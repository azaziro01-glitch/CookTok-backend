# CookTok — Full Deployment Guide

Deployment order matters: database → storage → backend → frontend. Each step needs values from the one before it.

---

## 1. Supabase (PostgreSQL)

1. Create an account at supabase.com → **New project**. Pick a strong database password (you'll need it in step 3) and the region closest to your users.
2. Wait for provisioning (~2 min), then go to **SQL Editor**.
3. Open `cooktok-backend/schema.sql` from this project, paste its full contents, and click **Run**. This creates all tables, triggers, and indexes in one shot.
4. Go to **Project Settings → Database → Connection string → URI**. Copy it — this is your `DATABASE_URL`. It looks like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres
   ```
   Replace `[YOUR-PASSWORD]` with the password from step 1.

**If you already have an older CookTok database** (from before search or analytics were added), don't re-run `schema.sql` — run these instead, in order, via the SQL Editor:
- `migrations/002_add_search.sql`
- `migrations/003_analytics.sql`

Both use `IF NOT EXISTS` guards, so they're safe to run even if partially applied already.

---

## 2. Cloudinary (video + image storage)

1. Create an account at cloudinary.com → free tier is enough to start.
2. Dashboard home page shows **Cloud name**, **API Key**, **API Secret**. Copy all three.
3. Nothing else to configure — the backend creates the `cooktok/videos` and `cooktok/avatars` folders automatically on first upload.

---

## 3. Backend deployment

### Option A: Railway (recommended)

1. Push the `cooktok-backend` folder to its own GitHub repo (or a subfolder of a monorepo — Railway lets you set a root directory).
2. At railway.app → **New Project → Deploy from GitHub repo** → select the repo.
3. If it's a monorepo, set **Root Directory** to `cooktok-backend` in the service settings.
4. Go to the service's **Variables** tab and add:
   | Key | Value |
   |---|---|
   | `DATABASE_URL` | from Supabase, step 1.4 |
   | `JWT_SECRET` | a long random string — generate with `openssl rand -hex 32` |
   | `JWT_EXPIRES_IN` | `7d` |
   | `CLOUDINARY_CLOUD_NAME` | from Cloudinary |
   | `CLOUDINARY_API_KEY` | from Cloudinary |
   | `CLOUDINARY_API_SECRET` | from Cloudinary |
   | `CORS_ORIGIN` | your Vercel URL — you won't have this yet, see the note below |
   | `PORT` | Railway sets this automatically; you can leave it unset |
5. Railway detects Node from `package.json` and runs `npm install && npm start` automatically. Deploy.
6. Under **Settings → Networking**, click **Generate Domain**. This gives you a public URL like `https://cooktok-api-production.up.railway.app` — this is your backend's `API_BASE_URL`.
7. Visit `https://<your-railway-domain>/health` — you should see `{"status":"ok"}`.

**About `CORS_ORIGIN`:** you need the frontend's URL before you can set this correctly, but you need the backend's URL before deploying the frontend. Resolve the chicken-and-egg by deploying the backend first with `CORS_ORIGIN` temporarily unset (defaults to `*`, which works but is permissive), then circle back and set it to your real Vercel URL once you have it (step 4), then redeploy.

### Option B: Render

1. render.com → **New → Web Service** → connect the repo.
2. Root directory: `cooktok-backend` (if monorepo).
3. Build command: `npm install`. Start command: `npm start`.
4. Add the same environment variables as the Railway table above, in **Environment**.
5. Deploy. Render gives you a URL like `https://cooktok-api.onrender.com`.
6. Note: Render's free tier spins the service down after inactivity — the first request after idle can take 30–60s to wake it up. Fine for testing, worth upgrading before real users.

---

## 4. Frontend deployment (Vercel)

The chat artifact isn't itself deployable — it's a component that needs a real build tool around it. Use the `cooktok-frontend` project included here (a minimal Vite + Tailwind app that wraps the same component).

1. Push `cooktok-frontend` to GitHub (its own repo, or another folder in the monorepo).
2. vercel.com → **Add New → Project** → import the repo.
3. If it's a monorepo, set **Root Directory** to `cooktok-frontend`.
4. Vercel auto-detects Vite (build command `vite build`, output `dist`) — leave the defaults.
5. Under **Environment Variables**, add:
   | Key | Value |
   |---|---|
   | `VITE_API_BASE_URL` | your Railway/Render backend URL from step 3, e.g. `https://cooktok-api-production.up.railway.app` |
6. Deploy. Vercel gives you a URL like `https://cooktok.vercel.app`.
7. **Now go back to your backend host** and set `CORS_ORIGIN` to this exact URL (no trailing slash), then redeploy the backend so the new env var takes effect.

### Updating `API_BASE_URL` later
If you ever move the backend (new host, custom domain), you only need to change one thing: the `VITE_API_BASE_URL` environment variable in Vercel's project settings, then trigger a redeploy (Vercel → Deployments → ⋯ → Redeploy). It's baked into the build at build time, not read at runtime, so a redeploy is required — editing the variable alone doesn't update a live site.

### Custom domain (optional)
Vercel → Project → **Settings → Domains** → add your domain, follow the DNS instructions shown. If you do this, update `CORS_ORIGIN` on the backend to the custom domain too.

---

## 5. Environment variable summary

**Backend** (Railway/Render):
```
DATABASE_URL=postgresql://postgres:...@db.xxx.supabase.co:5432/postgres
JWT_SECRET=<32+ random hex chars>
JWT_EXPIRES_IN=7d
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
CORS_ORIGIN=https://cooktok.vercel.app
```

**Frontend** (Vercel):
```
VITE_API_BASE_URL=https://cooktok-api-production.up.railway.app
```

---

## 6. CORS settings, explained

The backend's `src/index.js` does:
```js
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
```
- `CORS_ORIGIN` should be a single exact origin in production (scheme + host, no path, no trailing slash) — e.g. `https://cooktok.vercel.app`, not `https://cooktok.vercel.app/` or `cooktok.vercel.app`.
- Using `*` (the default if unset) works for testing but allows any site to call your API — fine while you're the only client, but tighten it before sharing the app publicly.
- If you need multiple allowed origins (e.g. a Vercel preview URL plus production), change that line to check against an array — ask if you want that wired up.

---

## 7. Common errors and fixes

| Symptom | Cause | Fix |
|---|---|---|
| Frontend shows "Couldn't reach the API" | `VITE_API_BASE_URL` wrong, unset, or backend down | Check the value in Vercel env vars, confirm `/health` responds on the backend URL directly |
| Browser console: CORS error, "No 'Access-Control-Allow-Origin' header" | `CORS_ORIGIN` on backend doesn't match the frontend's actual URL | Set `CORS_ORIGIN` to the exact Vercel URL, redeploy backend |
| 500 error on any DB-backed route | `DATABASE_URL` wrong, or schema not applied | Test the connection string with `psql "<DATABASE_URL>"`; confirm tables exist via Supabase Table Editor |
| `password authentication failed for user "postgres"` | Wrong password in `DATABASE_URL`, or password has unescaped special characters | Reset the DB password in Supabase, or URL-encode special characters (`@` → `%40`, etc.) |
| Video upload hangs or fails with a Cloudinary error | Wrong Cloudinary credentials, or file exceeds 200MB | Double-check `CLOUDINARY_*` vars; confirm file size |
| `relation "recipes" does not exist` | `schema.sql` was never run against this database | Re-run it in Supabase's SQL Editor |
| Search returns nothing even for obvious matches | Migrations 002/003 not applied, so `search_vector` column doesn't exist or isn't populated | Run `migrations/002_add_search.sql`; it also fires a trigger update on existing rows |
| `column "views" does not exist` or dashboard 500s | `migrations/003_analytics.sql` not applied | Run it in Supabase's SQL Editor |
| Login works but `/api/auth/me` returns 401 | `JWT_SECRET` differs between when the token was issued and now (e.g. you regenerated the secret) | Log out and log back in; don't rotate `JWT_SECRET` without expecting existing sessions to invalidate |
| Railway/Render build fails on `npm install` | Root directory not set correctly in a monorepo | Set the service's root directory to `cooktok-backend` (or `cooktok-frontend` for Vercel) |
| Render backend is slow on first request | Free tier spins down when idle | Expected behavior; upgrade the plan or ping `/health` periodically to keep it warm |
| Vercel build fails: "Cannot find module 'tailwindcss'" | `devDependencies` not installed | Shouldn't happen with the provided `package.json`, but if you edited it, make sure `tailwindcss`, `postcss`, `autoprefixer` stay in `devDependencies` |
| Uploaded avatar/video doesn't show after publishing | Cloudinary returned a URL but the recipe row wasn't updated, or ad blocker is blocking Cloudinary's CDN domain | Check the Cloudinary Media Library to confirm the asset exists; try a different network/browser to rule out ad blockers |

---

## 8. Quick verification checklist

After deploying everything:
1. `curl https://<backend-url>/health` → `{"status":"ok"}`
2. Visit the Vercel URL → should show the login/register screen, not a blank page or fetch error
3. Register a test account → should redirect into the feed
4. Publish a recipe with a short test video → should appear at the top of the feed within a few seconds
5. Like, save, and comment on it → counts should update without a page refresh
6. Open the Discover tab and search for a word from the test recipe's title → should appear in results
7. Open your profile → Analytics → should show 1 view (from step 4 loading it), your like/save/comment counts

If all seven pass, the full stack is wired up correctly.
