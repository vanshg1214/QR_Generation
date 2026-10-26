// Font, weight, size and colour for each piece of text printed on a letter page. Shared
// by the server (PDF) and the dashboard (editor + live preview) so both agree exactly.
//
// The five texts:
//   greeting     "Dear {name} ji,"            size in points
//   qrName       "{name} ji" under each QR    size as a multiple of the automatic size
//   qrCaption    e.g. "Scan to experience VPV" (the automatic size depends on the QR box)
//   footerName   signature name               size in points
//   footerTitle  signature title              size in points

// ascent/descent (as a fraction of font size) place each font's baseline the same way in
// the PDF and in the browser preview.
export const FONT_FAMILIES = {
  poppins: { label: "Poppins (modern)", weights: ["regular", "medium", "semibold", "bold"], ascent: 1.05, descent: 0.35 },
  helvetica: { label: "Helvetica (clean)", weights: ["regular", "bold"], ascent: 0.905, descent: 0.212 },
  times: { label: "Times Roman (classic)", weights: ["regular", "bold"], ascent: 0.891, descent: 0.216 },
  courier: { label: "Courier (typewriter)", weights: ["regular", "bold"], ascent: 0.833, descent: 0.3 },
};

export const WEIGHTS = { regular: 400, medium: 500, semibold: 600, bold: 700 };
export const WEIGHT_LABELS = { regular: "Regular", medium: "Medium", semibold: "Semi-bold", bold: "Bold" };

export const LINE_HEIGHT = 1.15;

export const TEXT_KEYS = ["greeting", "qrName", "qrCaption", "footerName", "footerTitle"];
export const TEXT_LABELS = {
  greeting: "Greeting",
  qrName: "Name under QR",
  qrCaption: "Caption under QR",
  footerName: "Footer name",
  footerTitle: "Footer title",
};

export const isScaledText = (key) => key === "qrName" || key === "qrCaption";
export const POINT_SIZE_RANGE = [6, 40];
export const SCALE_RANGE = [0.5, 2];

// Helvetica/Times/Courier are the PDF's built-in fonts and only come in regular and bold;
// other weights map to the nearer of the two.
export function supportedWeight(font, weight) {
  if (FONT_FAMILIES[font].weights.includes(weight)) return weight;
  return WEIGHTS[weight] >= 600 ? "bold" : "regular";
}

// Distance from the top of a text line (line height = LINE_HEIGHT × size) to its baseline.
export function baselineOffset(font, size) {
  const { ascent, descent } = FONT_FAMILIES[font];
  return ((LINE_HEIGHT - ascent - descent) / 2 + ascent) * size;
}

const TYPOGRAPHY_FONT = { "sans-serif": "helvetica", serif: "times", monospace: "courier" };

// typography: the single font setting campaigns used before per-text styles existed.
export function defaultTextStyles(typography = "sans-serif") {
  const font = TYPOGRAPHY_FONT[typography] || "helvetica";
  return {
    greeting: { font, weight: "bold", size: 13, color: "#1a1a1a" },
    qrName: { font: "poppins", weight: "semibold", size: 1, color: "#1a1a1a" },
    qrCaption: { font: "poppins", weight: "medium", size: 1, color: "#1a1a1a" },
    footerName: { font, weight: "bold", size: 13, color: "#1a1a1a" },
    footerTitle: { font, weight: "regular", size: 11, color: "#404040" },
  };
}

const isColor = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

// Merges user-supplied styles over `base`, validating every value. Returns null if
// anything is invalid, so the server can reject the request.
export function normalizeTextStyles(input, base = defaultTextStyles()) {
  if (input == null) return base;
  if (typeof input !== "object") return null;
  const out = {};
  for (const key of TEXT_KEYS) {
    const s = { ...base[key], ...(input[key] || {}) };
    if (!Object.hasOwn(FONT_FAMILIES, s.font) || !Object.hasOwn(WEIGHTS, s.weight) || !isColor(s.color)) return null;
    const size = Number(s.size);
    const [lo, hi] = isScaledText(key) ? SCALE_RANGE : POINT_SIZE_RANGE;
    if (!Number.isFinite(size) || size < lo || size > hi) return null;
    out[key] = { font: s.font, weight: supportedWeight(s.font, s.weight), size, color: s.color.toLowerCase() };
  }
  return out;
}

// Styles for a saved campaign. Campaigns saved before per-text styles existed only have
// a typography setting and (maybe) the old caption fields; those still print as before.
export function resolveTextStyles(textStylesJson, typography, qrCaption) {
  const base = defaultTextStyles(typography);
  if (qrCaption) {
    if (qrCaption.nameWeight) base.qrName.weight = qrCaption.nameWeight;
    if (qrCaption.nameScale) base.qrName.size = qrCaption.nameScale;
    if (qrCaption.nameColor) base.qrName.color = qrCaption.nameColor;
    if (qrCaption.captionWeight) base.qrCaption.weight = qrCaption.captionWeight;
    if (qrCaption.captionScale) base.qrCaption.size = qrCaption.captionScale;
    if (qrCaption.captionColor) base.qrCaption.color = qrCaption.captionColor;
  }
  let parsed = null;
  try {
    parsed = textStylesJson ? JSON.parse(textStylesJson) : null;
  } catch {
    parsed = null;
  }
  return normalizeTextStyles(parsed, base) || normalizeTextStyles(null, base);
}
