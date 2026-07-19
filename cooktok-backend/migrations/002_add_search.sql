-- Run this if you already created the database from the original schema.sql.
-- Adds country/meal category fields, full-text search, and supporting indexes.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_public_id TEXT;

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS meal_category TEXT; -- Breakfast, Lunch, Dinner, Snack, Dessert, Drink, etc.
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Keeps search_vector in sync whenever a recipe is inserted or updated.
-- Weighted so dish name and creator-facing fields rank above buried ingredient text.
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

DROP TRIGGER IF EXISTS recipes_search_vector_trigger ON recipes;
CREATE TRIGGER recipes_search_vector_trigger
BEFORE INSERT OR UPDATE ON recipes
FOR EACH ROW EXECUTE FUNCTION recipes_search_vector_update();

-- Backfill existing rows
UPDATE recipes SET title = title;

CREATE INDEX IF NOT EXISTS idx_recipes_search_vector ON recipes USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_recipes_cuisine ON recipes (lower(cuisine));
CREATE INDEX IF NOT EXISTS idx_recipes_country ON recipes (lower(country));
CREATE INDEX IF NOT EXISTS idx_recipes_difficulty ON recipes (difficulty);
CREATE INDEX IF NOT EXISTS idx_recipes_meal_category ON recipes (meal_category);
CREATE INDEX IF NOT EXISTS idx_recipes_tags_gin ON recipes USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_recipes_total_time ON recipes ((prep_minutes + cook_minutes));
CREATE INDEX IF NOT EXISTS idx_users_username_trgm ON users USING GIN (username gin_trgm_ops);
