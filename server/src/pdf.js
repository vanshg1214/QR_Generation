import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE_WIDTH = 595.28; // A4 portrait, in points
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const GREETING_SIZE = 20;
const GAP_BELOW_GREETING = 26;

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
export async function createLetterBook(graphicBytes, graphicMime, typography = "sans-serif") {
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
  return { pdfDoc, boldFont, regularFont, image, pageIndices: [] };
}

// Adds one person's "Dear {name} ji" letter page to the shared book:
// greeting at top, the (already-embedded, shared) graphic scaled to fit in
// the middle with any per-person QR codes stamped into it, and a signature
// block at the bottom. qrStamps: [{ x, y, width, height, qrPngBytes }], all
// fractions (0..1, top-left origin) of the ORIGINAL graphic image's dimensions.
export async function addLetterPage(book, name, { signatureName, signatureTitle, qrStamps = [], includeGreeting = true } = {}) {
  const { pdfDoc, boldFont, regularFont, image } = book;

  const contentWidth = PAGE_WIDTH - MARGIN * 2;
  const topOfImageY = PAGE_HEIGHT - MARGIN - GREETING_SIZE - GAP_BELOW_GREETING;
  const bottomOfImageY = signatureName || signatureTitle ? MARGIN + SIGNATURE_BLOCK_HEIGHT : MARGIN;
  const availableHeight = topOfImageY - bottomOfImageY;

  let imgWidth = contentWidth;
  let imgHeight = (image.height / image.width) * imgWidth;
  if (imgHeight > availableHeight) {
    imgHeight = availableHeight;
    imgWidth = (image.width / image.height) * imgHeight;
  }

  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  book.pageIndices.push(pdfDoc.getPageCount() - 1);

  if (includeGreeting) {
    const greeting = `Dear ${name} ji,`;
    const greetingSize = fitTextSize(boldFont, greeting, GREETING_SIZE, 10, contentWidth);
    page.drawText(greeting, {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN - GREETING_SIZE,
      size: greetingSize,
      font: boldFont,
      color: rgb(0.1, 0.1, 0.1),
    });
  }

  // Left-align with the greeting/signature text (both pinned at x=MARGIN) --
  // not centered -- so the graphic and the text share one vertical edge and
  // read as one piece, instead of the graphic drifting right whenever it's
  // narrower than the text column (e.g. a tall portrait image).
  const imgX = MARGIN;
  const imgY = topOfImageY - imgHeight;
  page.drawImage(image, { x: imgX, y: imgY, width: imgWidth, height: imgHeight });

  for (const stamp of qrStamps) {
    const qrImage = await pdfDoc.embedPng(stamp.qrPngBytes);
    const boxX = imgX + stamp.x * imgWidth;
    // Stamp coords are top-left origin (canvas/CSS); PDF page coords are
    // bottom-left origin, so the y axis has to flip here.
    const boxY = imgY + (1 - stamp.y - stamp.height) * imgHeight;
    const boxW = stamp.width * imgWidth;
    const boxH = stamp.height * imgHeight;

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
        x: MARGIN,
        y: MARGIN,
        size: titleSize,
        font: regularFont,
        color: rgb(0.25, 0.25, 0.25),
      });
    }
    if (signatureName) {
      page.drawText(signatureName, {
        x: MARGIN,
        y: MARGIN + SIGNATURE_TITLE_SIZE + SIGNATURE_LINE_GAP,
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
