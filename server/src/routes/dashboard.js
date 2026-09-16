import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../auth.js";

export const dashboardRoutes = Router();

const PEOPLE_QUERY = `
  SELECT
    p.id,
    p.code,
    p.name,
    p.details_json,
    p.created_at,
    COUNT(s.id)::int AS scan_count,
    MAX(s.scanned_at) AS last_scanned_at
  FROM people p
  LEFT JOIN scans s ON s.person_id = p.id
  GROUP BY p.id
  ORDER BY LOWER(p.name) ASC
`;

dashboardRoutes.get("/people", requireAuth, async (req, res) => {
  const { rows: dbRows } = await pool.query(PEOPLE_QUERY);

  const people = dbRows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    details: JSON.parse(row.details_json || "{}"),
    scanCount: row.scan_count,
    lastScannedAt: row.last_scanned_at,
    viewed: row.scan_count > 0,
  }));

  const summary = {
    totalPeople: people.length,
    totalViewed: people.filter((r) => r.viewed).length,
    totalScans: people.reduce((sum, r) => sum + r.scanCount, 0),
  };

  res.json({ people, summary });
});
