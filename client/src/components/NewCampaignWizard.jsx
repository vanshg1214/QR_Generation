import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { api, downloadBlob } from "../api.js";
import { goBack, goBackTo, historyIndex, navigate } from "../router.jsx";
import { letterSummary, zipFileName } from "../lib/downloads.js";
import LetterGraphicCalibrator from "./LetterGraphicCalibrator.jsx";
import TextStyleEditor from "./TextStyleEditor.jsx";
import { SkippedRows } from "./CampaignDetail.jsx";
import { DEFAULT_QR_CAPTION, MAX_CAPTION_LINES } from "../../../server/src/qrCaptionLayout.js";
import { defaultTextStyles, isScaledText } from "../../../server/src/textStyles.js";

const MAX_LINKS = 10;
const DEFAULT_SIGNATURE_NAME = "Nitin Gupta";
const DEFAULT_SIGNATURE_TITLE = "Export Marketing Strategist";
const SAMPLE_NAME = "Rajesh Kumar";
const DEFAULT_TEXT_COLOR = "#1a1a1a";

const STEPS = [
  { key: "details", label: "Details" },
  { key: "people", label: "People" },
  { key: "design", label: "Letter design" },
  { key: "review", label: "Review & generate" },
];

// Links are pre-named L-1, L-2, ... so every link (and every QR box) has a usable label
// from the start; the user can rename them.
function emptyLink(number = 1) {
  return { uid: crypto.randomUUID(), label: `L-${number}`, destinationUrl: "" };
}

const isUrl = (v) => /^https?:\/\/\S+\.\S+/i.test(v.trim());

function Checkbox({ checked, onChange, children }) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

// What the Excel file contains, before anything is generated: the numbers must add up
// (rows = people + skipped), and every person gets exactly one letter.
function SheetReport({ sheet }) {
  const [filter, setFilter] = useState("");
  const term = filter.trim().toLowerCase();
  const people = term ? sheet.people.filter((p) => p.name.toLowerCase().includes(term) || String(p.row) === term) : sheet.people;
  return (
    <div className="sheet-report">
      <div className="sheet-equation">
        <div>
          <strong>{sheet.dataRows}</strong>
          <span>rows with data</span>
        </div>
        <span className="sheet-equation-op">=</span>
        <div className="is-good">
          <strong>{sheet.peopleCount}</strong>
          <span>people → {sheet.peopleCount} letters</span>
        </div>
        <span className="sheet-equation-op">+</span>
        <div className={sheet.skipped.length ? "is-warn" : ""}>
          <strong>{sheet.skipped.length}</strong>
          <span>rows skipped</span>
        </div>
      </div>
      <p className="muted small">
        Sheet "{sheet.sheetName}": headings found on Excel row {sheet.headerRow}, names read from the "{sheet.nameColumn}"
        column. Completely empty rows are ignored. Titles like Mr, Mrs and Dr are removed from names.
      </p>

      {sheet.skipped.length > 0 && <SkippedRows skipped={sheet.skipped} />}

      {sheet.repeated.length > 0 && (
        <details className="sheet-details">
          <summary>
            {sheet.repeated.length} {sheet.repeated.length === 1 ? "name appears" : "names appear"} more than once. Each
            row still gets its own letter and QR code. Check they aren't the same person entered twice.
          </summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Times</th>
                  <th>Excel rows</th>
                </tr>
              </thead>
              <tbody>
                {sheet.repeated.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td>{r.rows.length}</td>
                    <td>{r.rows.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <details className="sheet-details">
        <summary>See all {sheet.peopleCount} people, in letter order</summary>
        <input type="search" placeholder="Search a name or row number…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="table-scroll people-preview-list">
          <table>
            <thead>
              <tr>
                <th>Letter</th>
                <th>Excel row</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.row}>
                  <td>{sheet.people.indexOf(p) + 1}</td>
                  <td>{p.row}</td>
                  <td>{p.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export default function NewCampaignWizard({ step, active, onFinished, onDiscard }) {
  const [campaignName, setCampaignName] = useState("");
  const [links, setLinks] = useState([emptyLink()]);

  const [excelFile, setExcelFile] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [sheetError, setSheetError] = useState("");
  const [checkingSheet, setCheckingSheet] = useState(false);

  const [graphicFile, setGraphicFile] = useState(null);
  const [boxes, setBoxes] = useState([]);
  const [signatureName, setSignatureName] = useState(DEFAULT_SIGNATURE_NAME);
  const [signatureTitle, setSignatureTitle] = useState(DEFAULT_SIGNATURE_TITLE);
  const [includeGreeting, setIncludeGreeting] = useState(true);
  const [includeSignature, setIncludeSignature] = useState(true);
  const [padding, setPadding] = useState(false);
  const [showCaption, setShowCaption] = useState(false);
  const [captionText, setCaptionText] = useState(DEFAULT_QR_CAPTION);
  const [greetingPos, setGreetingPos] = useState(null); // null = above graphic; {x,y} = inside graphic
  // Font, weight, size and colour of every text on the page (see server/src/textStyles.js).
  const [textStyles, setTextStyles] = useState(() => defaultTextStyles());
  const [selectedText, setSelectedText] = useState("greeting");
  // Colours for the text under the QR, matched to the graphic around the first QR box.
  const [autoColors, setAutoColors] = useState({ qrName: DEFAULT_TEXT_COLOR, qrCaption: DEFAULT_TEXT_COLOR });
  const [colorsAuto, setColorsAuto] = useState(true); // false once the user picks their own
  const [colorSampler, setColorSampler] = useState(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // ---- Steps & navigation ------------------------------------------------------------
  const detailsOk = campaignName.trim() && links.every((l) => l.label.trim() && isUrl(l.destinationUrl));
  const peopleOk = Boolean(sheet && sheet.peopleCount > 0);
  const designOk = !graphicFile || boxes.length > 0;
  const stepOk = { details: detailsOk, people: peopleOk, design: designOk, review: true };
  const firstIncomplete = STEPS.find((s) => !stepOk[s.key])?.key ?? "review";
  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const [lastStep, setLastStep] = useState("details");

  // Where this flow started in the browser history, so finishing it can leave the steps
  // out of Back history (Back from the new campaign then goes to where you came from).
  const startIdx = useRef(historyIndex());
  const wasActive = useRef(false);
  useEffect(() => {
    if (active && !wasActive.current) startIdx.current = historyIndex();
    wasActive.current = active;
  }, [active]);

  useEffect(() => {
    if (!active || busy) return;
    if (stepIndex === -1) {
      navigate(`/new/${lastStep}`, { replace: true });
      return;
    }
    // A later step can't be opened (e.g. by address) before the earlier ones are done.
    const blocker = STEPS.slice(0, stepIndex).find((s) => !stepOk[s.key]);
    if (blocker) navigate(`/new/${blocker.key}`, { replace: true });
    else setLastStep(step);
  });

  const goStep = (key) => navigate(`/new/${key}`);

  // Warn before closing or reloading the tab with an unfinished campaign.
  const dirty = Boolean(campaignName || excelFile || graphicFile);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ---- Excel -------------------------------------------------------------------------
  async function chooseExcel(file) {
    setExcelFile(file);
    setSheet(null);
    setSheetError("");
    setPreviewIndex(0);
    if (!file) return;
    setCheckingSheet(true);
    try {
      setSheet(await api.checkSheet(file));
    } catch (err) {
      setSheetError(err.message);
    } finally {
      setCheckingSheet(false);
    }
  }

  // ---- Letter design -----------------------------------------------------------------
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

  const previewPeople = sheet?.people || [];
  const previewName = previewPeople[previewIndex]?.name || SAMPLE_NAME;

  // ---- Links -------------------------------------------------------------------------
  function updateLink(index, field, value) {
    setLinks((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }
  const addLink = () => setLinks((prev) => (prev.length >= MAX_LINKS ? prev : [...prev, emptyLink(prev.length + 1)]));
  const removeLink = (index) => setLinks((prev) => prev.filter((_, i) => i !== index));

  // ---- Generate ----------------------------------------------------------------------
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setElapsed(0);
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  async function generate() {
    // Each box's link is sent as its position in the list; the server has no link ids yet.
    // A box is never left without a link: one with no (or a removed) link uses the first.
    const resolvedBoxes = boxes.map(({ linkUid, x, y, width, height }) => ({
      linkIndex: Math.max(0, links.findIndex((l) => l.uid === linkUid)),
      x,
      y,
      width,
      height,
    }));
    setBusy(true);
    try {
      const result = await api.createCampaign({
        campaignName: campaignName.trim(),
        links: links.map(({ label, destinationUrl }) => ({ label: label.trim(), destinationUrl: destinationUrl.trim() })),
        file: excelFile,
        graphic: graphicFile,
        boxes: resolvedBoxes,
        // No signature = no footer; the server only draws one when a name/title is given.
        signatureName: includeSignature ? signatureName.trim() : "",
        signatureTitle: includeSignature ? signatureTitle.trim() : "",
        includeGreeting,
        greetingPos: includeGreeting ? greetingPos : null,
        padding,
        qrCaption: showCaption ? { text: captionText } : null,
        textStyles,
      });
      downloadBlob(result.blob, zipFileName(campaignName));
      const expectedPages = graphicFile ? sheet.peopleCount : 0;
      if (result.peopleCount !== sheet.peopleCount || result.letterPages !== expectedPages) {
        toast.error(
          `Counts don't match the Excel check (${sheet.peopleCount} people expected, got ${letterSummary(result)}). Please check the zip.`,
          { duration: 12000 }
        );
      } else {
        toast.success(`Campaign created and downloaded: ${letterSummary(result)}. Matches your Excel.`, { duration: 8000 });
      }
      // Replace the steps in Back history with the new campaign's page.
      await goBackTo(startIdx.current);
      navigate(result.campaignId ? `/campaigns/${result.campaignId}` : "/", { replace: true });
      onFinished();
    } catch (err) {
      toast.error(err.message, { duration: 10000 });
      setBusy(false);
    }
  }

  // ---- Render ------------------------------------------------------------------------
  // Every step stays rendered (hidden when not shown), so going back and forth between
  // steps never loses anything, e.g. the QR boxes placed on the graphic.
  const shown = active ? step : null;

  const navFor = (key) => {
    const i = STEPS.findIndex((s) => s.key === key);
    return (
      <div className="wizard-nav">
        {i > 0 ? (
          <button type="button" className="secondary" onClick={() => goBack(`/new/${STEPS[i - 1].key}`)}>
            ← Back
          </button>
        ) : (
          <button type="button" className="secondary" onClick={() => window.confirm("Discard this campaign?") && onDiscard()}>
            Cancel
          </button>
        )}
        <button type="button" disabled={!stepOk[key]} onClick={() => goStep(STEPS[i + 1].key)}>
          Next: {STEPS[i + 1].label} →
        </button>
      </div>
    );
  };

  return (
    <div className="wizard">
      <div className="page-header">
        <div>
          <span className="eyebrow">New campaign</span>
          <h1 className="page-title">{campaignName.trim() || "Untitled campaign"}</h1>
        </div>
      </div>

      <ol className="wizard-steps" hidden={!shown}>
        {STEPS.map((s, i) => {
          const reachable = STEPS.slice(0, i).every((p) => stepOk[p.key]);
          return (
            <li key={s.key} className={`${s.key === step ? "is-current" : ""}${i < stepIndex ? " is-done" : ""}`}>
              <button type="button" disabled={!reachable || s.key === step || busy} onClick={() => goStep(s.key)}>
                <span className="wizard-step-num">{i < stepIndex ? "✓" : i + 1}</span>
                <span className="wizard-step-label">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {(
        <section className="card" hidden={shown !== "details"}>
          <h2>Campaign details</h2>
          <p className="muted">Give the campaign a title and add the links people's QR codes open. Each link gets its own QR code per person.</p>
          <div className="form-grid">
            <label className="field-label">
              Campaign title
              <input type="text" placeholder="e.g. Product Launch 2026" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} autoFocus />
            </label>
            <div className="field-label">
              Links
              <div className="links-editor">
                {links.map((link, i) => (
                  <div className="link-row" key={link.uid}>
                    <input type="text" placeholder={`Link ${i + 1} name (e.g. Demo)`} value={link.label} onChange={(e) => updateLink(i, "label", e.target.value)} aria-label={`Link ${i + 1} name`} />
                    <input
                      type="url"
                      placeholder="https://your-content-link.com"
                      value={link.destinationUrl}
                      onChange={(e) => updateLink(i, "destinationUrl", e.target.value)}
                      aria-label={`Link ${i + 1} address`}
                      aria-invalid={link.destinationUrl.trim() !== "" && !isUrl(link.destinationUrl)}
                    />
                    {links.length > 1 && (
                      <button type="button" className="secondary remove-link-btn" onClick={() => removeLink(i)}>
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                {links.length < MAX_LINKS && (
                  <button type="button" className="secondary" onClick={addLink}>
                    + Add another link
                  </button>
                )}
              </div>
            </div>
          </div>
          {!detailsOk && (campaignName || links.some((l) => l.destinationUrl)) && (
            <p className="muted small">Every link needs a name and a full address starting with https://</p>
          )}
          {navFor("details")}
        </section>
      )}

      {(
        <section className="card" hidden={shown !== "people"}>
          <h2>People list</h2>
          <p className="muted">
            Upload the Excel file. The name column is found automatically (e.g. "Name" or "Contact Name"), even with a title
            row above the headings. You'll see exactly how many letters will be made before anything is generated.
          </p>
          <label className={`file-drop${excelFile ? " has-file" : ""}`}>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => chooseExcel(e.target.files?.[0] || null)} />
            <strong>{excelFile ? excelFile.name : "Choose Excel file"}</strong>
            <span className="muted small">{excelFile ? "Click to choose a different file" : ".xlsx, .xls or .csv"}</span>
          </label>
          {checkingSheet && <p className="muted">Checking every row…</p>}
          {sheetError && <p className="error-text">{sheetError}</p>}
          {sheet && sheet.peopleCount === 0 && (
            <p className="error-text">No names were found in this file. Check the sheet has a name column with names in it.</p>
          )}
          {sheet && sheet.peopleCount > 0 && <SheetReport sheet={sheet} />}
          {navFor("people")}
        </section>
      )}

      {(
        <section className="card" hidden={shown !== "design"}>
          <h2>Letter design</h2>
          <p className="muted">
            Upload the letter graphic to get one printable "All Letters.pdf" with a page per person. Skip it to get QR
            images only.
          </p>
          <label className={`file-drop${graphicFile ? " has-file" : ""}`}>
            <input type="file" accept="image/png,image/jpeg" onChange={(e) => setGraphicFile(e.target.files?.[0] || null)} />
            <strong>{graphicFile ? graphicFile.name : "Choose letter graphic"}</strong>
            <span className="muted small">{graphicFile ? "Click to choose a different image" : "PNG or JPEG, optional"}</span>
          </label>
          {graphicFile && (
            <button type="button" className="secondary small-button" onClick={() => setGraphicFile(null)}>
              Remove graphic (QR images only)
            </button>
          )}

          {graphicFile && (
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
              previewName={previewName}
              previewPeople={previewPeople}
              previewIndex={previewIndex}
              onPreviewIndexChange={setPreviewIndex}
              onColorSampler={(sampler) => setColorSampler(() => sampler)}
            >
              <section className="design-section">
                <h3>What goes on each page</h3>
                <Checkbox checked={includeGreeting} onChange={setIncludeGreeting}>
                  Greeting ("Dear [Name] ji,")
                </Checkbox>
                <Checkbox checked={showCaption} onChange={setShowCaption}>
                  Name &amp; caption under the QR
                </Checkbox>
                {showCaption && (
                  <label className="field-label nested">
                    Caption (Enter starts a new line, up to {MAX_CAPTION_LINES} lines)
                    <textarea
                      className="caption-input"
                      rows={Math.min(MAX_CAPTION_LINES, Math.max(2, captionText.split("\n").length))}
                      value={captionText}
                      maxLength={80}
                      onChange={(e) => setCaptionText(e.target.value.split("\n").slice(0, MAX_CAPTION_LINES).join("\n"))}
                      placeholder={"Scan\nto experience VPV"}
                    />
                  </label>
                )}
                <Checkbox checked={includeSignature} onChange={setIncludeSignature}>
                  Signature footer
                </Checkbox>
                {includeSignature && (
                  <div className="signature-fields nested">
                    <label className="field-label">
                      Name
                      <input type="text" value={signatureName} onChange={(e) => setSignatureName(e.target.value)} placeholder={DEFAULT_SIGNATURE_NAME} />
                    </label>
                    <label className="field-label">
                      Title
                      <input type="text" value={signatureTitle} onChange={(e) => setSignatureTitle(e.target.value)} placeholder={DEFAULT_SIGNATURE_TITLE} />
                    </label>
                  </div>
                )}
                <Checkbox checked={padding} onChange={setPadding}>
                  White margin around the graphic
                </Checkbox>
              </section>
              <TextStyleEditor
                activeKeys={activeTexts}
                selected={editingText}
                onSelect={setSelectedText}
                styles={textStyles}
                defaults={resetStyles}
                onChange={updateTextStyle}
                colorsAuto={colorsAuto}
                onMatchColors={() => setColorsAuto(true)}
                graphicColors={[autoColors.qrName, autoColors.qrCaption]}
              />
            </LetterGraphicCalibrator>
          )}
          {graphicFile && !boxes.length && (
            <p className="error-text">Add at least one QR box to the page. Without one, the letters would have no QR code.</p>
          )}
          {navFor("design")}
        </section>
      )}

      {sheet && excelFile && (
        <section className="card" hidden={shown !== "review"}>
          <h2>Review &amp; generate</h2>
          <dl className="review-list">
            <div>
              <dt>Campaign</dt>
              <dd>{campaignName.trim()}</dd>
              <button type="button" className="link-button" onClick={() => goStep("details")} disabled={busy}>
                Edit
              </button>
            </div>
            <div>
              <dt>Links</dt>
              <dd>
                {links.map((l) => (
                  <div key={l.uid}>
                    <strong>{l.label.trim()}</strong> → <span className="break">{l.destinationUrl.trim()}</span>
                  </div>
                ))}
              </dd>
              <button type="button" className="link-button" onClick={() => goStep("details")} disabled={busy}>
                Edit
              </button>
            </div>
            <div>
              <dt>People</dt>
              <dd>
                <strong>{sheet.peopleCount} people</strong> from "{excelFile.name}" ({sheet.dataRows} rows with data
                {sheet.skipped.length ? `, ${sheet.skipped.length} skipped for having no name` : ", none skipped"})
                {sheet.repeated.length > 0 && (
                  <div className="muted small">
                    {sheet.repeated.length === 1 ? "1 name appears" : `${sheet.repeated.length} names appear`} more than
                    once; each row gets its own letter.
                  </div>
                )}
              </dd>
              <button type="button" className="link-button" onClick={() => goStep("people")} disabled={busy}>
                Edit
              </button>
            </div>
            {graphicFile && (
              <div>
                <dt>Each letter has</dt>
                <dd>
                  {[
                    includeGreeting && `Greeting "Dear [Name] ji,"${greetingPos ? " on the graphic" : " above the graphic"}`,
                    `${boxes.length} QR ${boxes.length === 1 ? "code" : "codes"}`,
                    showCaption && `name & caption under the QR ("${captionText.split("\n").filter((l) => l.trim()).join(" / ")}")`,
                    includeSignature && (signatureName.trim() || signatureTitle.trim()) && "signature footer",
                    padding ? "white margin" : "no margin (edge to edge)",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </dd>
                <button type="button" className="link-button" onClick={() => goStep("design")} disabled={busy}>
                  Edit
                </button>
              </div>
            )}
            <div>
              <dt>The zip will contain</dt>
              <dd>
                {graphicFile && (
                  <div>
                    <strong>All Letters.pdf</strong>: {sheet.peopleCount} pages, one per person, in Excel order
                  </div>
                )}
                <div>
                  <strong>{sheet.peopleCount} folders</strong>, one per person, each with {links.length} QR{" "}
                  {links.length === 1 ? "image" : "images"} ({sheet.peopleCount * links.length} in total)
                </div>
              </dd>
              <button type="button" className="link-button" onClick={() => goStep("design")} disabled={busy}>
                Edit
              </button>
            </div>
          </dl>

          {busy ? (
            <div className="progress-panel" role="status">
              <span className="spinner" aria-hidden="true" />
              <div>
                <strong>Generating {sheet.peopleCount} letters… {elapsed}s</strong>
                <p className="muted small">
                  Large lists can take a minute or two. Keep this tab open; the zip downloads by itself when it's ready.
                </p>
              </div>
            </div>
          ) : (
            <div className="wizard-nav">
              <button type="button" className="secondary" onClick={() => goBack("/new/design")}>
                ← Back
              </button>
              <button type="button" className="primary-large" onClick={generate}>
                Create campaign &amp; download zip
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
