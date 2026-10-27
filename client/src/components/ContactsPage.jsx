import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { Link } from "../router.jsx";
import ScanHistory from "./ScanHistory.jsx";
import { InterestBadge } from "./CampaignCharts.jsx";
import { fullDate, scanTime } from "../lib/time.js";

const GROUPS = [
  { key: "all", label: "Everyone", hint: "" },
  { key: "every_letter", label: "Scans every letter", hint: "Got 2+ letters and scanned every one" },
  { key: "top", label: "Top scanners", hint: "Most scans across all campaigns" },
  { key: "once", label: "Scanned once, never again", hint: "One scan, then nothing for 30+ days or on later letters" },
  { key: "never", label: "Never scans", hint: "Got letters but never scanned" },
];

// People recognised across campaigns by the phone or email column of the Excel: every letter
// they were sent and every scan, in one place.
export default function ContactsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [group, setGroup] = useState("all");
  const [search, setSearch] = useState("");
  const [openKey, setOpenKey] = useState(null);

  useEffect(() => {
    api.getContacts().then(setData).catch((err) => setError(err.message));
  }, []);

  const counts = useMemo(() => {
    const c = { all: 0, every_letter: 0, top: 0, once: 0, never: 0 };
    for (const x of data?.contacts || []) {
      c.all++;
      for (const g of x.groups) c[g]++;
      if (x.totalScans > 0) c.top++;
    }
    return c;
  }, [data]);

  const shown = useMemo(() => {
    let list = data?.contacts || [];
    if (group === "top") list = list.filter((c) => c.totalScans > 0);
    else if (group !== "all") list = list.filter((c) => c.groups.includes(group));
    const term = search.trim().toLowerCase();
    if (term) list = list.filter((c) => c.name.toLowerCase().includes(term) || c.contact.toLowerCase().includes(term));
    return list;
  }, [data, group, search]);

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Across all campaigns</span>
          <h1 className="page-title">Contacts</h1>
          <p className="page-subtitle">The same person in different campaigns, recognised by their phone number or email.</p>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}
      {!data && !error && <p className="muted">Loading contacts…</p>}

      {data && (
        <>
          {data.peopleWithContact < data.peopleTotal && (
            <div className="notice notice-info">
              <span>
                {data.peopleWithContact} of {data.peopleTotal} people have a phone or email in their Excel, so only they can be
                matched across campaigns. Add a "Mobile" or "Email" column to your sheets to include everyone.
              </span>
            </div>
          )}

          <section className="card">
            <div className="table-header">
              <h2>
                {shown.length} {shown.length === 1 ? "contact" : "contacts"}
              </h2>
              <input type="search" placeholder="Search name, phone or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="filter-chips" role="group" aria-label="Show">
              {GROUPS.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  title={g.hint}
                  className={`filter-chip${group === g.key ? " is-active" : ""}`}
                  aria-pressed={group === g.key}
                  onClick={() => setGroup(g.key)}
                >
                  {g.label} <span>{counts[g.key]}</span>
                </button>
              ))}
            </div>
            {GROUPS.find((g) => g.key === group)?.hint && <p className="muted small">{GROUPS.find((g) => g.key === group).hint}.</p>}

            {shown.length === 0 ? (
              <div className="empty-state" style={{ padding: "28px 12px" }}>
                <strong>{data.contacts.length ? "Nobody in this list yet" : "No contacts yet"}</strong>
                <p className="muted">
                  {data.contacts.length
                    ? "Try another list."
                    : "Contacts appear once a campaign's Excel has a phone or email column."}
                </p>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th>Name</th>
                      <th>Phone / email</th>
                      <th>Interest</th>
                      <th>Letters</th>
                      <th>Scans</th>
                      <th>Last scanned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((c) => {
                      const open = openKey === c.key;
                      const history = [...c.scans]
                        .reverse()
                        .slice(0, 12)
                        .map((s) => ({ at: s.at, campaign: c.letters.find((l) => l.campaignId === s.campaignId)?.campaignName, link: s.link }));
                      return (
                        <Fragment key={c.key}>
                          <tr className="clickable-row" onClick={() => setOpenKey(open ? null : c.key)}>
                            <td className="expand-toggle">{open ? "▾" : "▸"}</td>
                            <td>
                              <ScanHistory scans={history} total={c.totalScans} showCampaign>
                                <span className="person-name">{c.name}</span>
                              </ScanHistory>
                            </td>
                            <td className="muted">{c.contact}</td>
                            <td>
                              <InterestBadge level={c.level} />
                            </td>
                            <td>
                              {c.lettersScanned} of {c.lettersReceived} scanned
                            </td>
                            <td>{c.totalScans}</td>
                            <td>{c.lastScannedAt ? scanTime(c.lastScannedAt) : "—"}</td>
                          </tr>
                          {open && (
                            <tr className="scan-history-row">
                              <td></td>
                              <td colSpan={6}>
                                <ContactTimeline contact={c} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

// Every letter sent and every scan, oldest first.
function ContactTimeline({ contact }) {
  const events = [
    ...contact.letters.map((l) => ({
      at: l.sentAt ? `${l.sentAt}T12:00:00+05:30` : l.createdAt,
      kind: "letter",
      letter: l,
    })),
    ...contact.scans.map((s) => ({ at: s.at, kind: "scan", scan: s, campaign: contact.letters.find((l) => l.campaignId === s.campaignId) })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));
  return (
    <ol className="timeline">
      {events.map((e, i) =>
        e.kind === "letter" ? (
          <li key={i} className="timeline-letter">
            <span className="timeline-when">{fullDate(e.at)}</span>
            <span>
              Sent <Link to={`/campaigns/${e.letter.campaignId}`}>{e.letter.campaignName}</Link>
              {e.letter.scans ? ` · scanned ${e.letter.scans}×` : " · not scanned"}
            </span>
          </li>
        ) : (
          <li key={i} className="timeline-scan">
            <span className="timeline-when">{scanTime(e.at)}</span>
            <span>
              Scanned {e.campaign?.campaignName || "a letter"}
              {e.scan.link ? ` (${e.scan.link})` : ""}
            </span>
          </li>
        )
      )}
    </ol>
  );
}
