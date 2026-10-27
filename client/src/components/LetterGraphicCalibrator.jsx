import { useEffect, useRef, useState } from "react";
import { detectBlankBoxes } from "../lib/detectBlankBoxes.js";
import { createColorSampler } from "../lib/graphicColors.js";
import { layoutLetterPage } from "../../../server/src/letterLayout.js";
import { LINE_HEIGHT, WEIGHTS, supportedWeight } from "../../../server/src/textStyles.js";

const MIN_BOX_SIZE = 0.02;
const DEFAULT_GREETING_X = 0.03; // fraction of graphic width
const DEFAULT_GREETING_Y = 0.03; // fraction of graphic height

// Browser fonts that match the PDF's: Poppins is the same font (Google Fonts); Arial,
// Times New Roman and Courier New have the same widths as the PDF's built-in fonts.
const CSS_FONT = {
  poppins: '"Poppins", sans-serif',
  helvetica: 'Helvetica, Arial, sans-serif',
  times: '"Times New Roman", Times, serif',
  courier: '"Courier New", Courier, monospace',
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function candidateToBox(c, linkUid) {
  return { boxId: crypto.randomUUID(), x: c.x, y: c.y, width: c.width, height: c.height, linkUid };
}

function detectFromImage(imageUrl, onDone) {
  const img = new Image();
  img.onload = () => onDone(detectBlankBoxes(img), img);
  img.src = imageUrl;
}

// Measures text with the browser's matching font, for the shared page layout. Measured
// at 100px and scaled, which is more precise than measuring tiny sizes directly.
let measureCtx = null;
function measureText(text, font, weight, size) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  measureCtx.font = `${WEIGHTS[supportedWeight(font, weight)]} 100px ${CSS_FONT[font]}`;
  return (measureCtx.measureText(text).width * size) / 100;
}

// Live preview of one printed letter page -- page size, graphic, QR codes and every line
// of text come from the same layout the PDF uses, so what you see is what prints. Also
// where the user places QR boxes (auto-detected, then drag/resize/add/delete, each
// assigned to a link), drags the greeting, and clicks a text to style it.
export default function LetterGraphicCalibrator({
  graphicFile,
  links,
  boxes,
  onBoxesChange,
  includeGreeting,
  greetingPos, // { x, y } fractions of graphic, or null = above graphic
  onGreetingPosChange,
  padding,
  signatureName,
  signatureTitle,
  qrCaption, // null, or { text } -- name + caption under each QR
  textStyles,
  selectedText,
  onSelectText,
  previewName,
  previewPeople, // [{ row, name }] from the Excel, to flip through the real letters
  previewIndex,
  onPreviewIndexChange,
  onColorSampler, // receives a function box -> suggested { nameColor, captionColor }
  children, // page contents + text style controls, shown in the side panel
}) {
  const [imageUrl, setImageUrl] = useState(null);
  const [imageSize, setImageSize] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const graphicRef = useRef(null);
  const dragState = useRef(null);
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    // Poppins comes from Google Fonts; lay the preview out again once it has loaded.
    if (!document.fonts) return setFontsReady(true);
    Promise.all(Object.values(WEIGHTS).map((w) => document.fonts.load(`${w} 20px Poppins`)))
      .catch(() => {})
      .finally(() => setFontsReady(true));
  }, []);

  useEffect(() => {
    if (!graphicFile) {
      setImageUrl(null);
      setImageSize(null);
      onBoxesChange([]);
      return;
    }
    const url = URL.createObjectURL(graphicFile);
    setImageUrl(url);
    setDetecting(true);
    detectFromImage(url, (detected, img) => {
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
      onBoxesChange(detected.map((c) => candidateToBox(c, links[0]?.uid ?? null)));
      onColorSampler?.(createColorSampler(img));
      setDetecting(false);
    });
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphicFile]);

  function updateBox(boxId, patch) {
    onBoxesChange(boxes.map((b) => (b.boxId === boxId ? { ...b, ...patch } : b)));
  }

  function removeBox(boxId) {
    onBoxesChange(boxes.filter((b) => b.boxId !== boxId));
  }

  function addBox() {
    onBoxesChange([...boxes, { boxId: crypto.randomUUID(), x: 0.4, y: 0.4, width: 0.15, height: 0.15, linkUid: links[0]?.uid ?? null }]);
  }

  function redetect() {
    if (!imageUrl) return;
    if (boxes.length && !window.confirm("Re-detecting replaces your current boxes and link assignments. Continue?")) {
      return;
    }
    setDetecting(true);
    detectFromImage(imageUrl, (detected) => {
      onBoxesChange(detected.map((c) => candidateToBox(c, links[0]?.uid ?? null)));
      setDetecting(false);
    });
  }

  // Drags are measured against the graphic, since boxes and the greeting are stored as
  // fractions of it.
  function dragHandlers(boxId, mode) {
    return {
      onPointerDown: (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const box = boxes.find((b) => b.boxId === boxId);
        dragState.current = { type: "box", boxId, mode, startClientX: e.clientX, startClientY: e.clientY, startBox: { ...box } };
      },
      onPointerMove: (e) => {
        const state = dragState.current;
        if (!state || state.type !== "box" || state.boxId !== boxId || state.mode !== mode || !graphicRef.current) return;
        const rect = graphicRef.current.getBoundingClientRect();
        const dxFrac = (e.clientX - state.startClientX) / rect.width;
        const dyFrac = (e.clientY - state.startClientY) / rect.height;
        if (mode === "move") {
          updateBox(boxId, {
            x: clamp(state.startBox.x + dxFrac, 0, 1 - state.startBox.width),
            y: clamp(state.startBox.y + dyFrac, 0, 1 - state.startBox.height),
          });
        } else {
          updateBox(boxId, {
            width: clamp(state.startBox.width + dxFrac, MIN_BOX_SIZE, 1 - state.startBox.x),
            height: clamp(state.startBox.height + dyFrac, MIN_BOX_SIZE, 1 - state.startBox.y),
          });
        }
      },
      onPointerUp: (e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        dragState.current = null;
      },
    };
  }

  function greetingDragHandlers() {
    return {
      onPointerDown: (e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelectText?.("greeting");
        e.currentTarget.setPointerCapture(e.pointerId);
        const cur = greetingPos || { x: DEFAULT_GREETING_X, y: DEFAULT_GREETING_Y };
        dragState.current = { type: "greeting", startClientX: e.clientX, startClientY: e.clientY, startPos: { ...cur } };
      },
      onPointerMove: (e) => {
        const state = dragState.current;
        if (!state || state.type !== "greeting" || !graphicRef.current) return;
        const rect = graphicRef.current.getBoundingClientRect();
        const dxFrac = (e.clientX - state.startClientX) / rect.width;
        const dyFrac = (e.clientY - state.startClientY) / rect.height;
        onGreetingPosChange({
          x: clamp(state.startPos.x + dxFrac, 0, 0.95),
          y: clamp(state.startPos.y + dyFrac, 0, 0.95),
        });
      },
      onPointerUp: (e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        dragState.current = null;
      },
    };
  }

  if (!graphicFile) return null;

  const layout =
    imageSize && fontsReady
      ? layoutLetterPage({
          imageWidth: imageSize.width,
          imageHeight: imageSize.height,
          personName: previewName,
          padding,
          includeGreeting,
          greetingPos,
          signatureName,
          signatureTitle,
          qrBoxes: boxes,
          qrCaption,
          styles: textStyles,
          measure: measureText,
        })
      : null;
  // Everything is placed in percentages of the page (or of its QR box), and font sizes
  // in "cqw" -- percent of the page's width -- so the preview is an exact scaled copy of
  // the PDF page at whatever size it's shown, with nothing to measure.
  const pct = (v, total) => `${(v / total) * 100}%`;
  const cqw = (points) => `${(points / layout.pageWidth) * 100}cqw`;

  // One printed text line, positioned by the same "top of line" as the PDF; the browser
  // puts the baseline where the PDF does for these fonts. frame = the QR box it sits in.
  function textStyle(t, frame = { x: 0, y: 0, width: layout.pageWidth, height: layout.pageHeight }) {
    return {
      left: pct(t.x - frame.x, frame.width),
      top: pct(t.top - frame.y, frame.height),
      fontFamily: CSS_FONT[t.font],
      fontWeight: WEIGHTS[t.weight],
      fontSize: cqw(t.size),
      lineHeight: LINE_HEIGHT,
      color: t.color,
    };
  }
  const textClass = (t, extra = "") =>
    `page-text${selectedText === t.key ? " is-selected" : ""}${extra ? ` ${extra}` : ""}`;

  const peopleCount = previewPeople?.length || 0;
  const flip = (delta) => onPreviewIndexChange?.((previewIndex + delta + peopleCount) % peopleCount);
  const longestIndex = peopleCount
    ? previewPeople.reduce((best, p, i) => (p.name.length > previewPeople[best].name.length ? i : best), 0)
    : -1;

  return (
    <div className="design-studio">
      <aside className="design-panel">
        {children}

        <section className="design-section">
          <h3>QR codes</h3>
          <p className="muted small">
            {detecting
              ? "Scanning the graphic for blank areas…"
              : boxes.length
              ? `${boxes.length} QR ${boxes.length === 1 ? "box" : "boxes"} on the page. Drag a box to move it, drag its corner dot to resize, and pick which link it opens.`
              : 'No blank area was found automatically. Use "Add QR box" to place one.'}
          </p>
          <div className="button-row">
            <button type="button" className="secondary small-button" onClick={addBox}>
              + Add QR box
            </button>
            <button type="button" className="secondary small-button" onClick={redetect} disabled={detecting}>
              Find blank areas again
            </button>
          </div>
        </section>

        {includeGreeting && (
          <section className="design-section">
            <h3>Greeting position</h3>
            <div className="greeting-pos-row">
              <label>
                <input type="radio" name="greetingPos" checked={greetingPos === null} onChange={() => onGreetingPosChange(null)} />
                Above the graphic
              </label>
              <label>
                <input
                  type="radio"
                  name="greetingPos"
                  checked={greetingPos !== null}
                  onChange={() => onGreetingPosChange({ x: DEFAULT_GREETING_X, y: DEFAULT_GREETING_Y })}
                />
                On the graphic (drag it on the page)
              </label>
            </div>
          </section>
        )}
      </aside>

      <div className="design-preview">
        <div className="design-preview-bar">
          <strong className="design-preview-title">Live page preview</strong>
          {peopleCount > 0 ? (
            <div className="preview-person">
              <button type="button" className="secondary icon-button" onClick={() => flip(-1)} aria-label="Previous letter">
                ‹
              </button>
              <select value={previewIndex} onChange={(e) => onPreviewIndexChange(Number(e.target.value))} aria-label="Preview the letter for">
                {previewPeople.map((p, i) => (
                  <option key={p.row} value={i}>
                    {i + 1}. {p.name}
                  </option>
                ))}
              </select>
              <button type="button" className="secondary icon-button" onClick={() => flip(1)} aria-label="Next letter">
                ›
              </button>
              {longestIndex >= 0 && longestIndex !== previewIndex && (
                <button
                  type="button"
                  className="secondary small-button"
                  onClick={() => onPreviewIndexChange(longestIndex)}
                  title="Check the longest name still fits"
                >
                  Longest name
                </button>
              )}
            </div>
          ) : null}
        </div>
        {layout ? (
          <div className="letter-page-frame" style={{ "--page-ratio": layout.pageWidth / layout.pageHeight }}>
            <div className="letter-page" style={{ aspectRatio: `${layout.pageWidth} / ${layout.pageHeight}` }}>
            <div
              className="qr-calibrator-canvas"
              ref={graphicRef}
              style={{
                left: pct(layout.graphic.x, layout.pageWidth),
                top: pct(layout.graphic.y, layout.pageHeight),
                width: pct(layout.graphic.width, layout.pageWidth),
                height: pct(layout.graphic.height, layout.pageHeight),
              }}
            >
              {imageUrl && <img src={imageUrl} alt="Letter graphic" draggable={false} />}

              {boxes.map((box, i) => {
                const qr = layout.qrs[i];
                const frame = {
                  x: layout.graphic.x + box.x * layout.graphic.width,
                  y: layout.graphic.y + box.y * layout.graphic.height,
                  width: box.width * layout.graphic.width,
                  height: box.height * layout.graphic.height,
                };
                return (
                  <div
                    key={box.boxId}
                    className="qr-box"
                    style={{
                      left: `${box.x * 100}%`,
                      top: `${box.y * 100}%`,
                      width: `${box.width * 100}%`,
                      height: `${box.height * 100}%`,
                    }}
                    {...dragHandlers(box.boxId, "move")}
                  >
                    <div
                      className="qr-box-pattern"
                      style={{
                        left: pct(qr.x - frame.x, frame.width),
                        top: pct(qr.y - frame.y, frame.height),
                        width: pct(qr.size, frame.width),
                        height: pct(qr.size, frame.height),
                      }}
                    />
                    {layout.texts
                      .filter((t) => t.boxIndex === i)
                      .map((t, j) => (
                        <div
                          key={j}
                          className={textClass(t)}
                          style={textStyle(t, frame)}
                          // Selects the text; the box drag still starts from here too.
                          onPointerDown={() => onSelectText?.(t.key)}
                        >
                          {t.text}
                        </div>
                      ))}
                    <div className="qr-box-controls" onPointerDown={(e) => e.stopPropagation()}>
                      <select
                        value={links.some((l) => l.uid === box.linkUid) ? box.linkUid : links[0]?.uid}
                        onChange={(e) => updateBox(box.boxId, { linkUid: e.target.value })}
                      >
                        {links.map((link, li) => (
                          <option key={link.uid} value={link.uid}>
                            {link.label.trim() || `Link ${li + 1}`}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="qr-box-remove" onClick={() => removeBox(box.boxId)} aria-label="Remove box">
                        ×
                      </button>
                    </div>
                    <div className="qr-box-handle" {...dragHandlers(box.boxId, "resize")} />
                  </div>
                );
              })}
            </div>

            {layout.texts
              .filter((t) => t.boxIndex === undefined)
              .map((t) =>
                t.key === "greeting" && greetingPos ? (
                  <div
                    key={t.key}
                    className={textClass(t, "is-draggable")}
                    style={textStyle(t)}
                    title="Drag to move the greeting"
                    {...greetingDragHandlers()}
                  >
                    {t.text}
                  </div>
                ) : (
                  <div key={t.key} className={textClass(t)} style={textStyle(t)} onPointerDown={() => onSelectText?.(t.key)}>
                    {t.text}
                  </div>
                )
              )}
          </div>
        </div>
      ) : (
        <p className="muted small">Loading preview…</p>
      )}
        <p className="muted small design-preview-note">
          {peopleCount
            ? `Letter ${previewIndex + 1} of ${peopleCount}, exactly as it will print. Click any text to style it.`
            : `Shown with the sample name "${previewName}". Click any text to style it.`}
        </p>
      </div>
    </div>
  );
}
