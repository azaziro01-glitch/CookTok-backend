const express = require("express");
const pool = require("../db");
const { requireAuth, optionalAuth } = require("../middleware/auth");
const { upload, cloudinary } = require("../cloudinary");

const router = express.Router();

// Builds a prefix-matching tsquery from free-text input so "choc" still
// matches "chocolate". Strips characters that would break to_tsquery syntax.
function buildPrefixQuery(q) {
  const words = q
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean);
  if (!words.length) return null;
  return words.map((w) => `${w}:*`).join(" & ");
}

const MEAL_CATEGORIES = ["Breakfast", "Lunch", "Dinner", "Snack", "Dessert", "Drink", "BBQ", "Street Food"];

function shapeRecipe(row, viewerLiked, viewerSaved) {
  return {
    id: row.id,
    title: row.title,
    cuisine: row.cuisine,
    country: row.country,
    mealCategory: row.meal_category,
    difficulty: row.difficulty,
    prep: row.prep_minutes,
    cook: row.cook_minutes,
    servings: row.servings,
    ingredients: row.ingredients,
    steps: row.steps,
    tags: row.tags,
    videoUrl: row.video_url,
    thumbnailUrl: row.thumbnail_url,
    creator: { id: row.user_id, username: row.username, avatarUrl: row.avatar_url },
    views: Number(row.view_count) || 0,
    likes: Number(row.like_count) || 0,
    comments: Number(row.comment_count) || 0,
    liked: !!viewerLiked,
    saved: !!viewerSaved,
    createdAt: row.created_at,
  };
}

// GET /api/recipes/feed - paginated, newest first, with optional search/filters.
//
// Query params:
//   q             free text - matches dish name, ingredients, cuisine, country, tags (weighted, prefix match)
//   creator       username, partial match
//   cuisine       exact match, case-insensitive
//   country       exact match, case-insensitive
//   mealCategory  exact match (Breakfast, Lunch, Dinner, Snack, Dessert, Drink, BBQ, Street Food)
//   difficulty    Easy | Medium | Hard
//   hashtag       tag, with or without leading #
//   ingredient    substring match against any ingredient line
//   minTime       total minutes (prep+cook), lower bound
//   maxTime       total minutes (prep+cook), upper bound
//   page, limit   pagination
router.get("/feed", optionalAuth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(30, parseInt(req.query.limit) || 10);
  const offset = (page - 1) * limit;
  const {
    q, creator, cuisine, country, mealCategory, difficulty,
    hashtag, ingredient, minTime, maxTime,
  } = req.query;

  const conditions = [];
  const params = [req.userId || null]; // $1 always reserved for viewer id

  const addParam = (val) => { params.push(val); return `$${params.length}`; };

  if (q && q.trim()) {
    const tsQuery = buildPrefixQuery(q);
    if (tsQuery) {
      conditions.push(`(r.search_vector @@ to_tsquery('simple', ${addParam(tsQuery)}) OR u.username ILIKE ${addParam(`%${q.trim()}%`)})`);
    }
  }
  if (creator) conditions.push(`u.username ILIKE ${addParam(`%${creator}%`)}`);
  if (cuisine) conditions.push(`lower(r.cuisine) = lower(${addParam(cuisine)})`);
  if (country) conditions.push(`lower(r.country) = lower(${addParam(country)})`);
  if (mealCategory) conditions.push(`r.meal_category = ${addParam(mealCategory)}`);
  if (difficulty) conditions.push(`r.difficulty = ${addParam(difficulty)}`);
  if (hashtag) {
    const tag = hashtag.startsWith("#") ? hashtag : `#${hashtag}`;
    conditions.push(`r.tags @> ARRAY[${addParam(tag)}]::text[]`);
  }
  if (ingredient) {
    conditions.push(`EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(r.ingredients) ing
      WHERE ing ILIKE ${addParam(`%${ingredient}%`)}
    )`);
  }
  if (minTime) conditions.push(`(r.prep_minutes + r.cook_minutes) >= ${addParam(Number(minTime))}`);
  if (maxTime) conditions.push(`(r.prep_minutes + r.cook_minutes) <= ${addParam(Number(maxTime))}`);

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitParam = addParam(limit);
  const offsetParam = addParam(offset);

  try {
    const result = await pool.query(
      `SELECT r.*, u.username, u.avatar_url,
              (SELECT count(*) FROM views v WHERE v.recipe_id = r.id) AS view_count,
              (SELECT count(*) FROM likes l WHERE l.recipe_id = r.id) AS like_count,
              (SELECT count(*) FROM comments c WHERE c.recipe_id = r.id) AS comment_count,
              EXISTS (SELECT 1 FROM likes l2 WHERE l2.recipe_id = r.id AND l2.user_id = $1) AS viewer_liked,
              EXISTS (SELECT 1 FROM saves s2 WHERE s2.recipe_id = r.id AND s2.user_id = $1) AS viewer_saved
       FROM recipes r
       JOIN users u ON u.id = r.user_id
       ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params
    );
    res.json({
      recipes: result.rows.map((r) => shapeRecipe(r, r.viewer_liked, r.viewer_saved)),
      page,
      limit,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load feed" });
  }
});

// GET /api/recipes/meta - static facet options for building filter UI
router.get("/meta", (_req, res) => {
  res.json({
    mealCategories: MEAL_CATEGORIES,
    difficulties: ["Easy", "Medium", "Hard"],
  });
});

// GET /api/recipes/:id
router.get("/:id", optionalAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.username, u.avatar_url,
              (SELECT count(*) FROM likes l WHERE l.recipe_id = r.id) AS like_count,
              (SELECT count(*) FROM comments c WHERE c.recipe_id = r.id) AS comment_count,
              EXISTS (SELECT 1 FROM likes l2 WHERE l2.recipe_id = r.id AND l2.user_id = $2) AS viewer_liked,
              EXISTS (SELECT 1 FROM saves s2 WHERE s2.recipe_id = r.id AND s2.user_id = $2) AS viewer_saved
       FROM recipes r JOIN users u ON u.id = r.user_id
       WHERE r.id = $1`,
      [req.params.id, req.userId || null]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Recipe not found" });
    res.json({ recipe: shapeRecipe(result.rows[0], result.rows[0].viewer_liked, result.rows[0].viewer_saved) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load recipe" });
  }
});

// POST /api/recipes - multipart/form-data with a "video" file field + recipe fields
router.post("/", requireAuth, upload.single("video"), async (req, res) => {
  try {
    const { title, cuisine, country, mealCategory, difficulty, prep, cook, servings, tags } = req.body;
    if (!title) return res.status(400).json({ error: "title is required" });

    const ingredients = JSON.parse(req.body.ingredients || "[]");
    const steps = JSON.parse(req.body.steps || "[]");
    const tagList = tags ? tags.split(" ").filter(Boolean) : [];

    const videoUrl = req.file?.path || null;
    const videoPublicId = req.file?.filename || null;
    const thumbnailUrl = videoUrl
      ? cloudinary.url(videoPublicId, { resource_type: "video", format: "jpg", start_offset: "1" })
      : null;

    const result = await pool.query(
      `INSERT INTO recipes
        (user_id, title, cuisine, country, meal_category, difficulty, prep_minutes, cook_minutes, servings,
         ingredients, steps, tags, video_url, thumbnail_url, video_public_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        req.userId, title, cuisine || null, country || null, mealCategory || null, difficulty || "Easy",
        Number(prep) || 0, Number(cook) || 0, Number(servings) || 1,
        JSON.stringify(ingredients), JSON.stringify(steps), tagList,
        videoUrl, thumbnailUrl, videoPublicId,
      ]
    );
    const user = await pool.query("SELECT username, avatar_url FROM users WHERE id = $1", [req.userId]);
    const row = { ...result.rows[0], username: user.rows[0].username, avatar_url: user.rows[0].avatar_url, like_count: 0, comment_count: 0 };
    res.status(201).json({ recipe: shapeRecipe(row, false, false) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to publish recipe" });
  }
});

// DELETE /api/recipes/:id - only the owner can delete
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const existing = await pool.query("SELECT * FROM recipes WHERE id = $1", [req.params.id]);
    const recipe = existing.rows[0];
    if (!recipe) return res.status(404).json({ error: "Recipe not found" });
    if (recipe.user_id !== req.userId) return res.status(403).json({ error: "Not your recipe" });

    if (recipe.video_public_id) {
      await cloudinary.uploader.destroy(recipe.video_public_id, { resource_type: "video" });
    }
    await pool.query("DELETE FROM recipes WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete recipe" });
  }
});

module.exports = router;
