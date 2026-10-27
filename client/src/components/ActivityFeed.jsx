import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Link } from "../router.jsx";
import { gapText } from "../../../server/src/analytics.js";
import ScanHistory from "./ScanHistory.jsx";
import { ago } from "../lib/time.js";

const REFRESH_MS = 60_000;

// When this viewer last looked at a feed, so scans since then can be highlighted (per
// browser; it's only a convenience, so it may be missing).
function readSeen(scope) {
  try {
    return localStorage.getItem(`activitySeen:${scope}`);
  } catch {
    return null;
  }
}
function writeSeen(scope, value) {
  try {
    localStorage.setItem(`activitySeen:${scope}`, value);
  } catch {
    // private window or storage blocked: highlighting just won't carry over
  }
}

export function Badge({ item }) {
  if (item.badge === "new") return <span className="activity-badge is-new">NEW</span>;
  if (item.badge === "came_back")
    return <span className="activity-badge is-back">CAME BACK {gapText(item.gapDays).toUpperCase()}</span>;
  if (item.badge === "repeat") return <span className="activity-badge is-repeat">{ordinal(item.scanNumber)} SCAN</span>;
  return null;
}

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "TH" : ["TH", "ST", "ND", "RD"][n % 10] || "TH"}`;

// Newest scans first, like OnePageCRM's email tracking: NEW for someone's first ever scan,
// CAME BACK when they return after a long gap, and the scan number for repeat scanners.
// Hover (or tap) a name to see all their scans. Scans since your last visit are highlighted.
export default function ActivityFeed({ campaignId = null, title = "Scan activity", compact = false, onToday }) {
  const scope = campaignId ? `campaign:${campaignId}` : "all";
  const [items, setItems] = useState([]);
  const [today, setToday] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [, setTick] = useState(0); // re-renders "5 min ago"
  // Read once per visit: what was already seen before this visit.
  const seenBefore = useRef(readSeen(scope));
  // Kept in a ref so a new callback from the parent doesn't restart the loading.
  const onTodayRef = useRef(onToday);
  onTodayRef.current = onToday;

  const load = useCallback(async () => {
    try {
      const data = await api.getActivity({ campaignId, limit: compact ? 8 : 30 });
      setItems(data.items);
      setNextBefore(data.nextBefore);
      setToday(data.today);
      onTodayRef.current?.(data.today);
      setError("");
      if (data.items[0]) writeSeen(scope, data.items[0].at);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [campaignId, compact, scope]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      load();
      setTick((n) => n + 1);
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  async function loadMore() {
    const data = await api.getActivity({ campaignId, before: nextBefore, limit: 30 });
    setItems((prev) => [...prev, ...data.items]);
    setNextBefore(data.nextBefore);
  }

  const isUnseen = (item) => seenBefore.current && item.at > seenBefore.current;
  const unseen = items.filter(isUnseen).length;

  return (
    <section className="card activity-card">
      <div className="table-header">
        <div>
          <h2>{title}</h2>
          {today && (
            <p className="muted small" style={{ margin: 0 }}>
              Today: {today.scans} {today.scans === 1 ? "scan" : "scans"}
              {today.newPeople ? ` · ${today.newPeople} new` : ""}
              {today.cameBack ? ` · ${today.cameBack} came back` : ""} · Yesterday: {today.yesterday}
              {unseen > 0 && <strong className="activity-unseen"> · {unseen} since your last visit</strong>}
            </p>
          )}
        </div>
        <button className="secondary small-button" onClick={load}>
          Refresh
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {loading && !items.length ? (
        <p className="muted">Loading activity…</p>
      ) : !items.length ? (
        <div className="empty-state" style={{ padding: "24px 12px" }}>
          <strong>No scans yet</strong>
          <p className="muted">Every scan will appear here as it happens, newest first.</p>
        </div>
      ) : (
        <ol className="activity-list">
          {items.map((item) => (
            <li key={item.id} className={`activity-item${isUnseen(item) ? " is-unseen" : ""}`}>
              <span className="activity-dot" aria-hidden="true" />
              <div className="activity-main">
                <div className="activity-line">
                  <ScanHistory scans={item.history} total={item.totalScans} showCampaign={!campaignId}>
                    <strong className="activity-name">{item.name}</strong>
                  </ScanHistory>
                  <Badge item={item} />
                </div>
                <div className="activity-sub muted small">
                  scanned{" "}
                  {campaignId ? (
                    <>“{item.link}”</>
                  ) : (
                    <Link to={`/campaigns/${item.campaignId}`}>{item.campaignName}</Link>
                  )}
                  {!campaignId && item.link ? ` · ${item.link}` : ""}
                  {item.totalScans > 1 ? ` · ${item.totalScans} scans in all` : ""}
                </div>
              </div>
              <time className="activity-time muted small" dateTime={item.at} title={new Date(item.at).toString()}>
                {ago(item.at)}
              </time>
            </li>
          ))}
        </ol>
      )}
      {!compact && nextBefore && (
        <button className="secondary small-button" onClick={loadMore} style={{ marginTop: 10 }}>
          Show earlier scans
        </button>
      )}
    </section>
  );
}
