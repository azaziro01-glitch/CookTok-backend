const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function engagementRate(views, likes, comments, saves) {
  if (!views) return 0;
  return Math.round(((likes + comments + saves) / views) * 1000) / 10; // one decimal place
}

// GET /api/dashboard/summary - totals across everything the creator has posted
router.get("/summary", requireAuth, async (req, res) => {
  try {
    const totals = await pool.query(
      `SELECT
        (SELECT count(*) FROM recipes WHERE user_id = $1) AS recipe_count,
        (SELECT count(*) FROM views v JOIN recipes r ON r.id = v.recipe_id WHERE r.user_id = $1) AS total_views,
        (SELECT count(*) FROM likes l JOIN recipes r ON r.id = l.recipe_id WHERE r.user_id = $1) AS total_likes,
        (SELECT count(*) FROM saves s JOIN recipes r ON r.id = s.recipe_id WHERE r.user_id = $1) AS total_saves,
        (SELECT count(*) FROM comments c JOIN recipes r ON r.id = c.recipe_id WHERE r.user_id = $1) AS total_comments,
        (SELECT count(*) FROM follows WHERE following_id = $1) AS follower_count`,
      [req.userId]
    );
    const t = totals.rows[0];
    const views = Number(t.total_views);
    const likes = Number(t.total_likes);
    const saves = Number(t.total_saves);
    const comments = Number(t.total_comments);

    res.json({
      recipeCount: Number(t.recipe_count),
      totalViews: views,
      totalLikes: likes,
      totalSaves: saves,
      totalComments: comments,
      followerCount: Number(t.follower_count),
      engagementRate: engagementRate(views, likes, comments, saves),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load dashboard summary" });
  }
});

// GET /api/dashboard/recipes - per-video performance, best-performing first
router.get("/recipes", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.title, r.thumbnail_url, r.created_at,
              (SELECT count(*) FROM views v WHERE v.recipe_id = r.id) AS views,
              (SELECT count(*) FROM likes l WHERE l.recipe_id = r.id) AS likes,
              (SELECT count(*) FROM saves s WHERE s.recipe_id = r.id) AS saves,
              (SELECT count(*) FROM comments c WHERE c.recipe_id = r.id) AS comments
       FROM recipes r
       WHERE r.user_id = $1
       ORDER BY views DESC`,
      [req.userId]
    );
    const shaped = result.rows.map((r) => {
      const views = Number(r.views), likes = Number(r.likes), saves = Number(r.saves), comments = Number(r.comments);
      return {
        id: r.id, title: r.title, thumbnailUrl: r.thumbnail_url, createdAt: r.created_at,
        views, likes, saves, comments,
        engagementRate: engagementRate(views, likes, comments, saves),
      };
    });
    res.json({ recipes: shaped, bestPerforming: shaped.slice(0, 5) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load video performance" });
  }
});

// GET /api/dashboard/activity?limit=20 - recent likes/comments/saves/follows on the creator's content
router.get("/activity", requireAuth, async (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  try {
    const result = await pool.query(
      `(SELECT 'like' AS type, u.username, r.title AS recipe_title, r.id AS recipe_id, l.created_at
        FROM likes l JOIN recipes r ON r.id = l.recipe_id JOIN users u ON u.id = l.user_id
        WHERE r.user_id = $1)
       UNION ALL
       (SELECT 'save' AS type, u.username, r.title AS recipe_title, r.id AS recipe_id, s.created_at
        FROM saves s JOIN recipes r ON r.id = s.recipe_id JOIN users u ON u.id = s.user_id
        WHERE r.user_id = $1)
       UNION ALL
       (SELECT 'comment' AS type, u.username, r.title AS recipe_title, r.id AS recipe_id, c.created_at
        FROM comments c JOIN recipes r ON r.id = c.recipe_id JOIN users u ON u.id = c.user_id
        WHERE r.user_id = $1)
       UNION ALL
       (SELECT 'follow' AS type, u.username, NULL AS recipe_title, NULL AS recipe_id, f.created_at
        FROM follows f JOIN users u ON u.id = f.follower_id
        WHERE f.following_id = $1)
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.userId, limit]
    );
    res.json({ activity: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load recent activity" });
  }
});

module.exports = router;
