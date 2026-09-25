import { useEffect, useRef, useState } from "react";
import { detectBlankBoxes } from "../lib/detectBlankBoxes.js";

const MIN_BOX_SIZE = 0.02;

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
export default function LetterGraphicCalibrator({ graphicFile, links, boxes, onBoxesChange }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const containerRef = useRef(null);
  const dragState = useRef(null);

  // Re-detect from scratch whenever the graphic itself changes -- boxes
  // calibrated against a previous image don't carry over.
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
    // Only re-run when the graphic file itself changes -- onBoxesChange is a
    // stable setState setter from the parent.
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
        dragState.current = { boxId, mode, startClientX: e.clientX, startClientY: e.clientY, startBox: { ...box } };
      },
      onPointerMove: (e) => {
        const state = dragState.current;
        if (!state || state.boxId !== boxId || state.mode !== mode || !containerRef.current) return;
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

  if (!graphicFile) return null;

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

      <div className="qr-calibrator-canvas" ref={containerRef}>
        {imageUrl && <img src={imageUrl} alt="Letter graphic" draggable={false} />}
        {boxes.map((box) => (
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
            <div className="qr-box-pattern" />
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
        ))}
      </div>
    </div>
  );
}
