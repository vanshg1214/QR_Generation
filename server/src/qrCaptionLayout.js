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
// weight is one of the CAPTION_WEIGHTS keys.

export const DEFAULT_QR_CAPTION = "Scan to experience VPV";

// Poppins weights the user can pick for each line (key -> CSS font-weight). The server
// ships a TTF for each one.
export const CAPTION_WEIGHTS = { regular: 400, medium: 500, semibold: 600, bold: 700 };
// Text size is chosen as a multiple of the automatic size, because the right absolute
// size depends on how big the QR box is.
export const MIN_TEXT_SCALE = 0.5;
export const MAX_TEXT_SCALE = 2;
export const DEFAULT_CAPTION_STYLE = {
  nameWeight: "semibold",
  captionWeight: "medium",
  nameScale: 1,
  captionScale: 1,
};

// Fills in defaults and validates the per-line style. Returns null if a value is invalid
// (so the server can reject it); older saved campaigns without style fields get the
// defaults.
export function normalizeCaptionStyle(style = {}) {
  const out = { ...DEFAULT_CAPTION_STYLE };
  for (const key of ["nameWeight", "captionWeight"]) {
    if (style[key] == null) continue;
    if (!Object.hasOwn(CAPTION_WEIGHTS, style[key])) return null;
    out[key] = style[key];
  }
  for (const key of ["nameScale", "captionScale"]) {
    if (style[key] == null) continue;
    const v = Number(style[key]);
    if (!Number.isFinite(v) || v < MIN_TEXT_SCALE || v > MAX_TEXT_SCALE) return null;
    out[key] = v;
  }
  return out;
}

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

function layoutAtScale({ boxW, boxH, nameText, caption, measure, scale, style }) {
  const { nameWeight: nw, captionWeight: cw } = style;
  const pad = boxW * 0.04;
  const innerW = boxW - pad * 2;

  const auto = boxW * 0.085 * scale; // automatic name size; the gaps are based on it
  const baseName = auto * style.nameScale;
  // Shrink a long name a little; past ~70% of the base size, wrapping onto two lines
  // reads better than ever-smaller text.
  let nameSize = fitSize(measure, nameText, nw, baseName, baseName * 0.7, innerW);
  let nameLines = [nameText];
  if (measure(nameText, nw, nameSize) > innerW) {
    nameLines = splitInTwo(measure, nameText, nw, baseName);
    nameSize = Math.min(
      ...nameLines.map((l) => fitSize(measure, l, nw, baseName, baseName * 0.45, innerW))
    );
  }
  // Sized from the base, not the (possibly shrunk) name, so it stays consistent page to page.
  const baseCaption = auto * 0.8 * style.captionScale;
  const captionSize = caption
    ? fitSize(measure, caption, cw, baseCaption, baseCaption * 0.5, innerW)
    : 0;

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
    const line = { text, weight: nw, role: "name", size: nameSize, top: y };
    y += nameSize * LINE_HEIGHT;
    return line;
  });
  if (caption) {
    y += gapBeforeCaption;
    lines.push({ text: caption, weight: cw, role: "caption", size: captionSize, top: y });
  }
  for (const line of lines) {
    const w = measure(line.text, line.weight, line.size);
    line.x = (boxW - w) / 2;
    line.width = w;
  }
  return { qr, lines };
}

export function layoutQrCaption({ boxW, boxH, name, caption, measure, style }) {
  style = normalizeCaptionStyle(style) || DEFAULT_CAPTION_STYLE;
  const nameText = `${name} ji`;
  const captionText = (caption || "").trim();
  // In a short box, the text would squeeze the QR too small to scan reliably; scale the
  // text down until the QR keeps a healthy share of the box.
  const target = 0.55 * Math.min(boxW * 0.92, boxH * 0.92);
  let layout;
  for (let scale = 1; scale >= 0.4; scale -= 0.1) {
    layout = layoutAtScale({ boxW, boxH, nameText, caption: captionText, measure, scale, style });
    if (layout.qr.size >= target) break;
  }
  return layout;
}
