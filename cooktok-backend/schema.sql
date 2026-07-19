-- CookTok database schema (PostgreSQL / Supabase)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  avatar_public_id TEXT, -- Cloudinary asset id, used to replace/delete the old avatar
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  cuisine TEXT,
  country TEXT,
  meal_category TEXT, -- Breakfast, Lunch, Dinner, Snack, Dessert, Drink, etc.
  difficulty TEXT CHECK (difficulty IN ('Easy','Medium','Hard')),
  prep_minutes INT DEFAULT 0,
  cook_minutes INT DEFAULT 0,
  servings INT DEFAULT 1,
  ingredients JSONB NOT NULL DEFAULT '[]',
  steps JSONB NOT NULL DEFAULT '[]',
  tags TEXT[] DEFAULT '{}',
  video_url TEXT,
  thumbnail_url TEXT,
  video_public_id TEXT,          -- Cloudinary asset id, used for deletion
  search_vector tsvector,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Keeps search_vector in sync on every insert/update. Weighted so the dish
-- name and cuisine/country rank above ingredient text buried in the body.
CREATE OR REPLACE FUNCTION recipes_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.cuisine, '') || ' ' || coalesce(NEW.country, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.meal_category, '') || ' ' || coalesce(array_to_string(NEW.tags, ' '), '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(
      (SELECT string_agg(value, ' ') FROM jsonb_array_elements_text(NEW.ingredients) AS value), ''
    )), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER recipes_search_vector_trigger
BEFORE INSERT OR UPDATE ON recipes
FOR EACH ROW EXECUTE FUNCTION recipes_search_vector_update();

CREATE TABLE likes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, recipe_id)
);

CREATE TABLE saves (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, recipe_id)
);

CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE follows (
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE TABLE views (
  id BIGSERIAL PRIMARY KEY,
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  viewer_id UUID REFERENCES users(id) ON DELETE SET NULL, -- nullable: anonymous viewers still count
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_recipes_user ON recipes(user_id);
CREATE INDEX idx_recipes_created ON recipes(created_at DESC);
CREATE INDEX idx_comments_recipe ON comments(recipe_id);
CREATE INDEX idx_likes_recipe ON likes(recipe_id);

-- Search & filter indexes
CREATE INDEX idx_recipes_search_vector ON recipes USING GIN (search_vector);
CREATE INDEX idx_recipes_cuisine ON recipes (lower(cuisine));
CREATE INDEX idx_recipes_country ON recipes (lower(country));
CREATE INDEX idx_recipes_difficulty ON recipes (difficulty);
CREATE INDEX idx_recipes_meal_category ON recipes (meal_category);
CREATE INDEX idx_recipes_tags_gin ON recipes USING GIN (tags);
CREATE INDEX idx_recipes_total_time ON recipes ((prep_minutes + cook_minutes));
CREATE INDEX idx_users_username_trgm ON users USING GIN (username gin_trgm_ops);

-- Analytics indexes
CREATE INDEX idx_views_recipe ON views (recipe_id);
CREATE INDEX idx_views_created ON views (created_at DESC);
CREATE INDEX idx_follows_following ON follows (following_id);
