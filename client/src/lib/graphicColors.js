// Suggests text colours for the name/caption printed under each QR so they suit the
// uploaded graphic: the name gets a colour readable on the box's background, and the
// caption gets the graphic's dominant brand colour (e.g. the blue in a VPV flyer) when
// that colour is readable there too. The user can always override both.

const MAX_WORK_DIM = 240; // downscale target, px -- colour sampling needs very little detail
const DARK_TEXT = "#1a1a1a";
const LIGHT_TEXT = "#ffffff";
const MIN_CAPTION_CONTRAST = 3; // WCAG "large text" contrast ratio

// Draws the image small once; the returned sampler is cheap enough to call on every
// box move.
export function createColorSampler(img) {
  const scale = Math.min(1, MAX_WORK_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const brand = dominantBrandColor(data);

  return function suggestCaptionColors(box) {
    const bg = averageColor(data, w, h, box);
    const nameColor = luminance(bg) > 0.45 ? DARK_TEXT : LIGHT_TEXT;
    const captionColor =
      brand && contrastRatio(brand, bg) >= MIN_CAPTION_CONTRAST ? toHex(brand) : nameColor;
    return { nameColor, captionColor };
  };
}

// Most common clearly-coloured (saturated, not near-white/black) colour in the image.
function dominantBrandColor(data) {
  const bins = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 50 || min > 225 || (max - min) / max < 0.45) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    bin.n++;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(key, bin);
  }
  let best = null;
  for (const bin of bins.values()) if (!best || bin.n > best.n) best = bin;
  return best && [best.r / best.n, best.g / best.n, best.b / best.n];
}

function averageColor(data, w, h, box) {
  const x0 = Math.floor(box.x * w);
  const y0 = Math.floor(box.y * h);
  const x1 = Math.max(x0 + 1, Math.ceil((box.x + box.width) * w));
  const y1 = Math.max(y0 + 1, Math.ceil((box.y + box.height) * h));
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < Math.min(y1, h); y++) {
    for (let x = x0; x < Math.min(x1, w); x++) {
      const i = (y * w + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : [255, 255, 255];
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function toHex(rgb) {
  return "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}
