import { asyncRouter } from "../asyncRouter.js";
import crypto from "node:crypto";
import { pool } from "../db.js";
import { isBotUserAgent } from "../analytics.js";

export const redirectRoutes = asyncRouter();

function hashIp(ip) {
  const salt = process.env.IP_HASH_SALT || "";
  return crypto.createHash("sha256").update(salt + ip).digest("hex");
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const FALLBACK_URL = "https://example.com";

// In-memory cache for ultra-fast code resolution (< 1ms, no blocking DB query).
// Map<code, { codeId, destinationUrl, campaignLinkId, isSample, cachedAt }>
const codeCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function cacheCode(code, codeId, destinationUrl, campaignLinkId = null, isSample = false) {
  codeCache.set(code, {
    codeId,
    destinationUrl,
    campaignLinkId,
    isSample,
    cachedAt: Date.now(),
  });
}

export function invalidateCodeCache() {
  codeCache.clear();
}

// Pre-populates the in-memory cache on startup so scan lookups don't wait for DB latency.
export async function warmCodeCache() {
  try {
    const { rows } = await pool.query(
      `SELECT co.code, co.id AS code_id, cl.destination_url, cl.id AS campaign_link_id
       FROM codes co
       JOIN campaign_links cl ON cl.id = co.campaign_link_id
       ORDER BY co.id DESC
       LIMIT 50000`
    );
    for (const r of rows) {
      cacheCode(r.code, r.code_id, r.destination_url, r.campaign_link_id, false);
    }
    console.log(`Pre-warmed QR redirect cache with ${rows.length} codes.`);
  } catch (err) {
    console.warn("Could not pre-warm QR code cache:", err.message);
  }
}

// Keep-alive / health endpoints for free monitoring services (e.g. UptimeRobot or cron-job.org)
// to prevent Render free-tier instances from sleeping.
redirectRoutes.get("/health", (req, res) => res.status(200).send("OK"));
redirectRoutes.get("/ping", (req, res) => res.status(200).send("pong"));

// Generates an instant, lightweight branded loading page that immediately opens the destination
// while visually showing the user the exact site they are navigating to.
function renderRedirectPage(destinationUrl) {
  let displayDomain = "your destination";
  try {
    const parsed = new URL(destinationUrl);
    displayDomain = parsed.hostname.replace(/^www\./, "");
  } catch {}

  const safeUrl = escapeHtml(destinationUrl);
  const safeDomain = escapeHtml(displayDomain);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Opening ${safeDomain}...</title>
  <meta http-equiv="refresh" content="0; url=${safeUrl}">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: #0b0f19;
      color: #f1f5f9;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
      text-align: center;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 20px;
      padding: 36px 24px;
      width: 100%;
      max-width: 380px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .spinner-wrap {
      position: relative;
      width: 56px;
      height: 56px;
      margin-bottom: 20px;
    }
    .spinner {
      width: 56px;
      height: 56px;
      border: 3px solid rgba(59, 130, 246, 0.15);
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    .spinner-glow {
      position: absolute;
      inset: -4px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(59, 130, 246, 0.3) 0%, transparent 70%);
      pointer-events: none;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    h1 {
      font-size: 19px;
      font-weight: 600;
      color: #ffffff;
      margin-bottom: 6px;
      letter-spacing: -0.01em;
    }
    .subtitle {
      font-size: 13px;
      color: #94a3b8;
      margin-bottom: 18px;
    }
    .dest-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: rgba(30, 41, 59, 0.85);
      border: 1px solid rgba(59, 130, 246, 0.35);
      padding: 10px 18px;
      border-radius: 9999px;
      color: #60a5fa;
      font-weight: 600;
      font-size: 15px;
      text-decoration: none;
      word-break: break-all;
      max-width: 100%;
      transition: background-color 0.2s;
    }
    .dest-pill:active {
      background: rgba(59, 130, 246, 0.25);
    }
    .btn {
      margin-top: 20px;
      font-size: 13px;
      color: #64748b;
      text-decoration: underline;
      background: none;
      border: none;
      cursor: pointer;
    }
  </style>
  <script>
    // Immediately redirect without leaving redirect hop in browser back history
    window.location.replace(${JSON.stringify(destinationUrl)});
  </script>
</head>
<body>
  <div class="card">
    <div class="spinner-wrap">
      <div class="spinner-glow"></div>
      <div class="spinner"></div>
    </div>
    <h1>Opening Website</h1>
    <p class="subtitle">Connecting you to:</p>
    <a href="${safeUrl}" class="dest-pill">
      <span>${safeDomain}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
        <polyline points="15 3 21 3 21 9"></polyline>
        <line x1="10" y1="14" x2="21" y2="3"></line>
      </svg>
    </a>
    <a href="${safeUrl}" class="btn">Tap if not redirected automatically</a>
  </div>
</body>
</html>`;
}

// Background scan recording (non-blocking: never delays the visitor's page transition)
function recordScanAsync(codeId, userAgent, ip) {
  if (!codeId) return;
  const isBot = isBotUserAgent(userAgent);
  const ipHash = hashIp(ip || "");

  pool
    .query(
      "SELECT 1 FROM scans WHERE code_id = $1 AND is_bot = $2 AND scanned_at > now() - interval '10 seconds'",
      [codeId, isBot]
    )
    .then(({ rows }) => {
      if (rows.length === 0) {
        return pool.query(
          "INSERT INTO scans (code_id, user_agent, ip_hash, is_bot) VALUES ($1, $2, $3, $4)",
          [codeId, userAgent, ipHash, isBot]
        );
      }
    })
    .catch((err) => {
      console.error("Could not record a scan:", err.message);
    });
}

// Public, unauthenticated: this is the link encoded in each person's QR code.
redirectRoutes.get("/r/:code", async (req, res) => {
  const code = req.params.code;
  const userAgent = req.headers["user-agent"] || null;
  const isBot = isBotUserAgent(userAgent);

  // 1. Check in-memory cache first (instant 0ms lookup)
  let cached = codeCache.get(code);
  let codeId = null;
  let destination = FALLBACK_URL;

  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    codeId = cached.codeId;
    destination = cached.destinationUrl;
  } else {
    // 2. Fallback to DB lookup if not in cache
    try {
      const { rows } = await pool.query(
        `SELECT co.id AS code_id, cl.destination_url, cl.id AS campaign_link_id
         FROM codes co
         JOIN campaign_links cl ON cl.id = co.campaign_link_id
         WHERE co.code = $1`,
        [code]
      );
      if (rows[0]) {
        codeId = rows[0].code_id;
        destination = rows[0].destination_url;
        cacheCode(code, codeId, destination, rows[0].campaign_link_id, false);
      } else {
        const { rows: sampleRows } = await pool.query(
          "SELECT destination_url FROM sample_codes WHERE code = $1",
          [code]
        );
        if (sampleRows[0]) {
          destination = sampleRows[0].destination_url;
          cacheCode(code, null, destination, null, true);
        }
      }
    } catch (err) {
      console.error("QR lookup failed:", err.message);
    }
  }

  // 3. Record scan in background without blocking redirect
  if (codeId) {
    recordScanAsync(codeId, userAgent, req.ip);
  }

  // 4. Send instant HTTP 302 redirect directly to destination
  // Responds in ~50ms from in-memory cache so the mobile browser immediately
  // switches its address bar away from Render to the destination website.
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  return res.redirect(302, destination);
});
