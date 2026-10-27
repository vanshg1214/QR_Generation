import { Router } from "express";
import multer from "multer";
import { analyzePeopleSheet, repeatedNames } from "../spreadsheet.js";
import QRCode from "qrcode";
import archiver from "archiver";
import { customAlphabet } from "nanoid";
import { withTransaction } from "../db.js";
import { requireAuth } from "../auth.js";
import { failZip, uniqueNamer, verifyZipContents } from "../zipStream.js";
import { createLetterBook, saveLetterBook, addPersonLetter } from "../letters.js";
import { normalizeTextStyles } from "../textStyles.js";
import { captionLines, MAX_CAPTION_LINES } from "../qrCaptionLayout.js";

export const uploadRoutes = Router();

const upload = multer({ storage: multer.memoryStorage() });
const GRAPHIC_MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_GRAPHIC_MIMES = new Set(["image/png", "image/jpeg"]);

const MAX_LINKS = 10;
const MAX_SIGNATURE_FIELD_LENGTH = 200;
const MAX_QR_CAPTION_LENGTH = 80;

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

const MAX_SKIPPED_STORED = 500;

// What the Excel file contains, checked before a campaign is created: how many rows, which
// become letters, which are skipped and why, and which names repeat. The same parser is used
// to create the campaign, so these numbers are exactly what gets generated.
function sheetReport(analysis) {
  return {
    sheetName: analysis.sheetName,
    headerRow: analysis.headerRow,
    nameColumn: analysis.nameColumn,
    dataRows: analysis.dataRows,
    peopleCount: analysis.people.length,
    people: analysis.people.map(({ row, name }) => ({ row, name })),
    skipped: analysis.skipped,
    repeated: repeatedNames(analysis.people),
  };
}

uploadRoutes.post("/sheet-check", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  let analysis;
  try {
    analysis = analyzePeopleSheet(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: "Could not read the Excel file: " + err.message });
  }
  res.json(sheetReport(analysis));
});

// Reads and checks the letter settings sent with a campaign (graphic, links, QR boxes, texts and
// styles). Shared by /upload and /preview-letter so the proof page is made exactly like the
// real letters. Returns { error } or the settings.
function parseLetterRequest(req) {
  const graphicFile = req.files?.graphic?.[0];
  if (graphicFile) {
    if (!ALLOWED_GRAPHIC_MIMES.has(graphicFile.mimetype)) {
      return { error: "The letter graphic must be a PNG or JPEG image" };
    }
    if (graphicFile.size > GRAPHIC_MAX_BYTES) {
      return { error: "The letter graphic must be 20MB or smaller" };
    }
  }

  let links;
  try {
    links = JSON.parse(req.body.links || "[]");
  } catch {
    return { error: "links must be valid JSON" };
  }
  if (!Array.isArray(links) || links.length === 0) {
    return { error: "At least one link is required" };
  }
  if (links.length > MAX_LINKS) {
    return { error: `At most ${MAX_LINKS} links are allowed` };
  }
  for (const link of links) {
    if (!link.label || !link.label.trim()) {
      return { error: "Every link needs a label" };
    }
    if (!link.destinationUrl || !/^https?:\/\//i.test(link.destinationUrl)) {
      return { error: `"${link.label}" needs a valid http(s) destination URL` };
    }
  }

  const signatureName = (req.body.signatureName || "").trim();
  const signatureTitle = (req.body.signatureTitle || "").trim();
  if (signatureName.length > MAX_SIGNATURE_FIELD_LENGTH || signatureTitle.length > MAX_SIGNATURE_FIELD_LENGTH) {
    return { error: "Signature name/title must be 200 characters or fewer" };
  }

  const typography = ["sans-serif", "serif", "monospace"].includes(req.body.typography) ? req.body.typography : "sans-serif";
  const includeGreeting = req.body.includeGreeting === "false" ? false : true;
  const padding = req.body.padding === "true";

  // Optional "{name} ji" + caption printed under each QR: { text }.
  let qrCaption = null;
  if (req.body.qrCaption) {
    try {
      const parsed = JSON.parse(req.body.qrCaption);
      // Lines are separated by newlines (Enter in the caption box).
      const rawText = typeof parsed.text === "string" ? parsed.text : "";
      const text = captionLines(rawText).join("\n");
      if (text.length > MAX_QR_CAPTION_LENGTH || rawText.split(/\r?\n/).filter((l) => l.trim()).length > MAX_CAPTION_LINES) {
        return { error: "The QR caption is too long" };
      }
      qrCaption = { text };
    } catch {
      return { error: "qrCaption must be valid JSON" };
    }
  }

  // Font, weight, size and colour for each text on the page (see textStyles.js).
  let textStyles;
  try {
    textStyles = normalizeTextStyles(req.body.textStyles ? JSON.parse(req.body.textStyles) : null);
  } catch {
    textStyles = null;
  }
  if (!textStyles) {
    return { error: "The text style settings are invalid" };
  }

  let greetingPos = null;
  try {
    if (req.body.greetingPos) greetingPos = JSON.parse(req.body.greetingPos);
  } catch { /* ignore */ }

  let boxes;
  try {
    boxes = JSON.parse(req.body.boxes || "[]");
  } catch {
    return { error: "boxes must be valid JSON" };
  }
  if (!Array.isArray(boxes)) {
    return { error: "boxes must be an array" };
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
      return { error: "A letter QR box is invalid" };
    }
  }

  return {
    graphicFile,
    links,
    signatureName,
    signatureTitle,
    typography,
    includeGreeting,
    padding,
    qrCaption,
    textStyles,
    greetingPos,
    boxes,
  };
}

// One real letter page, built by the same code as "All Letters.pdf", so it can be checked
// before generating every letter. The QR codes are samples of the same length as the real
// ones (so they look identical); the real codes are only created with the campaign.
// Also times the work, so the dashboard can estimate how long the full zip will take.
uploadRoutes.post(
  "/preview-letter",
  requireAuth,
  upload.fields([{ name: "graphic", maxCount: 1 }]),
  async (req, res) => {
    const settings = parseLetterRequest(req);
    if (settings.error) return res.status(400).json({ error: settings.error });
    if (!settings.graphicFile) return res.status(400).json({ error: "No letter graphic uploaded" });
    const personName = String(req.body.personName || "").trim().slice(0, 200) || "Rajesh Kumar";
    const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

    const boxes = settings.boxes.map((b) => ({ ...b, campaignLinkId: b.linkIndex }));
    const sampleCodes = (n) =>
      settings.links.map((_, i) => ({ campaignLinkId: i, code: `SAMPLE${String((n * 10 + i) % 100).padStart(2, "0")}` }));
    const letter = (book, n, name) =>
      addPersonLetter({
        book,
        personName: name,
        codesForPerson: sampleCodes(n),
        boxes,
        signatureName: settings.signatureName,
        signatureTitle: settings.signatureTitle,
        includeGreeting: settings.includeGreeting,
        greetingPos: settings.greetingPos,
        padding: settings.padding,
        qrCaption: settings.qrCaption,
        textStyles: settings.textStyles,
        publicBaseUrl,
      });

    try {
      const t0 = performance.now();
      const book = await createLetterBook(settings.graphicFile.buffer, settings.graphicFile.mimetype);
      const t1 = performance.now();
      await letter(book, 0, personName);
      const bytes = await saveLetterBook(book);
      const t2 = performance.now();

      // Time a few more pages (plus the zip's QR images) to estimate the per-person cost.
      const SAMPLE_PAGES = 4;
      const timing = await createLetterBook(settings.graphicFile.buffer, settings.graphicFile.mimetype);
      await letter(timing, 0, personName); // fonts get embedded on the first page; not counted
      const t3 = performance.now();
      for (let n = 1; n <= SAMPLE_PAGES; n++) {
        await letter(timing, n, personName);
        for (const code of sampleCodes(n)) {
          await QRCode.toBuffer(`${publicBaseUrl}/r/${code.code}`, { width: 512, margin: 2 });
        }
      }
      const t4 = performance.now();

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'inline; filename="Sample letter.pdf"');
      res.setHeader("X-Setup-Ms", String(Math.round(t1 - t0)));
      res.setHeader("X-First-Page-Ms", String(Math.round(t2 - t1)));
      res.setHeader("X-Per-Page-Ms", String(Math.round((t4 - t3) / SAMPLE_PAGES)));
      res.end(Buffer.from(bytes));
    } catch (err) {
      console.error("Preview letter failed:", err);
      res.status(500).json({ error: "Could not build the sample page. Please try again." });
    }
  }
);

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

  const { campaignName } = req.body || {};
  if (!campaignName || !campaignName.trim()) {
    return res.status(400).json({ error: "campaignName is required" });
  }

  const settings = parseLetterRequest(req);
  if (settings.error) return res.status(400).json({ error: settings.error });
  const {
    graphicFile,
    links,
    signatureName,
    signatureTitle,
    typography,
    includeGreeting,
    padding,
    qrCaption,
    textStyles,
    greetingPos,
    boxes,
  } = settings;

  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

  let analysis;
  try {
    analysis = analyzePeopleSheet(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: "Could not read the Excel file: " + err.message });
  }

  const sheetRows = analysis.people;
  if (!sheetRows.length) {
    return res.status(400).json({ error: "No rows had a usable Name value" });
  }

  const created = await withTransaction(async (client) => {
    const { rows: campaignRows } = await client.query(
      `INSERT INTO campaigns (name, signature_name, signature_title, typography, include_greeting, greeting_pos_json,
         letter_padding, qr_caption_json, text_styles_json, sheet_data_rows, sheet_name_column, sheet_skipped_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [
        campaignName.trim(), signatureName, signatureTitle, typography, includeGreeting,
        greetingPos ? JSON.stringify(greetingPos) : null, padding, qrCaption ? JSON.stringify(qrCaption) : null,
        JSON.stringify(textStyles), analysis.dataRows, analysis.nameColumn,
        JSON.stringify(analysis.skipped.slice(0, MAX_SKIPPED_STORED)),
      ]
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
      `INSERT INTO people (id, campaign_id, name, details_json, sheet_row)
       SELECT id, $1, name, details, sheet_row
       FROM unnest($2::int[], $3::text[], $4::text[], $5::int[]) AS t(id, name, details, sheet_row)`,
      [
        campaignId,
        personIds,
        sheetRows.map((r) => r.name),
        sheetRows.map((r) => JSON.stringify(r.details)),
        sheetRows.map((r) => r.row),
      ]
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
    const book = graphicFile ? await createLetterBook(graphicFile.buffer, graphicFile.mimetype) : null;

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
          qrCaption,
          textStyles,
          publicBaseUrl,
        });
      }
    }

    // Never hand out a print file that doesn't match the people list.
    verifyZipContents({ book, people: created.people.length, links: links.length, qrFiles, personFolders });
    const combinedBytes = book ? await saveLetterBook(book) : null;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="qr-codes.zip"`);
    res.setHeader("X-Campaign-Id", String(created.campaignId));
    res.setHeader("X-People-Count", String(created.people.length));
    res.setHeader("X-Letter-Pages", String(book ? book.pdfDoc.getPageCount() : 0));
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
