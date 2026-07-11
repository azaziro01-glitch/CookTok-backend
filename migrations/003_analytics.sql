-- Run after 002_add_search.sql.

CREATE TABLE IF NOT EXISTS views (
  id BIGSERIAL PRIMARY KEY,
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  viewer_id UUID REFERENCES users(id) ON DELETE SET NULL, -- nullable: anonymous viewers still count
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_views_recipe ON views (recipe_id);
CREATE INDEX IF NOT EXISTS idx_views_created ON views (created_at DESC);

-- follows(follower_id, following_id) has a PK on that column order, which
-- doesn't serve "who follows user X" lookups efficiently. Add the reverse index.
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows (following_id);
