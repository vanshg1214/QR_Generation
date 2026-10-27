import { Fragment, useMemo, useState, useEffect } from "react";
import { interestLevel } from "../../../server/src/analytics.js";
import ScanHistory, { personScans } from "./ScanHistory.jsx";
import { InterestBadge } from "./CampaignCharts.jsx";
import { scanTime } from "../lib/time.js";

const formatDate = (value) => (value ? scanTime(value) : "—");

const FILTERS = [
  { key: "all", label: "Everyone" },
  { key: "hot", label: "Hot" },
  { key: "warm", label: "Warm" },
  { key: "none", label: "Not yet scanned" },
  { key: "repeat", label: "Scanned 2+ times" },
  { key: "shared", label: "Shared (2+ phones)" },
];

const LEVEL_ORDER = { hot: 0, warm: 1, none: 2 };

export default function PeopleTable({ people, initialSearch = "", initialExpandedId = null, initialFilter = "all" }) {
  const [search, setSearch] = useState(initialSearch);
  const [filter, setFilter] = useState(initialFilter);
  const levels = useMemo(() => {
    const now = Date.now();
    return new Map(people.map((p) => [p.id, interestLevel(p, now)]));
  }, [people]);
  const filterCounts = useMemo(() => {
    const c = { all: people.length, hot: 0, warm: 0, none: 0, repeat: 0, shared: 0 };
    for (const p of people) {
      c[levels.get(p.id)]++;
      if (p.scanCount >= 2) c.repeat++;
      if (p.devices >= 2) c.shared++;
    }
    return c;
  }, [people, levels]);
  // Campaigns that know each person's Excel row list them in sheet order by default.
  const hasRows = people.some((p) => p.sheetRow != null);
  const [sortKey, setSortKey] = useState(hasRows ? "sheetRow" : "name");
  const [sortDir, setSortDir] = useState("asc");
  const [expandedId, setExpandedId] = useState(initialExpandedId);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Reset to page 1 whenever filters, sort, or page size change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, filter, sortKey, sortDir, pageSize]);

  const extraColumns = useMemo(() => {
    const keys = new Set();
    for (const person of people) {
      for (const key of Object.keys(person.details)) {
        const trimmed = key.trim().toLowerCase();
        // "__EMPTY", "__EMPTY_1", etc. are SheetJS's auto-generated name for a
        // column whose header cell was blank in the original spreadsheet.
        if (trimmed !== "name" && !/^__empty/.test(trimmed)) keys.add(key);
      }
    }
    return Array.from(keys);
  }, [people]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let rows = people;
    if (filter === "repeat") rows = rows.filter((p) => p.scanCount >= 2);
    else if (filter === "shared") rows = rows.filter((p) => p.devices >= 2);
    else if (filter !== "all") rows = rows.filter((p) => levels.get(p.id) === filter);
    if (term) {
      rows = rows.filter((p) => {
        const haystack = [p.name, ...Object.values(p.details)].join(" ").toLowerCase();
        return haystack.includes(term);
      });
    }

    const sorted = [...rows].sort((a, b) => {
      const valueOf = (row) => {
        if (sortKey === "name") return row.name.toLowerCase();
        if (sortKey === "sheetRow") return row.sheetRow ?? 0;
        if (sortKey === "scanCount") return row.scanCount;
        if (sortKey === "interest") return LEVEL_ORDER[levels.get(row.id)];
        if (sortKey === "devices") return row.devices || 0;
        if (sortKey === "lastScannedAt") return row.lastScannedAt || "";
        return (row.details[sortKey] || "").toString().toLowerCase();
      };
      const av = valueOf(a);
      const bv = valueOf(b);
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [people, search, filter, levels, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const paginatedPeople = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;

  const columnCount = extraColumns.length + 7 + (hasRows ? 1 : 0);
  const arrow = (key) => (sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "");

  return (
    <section className="card">
      <div className="table-header">
        <h2>
          People ({filtered.length === people.length ? people.length : `${filtered.length} of ${people.length}`})
        </h2>
        <input
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="filter-chips" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`filter-chip${filter === f.key ? " is-active" : ""}`}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label} <span>{filterCounts[f.key]}</span>
          </button>
        ))}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th></th>
              {hasRows && (
                <th onClick={() => toggleSort("sheetRow")} className="sortable" title="Row number in the uploaded Excel">
                  Excel row{arrow("sheetRow")}
                </th>
              )}
              <th onClick={() => toggleSort("name")} className="sortable">Name{arrow("name")}</th>
              {extraColumns.map((col) => (
                <th key={col} onClick={() => toggleSort(col)} className="sortable">
                  {col}
                  {arrow(col)}
                </th>
              ))}
              <th>Viewed</th>
              <th onClick={() => toggleSort("interest")} className="sortable">Interest{arrow("interest")}</th>
              <th onClick={() => toggleSort("scanCount")} className="sortable">Scans{arrow("scanCount")}</th>
              <th onClick={() => toggleSort("devices")} className="sortable" title="Different phones that scanned this person's QR codes">
                Phones{arrow("devices")}
              </th>
              <th onClick={() => toggleSort("lastScannedAt")} className="sortable">Last scanned{arrow("lastScannedAt")}</th>
            </tr>
          </thead>
          <tbody>
            {paginatedPeople.map((p) => {
              const isExpanded = expandedId === p.id;
              return (
                <Fragment key={p.id}>
                  <tr
                    className="clickable-row"
                    onClick={() => setExpandedId(isExpanded ? null : p.id)}
                  >
                    <td className="expand-toggle">{isExpanded ? "▾" : "▸"}</td>
                    {hasRows && <td className="muted">{p.sheetRow ?? "—"}</td>}
                    <td>
                      <ScanHistory scans={personScans(p)} total={p.scanCount}>
                        <span className="person-name">{p.name}</span>
                      </ScanHistory>
                    </td>
                    {extraColumns.map((col) => (
                      <td key={col}>{p.details[col] ?? ""}</td>
                    ))}
                    <td>
                      <span className={p.viewed ? "badge badge-yes" : "badge badge-no"}>
                        {p.viewed ? "Yes" : "No"}
                      </span>
                    </td>
                    <td>
                      <InterestBadge level={levels.get(p.id)} />
                    </td>
                    <td>{p.scanCount}</td>
                    <td title={p.devices >= 2 ? "Scanned from more than one phone: the letter was probably forwarded" : undefined}>
                      {p.devices || "—"}
                      {p.devices >= 2 && <span className="shared-mark"> shared</span>}
                    </td>
                    <td>{formatDate(p.lastScannedAt)}</td>
                  </tr>
                  {isExpanded && (
                    <tr className="scan-history-row">
                      <td></td>
                      <td colSpan={columnCount - 1}>
                        <div className="link-breakdown">
                          <strong>Per-link breakdown for {p.name}:</strong>
                          {p.links.map((link) => (
                            <div className="link-breakdown-item" key={link.linkId}>
                              <div>
                                <strong>{link.label}</strong> — {link.scanCount} scan
                                {link.scanCount === 1 ? "" : "s"}
                                {link.lastScannedAt ? ` — last: ${formatDate(link.lastScannedAt)}` : ""}
                              </div>
                              {link.scans.length > 0 && (
                                <ul>
                                  {[...link.scans].reverse().map((scannedAt, idx) => (
                                    <li key={idx}>{formatDate(scannedAt)}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="muted">
                  {people.length ? `No one matches "${search}".` : "No people in this campaign."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="table-header" style={{ borderTop: "1px solid var(--border)", marginTop: "1rem", paddingTop: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="muted" style={{ fontSize: "0.85rem" }}>Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            style={{
              padding: "4px 8px",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: "#fff",
              fontSize: "0.85rem",
              cursor: "pointer"
            }}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
        
        {filtered.length > pageSize && (
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              type="button"
              className="secondary"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
            >
              Previous
            </button>
            <span className="muted">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              className="secondary"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
