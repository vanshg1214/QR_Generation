// Scans a loaded <img> for candidate blank rectangular regions -- e.g. an empty
// placeholder square in a flyer where a QR code is meant to go -- and returns
// them as fractional boxes (0..1, top-left origin) sorted by confidence.
//
// This is a heuristic, not real segmentation: it downsamples the image onto a
// coarse grid, flags blocks that are flat and light ("blank"), finds connected
// blank regions, and scores them by how rectangular/square/reasonably-sized
// they are. It will miss some real boxes and occasionally flag false ones --
// that's expected, which is why callers always let the user adjust the result.

const MAX_WORK_DIM = 500; // downscale target, px -- keeps the scan fast
const BLOCK = 4; // px, at working resolution
const VARIANCE_THRESHOLD = 150; // 0-255^2 scale; lower = flatter/more uniform
const LIGHTNESS_THRESHOLD = 205; // 0-255; higher = closer to white -- loose enough for light-gray fills, not just pure white
const MIN_FRACTION = 0.04; // reject boxes smaller than 4% of image width/height
const MAX_AREA_FRACTION = 0.4; // reject boxes bigger than 40% of image area (almost certainly page background, not a placeholder)
const MIN_ASPECT = 0.12; // very loose -- a QR placeholder is often drawn as a wide "scan here" rectangle, not a perfect square
const MAX_ASPECT = 8;
const MIN_FILL_RATIO = 0.75; // how rectangular the blank region's shape is
const MAX_CANDIDATES = 10;

export function detectBlankBoxes(img) {
  const { canvas, ctx, workW, workH } = drawToWorkingCanvas(img);
  const { data } = ctx.getImageData(0, 0, workW, workH);

  const cols = Math.ceil(workW / BLOCK);
  const rows = Math.ceil(workH / BLOCK);
  const blank = classifyBlocks(data, workW, workH, cols, rows);

  const components = findConnectedComponents(blank, cols, rows);

  const candidates = [];
  for (const comp of components) {
    const candidate = scoreComponent(comp, cols, rows, workW, workH);
    if (candidate) candidates.push(candidate);
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, MAX_CANDIDATES);
}

function drawToWorkingCanvas(img) {
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  const scale = Math.min(1, MAX_WORK_DIM / Math.max(naturalW, naturalH));
  const workW = Math.max(1, Math.round(naturalW * scale));
  const workH = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = workW;
  canvas.height = workH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, workW, workH);

  return { canvas, ctx, workW, workH };
}

function classifyBlocks(data, workW, workH, cols, rows) {
  const blank = new Uint8Array(cols * rows);
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * BLOCK;
      const y0 = by * BLOCK;
      const x1 = Math.min(x0 + BLOCK, workW);
      const y1 = Math.min(y0 + BLOCK, workH);

      let sum = 0;
      let sumSq = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * workW + x) * 4;
          const lightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
          sum += lightness;
          sumSq += lightness * lightness;
          count++;
        }
      }
      if (count === 0) continue;
      const mean = sum / count;
      const variance = sumSq / count - mean * mean;
      blank[by * cols + bx] = variance < VARIANCE_THRESHOLD && mean > LIGHTNESS_THRESHOLD ? 1 : 0;
    }
  }
  return blank;
}

// Iterative (queue-based) 4-connected flood fill -- avoids recursion depth
// issues on large grids.
function findConnectedComponents(mask, cols, rows) {
  const visited = new Uint8Array(mask.length);
  const components = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;

    const cells = [];
    const queue = [start];
    visited[start] = 1;

    while (queue.length) {
      const idx = queue.pop();
      cells.push(idx);
      const x = idx % cols;
      const y = Math.floor(idx / cols);

      const neighbors = [
        x > 0 ? idx - 1 : -1,
        x < cols - 1 ? idx + 1 : -1,
        y > 0 ? idx - cols : -1,
        y < rows - 1 ? idx + cols : -1,
      ];
      for (const n of neighbors) {
        if (n >= 0 && mask[n] && !visited[n]) {
          visited[n] = 1;
          queue.push(n);
        }
      }
    }
    components.push(cells);
  }
  return components;
}

function scoreComponent(cells, cols, rows, workW, workH) {
  let minX = cols;
  let maxX = 0;
  let minY = rows;
  let maxY = 0;
  for (const idx of cells) {
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const bboxCols = maxX - minX + 1;
  const bboxRows = maxY - minY + 1;
  const fillRatio = cells.length / (bboxCols * bboxRows);
  const aspect = bboxCols / bboxRows;

  const widthFrac = (bboxCols * BLOCK) / workW;
  const heightFrac = (bboxRows * BLOCK) / workH;
  const areaFrac = widthFrac * heightFrac;
  const touchesEdge = minX === 0 || minY === 0 || maxX === cols - 1 || maxY === rows - 1;

  if (fillRatio < MIN_FILL_RATIO) return null;
  if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) return null;
  if (widthFrac < MIN_FRACTION || heightFrac < MIN_FRACTION) return null;
  if (areaFrac > MAX_AREA_FRACTION) return null;
  if (touchesEdge) return null;

  // Prefer squarer, larger, more-rectangular regions, but never let a wide/tall
  // (still plausible) box score negative -- squareness saturates at 1 for a
  // perfect square and approaches 0 for extreme rectangles, never below.
  const squareness = Math.min(aspect, 1 / aspect);
  const sizeFactor = Math.min(1, areaFrac / 0.03);
  const score = fillRatio * squareness * sizeFactor;

  return {
    x: (minX * BLOCK) / workW,
    y: (minY * BLOCK) / workH,
    width: widthFrac,
    height: heightFrac,
    score,
  };
}
