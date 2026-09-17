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

// Unambiguous alphabet (no 0/O, 1/I/l) since these codes may occasionally be typed manually.
const nanoid = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 8);

async function generateUniqueCode(client) {
  for (;;) {
    const code = nanoid();
    const { rows } = await client.query("SELECT 1 FROM people WHERE code = $1", [code]);
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
  return name.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "person";
}

uploadRoutes.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const { campaignName, destinationUrl } = req.body || {};
  if (!campaignName || !campaignName.trim()) {
    return res.status(400).json({ error: "campaignName is required" });
  }
  if (!destinationUrl || !/^https?:\/\//i.test(destinationUrl)) {
    return res.status(400).json({ error: "destinationUrl must be a valid http(s) URL" });
  }

  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

  let rows;
  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
  } catch (err) {
    return res.status(400).json({ error: "Could not read the Excel file: " + err.message });
  }

  if (!rows.length) {
    return res.status(400).json({ error: "The sheet has no data rows" });
  }

  const created = await withTransaction(async (client) => {
    const { rows: campaignRows } = await client.query(
      "INSERT INTO campaigns (name, destination_url) VALUES ($1, $2) RETURNING id",
      [campaignName.trim(), destinationUrl]
    );
    const campaignId = campaignRows[0].id;

    const people = [];
    for (const rawRow of rows) {
      const nameKey = findNameKey(rawRow);
      const name = String(rawRow[nameKey] ?? "").trim();
      if (!name) continue;

      const row = stripAutoEmptyColumns(rawRow);
      const code = await generateUniqueCode(client);
      await client.query(
        "INSERT INTO people (campaign_id, code, name, details_json) VALUES ($1, $2, $3, $4)",
        [campaignId, code, name, JSON.stringify(row)]
      );
      people.push({ code, name });
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

  const usedNames = new Map();
  for (const person of created.people) {
    const url = `${publicBaseUrl}/r/${person.code}`;
    const pngBuffer = await QRCode.toBuffer(url, { width: 512, margin: 2 });

    let base = sanitizeFilename(person.name);
    const count = usedNames.get(base) || 0;
    usedNames.set(base, count + 1);
    const filename = count === 0 ? `${base}.png` : `${base}_${count + 1}.png`;

    archive.append(pngBuffer, { name: filename });
  }

  await archive.finalize();
});
