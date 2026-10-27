// Scan analytics shared by the server (Excel export, activity feed) and the dashboard
// (charts, badges, tooltips), so every number is worked out the same way everywhere.
// All days and hours are in Indian Standard Time.

export const TIME_ZONE = "Asia/Kolkata";
export const CAME_BACK_DAYS = 30; // a scan after this long a gap is a "came back"
export const HOT_SCANS = 3; // this many scans makes someone Hot...
export const HOT_RECENT_DAYS = 7; // ...as do 2+ scans with one in this many days
const DAY_MS = 24 * 60 * 60 * 1000;

// Link-preview fetchers: apps that open a link by themselves to build a preview (e.g. when a
// QR link is pasted into WhatsApp). These are not people opening the letter.
export const BOT_USER_AGENT =
  /(whatsapp|facebookexternalhit|facebot|telegrambot|slackbot|twitterbot|linkedinbot|discordbot|skypeuripreview|googlebot|bingbot|applebot|embedly|pinterest|redditbot|vkshare|preview|crawler|spider|\bbot\b)/i;

export const isBotUserAgent = (ua) => Boolean(ua) && BOT_USER_AGENT.test(ua);

// ---- Indian time helpers -------------------------------------------------------------
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const partsFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short", hour: "numeric", hourCycle: "h23" });

// "2026-10-27" for the Indian calendar day of a moment.
export const istDayKey = (t) => dayKeyFmt.format(new Date(t));

export function istWeekdayHour(t) {
  const parts = Object.fromEntries(partsFmt.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return { weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday), hour: Number(parts.hour) % 24 };
}

// Whole days between two Indian calendar days ("2026-10-27" - "2026-10-25" = 2).
export const dayDiff = (laterKey, earlierKey) => Math.round((Date.parse(laterKey) - Date.parse(earlierKey)) / DAY_MS);

export function addDays(dayKey, n) {
  const d = new Date(Date.parse(dayKey) + n * DAY_MS);
  return d.toISOString().slice(0, 10);
}

// ---- Per person --------------------------------------------------------------------------
// person: { links: [{ label, scans: [ISO time, ...] }], ... }
export function personScanTimes(person) {
  return person.links.flatMap((l) => l.scans).sort();
}

// "hot" (3+ scans, or 2+ scans with one in the last 7 days), "warm" (scanned), or "none".
// times: scan times, oldest first.
export function levelFromTimes(times, now = Date.now()) {
  if (!times.length) return "none";
  const last = new Date(times[times.length - 1]).getTime();
  if (times.length >= HOT_SCANS || (times.length >= 2 && now - last <= HOT_RECENT_DAYS * DAY_MS)) return "hot";
  return "warm";
}

export const interestLevel = (person, now = Date.now()) => levelFromTimes(personScanTimes(person), now);

export const INTEREST_LABELS = { hot: "Hot", warm: "Warm", none: "Not yet" };

// The badge for a person's n-th scan (0-based), given the time of their previous scan.
export function scanBadge(index, at, previousAt) {
  if (index === 0) return { badge: "new" };
  if (previousAt) {
    const gapDays = Math.floor((Date.parse(at) - Date.parse(previousAt)) / DAY_MS);
    if (gapDays >= CAME_BACK_DAYS) return { badge: "came_back", gapDays };
  }
  if (index >= 2) return { badge: "repeat" };
  return { badge: null };
}

export function gapText(days) {
  if (days >= 60) return `after ${Math.round(days / 30)} months`;
  if (days >= 14) return `after ${Math.round(days / 7)} weeks`;
  return `after ${days} days`;
}

// ---- Campaign level ------------------------------------------------------------------------
// The day the letters went out: the "Sent on" date if set, otherwise the day it was created.
export const startDayKey = (campaign) => campaign.sentAt || istDayKey(campaign.createdAt);

export function scansPerDay(people, fromKey, toKey = istDayKey(Date.now())) {
  const counts = new Map();
  for (const p of people) for (const t of personScanTimes(p)) counts.set(istDayKey(t), (counts.get(istDayKey(t)) || 0) + 1);
  const days = [];
  // At most 120 days are drawn; a longer campaign shows its latest 120.
  let start = fromKey;
  if (dayDiff(toKey, start) > 119) start = addDays(toKey, -119);
  for (let k = start; dayDiff(toKey, k) >= 0; k = addDays(k, 1)) days.push({ day: k, scans: counts.get(k) || 0 });
  return days;
}

export function todayAndYesterday(people, now = Date.now()) {
  const today = istDayKey(now);
  const yesterday = addDays(today, -1);
  let scansToday = 0;
  let scansYesterday = 0;
  let newToday = 0; // people whose first scan was today
  for (const p of people) {
    const times = personScanTimes(p);
    for (const t of times) {
      const k = istDayKey(t);
      if (k === today) scansToday++;
      else if (k === yesterday) scansYesterday++;
    }
    if (times.length && istDayKey(times[0]) === today) newToday++;
  }
  return { scansToday, scansYesterday, newToday };
}

// How many days after sending people first scanned.
const DELAY_BUCKETS = [
  { label: "Same day", max: 0 },
  { label: "Day 1", max: 1 },
  { label: "Day 2", max: 2 },
  { label: "Day 3", max: 3 },
  { label: "Day 4", max: 4 },
  { label: "Days 5–7", max: 7 },
  { label: "Days 8–14", max: 14 },
  { label: "Days 15–30", max: 30 },
  { label: "30+ days", max: Infinity },
];

export function timeToFirstScan(people, sentKey) {
  const delays = [];
  for (const p of people) {
    const times = personScanTimes(p);
    if (!times.length) continue;
    delays.push(Math.max(0, dayDiff(istDayKey(times[0]), sentKey)));
  }
  delays.sort((a, b) => a - b);
  const buckets = DELAY_BUCKETS.map((b, i) => ({
    label: b.label,
    people: delays.filter((d) => d <= b.max && (i === 0 || d > DELAY_BUCKETS[i - 1].max)).length,
  }));
  const median = delays.length ? delays[Math.floor((delays.length - 1) / 2)] : null;
  const average = delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null;
  // The shortest run of days holding at least half of the first scans ("most people scan
  // between day 2 and day 4").
  let peak = null;
  if (delays.length >= 3) {
    const need = Math.ceil(delays.length / 2);
    for (let i = 0; i + need - 1 < delays.length; i++) {
      const span = delays[i + need - 1] - delays[i];
      if (!peak || span < peak.to - peak.from) peak = { from: delays[i], to: delays[i + need - 1] };
    }
  }
  return { buckets, median, average, peak, scanned: delays.length };
}

export function funnel(people, sentKey) {
  let scanned = 0;
  let twice = 0;
  let firstWeek = 0;
  for (const p of people) {
    const times = personScanTimes(p);
    if (!times.length) continue;
    scanned++;
    if (times.length >= 2) twice++;
    if (dayDiff(istDayKey(times[0]), sentKey) <= 6) firstWeek++;
  }
  return [
    { label: "Letters sent", value: people.length },
    { label: "Scanned", value: scanned },
    { label: "Scanned twice or more", value: twice },
    { label: "Scanned in the first week", value: firstWeek },
  ];
}

// scans[weekday 0=Mon..6=Sun][hour 0..23]
export function weekdayHourGrid(people) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const p of people) {
    for (const t of personScanTimes(p)) {
      const { weekday, hour } = istWeekdayHour(t);
      if (weekday >= 0) grid[weekday][hour]++;
    }
  }
  return grid;
}

export function interestCounts(people, now = Date.now()) {
  const counts = { hot: 0, warm: 0, none: 0 };
  for (const p of people) counts[interestLevel(p, now)]++;
  return counts;
}
