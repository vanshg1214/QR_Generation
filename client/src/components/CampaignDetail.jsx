import { useCallback, useEffect, useState } from "react";
import { api, API_BASE } from "../api.js";
import PeopleTable from "./PeopleTable.jsx";
import Logo from "./Logo.jsx";
import { IconUsers, IconLink, IconEye, IconScan } from "./icons.jsx";

function LinkEditRow({ campaignId, link, onSaved }) {
  const [labelDraft, setLabelDraft] = useState(link.label);
  const [urlDraft, setUrlDraft] = useState(link.destinationUrl);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setStatus("");
    try {
      await api.updateLink(campaignId, link.id, { label: labelDraft, destinationUrl: urlDraft });
      setStatus("Saved.");
      onSaved?.();
    } catch (err) {
      setStatus(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="link-detail-row" onSubmit={handleSave}>
      <input
        type="text"
        className="link-detail-label"
        value={labelDraft}
        onChange={(e) => setLabelDraft(e.target.value)}
        required
      />
      <input
        type="url"
        value={urlDraft}
        onChange={(e) => setUrlDraft(e.target.value)}
        required
      />
      <button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
      {status && <span className="muted small">{status}</span>}
    </form>
  );
}

export default function CampaignDetail({ campaignId, onBack }) {
  const [campaign, setCampaign] = useState(null);
  const [links, setLinks] = useState([]);
  const [people, setPeople] = useState([]);
  const [summary, setSummary] = useState({ totalPeople: 0, totalLinks: 0, totalViewed: 0, totalScans: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [nameDraft, setNameDraft] = useState("");
  const [nameSaveStatus, setNameSaveStatus] = useState("");
  const [savingName, setSavingName] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    api
      .getCampaign(campaignId)
      .then((data) => {
        setCampaign(data.campaign);
        setLinks(data.links);
        setPeople(data.people);
        setSummary(data.summary);
        setNameDraft(data.campaign.name);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [campaignId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleSaveName(e) {
    e.preventDefault();
    setSavingName(true);
    setNameSaveStatus("");
    try {
      await api.updateCampaign(campaignId, { name: nameDraft });
      setNameSaveStatus("Saved.");
      refresh();
    } catch (err) {
      setNameSaveStatus(err.message);
    } finally {
      setSavingName(false);
    }
  }

  if (loading && !campaign) {
    return <div className="page-center">Loading…</div>;
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="topbar-heading">
            <button className="secondary back-button" onClick={onBack}>← All Campaigns</button>
            <Logo size="md" tone="light" />
          </div>
          <span className="topbar-tagline">{campaign?.name}</span>
        </div>
      </div>

      <div className="dashboard">
        <div className="hero">
          <span className="eyebrow">Campaign</span>
          <h2 className="hero-title">{campaign?.name}</h2>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="stats-row">
          <div className="stat">
            <span className="stat-icon"><IconUsers /></span>
            <div>
              <span className="stat-value">{summary.totalPeople}</span>
              <span className="stat-label">People</span>
            </div>
          </div>
          <div className="stat">
            <span className="stat-icon"><IconLink /></span>
            <div>
              <span className="stat-value">{summary.totalLinks}</span>
              <span className="stat-label">Links</span>
            </div>
          </div>
          <div className="stat">
            <span className="stat-icon"><IconEye /></span>
            <div>
              <span className="stat-value">{summary.totalViewed}</span>
              <span className="stat-label">Viewed</span>
            </div>
          </div>
          <div className="stat">
            <span className="stat-icon"><IconScan /></span>
            <div>
              <span className="stat-value">{summary.totalScans}</span>
              <span className="stat-label">Total Scans</span>
            </div>
          </div>
        </div>

        <section className="card">
          <span className="eyebrow">Settings</span>
          <h2>Campaign Title</h2>
          <form className="inline-form" onSubmit={handleSaveName}>
            <input type="text" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} required />
            <button type="submit" disabled={savingName}>
              {savingName ? "Saving…" : "Save"}
            </button>
          </form>
          {nameSaveStatus && <p className="muted">{nameSaveStatus}</p>}
        </section>

        <section className="card">
          <span className="eyebrow">Destinations</span>
          <h2>Links ({links.length})</h2>
          <p className="muted">
            Every already-generated QR code for a link keeps working when you change that link's
            destination here — no regenerating or reprinting needed.
          </p>
          {links.map((link) => (
            <LinkEditRow key={link.id} campaignId={campaignId} link={link} onSaved={refresh} />
          ))}
        </section>

        <section className="card export-card">
          <span className="eyebrow">Data</span>
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

        <p className="footer-note">LINK-2-QR — bulk QR campaigns &amp; scan tracking</p>
      </div>
    </>
  );
}
