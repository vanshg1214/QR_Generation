import { useRef, useState } from "react";
import { api, downloadBlob } from "../api.js";

const MAX_LINKS = 10;

function emptyLink() {
  return { label: "", destinationUrl: "" };
}

export default function CreateCampaignPanel({ onCreated, onCancel }) {
  const fileInput = useRef(null);
  const [campaignName, setCampaignName] = useState("");
  const [links, setLinks] = useState([emptyLink()]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  function updateLink(index, field, value) {
    setLinks((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  function addLink() {
    setLinks((prev) => (prev.length >= MAX_LINKS ? prev : [...prev, emptyLink()]));
  }

  function removeLink(index) {
    setLinks((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setStatus("Choose an Excel file first.");
      return;
    }
    setBusy(true);
    setStatus("Processing… generating QR codes for every person and every link.");
    try {
      const blob = await api.createCampaign({ campaignName, links, file });
      downloadBlob(blob, `${campaignName.trim().replace(/[^a-z0-9]+/gi, "_")}-qr-codes.zip`);
      setStatus("Done — QR codes downloaded as a zip (one folder per person).");
      setCampaignName("");
      setLinks([emptyLink()]);
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
      <div className="section-header">
        <div>
          <span className="eyebrow">New Campaign</span>
          <h2>Set up your links and upload people</h2>
        </div>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      <p className="muted">
        Give this batch a title, add one or more links (each gets its own QR code per person —
        e.g. "Demo", "Testimonial", "Product Page"), then upload the Excel (.xlsx) file of people
        (needs a "Name" column). The zip downloads with one folder per person, containing a QR
        code for each link.
      </p>
      <form className="stacked-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Campaign title (e.g. Product Launch 2026)"
          value={campaignName}
          onChange={(e) => setCampaignName(e.target.value)}
          required
        />

        <div className="links-editor">
          {links.map((link, i) => (
            <div className="link-row" key={i}>
              <input
                type="text"
                placeholder={`Link ${i + 1} label (e.g. Demo)`}
                value={link.label}
                onChange={(e) => updateLink(i, "label", e.target.value)}
                required
              />
              <input
                type="url"
                placeholder="Destination link (e.g. https://your-content-link.com)"
                value={link.destinationUrl}
                onChange={(e) => updateLink(i, "destinationUrl", e.target.value)}
                required
              />
              {links.length > 1 && (
                <button
                  type="button"
                  className="secondary remove-link-btn"
                  onClick={() => removeLink(i)}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {links.length < MAX_LINKS && (
            <button type="button" className="secondary" onClick={addLink}>
              + Add Another Link
            </button>
          )}
        </div>

        <input type="file" accept=".xlsx,.xls,.csv" ref={fileInput} />
        <button type="submit" disabled={busy}>
          {busy ? "Working…" : "Create Campaign & Generate QR Codes"}
        </button>
      </form>
      {status && <p className="muted">{status}</p>}
    </section>
  );
}
