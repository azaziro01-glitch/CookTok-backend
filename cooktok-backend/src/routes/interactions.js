const express = require("express");
const pool = require("../db");
const { requireAuth, optionalAuth } = require("../middleware/auth");

const router = express.Router();

// POST /api/recipes/:id/view - logs a view. Not auth-required (guests count),
// but attributes it to a user when logged in. Fire this once when a video
// starts playing in the feed, not on every scroll frame.
router.post("/:id/view", optionalAuth, async (req, res) => {
  try {
    await pool.query(
      "INSERT INTO views (recipe_id, viewer_id) VALUES ($1, $2)",
      [req.params.id, req.userId || null]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to log view" });
  }
});

// POST /api/recipes/:id/like  (toggle)
router.post("/:id/like", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await pool.query(
      "SELECT 1 FROM likes WHERE user_id = $1 AND recipe_id = $2",
      [req.userId, id]
    );
    if (existing.rows.length) {
      await pool.query("DELETE FROM likes WHERE user_id = $1 AND recipe_id = $2", [req.userId, id]);
    } else {
      await pool.query("INSERT INTO likes (user_id, recipe_id) VALUES ($1, $2)", [req.userId, id]);
    }
    const count = await pool.query("SELECT count(*) FROM likes WHERE recipe_id = $1", [id]);
    res.json({ liked: !existing.rows.length, likes: Number(count.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update like" });
  }
});

// POST /api/recipes/:id/save  (toggle)
router.post("/:id/save", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await pool.query(
      "SELECT 1 FROM saves WHERE user_id = $1 AND recipe_id = $2",
      [req.userId, id]
    );
    if (existing.rows.length) {
      await pool.query("DELETE FROM saves WHERE user_id = $1 AND recipe_id = $2", [req.userId, id]);
    } else {
      await pool.query("INSERT INTO saves (user_id, recipe_id) VALUES ($1, $2)", [req.userId, id]);
    }
    res.json({ saved: !existing.rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update save" });
  }
});

// GET /api/recipes/:id/comments
router.get("/:id/comments", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.body, c.created_at, u.username, u.avatar_url, u.id AS user_id
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.recipe_id = $1 ORDER BY c.created_at ASC`,
      [req.params.id]
    );
    res.json({ comments: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load comments" });
  }
});

// POST /api/recipes/:id/comments  { body }
router.post("/:id/comments", requireAuth, async (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: "Comment body is required" });
  try {
    const result = await pool.query(
      `INSERT INTO comments (recipe_id, user_id, body) VALUES ($1, $2, $3)
       RETURNING id, body, created_at`,
      [req.params.id, req.userId, body.trim()]
    );
    res.status(201).json({ comment: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add comment" });
  }
});

module.exports = router;
