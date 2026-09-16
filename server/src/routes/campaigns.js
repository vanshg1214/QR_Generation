import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../auth.js";

export const campaignRoutes = Router();

const CAMPAIGNS_LIST_QUERY = `
  SELECT
    c.id,
    c.name,
    c.destination_url,
    c.created_at,
    COUNT(DISTINCT p.id)::int AS people_count,
    COUNT(DISTINCT p.id) FILTER (WHERE s.id IS NOT NULL)::int AS viewed_count,
    COUNT(s.id)::int AS total_scans
  FROM campaigns c
  LEFT JOIN people p ON p.campaign_id = c.id
  LEFT JOIN scans s ON s.person_id = p.id
  GROUP BY c.id
  ORDER BY c.created_at DESC
`;

campaignRoutes.get("/campaigns", requireAuth, async (req, res) => {
  const { rows } = await pool.query(CAMPAIGNS_LIST_QUERY);
  res.json({
    campaigns: rows.map((r) => ({
      id: r.id,
      name: r.name,
      destinationUrl: r.destination_url,
      createdAt: r.created_at,
      peopleCount: r.people_count,
      viewedCount: r.viewed_count,
      totalScans: r.total_scans,
    })),
  });
});

const CAMPAIGN_PEOPLE_QUERY = `
  SELECT p.id, p.code, p.name, p.details_json, p.created_at, s.scanned_at
  FROM people p
  LEFT JOIN scans s ON s.person_id = p.id
  WHERE p.campaign_id = $1
  ORDER BY LOWER(p.name) ASC, s.scanned_at ASC
`;

campaignRoutes.get("/campaigns/:id", requireAuth, async (req, res) => {
  const campaignId = Number(req.params.id);
  if (!Number.isInteger(campaignId)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }

  const { rows: campaignRows } = await pool.query("SELECT * FROM campaigns WHERE id = $1", [
    campaignId,
  ]);
  const campaign = campaignRows[0];
  if (!campaign) {
    return res.status(404).json({ error: "Campaign not found" });
  }

  const { rows } = await pool.query(CAMPAIGN_PEOPLE_QUERY, [campaignId]);

  const peopleById = new Map();
  for (const row of rows) {
    if (!peopleById.has(row.id)) {
      peopleById.set(row.id, {
        id: row.id,
        code: row.code,
        name: row.name,
        details: JSON.parse(row.details_json || "{}"),
        createdAt: row.created_at,
        scans: [],
      });
    }
    if (row.scanned_at) {
      peopleById.get(row.id).scans.push(row.scanned_at);
    }
  }

  const people = Array.from(peopleById.values()).map((p) => ({
    ...p,
    scanCount: p.scans.length,
    lastScannedAt: p.scans.length ? p.scans[p.scans.length - 1] : null,
    viewed: p.scans.length > 0,
  }));

  const summary = {
    totalPeople: people.length,
    totalViewed: people.filter((p) => p.viewed).length,
    totalScans: people.reduce((sum, p) => sum + p.scanCount, 0),
  };

  res.json({
    campaign: {
      id: campaign.id,
      name: campaign.name,
      destinationUrl: campaign.destination_url,
      createdAt: campaign.created_at,
    },
    people,
    summary,
  });
});

campaignRoutes.patch("/campaigns/:id", requireAuth, async (req, res) => {
  const campaignId = Number(req.params.id);
  if (!Number.isInteger(campaignId)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }

  const { destinationUrl, name } = req.body || {};
  const fields = [];
  const values = [];
  let idx = 1;

  if (destinationUrl !== undefined) {
    if (!/^https?:\/\//i.test(destinationUrl)) {
      return res.status(400).json({ error: "destinationUrl must be a valid http(s) URL" });
    }
    fields.push(`destination_url = $${idx++}`);
    values.push(destinationUrl);
  }
  if (name !== undefined) {
    if (!name.trim()) {
      return res.status(400).json({ error: "name cannot be empty" });
    }
    fields.push(`name = $${idx++}`);
    values.push(name.trim());
  }
  if (!fields.length) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  values.push(campaignId);
  const result = await pool.query(
    `UPDATE campaigns SET ${fields.join(", ")} WHERE id = $${idx}`,
    values
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Campaign not found" });
  }
  res.json({ ok: true });
});
