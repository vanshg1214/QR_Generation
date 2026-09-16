import { Router } from "express";
import { getSetting, setSetting } from "../db.js";
import { requireAuth } from "../auth.js";

export const settingsRoutes = Router();

settingsRoutes.get("/settings", requireAuth, async (req, res) => {
  res.json({
    destinationUrl: (await getSetting("destination_url")) || "",
    publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  });
});

settingsRoutes.post("/settings", requireAuth, async (req, res) => {
  const { destinationUrl } = req.body || {};
  if (!destinationUrl || !/^https?:\/\//i.test(destinationUrl)) {
    return res.status(400).json({ error: "destinationUrl must be a valid http(s) URL" });
  }
  await setSetting("destination_url", destinationUrl);
  res.json({ ok: true });
});
