import { Fragment, useMemo, useState } from "react";

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export default function PeopleTable({ people }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [expandedId, setExpandedId] = useState(null);

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
    if (term) {
      rows = people.filter((p) => {
        const haystack = [p.name, ...Object.values(p.details)].join(" ").toLowerCase();
        return haystack.includes(term);
      });
    }

    const sorted = [...rows].sort((a, b) => {
      const valueOf = (row) => {
        if (sortKey === "name") return row.name.toLowerCase();
        if (sortKey === "scanCount") return row.scanCount;
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
  }, [people, search, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const columnCount = extraColumns.length + 5;

  return (
    <section className="card">
      <div className="table-header">
        <h2>People ({filtered.length})</h2>
        <input
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th></th>
              <th onClick={() => toggleSort("name")} className="sortable">Name</th>
              {extraColumns.map((col) => (
                <th key={col} onClick={() => toggleSort(col)} className="sortable">
                  {col}
                </th>
              ))}
              <th>Viewed</th>
              <th onClick={() => toggleSort("scanCount")} className="sortable">Scan Count</th>
              <th onClick={() => toggleSort("lastScannedAt")} className="sortable">Last Scanned</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const isExpanded = expandedId === p.id;
              return (
                <Fragment key={p.id}>
                  <tr
                    className="clickable-row"
                    onClick={() => setExpandedId(isExpanded ? null : p.id)}
                  >
                    <td className="expand-toggle">{isExpanded ? "▾" : "▸"}</td>
                    <td>{p.name}</td>
                    {extraColumns.map((col) => (
                      <td key={col}>{p.details[col] ?? ""}</td>
                    ))}
                    <td>
                      <span className={p.viewed ? "badge badge-yes" : "badge badge-no"}>
                        {p.viewed ? "Yes" : "No"}
                      </span>
                    </td>
                    <td>{p.scanCount}</td>
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
                  No people yet — create a campaign above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
