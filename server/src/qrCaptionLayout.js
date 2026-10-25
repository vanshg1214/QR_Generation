// Lays out a QR code with the person's name and a caption underneath, all inside one
// calibrated box:
//
//      [ QR ]
//   Saiyam Kochhar ji        (Poppins SemiBold)
//   Scan to experience VPV   (Poppins Medium)
//
// Used by the server (PDF) and imported by the dashboard (live preview) so both place things
// identically. Units are whatever the box is measured in; y is top-down from the box's
// top edge. measure(text, weight, size) returns the text's width in those units, where
// weight is "semibold" (name) or "medium" (caption).

export const DEFAULT_QR_CAPTION = "Scan to experience VPV";

// Where the text baseline sits below a line's top, as a fraction of font size. Poppins'
// ascent/descent (1.05/0.35 em) centred in a 1.15em line box puts it at 0.925em; using the
// same value in the PDF and in CSS keeps the preview faithful.
export const POPPINS_BASELINE = 0.925;
export const LINE_HEIGHT = 1.15;

// Shrinks size until text fits maxWidth; returns the size (never below minSize).
function fitSize(measure, text, weight, startSize, minSize, maxWidth) {
  let size = startSize;
  while (size > minSize && measure(text, weight, size) > maxWidth) size *= 0.95;
  return Math.max(size, minSize);
}

// Splits text into two lines at the word break that best balances their widths.
function splitInTwo(measure, text, weight, size) {
  const words = text.split(/\s+/);
  let best = [text];
  let bestWidth = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const w = Math.max(measure(a, weight, size), measure(b, weight, size));
    if (w < bestWidth) {
      bestWidth = w;
      best = [a, b];
    }
  }
  return best;
}

function layoutAtScale({ boxW, boxH, nameText, caption, measure, scale }) {
  const pad = boxW * 0.04;
  const innerW = boxW - pad * 2;

  const baseName = boxW * 0.085 * scale;
  // Shrink a long name a little; past ~70% of the base size, wrapping onto two lines
  // reads better than ever-smaller text.
  let nameSize = fitSize(measure, nameText, "semibold", baseName, baseName * 0.7, innerW);
  let nameLines = [nameText];
  if (measure(nameText, "semibold", nameSize) > innerW) {
    nameLines = splitInTwo(measure, nameText, "semibold", baseName);
    nameSize = Math.min(
      ...nameLines.map((l) => fitSize(measure, l, "semibold", baseName, baseName * 0.45, innerW))
    );
  }
  // Sized from the base, not the (possibly shrunk) name, so it stays consistent page to page.
  const captionSize = caption
    ? fitSize(measure, caption, "medium", baseName * 0.8, baseName * 0.4, innerW)
    : 0;

  const gapBelowQr = baseName * 0.35;
  const gapBeforeCaption = caption ? baseName * 0.1 : 0;
  const textHeight =
    nameLines.length * nameSize * LINE_HEIGHT + (caption ? gapBeforeCaption + captionSize * LINE_HEIGHT : 0);
  const qrSize = Math.max(0, Math.min(innerW, boxH - pad * 2 - gapBelowQr - textHeight));

  const totalHeight = qrSize + gapBelowQr + textHeight;
  let y = Math.max(pad, (boxH - totalHeight) / 2);
  const qr = { x: (boxW - qrSize) / 2, y, size: qrSize };
  y += qrSize + gapBelowQr;

  const lines = nameLines.map((text) => {
    const line = { text, weight: "semibold", role: "name", size: nameSize, top: y };
    y += nameSize * LINE_HEIGHT;
    return line;
  });
  if (caption) {
    y += gapBeforeCaption;
    lines.push({ text: caption, weight: "medium", role: "caption", size: captionSize, top: y });
  }
  for (const line of lines) {
    const w = measure(line.text, line.weight, line.size);
    line.x = (boxW - w) / 2;
    line.width = w;
  }
  return { qr, lines };
}

export function layoutQrCaption({ boxW, boxH, name, caption, measure }) {
  const nameText = `${name} ji`;
  const captionText = (caption || "").trim();
  // In a short box, the text would squeeze the QR too small to scan reliably; scale the
  // text down until the QR keeps a healthy share of the box.
  const target = 0.55 * Math.min(boxW * 0.92, boxH * 0.92);
  let layout;
  for (let scale = 1; scale >= 0.4; scale -= 0.1) {
    layout = layoutAtScale({ boxW, boxH, nameText, caption: captionText, measure, scale });
    if (layout.qr.size >= target) break;
  }
  return layout;
}
