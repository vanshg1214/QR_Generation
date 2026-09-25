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

// One-page "Dear {name} ji" letter: greeting at top, the campaign graphic
// (with any per-person QR codes stamped into it) scaled to fit in the middle,
// and a signature block (blank signing space + name + title) at the bottom.
// qrStamps: [{ x, y, width, height, qrPngBytes }], all fractions (0..1, top-left
// origin) of the ORIGINAL graphic image's dimensions.
export async function buildLetterPdf(
  name,
  graphicBytes,
  graphicMime,
  { signatureName, signatureTitle, qrStamps = [] } = {}
) {
  const pdfDoc = await PDFDocument.create();
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const image =
    graphicMime === "image/png"
      ? await pdfDoc.embedPng(graphicBytes)
      : await pdfDoc.embedJpg(graphicBytes);

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

  const greeting = `Dear ${name} ji,`;
  const greetingSize = fitTextSize(boldFont, greeting, GREETING_SIZE, 10, contentWidth);
  page.drawText(greeting, {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - GREETING_SIZE,
    size: greetingSize,
    font: boldFont,
    color: rgb(0.1, 0.1, 0.1),
  });

  const imgX = MARGIN + (contentWidth - imgWidth) / 2;
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

  return pdfDoc.save();
}

// Merges ordered single-page PDF byte arrays into one combined PDF for print-all.
export async function mergeLetterPdfs(pdfBytesList) {
  const merged = await PDFDocument.create();
  for (const bytes of pdfBytesList) {
    const doc = await PDFDocument.load(bytes);
    const copiedPages = await merged.copyPages(doc, doc.getPageIndices());
    copiedPages.forEach((page) => merged.addPage(page));
  }
  return merged.save();
}
