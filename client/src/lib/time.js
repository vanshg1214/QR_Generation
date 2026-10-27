import { TIME_ZONE, addDays, istDayKey } from "../../../server/src/analytics.js";

// All times are shown in Indian Standard Time, whatever the viewer's computer is set to.
const clock = new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true });
const shortDate = new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, day: "numeric", month: "short" });
const longDate = new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, day: "numeric", month: "short", year: "numeric" });

const time = (t) => clock.format(new Date(t)).replace(/\s?([ap])\.?m\.?/i, (_, ap) => ` ${ap.toLowerCase()}m`);

// "Today 10:42 am", "Yesterday 6:05 pm", "24 Oct 9:10 am", "24 Oct 2025 9:10 am"
export function scanTime(t, now = Date.now()) {
  const day = istDayKey(t);
  const today = istDayKey(now);
  if (day === today) return `Today ${time(t)}`;
  if (day === addDays(today, -1)) return `Yesterday ${time(t)}`;
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return `${(sameYear ? shortDate : longDate).format(new Date(t))} ${time(t)}`;
}

// "just now", "5 min ago", "3 h ago", then the day.
export function ago(t, now = Date.now()) {
  const s = Math.max(0, (now - new Date(t).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 6 * 3600) return `${Math.floor(s / 3600)} h ago`;
  return scanTime(t, now);
}

export const dayLabel = (dayKey) => shortDate.format(new Date(`${dayKey}T12:00:00+05:30`));
export const fullDate = (t) => longDate.format(new Date(t));
