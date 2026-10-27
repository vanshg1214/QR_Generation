# Analytics improvement plan

Goal: scan analytics as clear and useful as OnePageCRM's email tracking. See who scanned, when,
who is new, who came back after months, how long people take to scan, and who scans every letter
we send.

Status (27 Oct 2026): **Phases 1–3 built**, on the local branch `feat/analytics` (not live yet).
**Phase 4 not built**: it needs outside accounts (an email/WhatsApp sending service, and a
OnePageCRM API key).

What changed from the plan while building:
- "Hot" = 3+ scans, or 2+ scans with one in the last 7 days. (The plan said "or any scan in
  the last 7 days", which made everyone in a new campaign Hot.)
- Activity and Contacts are their own pages (top menu, and a bottom tab bar on phones); each
  campaign also has an Activity tab.
- The "since your last visit" highlight is remembered per browser.
- Server errors no longer stop the whole server, and a QR scan always opens its link even if
  saving the scan fails.

---

## Where we are today

Every scan is already saved with its exact time, the person and the link (`scans` table:
`code_id`, `scanned_at`, `user_agent`, `ip_hash`; `codes` links each QR to a person and a link).
So most of what's below needs **no new data**, only a better presentation.

What the campaign page shows now:
- People, Viewed (%), Total scans and Links totals
- "Viewed vs Not Viewed" pie, "Link Distribution", "Most Interested People", "Time of Day"
- Each person's scan times, but only after clicking their row open in the People tab

What's missing:
- Nothing shows what's new since yesterday, or who came back after a long gap
- No way to see how long after sending people scan (we don't know when letters were sent)
- No way to recognise the same person across campaigns (each campaign is a separate Excel
  upload, and names alone repeat: one real sheet had 28 repeated names)

---

## Phase 1: show the data we already have

Needs no change to how the Excel is prepared.

### 1. Live activity feed ("Scan activity")
- One feed per campaign, plus one across all campaigns on the home screen.
- Newest first: "Rajesh Kumar scanned *Cheque-Gifting* (L-1), 10 min ago".
- Badges on each row:
  - **NEW**: the person's first scan ever
  - **CAME BACK**: they scanned again after a long gap, e.g. "after 3 months" (gap of 30+ days,
    adjustable)
  - **REPEAT**: their 3rd or later scan
- Rows you haven't seen since your last visit are highlighted, with an unread count.

### 2. Scan-history tooltip
- Hover (or tap on a phone) any name to see every scan, newest first, in Indian time:
  "Today 10:42 am · Yesterday 6:05 pm · 24 Oct 9:10 am".
- Works in the activity feed, the People table and the leaderboards.

### 3. Today vs yesterday
- Stat cards show change: "12 scans · +5 today", "Viewed 8 · +2 today".
- A scans-per-day chart for the campaign (last 30 days, or since it was sent).

### 4. Interest levels
- **Hot**: 3+ scans, or a scan in the last 7 days
- **Warm**: 1–2 scans
- **Not yet**: no scans
- Filter the People list by level, and by "scanned more than once".
- Include the level in the Excel export.

### 5. Cleaner counts
- Ignore link previews (WhatsApp, Telegram and other apps open links by themselves to build a
  preview) by checking the `user_agent`. The current 10-second duplicate window stays.
- Count distinct devices per QR (from `ip_hash` + `user_agent`). "Scanned from 3 phones" usually
  means the letter was forwarded or shared.
- Show all times in Indian Standard Time.

---

## Phase 2: a "Sent on" date per campaign

Needs one new field: when the letters were posted or delivered. Today we only know when the
campaign was created in the portal. It can be set when creating the campaign and edited later
in Settings.

### 6. Time to first scan
- "Most people scan between day 2 and day 4 after sending"
- Average and median wait, and how quickly scans tail off after the first week

### 7. Funnel per campaign
- Sent → Scanned → Scanned twice or more → Scanned within the first 7 days
- Compare campaigns side by side (e.g. which graphic or which list got scanned more)

### 8. Best day and time
- Weekday × hour chart, so we know when letters get the most attention

---

## Phase 3: recognise people across campaigns

Needs a **phone or email column** in the Excel (names alone can't be trusted). Start adding one
to new sheets now, so past campaigns can be linked when this is built.

### 9. Contacts page
- One profile per person, showing every letter they received and every scan across all
  campaigns, as a timeline.

### 10. Loyalty lists
- "Scans every poster you send"
- "Scanned once, never again"
- "Never scans"
- Top scanners across all campaigns

---

## Phase 4: alerts and CRM

### 11. Alerts
- Email or WhatsApp alert when a Hot person scans, or someone comes back after a long gap.
- Optional morning summary: yesterday's scans, new scanners and returners.

### 12. OnePageCRM sync
- Each scan is added as a note on the matching OnePageCRM contact, or sets a follow-up action,
  so the sales team sees it where they already work. Contacts are matched by phone or email
  (from Phase 3).

---

## Recommended order

1. **Phase 1 + the "Sent on" field.** Gives the activity feed, tooltips and NEW / CAME BACK
   badges, and starts recording what Phase 2 needs.
2. **Phase 2:** time-to-scan, funnel, best day/time.
3. **Phase 3:** once sheets include a phone or email column.
4. **Phase 4:** alerts and OnePageCRM.

---

## Technical notes (for when we build it)

- **Badges** come straight from `scans.scanned_at` per person: NEW = the person's earliest scan;
  CAME BACK = gap to their previous scan ≥ threshold; REPEAT = 3rd+ scan. No new tables.
- **Activity feed:** one query over `scans` joined to `codes` → `people` → `campaign_links` →
  `campaigns`, ordered by `scanned_at DESC`, paged. A per-viewer "last seen" time can live in
  `settings` (single admin) or a small table once there are several users.
- **Bot filtering:** keep a list of preview user agents (WhatsApp, facebookexternalhit,
  TelegramBot, Slackbot, Twitterbot, LinkedInBot, Googlebot, etc.). Mark those scans
  (`scans.is_bot BOOLEAN`) rather than deleting them, so they can be excluded from counts and
  shown separately if needed.
- **Devices:** count `DISTINCT (ip_hash, user_agent)` per code.
- **Sent on:** `ALTER TABLE campaigns ADD COLUMN sent_at DATE`; time-to-first-scan =
  first `scanned_at` − `sent_at`, per person.
- **Cross-campaign identity:** a `contacts` table keyed by a normalised phone/email, and
  `people.contact_id` filled in on upload (and back-filled for old campaigns from `details_json`
  where a phone/email column exists).
- **Indexes:** `scans(scanned_at)` for the feed, and the existing `scans(code_id)`.
- **Time zone:** store UTC (as now), show in Asia/Kolkata.
- Keep the numbers consistent: the stat cards, charts, feed and Excel export must all read from
  the same queries, so they never disagree.
