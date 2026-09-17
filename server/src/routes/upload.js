import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import QRCode from "qrcode";
import archiver from "archiver";
import { customAlphabet } from "nanoid";
import { withTransaction } from "../db.js";
import { requireAuth } from "../auth.js";

export const uploadRoutes = Router();

const upload = multer({ storage: multer.memoryStorage() });

const MAX_LINKS = 10;

// Unambiguous alphabet (no 0/O, 1/I/l) since these codes may occasionally be typed manually.
const nanoid = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 8);

async function generateUniqueCode(client) {
  for (;;) {
    const code = nanoid();
    const { rows } = await client.query("SELECT 1 FROM codes WHERE code = $1", [code]);
    if (rows.length === 0) return code;
  }
}

function findNameKey(row) {
  const key = Object.keys(row).find((k) => k.trim().toLowerCase() === "name");
  return key || Object.keys(row)[0];
}

// SheetJS names a column "__EMPTY", "__EMPTY_1", etc. when its header cell was
// blank but some row still had data (or stray formatting) in that column.
// These aren't meaningful to store or display.
function stripAutoEmptyColumns(row) {
  const cleaned = {};
  for (const [key, value] of Object.entries(row)) {
    if (!/^__empty/i.test(key.trim())) cleaned[key] = value;
  }
  return cleaned;
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "item";
}

// Appends "_2", "_3", ... to keep names unique within a given scope (a zip folder, etc).
function uniqueNamer() {
  const used = new Map();
  return (rawName) => {
    const base = sanitizeFilename(rawName);
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  };
}

uploadRoutes.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const { campaignName } = req.body || {};
  if (!campaignName || !campaignName.trim()) {
    return res.status(400).json({ error: "campaignName is required" });
  }

  let links;
  try {
    links = JSON.parse(req.body.links || "[]");
  } catch {
    return res.status(400).json({ error: "links must be valid JSON" });
  }
  if (!Array.isArray(links) || links.length === 0) {
    return res.status(400).json({ error: "At least one link is required" });
  }
  if (links.length > MAX_LINKS) {
    return res.status(400).json({ error: `At most ${MAX_LINKS} links are allowed` });
  }
  for (const link of links) {
    if (!link.label || !link.label.trim()) {
      return res.status(400).json({ error: "Every link needs a label" });
    }
    if (!link.destinationUrl || !/^https?:\/\//i.test(link.destinationUrl)) {
      return res.status(400).json({ error: `"${link.label}" needs a valid http(s) destination URL` });
    }
  }

  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

  let sheetRows;
  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    sheetRows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
  } catch (err) {
    return res.status(400).json({ error: "Could not read the Excel file: " + err.message });
  }

  if (!sheetRows.length) {
    return res.status(400).json({ error: "The sheet has no data rows" });
  }

  const created = await withTransaction(async (client) => {
    const { rows: campaignRows } = await client.query(
      "INSERT INTO campaigns (name) VALUES ($1) RETURNING id",
      [campaignName.trim()]
    );
    const campaignId = campaignRows[0].id;

    const linkRows = [];
    for (let i = 0; i < links.length; i++) {
      const { rows } = await client.query(
        "INSERT INTO campaign_links (campaign_id, label, destination_url, position) VALUES ($1, $2, $3, $4) RETURNING id, label",
        [campaignId, links[i].label.trim(), links[i].destinationUrl, i]
      );
      linkRows.push(rows[0]);
    }

    const people = [];
    for (const rawRow of sheetRows) {
      const nameKey = findNameKey(rawRow);
      const name = String(rawRow[nameKey] ?? "").trim();
      if (!name) continue;

      const details = stripAutoEmptyColumns(rawRow);
      const { rows: personRows } = await client.query(
        "INSERT INTO people (campaign_id, name, details_json) VALUES ($1, $2, $3) RETURNING id",
        [campaignId, name, JSON.stringify(details)]
      );
      const personId = personRows[0].id;

      const codes = [];
      for (const link of linkRows) {
        const code = await generateUniqueCode(client);
        await client.query(
          "INSERT INTO codes (person_id, campaign_link_id, code) VALUES ($1, $2, $3)",
          [personId, link.id, code]
        );
        codes.push({ label: link.label, code });
      }
      people.push({ name, codes });
    }
    return { campaignId, people };
  });

  if (!created.people.length) {
    return res.status(400).json({ error: "No rows had a usable Name value" });
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="qr-codes.zip"`);

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    res.status(500).end(String(err));
  });
  archive.pipe(res);

  const personFolderName = uniqueNamer();
  for (const person of created.people) {
    const folder = personFolderName(person.name);
    const linkFileName = uniqueNamer();
    for (const { label, code } of person.codes) {
      const url = `${publicBaseUrl}/r/${code}`;
      const pngBuffer = await QRCode.toBuffer(url, { width: 512, margin: 2 });
      archive.append(pngBuffer, { name: `${folder}/${linkFileName(label)}.png` });
    }
  }

  await archive.finalize();
});
