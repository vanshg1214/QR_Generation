import { Router } from "express";
import QRCode from "qrcode";
import { pool } from "../db.js";

export const qrRoutes = Router();

// Public: regenerates a person's QR image on demand from their code, so an exported
// spreadsheet (or anyone with the link) can view/download it without logging in --
// knowing the code reveals nothing beyond what scanning the QR itself already would.
qrRoutes.get("/qr/:code.png", async (req, res) => {
  const { rows } = await pool.query("SELECT 1 FROM codes WHERE code = $1", [req.params.code]);
  if (!rows.length) {
    return res.status(404).json({ error: "Unknown code" });
  }

  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const url = `${publicBaseUrl}/r/${req.params.code}`;
  const pngBuffer = await QRCode.toBuffer(url, { width: 512, margin: 2 });

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(pngBuffer);
});
