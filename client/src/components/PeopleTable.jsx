import { useMemo, useState } from "react";

function formatDate(value) {
  if (!value) return "—";
  // SQLite stores UTC "YYYY-MM-DD HH:MM:SS"; make it parseable and show local time.
  const iso = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export default function PeopleTable({ people }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");

  const extraColumns = useMemo(() => {
    const keys = new Set();
    for (const person of people) {
      for (const key of Object.keys(person.details)) {
        if (key.trim().toLowerCase() !== "name") keys.add(key);
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
            {filtered.map((p) => (
              <tr key={p.id}>
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
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={extraColumns.length + 4} className="muted">
                  No people yet — upload an Excel sheet above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
