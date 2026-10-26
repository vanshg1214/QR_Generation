// Works out where everything goes on one letter page: the page size, the graphic, every
// QR code, and every line of text. The PDF (pdf.js) draws exactly this, and the
// dashboard's page preview renders exactly this -- so the preview is the printed page.
//
// All coordinates are PDF points, measured top-down from the page's top-left corner.

import { LINE_HEIGHT, supportedWeight } from "./textStyles.js";
import { layoutQrCaption } from "./qrCaptionLayout.js";

export const PAGE_WIDTH = 595.28; // A4 portrait
export const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const BORDERLESS_TEXT_INSET = 28; // text distance from the edge on a borderless page
const GAP_BELOW_GREETING = 16;
const SIGNATURE_BLANK_SPACE = 45; // room to physically sign above the printed name
const SIGNATURE_LINE_GAP = 4;
const MIN_TEXT_SIZE = 6;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

// Shrinks a size until the text fits maxWidth, so long input never overflows the page.
function fitSize(width, text, startSize, maxWidth) {
  let size = startSize;
  while (size > MIN_TEXT_SIZE && width(text, size) > maxWidth) size -= 0.5;
  return Math.max(size, MIN_TEXT_SIZE);
}

// imageWidth/imageHeight: the graphic's pixel size (only its proportions matter).
// qrBoxes: [{ x, y, width, height }] as fractions of the graphic (top-left origin).
// greetingPos: null = above the graphic; { x, y } = fractions of the graphic.
// padding: false = borderless (the graphic spans the full width and the page is only made
//   taller where a greeting-above or footer needs room); true = A4 with white margins.
// qrCaption: null, or { text } -- prints "{name} ji" and the caption under each QR.
// styles: see textStyles.js. measure(text, font, weight, size) -> width in points.
export function layoutLetterPage({
  imageWidth,
  imageHeight,
  personName,
  padding = false,
  includeGreeting = true,
  greetingPos = null,
  signatureName = "",
  signatureTitle = "",
  qrBoxes = [],
  qrCaption = null,
  styles: rawStyles,
  measure,
}) {
  // Built-in PDF fonts only have regular and bold; map other weights the same way everywhere.
  const styles = Object.fromEntries(
    Object.entries(rawStyles).map(([key, s]) => [key, { ...s, weight: supportedWeight(s.font, s.weight) }])
  );
  const widthOf = (key) => (text, size) => measure(text, styles[key].font, styles[key].weight, size);
  const inset = padding ? MARGIN : BORDERLESS_TEXT_INSET;
  const contentWidth = PAGE_WIDTH - inset * 2;
  const texts = [];
  const addText = (key, text, x, top, size, extra = {}) =>
    texts.push({ key, text, x, top, size, ...styles[key], ...extra, size });

  const greeting = includeGreeting ? `Dear ${personName} ji,` : null;
  const greetingSize = greeting ? fitSize(widthOf("greeting"), greeting, styles.greeting.size, contentWidth) : 0;
  const greetingAbove = Boolean(greeting) && !greetingPos;
  const topBand = greetingAbove ? inset + greetingSize * LINE_HEIGHT + GAP_BELOW_GREETING : 0;

  const footer = [];
  if (signatureName) footer.push({ key: "footerName", text: signatureName });
  if (signatureTitle) footer.push({ key: "footerTitle", text: signatureTitle });
  for (const line of footer) line.size = fitSize(widthOf(line.key), line.text, styles[line.key].size, contentWidth);
  const footerHeight =
    footer.reduce((h, line) => h + line.size * LINE_HEIGHT, 0) + (footer.length > 1 ? SIGNATURE_LINE_GAP : 0);
  const bottomBand = footer.length ? inset + SIGNATURE_BLANK_SPACE + footerHeight : 0;

  const ratio = imageHeight / imageWidth;
  let pageHeight, imgX, imgY, imgW, imgH;
  if (padding) {
    pageHeight = PAGE_HEIGHT;
    imgY = topBand || MARGIN;
    const available = PAGE_HEIGHT - (bottomBand || MARGIN) - imgY;
    imgW = PAGE_WIDTH - MARGIN * 2;
    imgH = ratio * imgW;
    if (imgH > available) {
      imgH = available;
      imgW = imgH / ratio;
    }
    // Left-aligned with the greeting/footer text, so they share one edge.
    imgX = MARGIN;
  } else {
    imgW = PAGE_WIDTH;
    imgH = ratio * PAGE_WIDTH;
    imgX = 0;
    imgY = topBand;
    pageHeight = topBand + imgH + bottomBand;
  }

  if (greeting) {
    if (greetingAbove) {
      addText("greeting", greeting, inset, inset, greetingSize);
    } else {
      // Inside the graphic; kept within the printable page.
      const edge = padding ? MARGIN : 8;
      const w = widthOf("greeting")(greeting, greetingSize);
      addText(
        "greeting",
        greeting,
        clamp(imgX + greetingPos.x * imgW, edge, PAGE_WIDTH - edge - w),
        clamp(imgY + greetingPos.y * imgH, edge, pageHeight - edge - greetingSize * LINE_HEIGHT),
        greetingSize
      );
    }
  }

  // Footer lines stack upwards from the bottom inset: name above title.
  let bottom = pageHeight - inset;
  for (const line of [...footer].reverse()) {
    const top = bottom - line.size * LINE_HEIGHT;
    addText(line.key, line.text, inset, top, line.size);
    bottom = top - SIGNATURE_LINE_GAP;
  }

  const qrs = qrBoxes.map((box, boxIndex) => {
    const bx = imgX + box.x * imgW;
    const by = imgY + box.y * imgH;
    const bw = box.width * imgW;
    const bh = box.height * imgH;
    if (qrCaption) {
      const layout = layoutQrCaption({
        boxW: bw,
        boxH: bh,
        name: personName,
        caption: qrCaption.text,
        measure,
        nameStyle: styles.qrName,
        captionStyle: styles.qrCaption,
      });
      for (const line of layout.lines) addText(line.role, line.text, bx + line.x, by + line.top, line.size, { boxIndex });
      return { boxIndex, x: bx + layout.qr.x, y: by + layout.qr.y, size: layout.qr.size };
    }
    // Never stretch a QR into a non-square box -- inscribe the largest centred square.
    const size = Math.min(bw, bh);
    return { boxIndex, x: bx + (bw - size) / 2, y: by + (bh - size) / 2, size };
  });

  return {
    pageWidth: PAGE_WIDTH,
    pageHeight,
    graphic: { x: imgX, y: imgY, width: imgW, height: imgH },
    qrs,
    texts,
  };
}
