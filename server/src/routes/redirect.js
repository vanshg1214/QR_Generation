import { asyncRouter } from "../asyncRouter.js";
import crypto from "node:crypto";
import { pool } from "../db.js";
import { isBotUserAgent } from "../analytics.js";

export const redirectRoutes = asyncRouter();

function hashIp(ip) {
  const salt = process.env.IP_HASH_SALT || "";
  return crypto.createHash("sha256").update(salt + ip).digest("hex");
}

const FALLBACK_URL = "https://example.com";

// Public, unauthenticated: this is the link encoded in each person's QR code. It always sends
// the visitor on, even if the database has a problem: a scan must never end on an error page.
redirectRoutes.get("/r/:code", async (req, res) => {
  let match = null;
  let destination = FALLBACK_URL;
  try {
    const { rows } = await pool.query(
      `SELECT co.id AS code_id, cl.destination_url
       FROM codes co
       JOIN campaign_links cl ON cl.id = co.campaign_link_id
       WHERE co.code = $1`,
      [req.params.code]
    );
    match = rows[0] || null;
    if (match) {
      destination = match.destination_url;
    } else {
      // A QR from a sample letter page: open the link, but don't count it as a scan.
      const { rows: sampleRows } = await pool.query("SELECT destination_url FROM sample_codes WHERE code = $1", [
        req.params.code,
      ]);
      if (sampleRows[0]) destination = sampleRows[0].destination_url;
    }
  } catch (err) {
    console.error("QR lookup failed:", err);
  }

  // Send the visitor on first, then record the scan, so saving it never slows the redirect.
  res.redirect(302, destination);
  if (!match) return;

  try {
    // Camera and messaging apps often open a link twice in a moment; scans within 10 seconds
    // of the last one count once. Link previews (e.g. WhatsApp fetching the link to show a
    // preview) are saved but marked, never counted, and don't block a real open right after.
    const userAgent = req.headers["user-agent"] || null;
    const isBot = isBotUserAgent(userAgent);
    const { rows: recentRows } = await pool.query(
      "SELECT 1 FROM scans WHERE code_id = $1 AND is_bot = $2 AND scanned_at > now() - interval '10 seconds'",
      [match.code_id, isBot]
    );
    if (recentRows.length === 0) {
      await pool.query("INSERT INTO scans (code_id, user_agent, ip_hash, is_bot) VALUES ($1, $2, $3, $4)", [
        match.code_id,
        userAgent,
        hashIp(req.ip || ""),
        isBot,
      ]);
    }
  } catch (err) {
    console.error("Could not record a scan:", err);
  }
});
