import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { api, downloadBlob } from "../api.js";
import LetterGraphicCalibrator from "./LetterGraphicCalibrator.jsx";
import TextStyleEditor from "./TextStyleEditor.jsx";
import { DEFAULT_QR_CAPTION } from "../../../server/src/qrCaptionLayout.js";
import { defaultTextStyles, isScaledText } from "../../../server/src/textStyles.js";

const MAX_LINKS = 10;
const DEFAULT_SIGNATURE_NAME = "Nitin Gupta";
const DEFAULT_SIGNATURE_TITLE = "Export Marketing Strategist";
const PREVIEW_NAME = "Rajesh Kumar";
const DEFAULT_TEXT_COLOR = "#1a1a1a";

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
  const [includeGreeting, setIncludeGreeting] = useState(true);
  const [includeSignature, setIncludeSignature] = useState(true);
  const [padding, setPadding] = useState(false);
  const [showCaption, setShowCaption] = useState(false);
  const [captionText, setCaptionText] = useState(DEFAULT_QR_CAPTION);
  // Font, weight, size and colour of every text on the page (see server/src/textStyles.js).
  const [textStyles, setTextStyles] = useState(() => defaultTextStyles());
  const [selectedText, setSelectedText] = useState("greeting");
  // Colours for the text under the QR, matched to the graphic around the first QR box.
  const [autoColors, setAutoColors] = useState({ qrName: DEFAULT_TEXT_COLOR, qrCaption: DEFAULT_TEXT_COLOR });
  const [colorsAuto, setColorsAuto] = useState(true); // false once the user picks their own
  const [colorSampler, setColorSampler] = useState(null);

  useEffect(() => {
    if (!colorSampler || !boxes.length) return;
    const suggested = colorSampler(boxes[0]);
    setAutoColors((prev) =>
      prev.qrName === suggested.nameColor && prev.qrCaption === suggested.captionColor
        ? prev
        : { qrName: suggested.nameColor, qrCaption: suggested.captionColor }
    );
  }, [colorSampler, boxes]);

  useEffect(() => {
    if (!colorsAuto) return;
    setTextStyles((prev) =>
      prev.qrName.color === autoColors.qrName && prev.qrCaption.color === autoColors.qrCaption
        ? prev
        : {
            ...prev,
            qrName: { ...prev.qrName, color: autoColors.qrName },
            qrCaption: { ...prev.qrCaption, color: autoColors.qrCaption },
          }
    );
  }, [colorsAuto, autoColors]);

  // What "Reset" goes back to: the defaults, with the graphic-matched colours under the QR.
  const baseStyles = defaultTextStyles();
  const resetStyles = {
    ...baseStyles,
    qrName: { ...baseStyles.qrName, color: autoColors.qrName },
    qrCaption: { ...baseStyles.qrCaption, color: autoColors.qrCaption },
  };

  // Only texts that will actually print can be edited.
  const activeTexts = [
    includeGreeting && "greeting",
    showCaption && "qrName",
    showCaption && captionText.trim() && "qrCaption",
    includeSignature && signatureName.trim() && "footerName",
    includeSignature && signatureTitle.trim() && "footerTitle",
  ].filter(Boolean);
  const editingText = activeTexts.includes(selectedText) ? selectedText : activeTexts[0];

  function updateTextStyle(key, patch) {
    setTextStyles((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    if (isScaledText(key) && "color" in patch) setColorsAuto(patch.color === autoColors[key]);
  }
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
        includeGreeting,
        greetingPos: includeGreeting ? greetingPos : null,
        padding,
        qrCaption: showCaption ? { text: captionText.trim() } : null,
        textStyles,
      });
      downloadBlob(blob, `${campaignName.trim().replace(/[^a-z0-9]+/gi, "_")}-qr-codes.zip`);
      toast.success("Done — QR codes downloaded as a zip.", { id: toastId });
      setCampaignName("");
      setLinks([emptyLink()]);
      setGraphicFile(null);
      setBoxes([]);
      setSignatureName(DEFAULT_SIGNATURE_NAME);
      setSignatureTitle(DEFAULT_SIGNATURE_TITLE);
      setIncludeGreeting(true);
      setIncludeSignature(true);
      setPadding(false);
      setShowCaption(false);
      setCaptionText(DEFAULT_QR_CAPTION);
      setTextStyles(defaultTextStyles());
      setSelectedText("greeting");
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
        footer are optional, and pages are borderless unless you tick the white-margin option. The
        page preview shows exactly how each page will print: place the QR boxes on it, and click any
        text to change its font, weight, size and colour.
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
            <div className="page-options">
              <strong>What goes on each page</strong>
              <label className="field-label" style={{ flexDirection: "row", alignItems: "center", gap: "8px", fontWeight: "normal", marginTop: "8px" }}>
                <input
                  type="checkbox"
                  checked={includeGreeting}
                  onChange={(e) => setIncludeGreeting(e.target.checked)}
                  style={{ width: "auto", margin: 0 }}
                />
                Personalized greeting ("Dear [Name] ji,")
              </label>
              <label className="field-label" style={{ flexDirection: "row", alignItems: "center", gap: "8px", fontWeight: "normal", marginTop: "8px" }}>
                <input
                  type="checkbox"
                  checked={showCaption}
                  onChange={(e) => setShowCaption(e.target.checked)}
                  style={{ width: "auto", margin: 0 }}
                />
                Name &amp; caption under the QR ("[Name] ji" / "Scan to experience VPV")
              </label>
              {showCaption && (
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
              )}
              <label className="field-label" style={{ flexDirection: "row", alignItems: "center", gap: "8px", fontWeight: "normal", marginTop: "8px" }}>
                <input
                  type="checkbox"
                  checked={includeSignature}
                  onChange={(e) => setIncludeSignature(e.target.checked)}
                  style={{ width: "auto", margin: 0 }}
                />
                Signature footer (name &amp; title)
              </label>
              {includeSignature && (
                <div className="signature-fields">
                  <label className="field-label">
                    Signature name
                    <input
                      type="text"
                      value={signatureName}
                      onChange={(e) => setSignatureName(e.target.value)}
                      placeholder={DEFAULT_SIGNATURE_NAME}
                    />
                  </label>
                  <label className="field-label">
                    Signature title
                    <input
                      type="text"
                      value={signatureTitle}
                      onChange={(e) => setSignatureTitle(e.target.value)}
                      placeholder={DEFAULT_SIGNATURE_TITLE}
                    />
                  </label>
                </div>
              )}
              <label className="field-label" style={{ flexDirection: "row", alignItems: "center", gap: "8px", fontWeight: "normal", marginTop: "8px" }}>
                <input
                  type="checkbox"
                  checked={padding}
                  onChange={(e) => setPadding(e.target.checked)}
                  style={{ width: "auto", margin: 0 }}
                />
                White margin around the graphic (off = graphic fills the page edge to edge)
              </label>
            </div>

            <LetterGraphicCalibrator
              graphicFile={graphicFile}
              links={links}
              boxes={boxes}
              onBoxesChange={setBoxes}
              includeGreeting={includeGreeting}
              greetingPos={greetingPos}
              onGreetingPosChange={setGreetingPos}
              padding={padding}
              signatureName={includeSignature ? signatureName.trim() : ""}
              signatureTitle={includeSignature ? signatureTitle.trim() : ""}
              qrCaption={showCaption ? { text: captionText } : null}
              textStyles={textStyles}
              selectedText={editingText}
              onSelectText={setSelectedText}
              previewName={PREVIEW_NAME}
              onColorSampler={(sampler) => setColorSampler(() => sampler)}
            >
              <TextStyleEditor
                activeKeys={activeTexts}
                selected={editingText}
                onSelect={setSelectedText}
                styles={textStyles}
                defaults={resetStyles}
                onChange={updateTextStyle}
                colorsAuto={colorsAuto}
                onMatchColors={() => setColorsAuto(true)}
              />
            </LetterGraphicCalibrator>
          </>
        )}

        <button type="submit" disabled={busy}>
          {busy ? "Working…" : "Create Campaign & Generate QR Codes"}
        </button>
      </form>
    </section>
  );
}
