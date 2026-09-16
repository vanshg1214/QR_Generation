import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import SettingsPanel from "./SettingsPanel.jsx";
import UploadPanel from "./UploadPanel.jsx";
import PeopleTable from "./PeopleTable.jsx";

export default function Dashboard({ onLoggedOut }) {
  const [people, setPeople] = useState([]);
  const [summary, setSummary] = useState({ totalPeople: 0, totalViewed: 0, totalScans: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    setLoading(true);
    api
      .getPeople()
      .then((data) => {
        setPeople(data.people);
        setSummary(data.summary);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleLogout() {
    await api.logout();
    onLoggedOut();
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>QR Code Tracker</h1>
        <button className="secondary" onClick={handleLogout}>Log out</button>
      </header>

      <div className="stats-row">
        <div className="stat">
          <span className="stat-value">{summary.totalPeople}</span>
          <span className="stat-label">People</span>
        </div>
        <div className="stat">
          <span className="stat-value">{summary.totalViewed}</span>
          <span className="stat-label">Viewed</span>
        </div>
        <div className="stat">
          <span className="stat-value">{summary.totalScans}</span>
          <span className="stat-label">Total Scans</span>
        </div>
      </div>

      <div className="panel-grid">
        <UploadPanel onUploaded={refresh} />
        <SettingsPanel />
      </div>

      <section className="card export-card">
        <h2>Export</h2>
        <div className="button-row">
          <a className="button-link" href="/api/export.xlsx">Export Excel (.xlsx)</a>
          <a className="button-link" href="/api/export.csv">Export CSV</a>
          <button className="secondary" onClick={refresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </section>

      {error && <p className="error-text">{error}</p>}

      <PeopleTable people={people} />
    </div>
  );
}
