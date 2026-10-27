import { asyncRouter } from "../asyncRouter.js";
import { pool } from "../db.js";
import { requireAuth } from "../auth.js";
import { CAME_BACK_DAYS, levelFromTimes } from "../analytics.js";
import { contactLabel } from "../spreadsheet.js";

export const activityRoutes = asyncRouter();

const HISTORY_LENGTH = 12; // scans shown in a name's tooltip

// Every counted scan with who made it. "who" is the person's contact key (phone/email, the
// same across campaigns) when the sheet had one, otherwise just that person in that campaign.
const SCANS_CTE = `
  scan_rows AS (
    SELECT
      s.id, s.scanned_at,
      p.id AS person_id, p.name, p.campaign_id, c.name AS campaign_name,
      cl.label AS link_label,
      COALESCE(NULLIF(p.contact_key, ''), 'person:' || p.id) AS who
    FROM scans s
    JOIN codes co ON co.id = s.code_id
    JOIN people p ON p.id = co.person_id
    JOIN campaigns c ON c.id = p.campaign_id
    JOIN campaign_links cl ON cl.id = co.campaign_link_id
    WHERE NOT s.is_bot
  ),
  ranked AS (
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY who ORDER BY scanned_at, id) AS scan_number,
      LAG(scanned_at) OVER (PARTITION BY who ORDER BY scanned_at, id) AS previous_at
    FROM scan_rows
  )`;

// GET /api/activity?campaignId=12&limit=50&before=<ISO time>
// Newest scans first, each with its badge:
//   new        the person's first scan ever (across campaigns when they can be recognised)
//   came_back  a scan after a gap of CAME_BACK_DAYS or more (gapDays says how long)
//   repeat     their 3rd or later scan
// and that person's latest scans for the tooltip. Also today's and yesterday's totals.
activityRoutes.get("/activity", requireAuth, async (req, res) => {
  const campaignId = req.query.campaignId ? Number(req.query.campaignId) : null;
  if (req.query.campaignId && !Number.isInteger(campaignId)) return res.status(400).json({ error: "Invalid campaign id" });
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const before = req.query.before && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : null;

  const { rows } = await pool.query(
    `WITH ${SCANS_CTE}
     SELECT id, scanned_at, person_id, name, campaign_id, campaign_name, link_label, who, scan_number,
       FLOOR(EXTRACT(EPOCH FROM (scanned_at - previous_at)) / 86400)::int AS gap_days
     FROM ranked
     WHERE ($1::int IS NULL OR campaign_id = $1) AND ($2::timestamptz IS NULL OR scanned_at < $2)
     ORDER BY scanned_at DESC, id DESC
     LIMIT $3`,
    [campaignId, before, limit + 1]
  );
  const more = rows.length > limit;
  const page = rows.slice(0, limit);

  // Tooltip history for everyone on this page.
  const whos = [...new Set(page.map((r) => r.who))];
  const history = new Map();
  if (whos.length) {
    const { rows: h } = await pool.query(
      `WITH ${SCANS_CTE}
       SELECT who, json_agg(json_build_object('at', scanned_at, 'link', link_label, 'campaign', campaign_name)
                            ORDER BY scanned_at DESC) AS scans,
              COUNT(*)::int AS total
       FROM ranked WHERE who = ANY($1::text[]) GROUP BY who`,
      [whos]
    );
    for (const r of h) history.set(r.who, { total: r.total, scans: r.scans.slice(0, HISTORY_LENGTH) });
  }

  const { rows: totals } = await pool.query(
    `WITH ${SCANS_CTE}
     SELECT
       COUNT(*) FILTER (WHERE day = today)::int AS scans_today,
       COUNT(*) FILTER (WHERE day = today - 1)::int AS scans_yesterday,
       COUNT(*) FILTER (WHERE day = today AND scan_number = 1)::int AS new_today,
       COUNT(*) FILTER (WHERE day = today AND previous_at IS NOT NULL
                        AND scanned_at - previous_at >= make_interval(days => $2))::int AS came_back_today
     FROM (
       SELECT *, (scanned_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
                 (now() AT TIME ZONE 'Asia/Kolkata')::date AS today
       FROM ranked WHERE ($1::int IS NULL OR campaign_id = $1)
     ) t`,
    [campaignId, CAME_BACK_DAYS]
  );

  res.json({
    items: page.map((r) => {
      let badge = null;
      if (Number(r.scan_number) === 1) badge = "new";
      else if (r.gap_days >= CAME_BACK_DAYS) badge = "came_back";
      else if (Number(r.scan_number) >= 3) badge = "repeat";
      const h = history.get(r.who) || { total: 1, scans: [] };
      return {
        id: r.id,
        at: r.scanned_at,
        personId: r.person_id,
        name: r.name,
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        link: r.link_label,
        scanNumber: Number(r.scan_number),
        badge,
        gapDays: badge === "came_back" ? r.gap_days : null,
        totalScans: h.total,
        history: h.scans,
      };
    }),
    nextBefore: more ? page[page.length - 1].scanned_at : null,
    today: {
      scans: totals[0].scans_today,
      yesterday: totals[0].scans_yesterday,
      newPeople: totals[0].new_today,
      cameBack: totals[0].came_back_today,
    },
  });
});

// GET /api/contacts
// One entry per person recognised across campaigns (by the phone/email column of the Excel),
// with every letter they were sent and every scan, plus loyalty groups:
//   every_letter  got 2+ letters and scanned every one
//   once          scanned exactly once, and either 30+ days ago or never scanned a later letter
//   never         never scanned anything
// People from sheets without a phone/email column can't be matched and aren't listed.
activityRoutes.get("/contacts", requireAuth, async (req, res) => {
  const { rows: letterRows } = await pool.query(
    `SELECT p.contact_key, p.id AS person_id, p.name, c.id AS campaign_id, c.name AS campaign_name,
            c.created_at, to_char(c.sent_at, 'YYYY-MM-DD') AS sent_at
     FROM people p JOIN campaigns c ON c.id = p.campaign_id
     WHERE COALESCE(p.contact_key, '') <> ''
     ORDER BY c.created_at ASC, p.id ASC`
  );
  const { rows: scanRows } = await pool.query(
    `SELECT p.contact_key, p.campaign_id, s.scanned_at, cl.label AS link_label
     FROM scans s
     JOIN codes co ON co.id = s.code_id
     JOIN people p ON p.id = co.person_id
     JOIN campaign_links cl ON cl.id = co.campaign_link_id
     WHERE NOT s.is_bot AND COALESCE(p.contact_key, '') <> ''
     ORDER BY s.scanned_at ASC`
  );
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS people,
            COUNT(*) FILTER (WHERE COALESCE(contact_key, '') <> '')::int AS with_contact
     FROM people`
  );

  const contacts = new Map();
  for (const r of letterRows) {
    if (!contacts.has(r.contact_key)) {
      contacts.set(r.contact_key, { key: r.contact_key, contact: contactLabel(r.contact_key), name: r.name, letters: [], scans: [] });
    }
    const c = contacts.get(r.contact_key);
    c.name = r.name; // latest spelling
    if (!c.letters.some((l) => l.campaignId === r.campaign_id)) {
      c.letters.push({ campaignId: r.campaign_id, campaignName: r.campaign_name, sentAt: r.sent_at, createdAt: r.created_at, scans: 0 });
    }
  }
  for (const r of scanRows) {
    const c = contacts.get(r.contact_key);
    if (!c) continue;
    c.scans.push({ at: r.scanned_at, campaignId: r.campaign_id, link: r.link_label });
    const letter = c.letters.find((l) => l.campaignId === r.campaign_id);
    if (letter) letter.scans++;
  }

  const now = Date.now();
  const DAY = 86400000;
  const list = [...contacts.values()].map((c) => {
    const scanned = c.letters.filter((l) => l.scans > 0).length;
    const last = c.scans.length ? Date.parse(c.scans[c.scans.length - 1].at) : null;
    const groups = [];
    if (c.letters.length >= 2 && scanned === c.letters.length) groups.push("every_letter");
    if (c.scans.length === 0) groups.push("never");
    if (c.scans.length === 1) {
      const scanCampaign = c.scans[0].campaignId;
      const laterUnscanned = c.letters.some(
        (l) => l.campaignId !== scanCampaign && Date.parse(l.createdAt) > Date.parse(c.scans[0].at) && l.scans === 0
      );
      if (laterUnscanned || now - last >= 30 * DAY) groups.push("once");
    }
    const level = levelFromTimes(c.scans.map((x) => x.at), now);
    return {
      ...c,
      lettersReceived: c.letters.length,
      lettersScanned: scanned,
      totalScans: c.scans.length,
      lastScannedAt: c.scans.length ? c.scans[c.scans.length - 1].at : null,
      level,
      groups,
    };
  });
  const time = (t) => (t ? new Date(t).getTime() : 0);
  list.sort((a, b) => b.totalScans - a.totalScans || time(b.lastScannedAt) - time(a.lastScannedAt) || a.name.localeCompare(b.name));

  res.json({
    contacts: list,
    peopleTotal: countRows[0].people,
    peopleWithContact: countRows[0].with_contact,
  });
});
