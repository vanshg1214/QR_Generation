import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { layoutLetterPage } from "./letterLayout.js";
import { baselineOffset, defaultTextStyles, supportedWeight } from "./textStyles.js";

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

const STANDARD_FONTS = {
  helvetica: { regular: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold },
  times: { regular: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold },
  courier: { regular: StandardFonts.Courier, bold: StandardFonts.CourierBold },
};

// Embeds each font+weight the first time a page uses it, then reuses it for every page.
// Poppins is subset, so only the glyphs actually printed end up in the file.
async function getFont(book, font, weight) {
  weight = supportedWeight(font, weight);
  const key = `${font}:${weight}`;
  if (!book.fonts[key]) {
    if (font === "poppins") {
      if (!book.fontkitRegistered) {
        book.pdfDoc.registerFontkit(fontkit);
        book.fontkitRegistered = true;
      }
      book.fonts[key] = await book.pdfDoc.embedFont(loadPoppins(weight), { subset: true });
    } else {
      book.fonts[key] = await book.pdfDoc.embedFont(STANDARD_FONTS[font][weight]);
    }
  }
  return book.fonts[key];
}

// A "book" is one shared PDFDocument with the campaign graphic (and fonts) embedded
// ONCE. Decoding/embedding a multi-megabyte graphic is by far the most expensive part
// of building these letters -- doing it once per campaign instead of once per person
// is what keeps a large campaign fast.
export async function createLetterBook(graphicBytes, graphicMime) {
  const pdfDoc = await PDFDocument.create();
  const image =
    graphicMime === "image/png" ? await pdfDoc.embedPng(graphicBytes) : await pdfDoc.embedJpg(graphicBytes);
  return { pdfDoc, image, fonts: {}, fontkitRegistered: false, pageIndices: [] };
}

// Adds one person's letter page to the shared book. Where everything goes comes from
// layoutLetterPage (letterLayout.js), the same layout the dashboard preview shows.
// qrStamps: [{ x, y, width, height, qrPngBytes }] as fractions of the graphic.
// textStyles: see textStyles.js (defaults if omitted).
export async function addLetterPage(
  book,
  name,
  { signatureName, signatureTitle, qrStamps = [], includeGreeting = true, greetingPos = null, padding = false, qrCaption = null, textStyles = null } = {}
) {
  const { pdfDoc, image } = book;
  const styles = textStyles || defaultTextStyles();

  // Every font this page uses must be embedded before measuring text with it. Fonts for
  // text that isn't printed are skipped, so they don't end up in the file.
  const used = [
    includeGreeting && "greeting",
    signatureName && "footerName",
    signatureTitle && "footerTitle",
    qrCaption && qrStamps.length && "qrName",
    qrCaption && qrStamps.length && "qrCaption",
  ].filter(Boolean);
  for (const key of used) await getFont(book, styles[key].font, styles[key].weight);
  const measure = (text, font, weight, size) =>
    book.fonts[`${font}:${supportedWeight(font, weight)}`].widthOfTextAtSize(text, size);

  const layout = layoutLetterPage({
    imageWidth: image.width,
    imageHeight: image.height,
    personName: name,
    padding,
    includeGreeting,
    greetingPos,
    signatureName,
    signatureTitle,
    qrBoxes: qrStamps,
    qrCaption,
    styles,
    measure,
  });

  const page = pdfDoc.addPage([layout.pageWidth, layout.pageHeight]);
  book.pageIndices.push(pdfDoc.getPageCount() - 1);
  // The layout is top-down; PDF coordinates are bottom-up.
  const H = layout.pageHeight;
  const g = layout.graphic;

  // Graphic first, so QR codes and text are drawn on top of it.
  page.drawImage(image, { x: g.x, y: H - g.y - g.height, width: g.width, height: g.height });

  for (const qr of layout.qrs) {
    const qrImage = await pdfDoc.embedPng(qrStamps[qr.boxIndex].qrPngBytes);
    page.drawImage(qrImage, { x: qr.x, y: H - qr.y - qr.size, width: qr.size, height: qr.size });
  }

  for (const t of layout.texts) {
    page.drawText(t.text, {
      x: t.x,
      y: H - t.top - baselineOffset(t.font, t.size),
      size: t.size,
      font: await getFont(book, t.font, t.weight),
      color: hexToRgb(t.color),
    });
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
