import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../auth.js";
import QRCode from "qrcode";
import archiver from "archiver";
import { failZip, sanitizeFilename, uniqueNamer } from "../zipStream.js";
import { createLetterBook, saveLetterBook, addPersonLetter } from "../letters.js";
import { resolveTextStyles } from "../textStyles.js";

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

campaignRoutes.delete("/campaigns/:id", requireAuth, async (req, res) => {
  const campaignId = Number(req.params.id);
  if (!Number.isInteger(campaignId)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }
  const result = await pool.query("DELETE FROM campaigns WHERE id = $1", [campaignId]);
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Campaign not found" });
  }
  res.json({ ok: true });
});

campaignRoutes.get("/campaigns/:id/download-qr.zip", requireAuth, async (req, res) => {
  const campaignId = Number(req.params.id);
  if (!Number.isInteger(campaignId)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }

  const { rows: campaignRows } = await pool.query(
    "SELECT name, graphic_data, graphic_mime, signature_name, signature_title, typography, include_greeting, greeting_pos_json, letter_padding, qr_caption_json, text_styles_json FROM campaigns WHERE id = $1",
    [campaignId]
  );
  if (!campaignRows[0]) {
    return res.status(404).json({ error: "Campaign not found" });
  }
  const campaignName = campaignRows[0].name;
  const graphicData = campaignRows[0].graphic_data;
  const graphicMime = campaignRows[0].graphic_mime;
  const signatureName = campaignRows[0].signature_name;
  const signatureTitle = campaignRows[0].signature_title;
  const typography = campaignRows[0].typography || "sans-serif";
  const includeGreeting = campaignRows[0].include_greeting ?? true;
  const padding = campaignRows[0].letter_padding ?? false;
  let qrCaption = null;
  try { if (campaignRows[0].qr_caption_json) qrCaption = JSON.parse(campaignRows[0].qr_caption_json); } catch { /* ignore */ }
  const textStyles = resolveTextStyles(campaignRows[0].text_styles_json, typography, qrCaption);
  let greetingPos = null;
  try { if (campaignRows[0].greeting_pos_json) greetingPos = JSON.parse(campaignRows[0].greeting_pos_json); } catch { /* ignore */ }

  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

  const { rows } = await pool.query(
    // Sheet order (p.id), the same order as the original download.
    `SELECT p.id AS person_id, p.name AS person_name, cl.label AS link_label, cl.id AS campaign_link_id, co.code
     FROM codes co
     JOIN people p ON p.id = co.person_id
     JOIN campaign_links cl ON cl.id = co.campaign_link_id
     WHERE p.campaign_id = $1
     ORDER BY p.id ASC, cl.position ASC`,
    [campaignId]
  );

  if (!rows.length) {
    return res.status(404).json({ error: "No QR codes found for this campaign" });
  }

  const { rows: boxRows } = await pool.query(
    `SELECT lqb.campaign_link_id, lqb.x, lqb.y, lqb.width, lqb.height
     FROM letter_qr_boxes lqb
     JOIN campaign_links cl ON cl.id = lqb.campaign_link_id
     WHERE cl.campaign_id = $1
     ORDER BY lqb.id`,
    [campaignId]
  );
  const boxes = boxRows.map((r) => ({
    campaignLinkId: r.campaign_link_id,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
  }));

  // Group by person id, not name: two people with the same name each get their own
  // page and folder, exactly as in the original download.
  const byPerson = new Map();
  for (const row of rows) {
    if (!byPerson.has(row.person_id)) byPerson.set(row.person_id, { name: row.person_name, links: [] });
    byPerson
      .get(row.person_id)
      .links.push({ label: row.link_label, code: row.code, campaignLinkId: row.campaign_link_id });
  }

  const archive = archiver("zip", { zlib: { level: 1 } });
  archive.on("error", (err) => failZip(res, archive, err));

  try {
    // Everything that can fail (building the PDFs) happens BEFORE any bytes are sent,
    // so a failure returns a clean error instead of a truncated, invalid zip.
    // The campaign graphic is embedded ONCE into a shared "book" and reused for
    // every person's page -- re-embedding a multi-megabyte image per person is
    // what made this slow.
    const book = graphicData ? await createLetterBook(graphicData, graphicMime) : null;

    const personFolders = [];
    const qrFiles = [];
    const personFolderName = uniqueNamer();
    for (const { name: personName, links } of byPerson.values()) {
      const folder = personFolderName(personName);
      personFolders.push(folder);
      const linkFileName = uniqueNamer();
      for (const { label, code } of links) {
        const url = `${publicBaseUrl}/r/${code}`;
        const pngBuffer = await QRCode.toBuffer(url, { width: 512, margin: 2 });
        qrFiles.push({ name: `${folder}/${linkFileName(label)}.png`, data: pngBuffer });
      }

      if (book) {
        await addPersonLetter({
          book,
          personName,
          codesForPerson: links,
          boxes,
          signatureName,
          signatureTitle,
          includeGreeting,
          greetingPos,
          padding,
          qrCaption,
          textStyles,
          publicBaseUrl,
        });
      }
    }

    const combinedBytes = book ? await saveLetterBook(book) : null;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(campaignName)}-qr-codes.zip"`);
    archive.pipe(res);

    for (const f of qrFiles) archive.append(f.data, { name: f.name });
    // One combined PDF for printing: one page per person, the graphic embedded once. Per-person
    // Letter.pdf files are deliberately not included -- each would carry its own full copy of
    // the graphic (hundreds of MB for a large campaign) and can't be produced without it.
    if (combinedBytes) archive.append(Buffer.from(combinedBytes), { name: "All Letters.pdf" });

    await archive.finalize();
  } catch (err) {
    failZip(res, archive, err);
  }
});
