import { useRef, useState } from "react";
import { api, downloadBlob } from "../api.js";

export default function CreateCampaignPanel({ onCreated }) {
  const fileInput = useRef(null);
  const [campaignName, setCampaignName] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setStatus("Choose an Excel file first.");
      return;
    }
    setBusy(true);
    setStatus("Processing… generating a QR code per person.");
    try {
      const blob = await api.createCampaign({ campaignName, destinationUrl, file });
      downloadBlob(blob, `${campaignName.trim().replace(/[^a-z0-9]+/gi, "_")}-qr-codes.zip`);
      setStatus("Done — QR codes downloaded as a zip.");
      setCampaignName("");
      setDestinationUrl("");
      fileInput.current.value = "";
      onCreated?.();
    } catch (err) {
      setStatus(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Create a New Campaign</h2>
      <p className="muted">
        Give this batch a title, set where every QR code should redirect to, and upload the Excel
        (.xlsx) file of people (needs a "Name" column). Each row gets a unique, trackable QR code,
        and all codes download as a zip.
      </p>
      <form className="stacked-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Campaign title (e.g. Product Launch 2026)"
          value={campaignName}
          onChange={(e) => setCampaignName(e.target.value)}
          required
        />
        <input
          type="url"
          placeholder="Destination link (e.g. https://your-content-link.com)"
          value={destinationUrl}
          onChange={(e) => setDestinationUrl(e.target.value)}
          required
        />
        <input type="file" accept=".xlsx,.xls,.csv" ref={fileInput} />
        <button type="submit" disabled={busy}>
          {busy ? "Working…" : "Create Campaign & Generate QR Codes"}
        </button>
      </form>
      {status && <p className="muted">{status}</p>}
    </section>
  );
}
