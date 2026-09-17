import { Router } from "express";
import crypto from "node:crypto";
import { pool } from "../db.js";

export const redirectRoutes = Router();

function hashIp(ip) {
  const salt = process.env.IP_HASH_SALT || "";
  return crypto.createHash("sha256").update(salt + ip).digest("hex");
}

// Public, unauthenticated: this is the link encoded in each person's QR code.
redirectRoutes.get("/r/:code", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT co.id AS code_id, cl.destination_url
     FROM codes co
     JOIN campaign_links cl ON cl.id = co.campaign_link_id
     WHERE co.code = $1`,
    [req.params.code]
  );
  const match = rows[0];
  const fallback = match?.destination_url || "https://example.com";

  if (match) {
    // Camera apps and messaging apps often silently prefetch a link (to build a preview)
    // before the person actually opens it, which would otherwise inflate the scan count.
    // Collapse anything within a few seconds of the last scan into a single count.
    const { rows: recentRows } = await pool.query(
      "SELECT 1 FROM scans WHERE code_id = $1 AND scanned_at > now() - interval '10 seconds'",
      [match.code_id]
    );
    if (recentRows.length === 0) {
      await pool.query(
        "INSERT INTO scans (code_id, user_agent, ip_hash) VALUES ($1, $2, $3)",
        [match.code_id, req.headers["user-agent"] || null, hashIp(req.ip || "")]
      );
    }
  }

  // Fail open: even an unknown/mistyped code still lands the visitor on the
  // destination content instead of showing them an error.
  res.redirect(302, fallback);
});
