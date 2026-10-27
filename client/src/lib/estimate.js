// Estimates how long creating the whole campaign (all letters + the zip) will take, from the
// timings of making one sample page on the same server, and the connection speed seen while
// sending the graphic for it.
//
// Server time ≈ fixed setup (reading the graphic, the Excel, saving to the database, writing
// the PDF and the zip) + one page's cost per person. Measured locally, 240 people: estimate
// 25.4s, actual 26.2s.
const FIXED_SERVER_MS = 3500; // Excel, database, final PDF save and zip, beyond what's measured
const ZIP_BYTES_PER_QR = 3500; // one QR image in the zip
const PDF_BYTES_PER_PAGE = 2500; // one extra page in "All Letters.pdf"

export function estimateGeneration({ proof, people, links, graphicBytes, excelBytes }) {
  const serverMs = FIXED_SERVER_MS + 2 * proof.setupMs + proof.firstPageMs + people * proof.perPageMs;

  // The sample request moved the graphic up and the one-page PDF down; whatever time the
  // server didn't spend working was the network.
  const proofServerMs = 2 * proof.setupMs + 2 * proof.firstPageMs + 4 * proof.perPageMs;
  const proofNetworkMs = Math.max(300, proof.clientMs - proofServerMs);
  const bytesPerMs = Math.max(20, (graphicBytes + proof.pdfBytes) / proofNetworkMs);
  const zipBytes = graphicBytes + people * (links * ZIP_BYTES_PER_QR + PDF_BYTES_PER_PAGE);
  const transferMs = (graphicBytes + excelBytes + zipBytes) / bytesPerMs;

  const totalMs = serverMs + transferMs;
  return { totalMs, lowMs: totalMs * 0.85, highMs: totalMs * 1.35, zipBytes };
}

function roundSeconds(ms) {
  const s = ms / 1000;
  if (s < 10) return Math.max(1, Math.round(s));
  if (s < 60) return Math.round(s / 5) * 5;
  return Math.round(s / 15) * 15;
}

export function formatDuration(ms) {
  const s = roundSeconds(ms);
  if (s < 60) return `${s} seconds`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} min ${rest} s` : `${m} min`;
}

// "about 20–35 seconds", "about 1 min – 1 min 30 s"
export function formatRange({ lowMs, highMs }) {
  const lo = roundSeconds(lowMs);
  const hi = roundSeconds(highMs);
  if (lo === hi) return `about ${formatDuration(lowMs)}`;
  if (hi < 60) return `about ${lo}–${hi} seconds`;
  return `about ${formatDuration(lowMs)} – ${formatDuration(highMs)}`;
}

export function formatBytes(bytes) {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
