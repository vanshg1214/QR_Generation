import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { layoutQrCaption, normalizeCaptionStyle, POPPINS_BASELINE } from "./qrCaptionLayout.js";

const FONTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fonts");
const POPPINS_FILES = {
  regular: "Poppins-Regular.ttf",
  medium: "Poppins-Medium.ttf",
  semibold: "Poppins-SemiBold.ttf",
  bold: "Poppins-Bold.ttf",
};
const poppinsBytes = {}; // each weight is read on first use, then reused for every campaign
function loadPoppins(weight) {
  poppinsBytes[weight] ??= fs.readFileSync(path.join(FONTS_DIR, POPPINS_FILES[weight]));
  return poppinsBytes[weight];
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function clamp(val, lo, hi) { return Math.min(Math.max(val, lo), hi); }

const PAGE_WIDTH = 595.28; // A4 portrait, in points
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const BORDERLESS_TEXT_INSET = 28; // text distance from the edge on a borderless page
const GREETING_SIZE = 13;   // smaller so it blends with the graphic styling
const GAP_BELOW_GREETING = 16;

const SIGNATURE_NAME_SIZE = 13;
const SIGNATURE_TITLE_SIZE = 11;
const SIGNATURE_LINE_GAP = 4;
const SIGNATURE_BLANK_SPACE = 45; // room to physically sign above the printed name
const SIGNATURE_BLOCK_HEIGHT =
  SIGNATURE_BLANK_SPACE + SIGNATURE_NAME_SIZE + SIGNATURE_LINE_GAP + SIGNATURE_TITLE_SIZE;

// Shrinks a font size until the text fits contentWidth, so long input never
// overflows the page margins.
function fitTextSize(font, text, startSize, minSize, maxWidth) {
  let size = startSize;
  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 1;
  }
  return size;
}

// A "book" is one shared PDFDocument with the campaign graphic and fonts
// embedded ONCE. Decoding/embedding a multi-megabyte graphic is by far the
// most expensive part of building these letters -- doing it once per
// campaign instead of once per person is what keeps a large campaign fast
// (a 28-person campaign with re-embedding per person took 44s; sharing one
// embed brings that down to a couple of seconds).
// qrCaption: when set, embed the Poppins weights its name/caption lines use. Subsetting
// keeps only the glyphs actually used, so it adds a few KB, not the full font files.
export async function createLetterBook(graphicBytes, graphicMime, typography = "sans-serif", { qrCaption = null } = {}) {
  const pdfDoc = await PDFDocument.create();
  
  let boldFontStandard = StandardFonts.HelveticaBold;
  let regularFontStandard = StandardFonts.Helvetica;
  
  if (typography === "serif") {
    boldFontStandard = StandardFonts.TimesRomanBold;
    regularFontStandard = StandardFonts.TimesRoman;
  } else if (typography === "monospace") {
    boldFontStandard = StandardFonts.CourierBold;
    regularFontStandard = StandardFonts.Courier;
  }
  
  const boldFont = await pdfDoc.embedFont(boldFontStandard);
  const regularFont = await pdfDoc.embedFont(regularFontStandard);
  
  const image =
    graphicMime === "image/png" ? await pdfDoc.embedPng(graphicBytes) : await pdfDoc.embedJpg(graphicBytes);
  let poppins = null;
  if (qrCaption) {
    pdfDoc.registerFontkit(fontkit);
    const style = normalizeCaptionStyle(qrCaption) || normalizeCaptionStyle();
    poppins = {};
    for (const weight of new Set([style.nameWeight, style.captionWeight])) {
      poppins[weight] = await pdfDoc.embedFont(loadPoppins(weight), { subset: true });
    }
  }
  return { pdfDoc, boldFont, regularFont, image, poppins, pageIndices: [] };
}

// Adds one person's letter page to the shared book: the (already-embedded,
// shared) graphic with any per-person QR codes stamped into it, plus an
// optional greeting and signature block. qrStamps: [{ x, y, width, height,
// qrPngBytes }], all fractions (0..1, top-left origin) of the ORIGINAL graphic
// image's dimensions. greetingPos: null = above the graphic; { x, y } =
// fraction of the graphic's bounding box where the text's top-left should land.
//
// padding: false (default) = borderless -- the graphic spans the full A4 width
// with no margins, and the page is only made taller by a slim white band where a
// greeting-above or signature actually needs room. With neither, the page IS the
// graphic, so an A4-proportioned graphic prints as exactly one full A4 page.
// padding: true = the graphic sits inside an A4 page with white margins.
// qrCaption: null, or { text, nameColor, captionColor, nameWeight, captionWeight,
// nameScale, captionScale } -- prints "{name} ji" and the
// caption under the QR, inside the same box (see qrCaptionLayout.js).
export async function addLetterPage(book, name, { signatureName, signatureTitle, qrStamps = [], includeGreeting = true, greetingPos = null, padding = false, qrCaption = null } = {}) {
  const { pdfDoc, boldFont, regularFont, image } = book;

  const greetingAbove = includeGreeting && !greetingPos;
  const hasSignature = Boolean(signatureName || signatureTitle);
  // How far text sits from the page edge.
  const inset = padding ? MARGIN : BORDERLESS_TEXT_INSET;
  const topBand = greetingAbove ? inset + GREETING_SIZE + GAP_BELOW_GREETING : 0;
  const bottomBand = hasSignature ? inset + SIGNATURE_BLOCK_HEIGHT : 0;

  const pageWidth = PAGE_WIDTH;
  let pageHeight, imgX, imgY, imgWidth, imgHeight;
  if (padding) {
    pageHeight = PAGE_HEIGHT;
    const topOfImageY = PAGE_HEIGHT - (topBand || MARGIN);
    const bottomOfImageY = bottomBand || MARGIN;
    const availableHeight = topOfImageY - bottomOfImageY;

    imgWidth = PAGE_WIDTH - MARGIN * 2;
    imgHeight = (image.height / image.width) * imgWidth;
    if (imgHeight > availableHeight) {
      imgHeight = availableHeight;
      imgWidth = (image.width / image.height) * imgHeight;
    }
    // Left-align with the greeting/signature text (both pinned at x=MARGIN) --
    // not centered -- so the graphic and the text share one vertical edge and
    // read as one piece, instead of the graphic drifting right whenever it's
    // narrower than the text column (e.g. a tall portrait image).
    imgX = MARGIN;
    imgY = topOfImageY - imgHeight;
  } else {
    imgWidth = pageWidth;
    imgHeight = (image.height / image.width) * pageWidth;
    imgX = 0;
    imgY = bottomBand;
    pageHeight = bottomBand + imgHeight + topBand;
  }
  const contentWidth = pageWidth - inset * 2;
  // Keeps a greeting dragged onto the graphic inside the printable page.
  const edge = padding ? MARGIN : 8;

  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  book.pageIndices.push(pdfDoc.getPageCount() - 1);

  // Graphic first, so a greeting positioned inside it is drawn on top, not under it.
  page.drawImage(image, { x: imgX, y: imgY, width: imgWidth, height: imgHeight });

  if (includeGreeting) {
    const greeting = `Dear ${name} ji,`;
    const greetingSize = fitTextSize(boldFont, greeting, GREETING_SIZE, 8, contentWidth);
    if (greetingPos) {
      // Inside the graphic: greetingPos.x/y are fractions of the graphic's
      // bounding box (top-left origin, same as QR stamps).
      const gx = imgX + greetingPos.x * imgWidth;
      // PDF y is bottom-up; greetingPos.y is top-down fraction of graphic height.
      const gy = imgY + (1 - greetingPos.y) * imgHeight - greetingSize;
      page.drawText(greeting, {
        x: clamp(gx, edge, pageWidth - edge - boldFont.widthOfTextAtSize(greeting, greetingSize)),
        y: clamp(gy, edge, pageHeight - edge - greetingSize),
        size: greetingSize,
        font: boldFont,
        color: rgb(0.1, 0.1, 0.1),
      });
    } else {
      // Above the graphic (default)
      page.drawText(greeting, {
        x: inset,
        y: pageHeight - inset - GREETING_SIZE,
        size: greetingSize,
        font: boldFont,
        color: rgb(0.1, 0.1, 0.1),
      });
    }
  }

  for (const stamp of qrStamps) {
    const qrImage = await pdfDoc.embedPng(stamp.qrPngBytes);
    const boxX = imgX + stamp.x * imgWidth;
    // Stamp coords are top-left origin (canvas/CSS); PDF page coords are
    // bottom-left origin, so the y axis has to flip here.
    const boxY = imgY + (1 - stamp.y - stamp.height) * imgHeight;
    const boxW = stamp.width * imgWidth;
    const boxH = stamp.height * imgHeight;

    if (qrCaption && book.poppins) {
      const fonts = book.poppins;
      const layout = layoutQrCaption({
        boxW,
        boxH,
        name,
        caption: qrCaption.text,
        measure: (text, weight, size) => fonts[weight].widthOfTextAtSize(text, size),
        style: qrCaption,
      });
      // Layout is top-down within the box; PDF y is bottom-up from the page.
      const boxTop = boxY + boxH;
      page.drawImage(qrImage, {
        x: boxX + layout.qr.x,
        y: boxTop - layout.qr.y - layout.qr.size,
        width: layout.qr.size,
        height: layout.qr.size,
      });
      for (const line of layout.lines) {
        page.drawText(line.text, {
          x: boxX + line.x,
          y: boxTop - line.top - line.size * POPPINS_BASELINE,
          size: line.size,
          font: fonts[line.weight],
          color: hexToRgb(line.role === "name" ? qrCaption.nameColor : qrCaption.captionColor),
        });
      }
      continue;
    }

    // Never stretch a QR into a non-square box -- inscribe the largest
    // centered square instead, so it stays scannable.
    const qrSize = Math.min(boxW, boxH);
    page.drawImage(qrImage, {
      x: boxX + (boxW - qrSize) / 2,
      y: boxY + (boxH - qrSize) / 2,
      width: qrSize,
      height: qrSize,
    });
  }

  if (signatureName || signatureTitle) {
    const titleSize = fitTextSize(regularFont, signatureTitle || "", SIGNATURE_TITLE_SIZE, 8, contentWidth);
    const nameSize = fitTextSize(boldFont, signatureName || "", SIGNATURE_NAME_SIZE, 8, contentWidth);
    if (signatureTitle) {
      page.drawText(signatureTitle, {
        x: inset,
        y: inset,
        size: titleSize,
        font: regularFont,
        color: rgb(0.25, 0.25, 0.25),
      });
    }
    if (signatureName) {
      page.drawText(signatureName, {
        x: inset,
        y: inset + SIGNATURE_TITLE_SIZE + SIGNATURE_LINE_GAP,
        size: nameSize,
        font: boldFont,
        color: rgb(0.1, 0.1, 0.1),
      });
    }
  }
}

// Extracts one person's page (by the order it was added in) as its own
// standalone single-page PDF, for that person's individual Letter.pdf.
// copyPages reuses the book's already-decoded image data rather than
// re-embedding the raw graphic bytes again.
export async function extractLetterPage(book, personIndex) {
  const single = await PDFDocument.create();
  const [copiedPage] = await single.copyPages(book.pdfDoc, [book.pageIndices[personIndex]]);
  single.addPage(copiedPage);
  // Object streams trade CPU time for a smaller file by re-compressing the
  // PDF's structural objects -- not worth it here since the embedded image
  // already dominates file size, and this runs once per person.
  return single.save({ useObjectStreams: false });
}

// Saves the whole book -- every person's page, in order -- as one combined
// PDF for print-all ("All Letters.pdf").
export async function saveLetterBook(book) {
  return book.pdfDoc.save({ useObjectStreams: false });
}
