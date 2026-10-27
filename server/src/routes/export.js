import { asyncRouter } from "../asyncRouter.js";
import ExcelJS from "exceljs";
import { pool } from "../db.js";
import { requireAuth } from "../auth.js";
import { INTEREST_LABELS, dayDiff, interestLevel, istDayKey, startDayKey, TIME_ZONE } from "../analytics.js";

const istTime = (t) => new Date(t).toLocaleString("en-IN", { timeZone: TIME_ZONE });

export const exportRoutes = asyncRouter();

async function buildLinkRows(campaignId) {
  const { rows } = await pool.query(
    "SELECT label, destination_url FROM campaign_links WHERE campaign_id = $1 ORDER BY position ASC, id ASC",
    [campaignId]
  );
  return rows.map((r) => ({ label: r.label, destinationUrl: r.destination_url }));
}

async function buildPeopleRows(campaignId, publicBaseUrl) {
  const { rows } = await pool.query(
    `
      SELECT
        c.name AS campaign_name,
        p.id AS person_id,
        p.name,
        p.details_json,
        p.created_at,
        cl.label AS link_label,
        cl.position,
        co.code,
        COUNT(s.id)::int AS scan_count,
        MAX(s.scanned_at) AS last_scanned_at,
        COALESCE(json_agg(s.scanned_at ORDER BY s.scanned_at) FILTER (WHERE s.id IS NOT NULL), '[]') AS scan_times,
        COUNT(DISTINCT md5(COALESCE(s.ip_hash, '') || COALESCE(s.user_agent, ''))) FILTER (WHERE s.id IS NOT NULL)::int AS devices,
        c.created_at AS campaign_created_at,
        to_char(c.sent_at, 'YYYY-MM-DD') AS sent_at
      FROM people p
      JOIN campaigns c ON c.id = p.campaign_id
      JOIN codes co ON co.person_id = p.id
      JOIN campaign_links cl ON cl.id = co.campaign_link_id
      LEFT JOIN scans s ON s.code_id = co.id AND NOT s.is_bot
      WHERE p.campaign_id = $1
      GROUP BY c.name, c.created_at, c.sent_at, p.id, p.name, p.details_json, p.created_at, cl.id, cl.label, cl.position, co.code
      ORDER BY p.id ASC, cl.position ASC
    `,
    [campaignId]
  );

  // Interest level and first scan are per person (all their links together).
  const byPerson = new Map();
  for (const row of rows) {
    if (!byPerson.has(row.person_id)) byPerson.set(row.person_id, { links: [] });
    byPerson.get(row.person_id).links.push({ scans: row.scan_times });
  }

  return rows.map((row) => {
    const person = byPerson.get(row.person_id);
    const times = person.links.flatMap((l) => l.scans).sort();
    const sentKey = startDayKey({ sentAt: row.sent_at, createdAt: row.campaign_created_at });
    const details = JSON.parse(row.details_json || "{}");
    for (const key of Object.keys(details)) {
      const trimmed = key.trim().toLowerCase();
      // "__EMPTY", "__EMPTY_1", etc. are SheetJS's auto-generated name for a
      // column whose header cell was blank in the original spreadsheet.
      if (trimmed === "name" || /^__empty/.test(trimmed)) delete details[key];
    }
    return {
      campaign: row.campaign_name,
      name: row.name,
      ...details,
      link: row.link_label,
      code: row.code,
      qrCode: { text: "View QR", hyperlink: `${publicBaseUrl}/qr/${row.code}.png` },
      viewed: row.scan_count > 0 ? "Yes" : "No",
      scanCount: row.scan_count,
      interest: INTEREST_LABELS[interestLevel(person)],
      devices: row.devices,
      firstScannedAt: times.length ? istTime(times[0]) : "",
      daysToFirstScan: times.length ? Math.max(0, dayDiff(istDayKey(times[0]), sentKey)) : "",
      lastScannedAt: row.last_scanned_at ? istTime(row.last_scanned_at) : "",
      uploadedAt: row.created_at ? istTime(row.created_at) : "",
    };
  });
}

// Every individual scan event, most recent first -- the full "who scanned which link when" log.
async function buildScanLog(campaignId) {
  const { rows } = await pool.query(
    `
      SELECT p.name AS person_name, cl.label AS link_label, s.scanned_at
      FROM scans s
      JOIN codes co ON co.id = s.code_id
      JOIN people p ON p.id = co.person_id
      JOIN campaign_links cl ON cl.id = co.campaign_link_id
      WHERE p.campaign_id = $1 AND NOT s.is_bot
      ORDER BY s.scanned_at DESC
    `,
    [campaignId]
  );
  return rows.map((row) => ({
    name: row.person_name,
    link: row.link_label,
    scannedAt: istTime(row.scanned_at),
  }));
}

async function getCampaignName(campaignId) {
  const { rows } = await pool.query("SELECT name FROM campaigns WHERE id = $1", [campaignId]);
  return rows[0]?.name;
}

const COLUMN_LABELS = {
  campaign: "Campaign",
  name: "Name",
  link: "Link",
  code: "QR Code ID",
  qrCode: "QR Code",
  viewed: "Viewed",
  scanCount: "Scan Count",
  interest: "Interest",
  devices: "Phones That Scanned",
  firstScannedAt: "First Scanned (IST)",
  daysToFirstScan: "Days To First Scan",
  lastScannedAt: "Last Scanned (IST)",
  uploadedAt: "Uploaded At",
};

exportRoutes.get("/campaigns/:id/export.xlsx", requireAuth, async (req, res) => {
  const campaignId = Number(req.params.id);
  if (!Number.isInteger(campaignId)) {
    return res.status(400).json({ error: "Invalid campaign id" });
  }
  const campaignName = await getCampaignName(campaignId);
  if (!campaignName) {
    return res.status(404).json({ error: "Campaign not found" });
  }

  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const linkRows = await buildLinkRows(campaignId);
  const rows = await buildPeopleRows(campaignId, publicBaseUrl);
  const scanLog = await buildScanLog(campaignId);
  const workbook = new ExcelJS.Workbook();

  const totalPeople = new Set(rows.map((r) => r.name)).size;
  const totalViewed = new Set(rows.filter((r) => r.viewed === "Yes").map((r) => r.name)).size;
  const totalScans = rows.reduce((sum, r) => sum + r.scanCount, 0);
  const viewRate = totalPeople ? Math.round((totalViewed / totalPeople) * 1000) / 10 : 0;

  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { header: "Metric", key: "metric", width: 26 },
    { header: "Value", key: "value", width: 20 },
  ];
  summarySheet.getRow(1).font = { bold: true };
  summarySheet.addRows([
    { metric: "Campaign", value: campaignName },
    { metric: "Total People", value: totalPeople },
    { metric: "Total Links", value: linkRows.length },
    { metric: "Total Viewed (any link)", value: totalViewed },
    { metric: "View Rate (%)", value: viewRate },
    { metric: "Total Scans (all links, all-time)", value: totalScans },
    { metric: "Report Generated At (IST)", value: istTime(Date.now()) },
  ]);
  summarySheet.getColumn("metric").font = { bold: true };

  const linksSheet = workbook.addWorksheet("Links");
  linksSheet.columns = [
    { header: "Link", key: "label", width: 24 },
    { header: "Destination URL", key: "destinationUrl", width: 50 },
  ];
  linksSheet.getRow(1).font = { bold: true };
  linkRows.forEach((row) => linksSheet.addRow(row));

  const peopleSheet = workbook.addWorksheet("People");
  const columns = rows.length
    ? Object.keys(rows[0]).map((key) => ({
        header: COLUMN_LABELS[key] || key,
        key,
        width: key === "qrCode" ? 14 : 22,
      }))
    : [{ header: "Name", key: "name", width: 22 }];
  peopleSheet.columns = columns;
  peopleSheet.getRow(1).font = { bold: true };
  rows.forEach((row) => peopleSheet.addRow(row));
  if (rows.length) {
    peopleSheet.getColumn("qrCode").font = { color: { argb: "FF2563EB" }, underline: true };
  }

  const scanLogSheet = workbook.addWorksheet("Scan Log");
  scanLogSheet.columns = [
    { header: "Name", key: "name", width: 28 },
    { header: "Link", key: "link", width: 20 },
    { header: "Scanned At (IST)", key: "scannedAt", width: 24 },
  ];
  scanLogSheet.getRow(1).font = { bold: true };
  scanLog.forEach((row) => scanLogSheet.addRow(row));

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${campaignName.replace(/[^a-z0-9]+/gi, "_")}-scan-data.xlsx"`
  );

  await workbook.xlsx.write(res);
  res.end();
});
