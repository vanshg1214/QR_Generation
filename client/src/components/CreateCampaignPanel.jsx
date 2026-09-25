import { useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { api, downloadBlob } from "../api.js";
import LetterGraphicCalibrator from "./LetterGraphicCalibrator.jsx";

const MAX_LINKS = 10;
const DEFAULT_SIGNATURE_NAME = "Nitin Gupta";
const DEFAULT_SIGNATURE_TITLE = "Export Marketing Strategist";

function emptyLink() {
  return { uid: crypto.randomUUID(), label: "", destinationUrl: "" };
}

export default function CreateCampaignPanel({ onCreated, onCancel }) {
  const fileInput = useRef(null);
  const graphicInput = useRef(null);
  const [campaignName, setCampaignName] = useState("");
  const [links, setLinks] = useState([emptyLink()]);
  const [graphicFile, setGraphicFile] = useState(null);
  const [boxes, setBoxes] = useState([]);
  const [signatureName, setSignatureName] = useState(DEFAULT_SIGNATURE_NAME);
  const [signatureTitle, setSignatureTitle] = useState(DEFAULT_SIGNATURE_TITLE);
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
      toast.error("Choose an Excel file first.");
      return;
    }
    const graphic = graphicInput.current?.files?.[0] || null;

    // Resolve each box's link assignment to that link's current array
    // position -- the server doesn't have real link ids until it inserts
    // them in this same request. Drop boxes with no (or a stale) assignment.
    const resolvedBoxes = boxes
      .map((box) => ({ ...box, linkIndex: links.findIndex((l) => l.uid === box.linkUid) }))
      .filter((box) => box.linkIndex !== -1)
      .map(({ linkIndex, x, y, width, height }) => ({ linkIndex, x, y, width, height }));

    setBusy(true);
    const toastId = toast.loading("Processing… generating QR codes for every person and every link.");
    try {
      const blob = await api.createCampaign({
        campaignName,
        links,
        file,
        graphic,
        boxes: resolvedBoxes,
        signatureName: signatureName.trim(),
        signatureTitle: signatureTitle.trim(),
      });
      downloadBlob(blob, `${campaignName.trim().replace(/[^a-z0-9]+/gi, "_")}-qr-codes.zip`);
      toast.success("Done — QR codes downloaded as a zip.", { id: toastId });
      setCampaignName("");
      setLinks([emptyLink()]);
      setGraphicFile(null);
      setBoxes([]);
      setSignatureName(DEFAULT_SIGNATURE_NAME);
      setSignatureTitle(DEFAULT_SIGNATURE_TITLE);
      fileInput.current.value = "";
      graphicInput.current.value = "";
      onCreated?.();
    } catch (err) {
      toast.error(err.message, { id: toastId });
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
        (needs a "Name" column). Optionally upload a letter graphic (PNG/JPEG) — if provided,
        every person's folder in the zip also gets a "Dear {"{Name}"} ji" PDF letter with that
        graphic and a signature block, plus one combined "All Letters.pdf" for printing everyone
        at once. If the graphic has a blank placeholder box (e.g. "scan this"), calibrate it below
        so each person's real QR code gets stamped into it.
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
            <div className="link-row" key={link.uid}>
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

        <label className="field-label">
          People list (Excel)
          <input type="file" accept=".xlsx,.xls,.csv" ref={fileInput} />
        </label>
        <label className="field-label">
          Letter graphic (optional — PNG/JPEG)
          <input
            type="file"
            accept="image/png,image/jpeg"
            ref={graphicInput}
            onChange={(e) => setGraphicFile(e.target.files?.[0] || null)}
          />
        </label>

        {graphicFile && (
          <>
            <LetterGraphicCalibrator
              graphicFile={graphicFile}
              links={links}
              boxes={boxes}
              onBoxesChange={setBoxes}
            />
            <label className="field-label">
              Signature name
              <input
                type="text"
                value={signatureName}
                onChange={(e) => setSignatureName(e.target.value)}
                placeholder="Nitin Gupta"
              />
            </label>
            <label className="field-label">
              Signature title
              <input
                type="text"
                value={signatureTitle}
                onChange={(e) => setSignatureTitle(e.target.value)}
                placeholder="Export Marketing Strategist"
              />
            </label>
          </>
        )}

        <button type="submit" disabled={busy}>
          {busy ? "Working…" : "Create Campaign & Generate QR Codes"}
        </button>
      </form>
    </section>
  );
}
