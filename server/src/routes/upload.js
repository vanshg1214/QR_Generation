import { Router } from "express";
import multer from "multer";
import { parsePeopleSheet } from "../spreadsheet.js";
import QRCode from "qrcode";
import archiver from "archiver";
import { customAlphabet } from "nanoid";
import { withTransaction } from "../db.js";
import { requireAuth } from "../auth.js";
import { failZip } from "../zipStream.js";
import { createLetterBook, saveLetterBook, addPersonLetter } from "../letters.js";

export const uploadRoutes = Router();

const upload = multer({ storage: multer.memoryStorage() });
const GRAPHIC_MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_GRAPHIC_MIMES = new Set(["image/png", "image/jpeg"]);

const MAX_LINKS = 10;
const MAX_SIGNATURE_FIELD_LENGTH = 200;

// Unambiguous alphabet (no 0/O, 1/I/l) since these codes may occasionally be typed manually.
const nanoid = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 8);

// Generates `count` codes unique among themselves and against every code already stored,
// in one round trip per attempt (collisions are astronomically rare at 32^8 combinations).
async function generateUniqueCodes(client, count) {
  const codes = new Set();
  while (codes.size < count) {
    const batch = new Set();
    while (batch.size < count - codes.size) {
      const code = nanoid();
      if (!codes.has(code)) batch.add(code);
    }
    const { rows } = await client.query("SELECT code FROM codes WHERE code = ANY($1::text[])", [[...batch]]);
    for (const { code } of rows) batch.delete(code);
    for (const code of batch) codes.add(code);
  }
  return [...codes];
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

  const typography = ["sans-serif", "serif", "monospace"].includes(req.body.typography) ? req.body.typography : "sans-serif";
  const includeGreeting = req.body.includeGreeting === "false" ? false : true;
  const padding = req.body.padding === "true";

  let greetingPos = null;
  try {
    if (req.body.greetingPos) greetingPos = JSON.parse(req.body.greetingPos);
  } catch { /* ignore */ }

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
    sheetRows = parsePeopleSheet(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: "Could not read the Excel file: " + err.message });
  }

  if (!sheetRows.length) {
    return res.status(400).json({ error: "No rows had a usable Name value" });
  }

  const created = await withTransaction(async (client) => {
    const { rows: campaignRows } = await client.query(
      "INSERT INTO campaigns (name, signature_name, signature_title, typography, include_greeting, greeting_pos_json, letter_padding) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [campaignName.trim(), signatureName, signatureTitle, typography, includeGreeting, greetingPos ? JSON.stringify(greetingPos) : null, padding]
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

    // Bulk inserts: the database is remote, so per-row queries (3 round trips per person
    // per link) made big sheets take minutes. This is a fixed handful of queries instead.
    const { rows: idRows } = await client.query(
      "SELECT nextval(pg_get_serial_sequence('people', 'id'))::int AS id FROM generate_series(1, $1)",
      [sheetRows.length]
    );
    const personIds = idRows.map((r) => r.id);
    await client.query(
      `INSERT INTO people (id, campaign_id, name, details_json)
       SELECT id, $1, name, details FROM unnest($2::int[], $3::text[], $4::text[]) AS t(id, name, details)`,
      [campaignId, personIds, sheetRows.map((r) => r.name), sheetRows.map((r) => JSON.stringify(r.details))]
    );

    const allCodes = await generateUniqueCodes(client, sheetRows.length * linkRows.length);
    const codePersonIds = [];
    const codeLinkIds = [];
    const people = sheetRows.map(({ name }, i) => {
      const codes = linkRows.map((link, j) => {
        codePersonIds.push(personIds[i]);
        codeLinkIds.push(link.id);
        return { label: link.label, code: allCodes[i * linkRows.length + j], campaignLinkId: link.id };
      });
      return { name, codes };
    });
    await client.query(
      `INSERT INTO codes (person_id, campaign_link_id, code)
       SELECT * FROM unnest($1::int[], $2::int[], $3::text[])`,
      [codePersonIds, codeLinkIds, allCodes]
    );
    return { campaignId, people, resolvedBoxes };
  });

  if (!created.people.length) {
    return res.status(400).json({ error: "No rows had a usable Name value" });
  }

  const archive = archiver("zip", { zlib: { level: 1 } });
  archive.on("error", (err) => failZip(res, archive, err));

  try {
    // Everything that can fail (building the PDFs) happens BEFORE any bytes are sent,
    // so a failure returns a clean error instead of a truncated, invalid zip.
    // The campaign graphic is embedded ONCE into a shared "book" and reused for
    // every person's page -- re-embedding a multi-megabyte image per person is
    // what made this slow (a 28-person campaign took 44s before this).
    const book = graphicFile ? await createLetterBook(graphicFile.buffer, graphicFile.mimetype, typography) : null;

    const personFolders = [];
    const qrFiles = [];
    const personFolderName = uniqueNamer();
    for (const person of created.people) {
      const folder = personFolderName(person.name);
      personFolders.push(folder);
      const linkFileName = uniqueNamer();
      for (const { label, code } of person.codes) {
        const url = `${publicBaseUrl}/r/${code}`;
        const pngBuffer = await QRCode.toBuffer(url, { width: 512, margin: 2 });
        qrFiles.push({ name: `${folder}/${linkFileName(label)}.png`, data: pngBuffer });
      }

      if (book) {
        await addPersonLetter({
          book,
          personName: person.name,
          codesForPerson: person.codes,
          boxes: created.resolvedBoxes,
          signatureName,
          signatureTitle,
          includeGreeting,
          greetingPos,
          padding,
          publicBaseUrl,
        });
      }
    }

    const combinedBytes = book ? await saveLetterBook(book) : null;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="qr-codes.zip"`);
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
