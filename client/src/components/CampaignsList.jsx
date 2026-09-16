import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import CreateCampaignPanel from "./CreateCampaignPanel.jsx";

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export default function CampaignsList({ onSelectCampaign }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    setLoading(true);
    api
      .getCampaigns()
      .then((data) => {
        setCampaigns(data.campaigns);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>QR Code Tracker</h1>
      </header>

      <CreateCampaignPanel onCreated={refresh} />

      <section className="card">
        <div className="table-header">
          <h2>Campaigns ({campaigns.length})</h2>
          <button className="secondary" onClick={refresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>People</th>
                <th>Viewed</th>
                <th>Total Scans</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="clickable-row" onClick={() => onSelectCampaign(c.id)}>
                  <td>{c.name}</td>
                  <td>{c.peopleCount}</td>
                  <td>{c.viewedCount}</td>
                  <td>{c.totalScans}</td>
                  <td>{formatDate(c.createdAt)}</td>
                </tr>
              ))}
              {campaigns.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="muted">
                    No campaigns yet — create one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
