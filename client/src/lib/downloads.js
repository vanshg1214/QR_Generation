import { toast } from "react-hot-toast";
import { api, downloadBlob } from "../api.js";

export const zipFileName = (campaignName) =>
  `${(campaignName || "campaign").trim().replace(/[^a-z0-9]+/gi, "_")}-qr-codes.zip`;

export function letterSummary({ peopleCount, letterPages }) {
  const people = `${peopleCount} ${peopleCount === 1 ? "person" : "people"}`;
  return letterPages ? `${people}, ${letterPages} letter pages` : people;
}

// Downloads a campaign's zip again. The server checks the zip has exactly one letter page and
// one folder per person before sending it; the toast repeats those counts so they can be seen.
export async function downloadCampaignZip({ id, name, peopleCount }) {
  const toastId = toast.loading(
    peopleCount ? `Preparing the zip for ${peopleCount} people…` : "Preparing the zip…"
  );
  try {
    const result = await api.downloadQrZip(id);
    downloadBlob(result.blob, zipFileName(name));
    toast.success(`Downloaded: ${letterSummary(result)}.`, { id: toastId, duration: 6000 });
  } catch (err) {
    toast.error(err.message, { id: toastId });
  }
}
