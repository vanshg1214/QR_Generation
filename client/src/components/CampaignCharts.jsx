import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import {
  INTEREST_LABELS,
  funnel,
  interestCounts,
  interestLevel,
  scansPerDay,
  startDayKey,
  timeToFirstScan,
  weekdayHourGrid,
} from "../../../server/src/analytics.js";
import ScanHistory, { personScans } from "./ScanHistory.jsx";
import { dayLabel, fullDate } from "../lib/time.js";

const PRIMARY = "#123c2c";
const ACCENT = "#1f7a4d";
const MUTED = "#9aa6a0";
const PALETTE = ["#123c2c", "#1f7a4d", "#2da05e", "#5dc48a", "#a8dfc0", "#d4e8dc"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ChartTooltip({ active, payload, label, labelFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      {label != null && <p className="chart-tooltip-label">{labelFormatter ? labelFormatter(label) : label}</p>}
      {payload.map((entry, i) => (
        <p key={i} style={{ margin: "2px 0", color: entry.color || PRIMARY }}>
          {entry.name}: <strong>{entry.value}</strong>
        </p>
      ))}
    </div>
  );
}

function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={700}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const dayWord = (d) => (d === 0 ? "the same day" : d === 1 ? "day 1" : `day ${d}`);

export function InterestBadge({ level }) {
  return <span className={`interest-badge is-${level}`}>{INTEREST_LABELS[level]}</span>;
}

// Everything about how a campaign's letters are being scanned. All numbers come from the same
// people data as the stat cards and the People table (see server/src/analytics.js).
export default function CampaignCharts({ campaign, people, summary, links, onPersonClick, onFilterPeople, onSetSentDate }) {
  const sentKey = startDayKey(campaign);
  const hasSentDate = Boolean(campaign.sentAt);

  const data = useMemo(() => {
    const now = Date.now();
    return {
      interest: interestCounts(people, now),
      perDay: scansPerDay(people, sentKey),
      funnel: funnel(people, sentKey),
      delay: timeToFirstScan(people, sentKey),
      grid: weekdayHourGrid(people),
      shared: people.filter((p) => p.devices >= 2).length,
      top: [...people].filter((p) => p.scanCount > 0).sort((a, b) => b.scanCount - a.scanCount || (b.lastScannedAt > a.lastScannedAt ? 1 : -1)),
      levelOf: new Map(people.map((p) => [p.id, interestLevel(p, now)])),
      byLink: links.map((l) => ({
        name: l.label,
        value: people.reduce((sum, p) => sum + (p.links.find((x) => x.linkId === l.id)?.scanCount || 0), 0),
      })),
    };
  }, [people, links, sentKey]);

  const gridMax = Math.max(1, ...data.grid.flat());
  const best = (() => {
    let top = null;
    data.grid.forEach((row, d) => row.forEach((v, h) => (!top || v > top.v) && (top = { d, h, v })));
    return top?.v ? top : null;
  })();
  const hourName = (h) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;

  const startNote = hasSentDate ? (
    <>Counted from {fullDate(`${campaign.sentAt}T12:00:00+05:30`)}, the day the letters were sent.</>
  ) : (
    <>
      Counted from the day the campaign was created.{" "}
      <button type="button" className="link-button" onClick={onSetSentDate}>
        Set the date the letters were sent
      </button>{" "}
      for exact numbers.
    </>
  );

  return (
    <section className="card analytics-section">
      <span className="eyebrow">Analytics</span>
      <h2 style={{ marginBottom: 6 }}>How the letters are being scanned</h2>
      <p className="muted small" style={{ marginBottom: 16 }}>
        {startNote} Link previews (e.g. from WhatsApp) are not counted. Times are Indian time.
      </p>

      <div className="interest-row">
        {["hot", "warm", "none"].map((level) => (
          <button key={level} type="button" className={`interest-tile is-${level}`} onClick={() => onFilterPeople?.(level)}>
            <strong>{data.interest[level]}</strong>
            <span>{INTEREST_LABELS[level]}</span>
            <small>
              {level === "hot" ? "3+ scans, or 2+ with one this week" : level === "warm" ? "scanned, not yet Hot" : "haven't scanned"}
            </small>
          </button>
        ))}
        <button type="button" className="interest-tile is-shared" onClick={() => onFilterPeople?.("shared")}>
          <strong>{data.shared}</strong>
          <span>Shared</span>
          <small>scanned from 2+ phones: probably forwarded</small>
        </button>
      </div>

      {summary.totalScans === 0 ? (
        <div className="empty-state" style={{ padding: "28px 16px" }}>
          <strong>No scans yet</strong>
          <p className="muted">The charts fill in as people scan their QR codes.</p>
        </div>
      ) : (
        <div className="charts-grid">
          <div className="chart-card chart-card-wide">
            <h3 className="chart-title">Scans per day</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.perDay} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8e4" vertical={false} />
                <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} minTickGap={18} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip labelFormatter={dayLabel} />} cursor={{ fill: "rgba(31,122,77,0.08)" }} />
                <Bar dataKey="scans" name="Scans" fill={ACCENT} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-card">
            <h3 className="chart-title">Funnel</h3>
            <div className="funnel">
              {data.funnel.map((step, i) => (
                <div key={step.label} className="funnel-step">
                  <div className="funnel-label">
                    <span>{step.label}</span>
                    <strong>
                      {step.value}
                      {i > 0 && <small> · {pct(step.value, data.funnel[0].value)}%</small>}
                    </strong>
                  </div>
                  <div className="funnel-bar">
                    <span style={{ width: `${Math.max(2, pct(step.value, data.funnel[0].value))}%`, background: PALETTE[i] }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="chart-card">
            <h3 className="chart-title">Days from sending to first scan</h3>
            <p className="chart-headline">
              {data.delay.peak
                ? data.delay.peak.from === data.delay.peak.to
                  ? `Most people scan on ${dayWord(data.delay.peak.from)}`
                  : `Most people scan between ${dayWord(data.delay.peak.from)} and ${dayWord(data.delay.peak.to)}`
                : "Not enough scans yet to see a pattern"}
              {data.delay.median != null && <span className="muted"> · typical wait {data.delay.median} {data.delay.median === 1 ? "day" : "days"}</span>}
            </p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={data.delay.buckets} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8e4" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} interval={0} angle={-30} textAnchor="end" height={46} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(31,122,77,0.08)" }} />
                <Bar dataKey="people" name="People" fill={PRIMARY} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-card chart-card-wide">
            <h3 className="chart-title">Best day and time</h3>
            <p className="chart-headline">
              {best ? (
                <>
                  Busiest: <strong>{WEEKDAYS[best.d]}</strong> around <strong>{hourName(best.h)}</strong>
                  <span className="muted"> ({best.v} scans)</span>
                </>
              ) : (
                "—"
              )}
            </p>
            <div className="heatmap-scroll">
              <div className="heatmap" role="table" aria-label="Scans by weekday and hour">
                <span />
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={h} className="heatmap-hour">
                    {h % 3 === 0 ? hourName(h).replace(" ", "") : ""}
                  </span>
                ))}
                {data.grid.map((row, d) => [
                  <span key={`d${d}`} className="heatmap-day">
                    {WEEKDAYS[d]}
                  </span>,
                  ...row.map((v, h) => (
                    <span
                      key={`${d}-${h}`}
                      className="heatmap-cell"
                      title={`${WEEKDAYS[d]} ${hourName(h)}: ${v} ${v === 1 ? "scan" : "scans"}`}
                      style={{ background: v ? `rgba(31, 122, 77, ${0.15 + 0.85 * (v / gridMax)})` : undefined }}
                    />
                  )),
                ])}
              </div>
            </div>
          </div>

          <div className="chart-card">
            <h3 className="chart-title">Viewed vs not viewed</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={[
                    { name: "Viewed", value: summary.totalViewed },
                    { name: "Not viewed", value: summary.totalPeople - summary.totalViewed },
                  ].filter((d) => d.value > 0)}
                  dataKey="value"
                  innerRadius={52}
                  outerRadius={82}
                  paddingAngle={3}
                  labelLine={false}
                  label={PieLabel}
                >
                  <Cell fill={ACCENT} />
                  <Cell fill={MUTED} />
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend formatter={(value, entry) => <span style={{ color: PRIMARY, fontSize: "0.82rem" }}>{value} ({entry.payload.value})</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-card">
            <h3 className="chart-title">Most interested people</h3>
            <div className="leaderboard-list">
              {data.top.map((p) => (
                <div key={p.id} className="leaderboard-item clickable" onClick={() => onPersonClick?.(p)}>
                  <ScanHistory scans={personScans(p)} total={p.scanCount}>
                    <span className="leaderboard-name">{p.name}</span>
                  </ScanHistory>
                  <span className="leaderboard-meta">
                    {p.devices >= 2 && <span className="muted small" title="Scanned from more than one phone">{p.devices} phones</span>}
                    <InterestBadge level={data.levelOf.get(p.id)} />
                    <span className="leaderboard-scans">{p.scanCount}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {links.length > 1 && (
            <div className="chart-card">
              <h3 className="chart-title">Scans per link</h3>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={data.byLink} dataKey="value" outerRadius={82} labelLine={false} label={PieLabel}>
                    {data.byLink.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend formatter={(value, entry) => <span style={{ color: PRIMARY, fontSize: "0.82rem" }}>{value} ({entry.payload.value})</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
