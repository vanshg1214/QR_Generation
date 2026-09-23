import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from "recharts";

const PRIMARY = "#123c2c";
const ACCENT = "#1f7a4d";
const CREAM = "#d4e8dc";
const DANGER = "#b3261e";
const MUTED = "#9aa6a0";
const PALETTE = ["#123c2c", "#1f7a4d", "#2da05e", "#5dc48a", "#a8dfc0", "#d4e8dc"];

// Custom tooltip for charts
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e2e8e4",
      borderRadius: 8,
      padding: "8px 14px",
      fontSize: "0.83rem",
      boxShadow: "0 4px 16px rgba(18,60,44,0.1)",
    }}>
      {label && <p style={{ margin: "0 0 4px", fontWeight: 600, color: PRIMARY }}>{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} style={{ margin: "2px 0", color: entry.color || PRIMARY }}>
          {entry.name}: <strong>{entry.value}</strong>
        </p>
      ))}
    </div>
  );
}

// Custom label for pie chart
function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central"
      fontSize={13} fontWeight={700}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export default function CampaignCharts({ people, summary, links, onPersonClick }) {
  // 1. Viewed vs Not Viewed (donut)
  const viewedData = useMemo(() => {
    const viewed = summary.totalViewed;
    const notViewed = summary.totalPeople - summary.totalViewed;
    return [
      { name: "Viewed", value: viewed },
      { name: "Not Viewed", value: notViewed },
    ].filter((d) => d.value > 0);
  }, [summary]);

  // 2. Scans by link (bar)
  const scansByLink = useMemo(() => {
    const counts = {};
    for (const person of people) {
      for (const link of person.links) {
        counts[link.label] = (counts[link.label] || 0) + link.scanCount;
      }
    }
    return Object.entries(counts)
      .map(([label, scans]) => ({ name: label, value: scans }))
      .sort((a, b) => b.value - a.value);
  }, [people]);



  // 4. Per-person scan leaderboard
  const topPeople = useMemo(() => {
    return [...people]
      .filter((p) => p.scanCount > 0)
      .sort((a, b) => b.scanCount - a.scanCount);
  }, [people]);

  // 5. Time of Day Analysis
  const timeOfDayData = useMemo(() => {
    let morning = 0;   // 6am - 11:59am
    let afternoon = 0; // 12pm - 5:59pm
    let evening = 0;   // 6pm - 11:59pm
    let night = 0;     // 12am - 5:59am

    for (const person of people) {
      for (const link of person.links) {
        for (const ts of link.scans) {
          const hour = new Date(ts).getHours();
          if (hour >= 6 && hour < 12) morning++;
          else if (hour >= 12 && hour < 18) afternoon++;
          else if (hour >= 18 && hour <= 23) evening++;
          else night++;
        }
      }
    }

    return [
      { name: "Morning", scans: morning },
      { name: "Afternoon", scans: afternoon },
      { name: "Evening", scans: evening },
      { name: "Night", scans: night },
    ];
  }, [people]);

  const hasScans = summary.totalScans > 0;

  return (
    <section className="card analytics-section">
      <span className="eyebrow">Analytics</span>
      <h2 style={{ marginBottom: 6 }}>Scan Insights</h2>
      <p className="muted" style={{ marginBottom: 20 }}>
        Visual breakdown of engagement across people and links.
      </p>

      {!hasScans ? (
        <div className="empty-state" style={{ padding: "32px 16px" }}>
          <strong>No scans yet</strong>
          <p className="muted">Charts will appear here once people start scanning their QR codes.</p>
        </div>
      ) : (
        <div className="charts-grid">

          {/* Donut – Viewed vs Not Viewed */}
          <div className="chart-card">
            <h3 className="chart-title">Viewed vs Not Viewed</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={viewedData}
                  dataKey="value"
                  innerRadius={58}
                  outerRadius={90}
                  paddingAngle={3}
                  labelLine={false}
                  label={PieLabel}
                >
                  {viewedData.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? ACCENT : MUTED} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend
                  formatter={(value, entry) => (
                    <span style={{ color: PRIMARY, fontSize: "0.82rem" }}>
                      {value} ({entry.payload.value})
                    </span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Pie – Scans by Link */}
          {scansByLink.length > 0 && (
            <div className="chart-card">
              <h3 className="chart-title">Link Distribution</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={scansByLink}
                    dataKey="value"
                    innerRadius={0}
                    outerRadius={90}
                    labelLine={false}
                    label={PieLabel}
                  >
                    {scansByLink.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    formatter={(value, entry) => (
                      <span style={{ color: PRIMARY, fontSize: "0.82rem" }}>
                        {value} ({entry.payload.value})
                      </span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* List – Top People */}
          {topPeople.length > 0 && (
            <div className="chart-card">
              <h3 className="chart-title">Most Interested People</h3>
              <div className="leaderboard-list">
                {topPeople.map((p) => (
                  <div 
                    key={p.id} 
                    className="leaderboard-item clickable"
                    onClick={() => onPersonClick && onPersonClick(p)}
                  >
                    <span className="leaderboard-name">{p.name}</span>
                    <span className="leaderboard-scans">{p.scanCount}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bar - Time of Day */}
          {hasScans && (
            <div className="chart-card">
              <h3 className="chart-title">Time of Day</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={timeOfDayData} margin={{ top: 12, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8e4" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="scans" name="Scans" fill={ACCENT} radius={[4, 4, 0, 0]}>
                    {timeOfDayData.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

        </div>
      )}
    </section>
  );
}
