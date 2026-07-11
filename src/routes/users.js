const express = require("express");
const pool = require("../db");
const { requireAuth, optionalAuth } = require("../middleware/auth");
const { cloudinary, uploadAvatar } = require("../cloudinary");

const router = express.Router();

// PATCH /api/users/me - update display name, bio, and/or avatar (multipart)
router.patch("/me", requireAuth, uploadAvatar.single("avatar"), async (req, res) => {
  try {
    const { displayName, bio } = req.body;
    const current = await pool.query("SELECT * FROM users WHERE id = $1", [req.userId]);
    const existing = current.rows[0];
    if (!existing) return res.status(404).json({ error: "User not found" });

    let avatarUrl = existing.avatar_url;
    let avatarPublicId = existing.avatar_public_id;
    if (req.file) {
      if (existing.avatar_public_id) {
        await cloudinary.uploader.destroy(existing.avatar_public_id, { resource_type: "image" }).catch(() => {});
      }
      avatarUrl = req.file.path;
      avatarPublicId = req.file.filename;
    }

    const result = await pool.query(
      `UPDATE users SET
         display_name = COALESCE($1, display_name),
         bio = COALESCE($2, bio),
         avatar_url = $3,
         avatar_public_id = $4
       WHERE id = $5 RETURNING *`,
      [displayName ?? null, bio ?? null, avatarUrl, avatarPublicId, req.userId]
    );
    const u = result.rows[0];
    res.json({
      user: {
        id: u.id, username: u.username, email: u.email,
        displayName: u.display_name, bio: u.bio, avatarUrl: u.avatar_url,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// GET /api/users/:username
router.get("/:username", optionalAuth, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [req.params.username]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });

    const [{ count: recipeCount }] = (await pool.query(
      "SELECT count(*) FROM recipes WHERE user_id = $1", [user.id]
    )).rows;
    const [{ count: followerCount }] = (await pool.query(
      "SELECT count(*) FROM follows WHERE following_id = $1", [user.id]
    )).rows;

    res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        bio: user.bio,
        avatarUrl: user.avatar_url,
        recipeCount: Number(recipeCount),
        followerCount: Number(followerCount),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load profile" });
  }
});

// GET /api/users/:username/recipes
router.get("/:username/recipes", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.username, u.avatar_url,
              (SELECT count(*) FROM likes l WHERE l.recipe_id = r.id) AS like_count,
              (SELECT count(*) FROM comments c WHERE c.recipe_id = r.id) AS comment_count
       FROM recipes r JOIN users u ON u.id = r.user_id
       WHERE u.username = $1 ORDER BY r.created_at DESC`,
      [req.params.username]
    );
    res.json({ recipes: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load user's recipes" });
  }
});

// GET /api/users/me/saved - the logged-in user's saved recipes
router.get("/me/saved", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.username, u.avatar_url
       FROM saves s
       JOIN recipes r ON r.id = s.recipe_id
       JOIN users u ON u.id = r.user_id
       WHERE s.user_id = $1 ORDER BY s.created_at DESC`,
      [req.userId]
    );
    res.json({ recipes: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load saved recipes" });
  }
});

// POST /api/users/:username/follow (toggle)
router.post("/:username/follow", requireAuth, async (req, res) => {
  try {
    const target = await pool.query("SELECT id FROM users WHERE username = $1", [req.params.username]);
    if (!target.rows[0]) return res.status(404).json({ error: "User not found" });
    const targetId = target.rows[0].id;
    if (targetId === req.userId) return res.status(400).json({ error: "Cannot follow yourself" });

    const existing = await pool.query(
      "SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2",
      [req.userId, targetId]
    );
    if (existing.rows.length) {
      await pool.query("DELETE FROM follows WHERE follower_id = $1 AND following_id = $2", [req.userId, targetId]);
    } else {
      await pool.query("INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)", [req.userId, targetId]);
    }
    res.json({ following: !existing.rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update follow" });
  }
});

module.exports = router;
