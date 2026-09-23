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

export default function CampaignCharts({ people, summary, links }) {
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



  // 4. Per-person scan leaderboard (top 10)
  const topPeople = useMemo(() => {
    return [...people]
      .sort((a, b) => b.scanCount - a.scanCount)
      .slice(0, 10)
      .map((p) => ({ name: p.name.length > 18 ? p.name.slice(0, 16) + "…" : p.name, scans: p.scanCount }));
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

          {/* Bar – Top People */}
          {topPeople.some((p) => p.scans > 0) && (
            <div className="chart-card chart-card-wide">
              <h3 className="chart-title">Top People by Scans</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={topPeople} layout="vertical" margin={{ top: 0, right: 12, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8e4" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: MUTED }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: PRIMARY }} axisLine={false} tickLine={false} width={110} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="scans" name="Scans" fill={PRIMARY} radius={[0, 5, 5, 0]}>
                    {topPeople.map((_, i) => (
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
