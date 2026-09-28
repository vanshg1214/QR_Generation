import { useEffect, useRef, useState } from "react";
import { detectBlankBoxes } from "../lib/detectBlankBoxes.js";

const MIN_BOX_SIZE = 0.02;
const DEFAULT_GREETING_X = 0.03; // fraction of graphic width
const DEFAULT_GREETING_Y = 0.03; // fraction of graphic height

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function candidateToBox(c) {
  return { boxId: crypto.randomUUID(), x: c.x, y: c.y, width: c.width, height: c.height, linkUid: null };
}

function detectFromImage(imageUrl, onDone) {
  const img = new Image();
  img.onload = () => onDone(detectBlankBoxes(img).map(candidateToBox));
  img.src = imageUrl;
}

// Lets the user calibrate where each person's QR code should be stamped onto
// the letter graphic: auto-detects candidate blank boxes, then lets them
// drag/resize/delete/add boxes and assign each one to a campaign link.
// Also lets them drag the "Dear [Name] ji," greeting to any position on the graphic.
export default function LetterGraphicCalibrator({
  graphicFile,
  links,
  boxes,
  onBoxesChange,
  includeGreeting,
  greetingPos,        // { x, y } fractions of graphic, or null = above graphic
  onGreetingPosChange,
}) {
  const [imageUrl, setImageUrl] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef(null);
  const dragState = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainerSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [imageUrl]);

  useEffect(() => {
    if (!graphicFile) {
      setImageUrl(null);
      onBoxesChange([]);
      return;
    }
    const url = URL.createObjectURL(graphicFile);
    setImageUrl(url);
    setDetecting(true);
    detectFromImage(url, (detected) => {
      onBoxesChange(detected);
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
    onBoxesChange([...boxes, { boxId: crypto.randomUUID(), x: 0.4, y: 0.4, width: 0.15, height: 0.15, linkUid: null }]);
  }

  function redetect() {
    if (!imageUrl) return;
    const anyAssigned = boxes.some((b) => b.linkUid);
    if (anyAssigned && !window.confirm("Re-detecting replaces your current boxes and link assignments. Continue?")) {
      return;
    }
    setDetecting(true);
    detectFromImage(imageUrl, (detected) => {
      onBoxesChange(detected);
      setDetecting(false);
    });
  }

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
        if (!state || state.type !== "box" || state.boxId !== boxId || state.mode !== mode || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
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
        e.currentTarget.setPointerCapture(e.pointerId);
        const cur = greetingPos || { x: DEFAULT_GREETING_X, y: DEFAULT_GREETING_Y };
        dragState.current = { type: "greeting", startClientX: e.clientX, startClientY: e.clientY, startPos: { ...cur } };
      },
      onPointerMove: (e) => {
        const state = dragState.current;
        if (!state || state.type !== "greeting" || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
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

  const gPos = greetingPos || { x: DEFAULT_GREETING_X, y: DEFAULT_GREETING_Y };
  const greetingOnGraphic = includeGreeting && greetingPos !== null;

  return (
    <div className="qr-calibrator">
      <div className="qr-calibrator-header">
        <div>
          <strong>Where should each person's QR code appear on the graphic?</strong>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            {detecting
              ? "Scanning the graphic for blank areas…"
              : boxes.length
              ? "Drag to move, use the bottom-right handle to resize, and assign a link to each box."
              : "No blank areas were detected — use \"Add box\" to place one manually."}
          </p>
        </div>
        <div className="qr-calibrator-actions">
          <button type="button" className="secondary" onClick={addBox}>
            + Add box
          </button>
          <button type="button" className="secondary" onClick={redetect} disabled={detecting}>
            Re-detect
          </button>
        </div>
      </div>

      {includeGreeting && (
        <div style={{ marginBottom: "10px", display: "flex", alignItems: "center", gap: "12px", fontSize: "0.85rem" }}>
          <span className="muted">Greeting position:</span>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontWeight: "normal" }}>
            <input
              type="radio"
              name="greetingPos"
              checked={greetingPos === null}
              onChange={() => onGreetingPosChange(null)}
            />
            Above graphic (default)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontWeight: "normal" }}>
            <input
              type="radio"
              name="greetingPos"
              checked={greetingPos !== null}
              onChange={() => onGreetingPosChange({ x: DEFAULT_GREETING_X, y: DEFAULT_GREETING_Y })}
            />
            Inside graphic (draggable)
          </label>
        </div>
      )}

      <div className="qr-calibrator-canvas" ref={containerRef}>
        {imageUrl && <img src={imageUrl} alt="Letter graphic" draggable={false} />}

        {/* Draggable greeting overlay — only when placed inside the graphic */}
        {greetingOnGraphic && (
          <div
            className="greeting-overlay"
            style={{ left: `${gPos.x * 100}%`, top: `${gPos.y * 100}%` }}
            {...greetingDragHandlers()}
            title="Drag to reposition the greeting"
          >
            Dear [Name] ji,
          </div>
        )}

        {boxes.map((box) => {
          const boxPxWidth = box.width * containerSize.width;
          const boxPxHeight = box.height * containerSize.height;
          const qrPx = Math.min(boxPxWidth, boxPxHeight);
          const patternStyle =
            containerSize.width > 0
              ? {
                  left: (boxPxWidth - qrPx) / 2,
                  top: (boxPxHeight - qrPx) / 2,
                  width: qrPx,
                  height: qrPx,
                }
              : { inset: 0 };

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
            <div className="qr-box-pattern" style={patternStyle} />
            <div className="qr-box-controls" onPointerDown={(e) => e.stopPropagation()}>
              <select
                value={links.some((l) => l.uid === box.linkUid) ? box.linkUid : ""}
                onChange={(e) => updateBox(box.boxId, { linkUid: e.target.value || null })}
              >
                <option value="">Unassigned</option>
                {links.map((link, i) => (
                  <option key={link.uid} value={link.uid}>
                    {link.label.trim() || `Link ${i + 1}`}
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
    </div>
  );
}
