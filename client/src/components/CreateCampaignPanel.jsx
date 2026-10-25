import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { api, downloadBlob } from "../api.js";
import LetterGraphicCalibrator from "./LetterGraphicCalibrator.jsx";
import { DEFAULT_QR_CAPTION } from "../../../server/src/qrCaptionLayout.js";

const MAX_LINKS = 10;
const DEFAULT_SIGNATURE_NAME = "Nitin Gupta";
const DEFAULT_SIGNATURE_TITLE = "Export Marketing Strategist";
const PREVIEW_NAME = "Rajesh Kumar";
const DEFAULT_NAME_COLOR = "#1a1a1a";

// Links are pre-named L-1, L-2, ... so every link (and every QR box) has a usable label
// from the start; the user can rename them.
function emptyLink(number = 1) {
  return { uid: crypto.randomUUID(), label: `L-${number}`, destinationUrl: "" };
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
  const [typography, setTypography] = useState("sans-serif");
  const [includeGreeting, setIncludeGreeting] = useState(true);
  const [includeSignature, setIncludeSignature] = useState(true);
  const [padding, setPadding] = useState(false);
  const [showCaption, setShowCaption] = useState(false);
  const [captionText, setCaptionText] = useState(DEFAULT_QR_CAPTION);
  const [nameColor, setNameColor] = useState(DEFAULT_NAME_COLOR);
  const [captionColor, setCaptionColor] = useState(DEFAULT_NAME_COLOR);
  const [colorsAuto, setColorsAuto] = useState(true); // false once the user picks a colour
  const [colorSampler, setColorSampler] = useState(null);

  // Keep the caption colours matched to the graphic (around the first QR box) until the
  // user picks their own.
  useEffect(() => {
    if (!showCaption || !colorsAuto || !colorSampler || !boxes.length) return;
    const box = boxes.find((b) => b.linkUid) || boxes[0];
    const suggested = colorSampler(box);
    setNameColor(suggested.nameColor);
    setCaptionColor(suggested.captionColor);
  }, [showCaption, colorsAuto, colorSampler, boxes]);
  const [greetingPos, setGreetingPos] = useState(null); // null = above graphic; {x,y} = inside graphic
  const [busy, setBusy] = useState(false);

  function updateLink(index, field, value) {
    setLinks((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  function addLink() {
    setLinks((prev) => (prev.length >= MAX_LINKS ? prev : [...prev, emptyLink(prev.length + 1)]));
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
    // them in this same request. A box is never left without a link: one with no (or a
    // removed) assignment uses the first link, matching what its dropdown shows.
    const resolvedBoxes = boxes
      .map((box) => ({ ...box, linkIndex: Math.max(0, links.findIndex((l) => l.uid === box.linkUid)) }))
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
        // No signature = no footer; the server only draws one when a name/title is given.
        signatureName: includeSignature ? signatureName.trim() : "",
        signatureTitle: includeSignature ? signatureTitle.trim() : "",
        typography,
        includeGreeting,
        greetingPos: includeGreeting ? greetingPos : null,
        padding,
        qrCaption: showCaption ? { text: captionText.trim(), nameColor, captionColor } : null,
      });
      downloadBlob(blob, `${campaignName.trim().replace(/[^a-z0-9]+/gi, "_")}-qr-codes.zip`);
      toast.success("Done — QR codes downloaded as a zip.", { id: toastId });
      setCampaignName("");
      setLinks([emptyLink()]);
      setGraphicFile(null);
      setBoxes([]);
      setSignatureName(DEFAULT_SIGNATURE_NAME);
      setSignatureTitle(DEFAULT_SIGNATURE_TITLE);
      setTypography("sans-serif");
      setIncludeGreeting(true);
      setIncludeSignature(true);
      setPadding(false);
      setShowCaption(false);
      setCaptionText(DEFAULT_QR_CAPTION);
      setColorsAuto(true);
      setGreetingPos(null);
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
        (the name column is found automatically, e.g. "Name" or "Contact Name"). Optionally upload
        a letter graphic (PNG/JPEG) — if provided, the zip also gets one combined "All Letters.pdf"
        for printing, one page per person with their own QR code. The greeting and signature
        footer are optional, and pages are borderless unless you tick the white-margin option. If the
        graphic has a blank placeholder box (e.g. "scan this"), calibrate it below so each
        person's real QR code gets stamped into it.
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
              includeGreeting={includeGreeting}
              greetingPos={greetingPos}
              onGreetingPosChange={setGreetingPos}
              qrCaption={showCaption ? { text: captionText, nameColor, captionColor } : null}
              previewName={PREVIEW_NAME}
              onColorSampler={(sampler) => setColorSampler(() => sampler)}
            />
            <label className="field-label" style={{ flexDirection: "row", alignItems: "center", gap: "8px", fontWeight: "normal", marginTop: "8px" }}>
              <input
                type="checkbox"
                checked={showCaption}
                onChange={(e) => setShowCaption(e.target.checked)}
                style={{ width: "auto", margin: 0 }}
              />
              Show name &amp; caption under the QR (e.g. "Rajesh Kumar ji" / "Scan to experience VPV")
            </label>
            {showCaption && (
              <>
                <label className="field-label">
                  Caption under the name
                  <input
                    type="text"
                    value={captionText}
                    maxLength={80}
                    onChange={(e) => setCaptionText(e.target.value)}
                    placeholder={DEFAULT_QR_CAPTION}
                  />
                </label>
                <div className="caption-color-row">
                  <label>
                    <input
                      type="color"
                      value={nameColor}
                      onChange={(e) => {
                        setColorsAuto(false);
                        setNameColor(e.target.value);
                      }}
                    />
                    Name colour
                  </label>
                  <label>
                    <input
                      type="color"
                      value={captionColor}
                      onChange={(e) => {
                        setColorsAuto(false);
                        setCaptionColor(e.target.value);
                      }}
                    />
                    Caption colour
                  </label>
                  <button type="button" className="secondary" onClick={() => setColorsAuto(true)} disabled={colorsAuto}>
                    {colorsAuto ? "Colours matched to graphic" : "Match colours to graphic"}
                  </button>
                </div>
                <p className="muted small" style={{ margin: 0 }}>
                  The QR, name and caption all fit inside the box you place — make the box a little taller than wide so there's room for the text. The preview above shows how it will print.
                </p>
              </>
            )}
            <label className="field-label" style={{ flexDirection: "row", alignItems: "center", gap: "8px", fontWeight: "normal", marginTop: "8px" }}>
              <input 
                type="checkbox" 
                checked={includeSignature}
                onChange={(e) => setIncludeSignature(e.target.checked)}
                style={{ width: "auto", margin: 0 }}
              />
              Include Signature Footer (name & title)
            </label>
            {includeSignature && (
              <>
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
            <label className="field-label">
              Letter Font Style
              <select value={typography} onChange={(e) => setTypography(e.target.value)}>
                <option value="sans-serif">Modern & Clean (Helvetica)</option>
                <option value="serif">Classic & Professional (Times Roman)</option>
                <option value="monospace">Typewriter Style (Courier)</option>
              </select>
            </label>
            <label className="field-label" style={{ flexDirection: "row", alignItems: "center", gap: "8px", fontWeight: "normal", marginTop: "8px" }}>
              <input 
                type="checkbox" 
                checked={includeGreeting}
                onChange={(e) => setIncludeGreeting(e.target.checked)}
                style={{ width: "auto", margin: 0 }}
              />
              Include Personalized Greeting (Dear [Name] ji,)
            </label>
            <label className="field-label" style={{ flexDirection: "row", alignItems: "center", gap: "8px", fontWeight: "normal", marginTop: "8px" }}>
              <input
                type="checkbox"
                checked={padding}
                onChange={(e) => setPadding(e.target.checked)}
                style={{ width: "auto", margin: 0 }}
              />
              Add white margin around the graphic (off = graphic fills the page edge to edge)
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
