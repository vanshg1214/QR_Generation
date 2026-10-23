# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

QR tracker: upload a spreadsheet of people, generate a unique QR code per person per campaign link, track scans via a redirect endpoint, and export QR images / spreadsheets / per-person letter PDFs. npm workspaces monorepo: `client/` (React + Vite dashboard) and `server/` (Express + Postgres, ESM). No tests or linter are configured.

## Commands

- `npm install` (root) — installs both workspaces
- `npm run dev` — runs server (`node --watch`, port 4000) and client (Vite) together; Vite proxies `/api` and `/r` to `localhost:4000`
- `npm run build` — builds the client to `client/dist`
- `npm start` — runs the server (which also serves `client/dist` if it exists)
- Server needs `server/.env` (copy `server/.env.example`): `DATABASE_URL` (Postgres/Supabase), `PUBLIC_BASE_URL`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `IP_HASH_SALT`. `DISABLE_AUTH=true` skips login for local testing.

## Architecture

**Deployment split:** the dashboard is deployed on Vercel and the API on Render. `client/src/api.js` hardcodes the Render URL as `API_BASE` in production (empty in dev, using the Vite proxy). `vercel.json` redirects `/r/:code` to the Render server so printed QR links on the dashboard domain still work. Cross-origin cookies depend on `FRONTEND_ORIGIN` (enables CORS and switches the session cookie to `SameSite=None; Secure`).

**Server (`server/src/`):**
- `index.js` mounts public routes first (`redirect.js` → `/r/:code`, `qr.js` → on-demand QR images), then `/api` routes (`authRoutes`, `campaigns`, `upload`, `export`) guarded by `requireAuth` (session cookie, single shared admin password).
- `db.js` — `pg` pool, `initSchema()` runs `CREATE TABLE IF NOT EXISTS` plus `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` on every boot (this is the migration mechanism — add new columns there). `migrateSingleLinkSchema` upgrades the legacy single-link schema in place. Use `withTransaction` for multi-statement writes.
- Data model: `campaigns` → `campaign_links` (a campaign has several destination URLs) and `people`; `codes` is one row per (person, link) with a unique short code; `scans` reference `codes`; `letter_qr_boxes` hold QR placement (fractions 0..1 of the graphic) per link. Campaign graphic is stored as BYTEA in `campaigns`.
- `redirect.js` — public scan tracker: logs a scan (deduped within 10s to ignore link-preview prefetches, IP salted+hashed) and always redirects, failing open to a fallback URL for unknown codes.
- `upload.js` — multer in-memory upload of xlsx/csv (parsed with SheetJS) creating campaign, people, codes; also handles graphic upload and the letters zip.
- `letters.js` + `pdf.js` — per-person letter PDFs with pdf-lib. A single "book" PDF embeds the campaign graphic and fonts once, each person adds a page (greeting, stamped QR codes, signature block), then pages are extracted individually. Embedding once is a deliberate performance choice; don't re-embed per person.

**Client (`client/src/`):** `App.jsx` gates on session (`Login.jsx`) then shows `CampaignsList` / `CampaignDetail` / `CreateCampaignPanel`. `api.js` is the single fetch wrapper (`credentials: "include"`). `LetterGraphicCalibrator.jsx` + `lib/detectBlankBoxes.js` let the user mark/auto-detect where QR codes go on the letter graphic and where the greeting sits (draggable). Charts use Recharts (`CampaignCharts.jsx`).
