import crypto from "node:crypto";

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function checkPassword(password) {
  return safeEqual(password || "", process.env.ADMIN_PASSWORD || "");
}

export function requireAuth(req, res, next) {
  // TEMPORARY: set DISABLE_AUTH=true in .env to skip login during testing.
  // Set it back to false (or remove it) to re-enable the password screen.
  if (process.env.DISABLE_AUTH === "true") return next();
  if (req.session?.authenticated) return next();
  return res.status(401).json({ error: "Not authenticated" });
}
