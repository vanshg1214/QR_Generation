// Lays out a QR code with the person's name and a caption underneath, all inside one
// calibrated box:
//
//      [ QR ]
//   Saiyam Kochhar ji
//   Scan to experience VPV
//
// Units are whatever the box is measured in; y is top-down from the box's top edge.
// measure(text, font, weight, size) returns the text's width in those units.
// nameStyle / captionStyle: { font, weight, size } where size is a multiple of the
// automatic size (see textStyles.js).

import { LINE_HEIGHT } from "./textStyles.js";

export const DEFAULT_QR_CAPTION = "Scan to experience VPV";

// Shrinks size until text fits maxWidth; returns the size (never below minSize).
function fitSize(width, text, startSize, minSize, maxWidth) {
  let size = startSize;
  while (size > minSize && width(text, size) > maxWidth) size *= 0.95;
  return Math.max(size, minSize);
}

// Splits text into two lines at the word break that best balances their widths.
function splitInTwo(width, text, size) {
  const words = text.split(/\s+/);
  let best = [text];
  let bestWidth = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const w = Math.max(width(a, size), width(b, size));
    if (w < bestWidth) {
      bestWidth = w;
      best = [a, b];
    }
  }
  return best;
}

function layoutAtScale({ boxW, boxH, nameText, caption, measure, nameStyle, captionStyle, scale }) {
  const nameWidth = (t, s) => measure(t, nameStyle.font, nameStyle.weight, s);
  const captionWidth = (t, s) => measure(t, captionStyle.font, captionStyle.weight, s);
  const pad = boxW * 0.04;
  const innerW = boxW - pad * 2;

  const auto = boxW * 0.085 * scale; // automatic name size; the gaps are based on it
  const baseName = auto * nameStyle.size;
  // Shrink a long name a little; past ~70% of the base size, wrapping onto two lines
  // reads better than ever-smaller text.
  let nameSize = fitSize(nameWidth, nameText, baseName, baseName * 0.7, innerW);
  let nameLines = [nameText];
  if (nameWidth(nameText, nameSize) > innerW) {
    nameLines = splitInTwo(nameWidth, nameText, baseName);
    nameSize = Math.min(...nameLines.map((l) => fitSize(nameWidth, l, baseName, baseName * 0.45, innerW)));
  }
  // Sized from the base, not the (possibly shrunk) name, so it stays consistent page to page.
  const baseCaption = auto * 0.8 * captionStyle.size;
  const captionSize = caption ? fitSize(captionWidth, caption, baseCaption, baseCaption * 0.5, innerW) : 0;

  const gapBelowQr = auto * 0.35;
  const gapBeforeCaption = caption ? auto * 0.1 : 0;
  const textHeight =
    nameLines.length * nameSize * LINE_HEIGHT + (caption ? gapBeforeCaption + captionSize * LINE_HEIGHT : 0);
  const qrSize = Math.max(0, Math.min(innerW, boxH - pad * 2 - gapBelowQr - textHeight));

  const totalHeight = qrSize + gapBelowQr + textHeight;
  let y = Math.max(pad, (boxH - totalHeight) / 2);
  const qr = { x: (boxW - qrSize) / 2, y, size: qrSize };
  y += qrSize + gapBelowQr;

  const lines = nameLines.map((text) => {
    const line = { text, role: "qrName", size: nameSize, top: y, width: nameWidth(text, nameSize) };
    y += nameSize * LINE_HEIGHT;
    return line;
  });
  if (caption) {
    y += gapBeforeCaption;
    lines.push({ text: caption, role: "qrCaption", size: captionSize, top: y, width: captionWidth(caption, captionSize) });
  }
  for (const line of lines) line.x = (boxW - line.width) / 2;
  return { qr, lines };
}

export function layoutQrCaption({ boxW, boxH, name, caption, measure, nameStyle, captionStyle }) {
  const nameText = `${name} ji`;
  const captionText = (caption || "").trim();
  // In a short box, the text would squeeze the QR too small to scan reliably; scale the
  // text down until the QR keeps a healthy share of the box.
  const target = 0.55 * Math.min(boxW * 0.92, boxH * 0.92);
  let layout;
  for (let scale = 1; scale >= 0.4; scale -= 0.1) {
    layout = layoutAtScale({ boxW, boxH, nameText, caption: captionText, measure, nameStyle, captionStyle, scale });
    if (layout.qr.size >= target) break;
  }
  return layout;
}
