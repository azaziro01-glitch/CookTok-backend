# CookTok API

Express + PostgreSQL backend for the CookTok prototype: auth, recipes, video upload (Cloudinary), likes, saves, comments, profiles.

## 1. Local setup

```bash
cd cooktok-backend
npm install
cp .env.example .env   # then fill in the values below
```

### Get a database (Supabase, free tier)
1. Create a project at supabase.com.
2. Project Settings → Database → Connection string → URI. Copy it into `DATABASE_URL`.
3. SQL Editor → paste the contents of `schema.sql` → Run.

### Get video storage (Cloudinary, free tier)
1. Create an account at cloudinary.com.
2. Dashboard shows Cloud name, API key, API secret → copy into `.env`.

### Run it
```bash
npm run dev      # nodemon, auto-restart
# or
npm start
```
Server starts on `http://localhost:4000`. Check `http://localhost:4000/health`.

## 2. Database schema

See `schema.sql`. Tables: `users`, `recipes`, `likes`, `saves`, `comments`, `follows`. Recipes store `ingredients`/`steps` as JSONB arrays and `tags` as a text array. Deleting a user or recipe cascades to its likes/saves/comments.

## 3. API reference

All bodies are JSON except recipe creation, which is `multipart/form-data`.

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | – | `{ username, email, password, displayName }` → `{ token, user }` |
| POST | `/api/auth/login` | – | `{ email, password }` → `{ token, user }` |
| GET | `/api/auth/me` | ✅ | Current user |
| GET | `/api/recipes/feed` | optional | Paginated feed, newest first. Search/filter params below |
| GET | `/api/recipes/meta` | – | Facet options (`mealCategories`, `difficulties`) for building filter UI |
| GET | `/api/recipes/:id` | optional | Single recipe |
| POST | `/api/recipes` | ✅ | Create recipe. Fields: `title, cuisine, country, mealCategory, difficulty, prep, cook, servings, tags` (space-separated), `ingredients`/`steps` (JSON string arrays), `video` (file field) |
| PATCH | `/api/users/me` | ✅ | Update profile. Fields: `displayName`, `bio`, `avatar` (image file field) |
| DELETE | `/api/recipes/:id` | ✅ | Owner only |
| POST | `/api/recipes/:id/like` | ✅ | Toggle like |
| POST | `/api/recipes/:id/save` | ✅ | Toggle save |
| GET | `/api/recipes/:id/comments` | – | List comments |
| POST | `/api/recipes/:id/comments` | ✅ | `{ body }` |
| GET | `/api/users/:username` | optional | Public profile |
| GET | `/api/users/:username/recipes` | – | That user's recipes |
| GET | `/api/users/me/saved` | ✅ | Logged-in user's saved recipes |
| POST | `/api/users/:username/follow` | ✅ | Toggle follow |
| GET | `/api/dashboard/summary` | ✅ | Totals: views, likes, saves, comments, followers, engagement rate |
| GET | `/api/dashboard/recipes` | ✅ | Per-video performance, best-performing first |
| GET | `/api/dashboard/activity?limit=20` | ✅ | Recent likes/saves/comments/follows on the creator's content |
| POST | `/api/recipes/:id/view` | optional | Logs a view (fire once per playback, not per scroll frame) |

Run `migrations/003_analytics.sql` if you're updating an existing database rather than starting fresh from `schema.sql`.

Authenticated requests need `Authorization: Bearer <token>`.

### Search & filter params on `GET /api/recipes/feed`

| Param | Matches |
|---|---|
| `q` | Free text across dish name, ingredients, cuisine, country, tags, and creator username. Prefix-matched (e.g. `choc` finds "chocolate") and ranked so dish name beats buried ingredient text. |
| `creator` | Username, partial match |
| `cuisine` | Exact, case-insensitive |
| `country` | Exact, case-insensitive |
| `mealCategory` | Exact — one of `/api/recipes/meta`'s `mealCategories` |
| `difficulty` | `Easy`, `Medium`, or `Hard` |
| `hashtag` | With or without leading `#` |
| `ingredient` | Substring match against any ingredient line |
| `minTime` / `maxTime` | Total minutes (prep + cook) |
| `page` / `limit` | Pagination |

Example: `GET /api/recipes/feed?q=jollof&mealCategory=Dinner&maxTime=60`

Full-text search runs against a `search_vector` column kept in sync by a database trigger (see `schema.sql` / `migrations/002_add_search.sql`), backed by a GIN index — so it stays fast as the recipe table grows. If you already ran the original `schema.sql` on Supabase, run `migrations/002_add_search.sql` to add the new columns and indexes without losing data.

### Example: publish a recipe with video (fetch)
```js
const form = new FormData();
form.append("title", "Smoky Jollof Rice");
form.append("cuisine", "West African");
form.append("difficulty", "Medium");
form.append("prep", 15);
form.append("cook", 45);
form.append("servings", 4);
form.append("ingredients", JSON.stringify(["4 cups rice", "6 tomatoes"]));
form.append("steps", JSON.stringify(["Blend tomatoes", "Simmer 20 min"]));
form.append("tags", "#jollof #onepot");
form.append("video", fileInput.files[0]);

await fetch(`${API_BASE_URL}/api/recipes`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
```

## 4. Deployment

**Database + storage:** Supabase (Postgres) and Cloudinary both stay as-is — they're already hosted.

**API server — Railway (recommended, free tier available):**
1. Push this `cooktok-backend` folder to a GitHub repo.
2. railway.app → New Project → Deploy from GitHub repo.
3. Add the same variables from `.env` under Variables (set `CORS_ORIGIN` to your frontend's deployed URL).
4. Railway auto-detects Node and runs `npm start`. Copy the generated public URL.

**Alternative — Render:**
1. render.com → New → Web Service → connect the repo.
2. Build command: `npm install`. Start command: `npm start`.
3. Add the same environment variables.

**Frontend:** set `API_BASE_URL` in the React app (see `API_BASE_URL` constant at the top of the component) to the deployed backend URL, e.g. `https://cooktok-api.up.railway.app`.

## 5. Notes / next steps
- Passwords are hashed with bcrypt; tokens are JWT, 7-day expiry by default.
- Video files are capped at 200MB and uploaded straight to Cloudinary via multer-storage-cloudinary — nothing touches the API server's disk.
- Not included yet, but straightforward to add on this schema: search/filtering, pagination cursors instead of offset, rate limiting, refresh tokens, email verification, admin moderation routes.
