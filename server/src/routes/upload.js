import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import QRCode from "qrcode";
import archiver from "archiver";
import { customAlphabet } from "nanoid";
import { withTransaction } from "../db.js";
import { requireAuth } from "../auth.js";
import { mergeLetterPdfs } from "../pdf.js";
import { buildPersonLetter } from "../letters.js";

export const uploadRoutes = Router();

const upload = multer({ storage: multer.memoryStorage() });
const GRAPHIC_MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_GRAPHIC_MIMES = new Set(["image/png", "image/jpeg"]);

const MAX_LINKS = 10;
const MAX_SIGNATURE_FIELD_LENGTH = 200;

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

uploadRoutes.post(
  "/upload",
  requireAuth,
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "graphic", maxCount: 1 },
  ]),
  async (req, res) => {
  const excelFile = req.files?.file?.[0];
  if (!excelFile) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  req.file = excelFile; // downstream code below reads req.file

  const graphicFile = req.files?.graphic?.[0];
  if (graphicFile) {
    if (!ALLOWED_GRAPHIC_MIMES.has(graphicFile.mimetype)) {
      return res.status(400).json({ error: "The letter graphic must be a PNG or JPEG image" });
    }
    if (graphicFile.size > GRAPHIC_MAX_BYTES) {
      return res.status(400).json({ error: "The letter graphic must be 20MB or smaller" });
    }
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

  const signatureName = (req.body.signatureName || "").trim();
  const signatureTitle = (req.body.signatureTitle || "").trim();
  if (signatureName.length > MAX_SIGNATURE_FIELD_LENGTH || signatureTitle.length > MAX_SIGNATURE_FIELD_LENGTH) {
    return res.status(400).json({ error: "Signature name/title must be 200 characters or fewer" });
  }

  let boxes;
  try {
    boxes = JSON.parse(req.body.boxes || "[]");
  } catch {
    return res.status(400).json({ error: "boxes must be valid JSON" });
  }
  if (!Array.isArray(boxes)) {
    return res.status(400).json({ error: "boxes must be an array" });
  }
  for (const box of boxes) {
    const fieldsOk =
      Number.isInteger(box.linkIndex) &&
      box.linkIndex >= 0 &&
      box.linkIndex < links.length &&
      [box.x, box.y, box.width, box.height].every((n) => typeof n === "number" && Number.isFinite(n)) &&
      box.x >= 0 &&
      box.x <= 1 &&
      box.y >= 0 &&
      box.y <= 1 &&
      box.width > 0 &&
      box.height > 0 &&
      box.x + box.width <= 1.02 &&
      box.y + box.height <= 1.02;
    if (!fieldsOk) {
      return res.status(400).json({ error: "A letter QR box is invalid" });
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
      "INSERT INTO campaigns (name, signature_name, signature_title) VALUES ($1, $2, $3) RETURNING id",
      [campaignName.trim(), signatureName, signatureTitle]
    );
    const campaignId = campaignRows[0].id;

    if (graphicFile) {
      await client.query("UPDATE campaigns SET graphic_data = $1, graphic_mime = $2 WHERE id = $3", [
        graphicFile.buffer,
        graphicFile.mimetype,
        campaignId,
      ]);
    }

    const linkRows = [];
    for (let i = 0; i < links.length; i++) {
      const { rows } = await client.query(
        "INSERT INTO campaign_links (campaign_id, label, destination_url, position) VALUES ($1, $2, $3, $4) RETURNING id, label",
        [campaignId, links[i].label.trim(), links[i].destinationUrl, i]
      );
      linkRows.push(rows[0]);
    }

    const resolvedBoxes = [];
    for (const box of boxes) {
      const link = linkRows[box.linkIndex];
      await client.query(
        "INSERT INTO letter_qr_boxes (campaign_link_id, x, y, width, height) VALUES ($1, $2, $3, $4, $5)",
        [link.id, box.x, box.y, box.width, box.height]
      );
      resolvedBoxes.push({ campaignLinkId: link.id, x: box.x, y: box.y, width: box.width, height: box.height });
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
        codes.push({ label: link.label, code, campaignLinkId: link.id });
      }
      people.push({ name, codes });
    }
    return { campaignId, people, resolvedBoxes };
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

  const letterPdfs = [];
  const personFolderName = uniqueNamer();
  for (const person of created.people) {
    const folder = personFolderName(person.name);
    const linkFileName = uniqueNamer();
    for (const { label, code } of person.codes) {
      const url = `${publicBaseUrl}/r/${code}`;
      const pngBuffer = await QRCode.toBuffer(url, { width: 512, margin: 2 });
      archive.append(pngBuffer, { name: `${folder}/${linkFileName(label)}.png` });
    }

    if (graphicFile) {
      const letterBytes = await buildPersonLetter({
        personName: person.name,
        codesForPerson: person.codes,
        boxes: created.resolvedBoxes,
        graphicData: graphicFile.buffer,
        graphicMime: graphicFile.mimetype,
        signatureName,
        signatureTitle,
        publicBaseUrl,
      });
      archive.append(Buffer.from(letterBytes), { name: `${folder}/Letter.pdf` });
      letterPdfs.push(letterBytes);
    }
  }

  if (letterPdfs.length) {
    const combinedBytes = await mergeLetterPdfs(letterPdfs);
    archive.append(Buffer.from(combinedBytes), { name: "All Letters.pdf" });
  }

  await archive.finalize();
});
