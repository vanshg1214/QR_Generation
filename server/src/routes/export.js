import { Router } from "express";
import ExcelJS from "exceljs";
import { pool } from "../db.js";
import { requireAuth } from "../auth.js";

export const exportRoutes = Router();

const PEOPLE_QUERY = `
  SELECT
    p.name,
    p.code,
    p.details_json,
    p.created_at,
    COUNT(s.id)::int AS scan_count,
    MAX(s.scanned_at) AS last_scanned_at
  FROM people p
  LEFT JOIN scans s ON s.person_id = p.id
  GROUP BY p.id
  ORDER BY LOWER(p.name) ASC
`;

async function buildRows() {
  const { rows } = await pool.query(PEOPLE_QUERY);
  return rows.map((row) => {
    const details = JSON.parse(row.details_json || "{}");
    delete details[Object.keys(details).find((k) => k.trim().toLowerCase() === "name")];
    return {
      name: row.name,
      ...details,
      code: row.code,
      viewed: row.scan_count > 0 ? "Yes" : "No",
      scanCount: row.scan_count,
      lastScannedAt: row.last_scanned_at ? new Date(row.last_scanned_at).toLocaleString() : "",
      uploadedAt: row.created_at ? new Date(row.created_at).toLocaleString() : "",
    };
  });
}

exportRoutes.get("/export.xlsx", requireAuth, async (req, res) => {
  const rows = await buildRows();
  const workbook = new ExcelJS.Workbook();

  const totalPeople = rows.length;
  const totalViewed = rows.filter((r) => r.viewed === "Yes").length;
  const totalScans = rows.reduce((sum, r) => sum + r.scanCount, 0);
  const viewRate = totalPeople ? Math.round((totalViewed / totalPeople) * 1000) / 10 : 0;

  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { header: "Metric", key: "metric", width: 26 },
    { header: "Value", key: "value", width: 20 },
  ];
  summarySheet.getRow(1).font = { bold: true };
  summarySheet.addRows([
    { metric: "Total People", value: totalPeople },
    { metric: "Total Viewed", value: totalViewed },
    { metric: "Total Not Viewed", value: totalPeople - totalViewed },
    { metric: "View Rate (%)", value: viewRate },
    { metric: "Total Scans (all-time)", value: totalScans },
    { metric: "Report Generated At", value: new Date().toLocaleString() },
  ]);
  summarySheet.getColumn("metric").font = { bold: true };

  const sheet = workbook.addWorksheet("Scan Tracking");
  const columns = rows.length
    ? Object.keys(rows[0]).map((key) => ({ header: key, key, width: 22 }))
    : [{ header: "name", key: "name", width: 22 }];
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  rows.forEach((row) => sheet.addRow(row));

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="qr-scan-data.xlsx"`);

  await workbook.xlsx.write(res);
  res.end();
});

exportRoutes.get("/export.csv", requireAuth, async (req, res) => {
  const rows = await buildRows();
  const headers = rows.length ? Object.keys(rows[0]) : ["name"];

  const escape = (value) => {
    const str = String(value ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="qr-scan-data.csv"`);
  res.send(lines.join("\n"));
});
