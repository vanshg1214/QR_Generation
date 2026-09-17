import { useCallback, useEffect, useState } from "react";
import { api, API_BASE } from "../api.js";
import PeopleTable from "./PeopleTable.jsx";

export default function CampaignDetail({ campaignId, onBack }) {
  const [campaign, setCampaign] = useState(null);
  const [people, setPeople] = useState([]);
  const [summary, setSummary] = useState({ totalPeople: 0, totalViewed: 0, totalScans: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [nameDraft, setNameDraft] = useState("");
  const [destinationDraft, setDestinationDraft] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    api
      .getCampaign(campaignId)
      .then((data) => {
        setCampaign(data.campaign);
        setPeople(data.people);
        setSummary(data.summary);
        setNameDraft(data.campaign.name);
        setDestinationDraft(data.campaign.destinationUrl);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [campaignId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setSaveStatus("");
    try {
      await api.updateCampaign(campaignId, { name: nameDraft, destinationUrl: destinationDraft });
      setSaveStatus("Saved.");
      refresh();
    } catch (err) {
      setSaveStatus(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading && !campaign) {
    return <div className="page-center">Loading…</div>;
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <button className="secondary back-button" onClick={onBack}>← All Campaigns</button>
          <h1>{campaign?.name}</h1>
        </div>
      </header>

      {error && <p className="error-text">{error}</p>}

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

      <section className="card">
        <h2>Campaign Settings</h2>
        <form className="stacked-form" onSubmit={handleSave}>
          <label className="field-label">
            Title
            <input type="text" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} required />
          </label>
          <label className="field-label">
            Destination Link
            <input
              type="url"
              value={destinationDraft}
              onChange={(e) => setDestinationDraft(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </form>
        {saveStatus && <p className="muted">{saveStatus}</p>}
      </section>

      <section className="card export-card">
        <h2>Export</h2>
        <div className="button-row">
          <a className="button-link" href={`${API_BASE}/api/campaigns/${campaignId}/export.xlsx`}>
            Export Excel (.xlsx)
          </a>
          <button className="secondary" onClick={refresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </section>

      <PeopleTable people={people} />
    </div>
  );
}
