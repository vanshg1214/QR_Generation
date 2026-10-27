import { useEffect, useId, useRef, useState } from "react";
import { scanTime } from "../lib/time.js";

// A name that shows every scan in a tooltip: on hover or keyboard focus on a computer, on tap
// on a phone. scans: [{ at, link?, campaign? }] newest first.
export default function ScanHistory({ scans, total, children, showCampaign = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  if (!scans?.length) return children;
  const count = total ?? scans.length;
  return (
    <span
      ref={ref}
      className="scan-history-anchor"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={(e) => {
        // Taps on phones toggle it; don't also open the row underneath.
        if (window.matchMedia("(hover: none)").matches) {
          e.stopPropagation();
          setOpen((o) => !o);
        }
      }}
      tabIndex={0}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span role="tooltip" id={id} className="scan-history-tip">
          <strong>
            {count} {count === 1 ? "scan" : "scans"}
          </strong>
          <ul>
            {scans.map((s, i) => (
              <li key={i}>
                <span>{scanTime(s.at)}</span>
                {(s.link || (showCampaign && s.campaign)) && (
                  <span className="muted">
                    {showCampaign && s.campaign ? `${s.campaign}${s.link ? " · " : ""}` : ""}
                    {s.link || ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {count > scans.length && <span className="muted small">and {count - scans.length} earlier</span>}
        </span>
      )}
    </span>
  );
}

// A person's scans (from the campaign data), newest first, for ScanHistory.
export function personScans(person, max = 12) {
  return person.links
    .flatMap((l) => l.scans.map((at) => ({ at, link: person.links.length > 1 ? l.label : null })))
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, max);
}
