import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../auth.js";

export const campaignRoutes = Router();

const CAMPAIGNS_LIST_QUERY = `
  SELECT
    c.id,
    c.name,
    c.created_at,
    (SELECT COUNT(*) FROM people p WHERE p.campaign_id = c.id)::int AS people_count,
    (SELECT COUNT(*) FROM campaign_links cl WHERE cl.campaign_id = c.id)::int AS link_count,
    (
      SELECT COUNT(DISTINCT p2.id) FROM people p2
      JOIN codes co2 ON co2.person_id = p2.id
      JOIN scans s2 ON s2.code_id = co2.id
      WHERE p2.campaign_id = c.id
    )::int AS viewed_count,
    (
      SELECT COUNT(*) FROM people p3
      JOIN codes co3 ON co3.person_id = p3.id
      JOIN scans s3 ON s3.code_id = co3.id
      WHERE p3.campaign_id = c.id
    )::int AS total_scans
  FROM campaigns c
  ORDER BY c.created_at DESC
`;

campaignRoutes.get("/campaigns", requireAuth, async (req, res) => {
  const { rows } = await pool.query(CAMPAIGNS_LIST_QUERY);
  res.json({
    campaigns: rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      peopleCount: r.people_count,
      linkCount: r.link_count,
      viewedCount: r.viewed_count,
      totalScans: r.total_scans,
    })),
  });
});

const CAMPAIGN_PEOPLE_QUERY = `
  SELECT
    p.id AS person_id, p.name, p.details_json, p.created_at,
    cl.id AS link_id, cl.label, cl.position,
    co.code,
    s.scanned_at
  FROM people p
  JOIN codes co ON co.person_id = p.id
  JOIN campaign_links cl ON cl.id = co.campaign_link_id
  LEFT JOIN scans s ON s.code_id = co.id
  WHERE p.campaign_id = $1
  ORDER BY LOWER(p.name) ASC, cl.position ASC, s.scanned_at ASC
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

  const { rows: linkRows } = await pool.query(
    "SELECT id, label, destination_url, position FROM campaign_links WHERE campaign_id = $1 ORDER BY position ASC, id ASC",
    [campaignId]
  );

  const { rows } = await pool.query(CAMPAIGN_PEOPLE_QUERY, [campaignId]);

  const peopleById = new Map();
  for (const row of rows) {
    if (!peopleById.has(row.person_id)) {
      peopleById.set(row.person_id, {
        id: row.person_id,
        name: row.name,
        details: JSON.parse(row.details_json || "{}"),
        createdAt: row.created_at,
        linksById: new Map(),
      });
    }
    const person = peopleById.get(row.person_id);
    if (!person.linksById.has(row.link_id)) {
      person.linksById.set(row.link_id, {
        linkId: row.link_id,
        label: row.label,
        code: row.code,
        scans: [],
      });
    }
    if (row.scanned_at) {
      person.linksById.get(row.link_id).scans.push(row.scanned_at);
    }
  }

  const people = Array.from(peopleById.values()).map((p) => {
    const links = Array.from(p.linksById.values()).map((l) => ({
      ...l,
      scanCount: l.scans.length,
      lastScannedAt: l.scans.length ? l.scans[l.scans.length - 1] : null,
      viewed: l.scans.length > 0,
    }));
    const scanCount = links.reduce((sum, l) => sum + l.scanCount, 0);
    const lastScannedAt = links.reduce(
      (latest, l) => (l.lastScannedAt && (!latest || l.lastScannedAt > latest) ? l.lastScannedAt : latest),
      null
    );
    return {
      id: p.id,
      name: p.name,
      details: p.details,
      createdAt: p.createdAt,
      links,
      scanCount,
      lastScannedAt,
      viewed: scanCount > 0,
    };
  });

  const summary = {
    totalPeople: people.length,
    totalLinks: linkRows.length,
    totalViewed: people.filter((p) => p.viewed).length,
    totalScans: people.reduce((sum, p) => sum + p.scanCount, 0),
  };

  res.json({
    campaign: {
      id: campaign.id,
      name: campaign.name,
      createdAt: campaign.created_at,
    },
    links: linkRows.map((l) => ({
      id: l.id,
      label: l.label,
      destinationUrl: l.destination_url,
      position: l.position,
    })),
    people,
    summary,
  });
});

campaignRoutes.patch("/campaigns/:id", requireAuth, async (req, res) => {
  const campaignId = Number(req.params.id);
  if (!Number.isInteger(campaignId)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "name cannot be empty" });
  }
  const result = await pool.query("UPDATE campaigns SET name = $1 WHERE id = $2", [
    name.trim(),
    campaignId,
  ]);
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Campaign not found" });
  }
  res.json({ ok: true });
});

campaignRoutes.patch("/campaigns/:id/links/:linkId", requireAuth, async (req, res) => {
  const campaignId = Number(req.params.id);
  const linkId = Number(req.params.linkId);
  if (!Number.isInteger(campaignId) || !Number.isInteger(linkId)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const { destinationUrl, label } = req.body || {};
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
  if (label !== undefined) {
    if (!label.trim()) {
      return res.status(400).json({ error: "label cannot be empty" });
    }
    fields.push(`label = $${idx++}`);
    values.push(label.trim());
  }
  if (!fields.length) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  values.push(linkId, campaignId);
  const result = await pool.query(
    `UPDATE campaign_links SET ${fields.join(", ")} WHERE id = $${idx++} AND campaign_id = $${idx}`,
    values
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Link not found" });
  }
  res.json({ ok: true });
});
