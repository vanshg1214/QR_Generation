import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import Logo from "./Logo.jsx";
import CreateCampaignPanel from "./CreateCampaignPanel.jsx";
import { IconUsers, IconEye, IconScan, IconPlus, IconLayers, IconInbox } from "./icons.jsx";

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
  const [showCreate, setShowCreate] = useState(false);

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

  const totals = useMemo(
    () =>
      campaigns.reduce(
        (acc, c) => ({
          people: acc.people + c.peopleCount,
          links: acc.links + c.linkCount,
          viewed: acc.viewed + c.viewedCount,
          scans: acc.scans + c.totalScans,
        }),
        { people: 0, links: 0, viewed: 0, scans: 0 }
      ),
    [campaigns]
  );

  function handleCreated() {
    setShowCreate(false);
    refresh();
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <Logo size="lg" />
          <span className="topbar-tagline">Bulk QR campaigns &amp; scan tracking</span>
        </div>
      </div>

      <div className="dashboard">
        <div className="hero">
          <span className="eyebrow">Platform Overview</span>
          <h2 className="hero-title">Every campaign, every scan, in one place</h2>
          <p className="hero-subtitle">
            Create a campaign, attach one or more trackable links, and generate a unique QR code
            per person. LINK-2-QR logs exactly who scanned, which link, and when.
          </p>
        </div>

        <div className="stats-row">
          <div className="stat">
            <span className="stat-icon"><IconLayers /></span>
            <div>
              <span className="stat-value">{campaigns.length}</span>
              <span className="stat-label">Campaigns</span>
            </div>
          </div>
          <div className="stat">
            <span className="stat-icon"><IconUsers /></span>
            <div>
              <span className="stat-value">{totals.people}</span>
              <span className="stat-label">People</span>
            </div>
          </div>
          <div className="stat">
            <span className="stat-icon"><IconEye /></span>
            <div>
              <span className="stat-value">{totals.viewed}</span>
              <span className="stat-label">Viewed</span>
            </div>
          </div>
          <div className="stat">
            <span className="stat-icon"><IconScan /></span>
            <div>
              <span className="stat-value">{totals.scans}</span>
              <span className="stat-label">Total Scans</span>
            </div>
          </div>
        </div>

        {showCreate ? (
          <CreateCampaignPanel onCreated={handleCreated} onCancel={() => setShowCreate(false)} />
        ) : (
          <section className="card">
            <div className="section-header">
              <div>
                <span className="eyebrow">Get Started</span>
                <h2>Launch a new campaign</h2>
              </div>
              <button onClick={() => setShowCreate(true)}>
                <IconPlus style={{ marginRight: 6, verticalAlign: "-3px" }} />
                New Campaign
              </button>
            </div>
          </section>
        )}

        <section className="card">
          <div className="table-header">
            <h2>Campaigns ({campaigns.length})</h2>
            <button className="secondary" onClick={refresh} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {error && <p className="error-text">{error}</p>}
          {campaigns.length === 0 && !loading ? (
            <div className="empty-state">
              <span className="empty-state-icon"><IconInbox width={26} height={26} /></span>
              <strong>No campaigns yet</strong>
              <p className="muted">Create your first campaign above to generate trackable QR codes.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Links</th>
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
                      <td>{c.linkCount}</td>
                      <td>{c.peopleCount}</td>
                      <td>{c.viewedCount}</td>
                      <td>{c.totalScans}</td>
                      <td>{formatDate(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="footer-note">LINK-2-QR — bulk QR campaigns &amp; scan tracking</p>
      </div>
    </>
  );
}
