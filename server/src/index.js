import "dotenv/config";
import express from "express";
import session from "express-session";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { authRoutes } from "./routes/authRoutes.js";
import { redirectRoutes } from "./routes/redirect.js";
import { qrRoutes } from "./routes/qr.js";
import { campaignRoutes } from "./routes/campaigns.js";
import { uploadRoutes } from "./routes/upload.js";
import { exportRoutes } from "./routes/export.js";
import { initSchema } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set("trust proxy", 1);

// FRONTEND_ORIGIN: comma-separated list of origins allowed to call this API from a browser
// (needed when the dashboard is deployed separately from this server, e.g. on Vercel).
// Leave unset when the dashboard is served by this same server — no cross-origin calls to allow.
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (allowedOrigins.length) {
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    })
  );
}

app.use(express.json());

const isProduction = process.env.NODE_ENV === "production";

app.use(
  session({
    name: "qr_tracker_sid",
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Cross-site (dashboard on a different domain than this API) requires
      // SameSite=None, which browsers only honor on Secure (HTTPS) cookies.
      sameSite: allowedOrigins.length ? "none" : "lax",
      secure: isProduction || allowedOrigins.length > 0,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    },
  })
);

// Public: the redirect/tracking endpoint QR codes actually point to, and the
// on-demand QR image endpoint used from exported spreadsheets.
app.use(redirectRoutes);
app.use(qrRoutes);

// Everything else the dashboard needs, all password-protected except /api/login and /api/session.
app.use("/api", authRoutes);
app.use("/api", campaignRoutes);
app.use("/api", uploadRoutes);
app.use("/api", exportRoutes);

// Serve the built React dashboard in production.
const clientDist = path.join(__dirname, "..", "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/r\/|\/qr\/).*/, (req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = process.env.PORT || 4000;

initSchema()
  .then(() => {
    app.listen(port, () => {
      console.log(`QR tracker server listening on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database schema:", err);
    process.exit(1);
  });
