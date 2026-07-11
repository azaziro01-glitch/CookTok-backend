const jwt = require("jsonwebtoken");

// Requires a valid token. Rejects the request if missing/invalid.
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Attaches req.userId if a valid token is present, but doesn't reject if absent.
// Used for routes like the feed, where likes/saves should show as "not liked" for guests.
function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      req.userId = payload.sub;
    } catch {
      // ignore invalid token, treat as guest
    }
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
