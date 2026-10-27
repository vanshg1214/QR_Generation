import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { api } from "../api.js";
import { Link, navigate } from "../router.jsx";
import { downloadCampaignZip } from "../lib/downloads.js";
import { IconUsers, IconEye, IconScan, IconPlus, IconLayers, IconInbox, IconTrash, IconDownload } from "./icons.jsx";

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const percent = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

export default function CampaignsList({ hasDraft, onDiscardDraft }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

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
          viewed: acc.viewed + c.viewedCount,
          scans: acc.scans + c.totalScans,
        }),
        { people: 0, viewed: 0, scans: 0 }
      ),
    [campaigns]
  );

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? campaigns.filter((c) => c.name.toLowerCase().includes(term)) : campaigns;
  }, [campaigns, search]);

  async function handleDelete(e, campaign) {
    e.stopPropagation();
    if (
      !window.confirm(
        `Delete campaign "${campaign.name}"? This permanently removes its ${campaign.peopleCount} people, their QR codes and all scan data. Printed QR codes will stop being tracked. This cannot be undone.`
      )
    )
      return;
    const toastId = toast.loading(`Deleting "${campaign.name}"…`);
    try {
      await api.deleteCampaign(campaign.id);
      toast.success(`"${campaign.name}" deleted.`, { id: toastId });
      refresh();
    } catch (err) {
      toast.error(err.message, { id: toastId });
    }
  }

  function handleDownload(e, campaign) {
    e.stopPropagation();
    downloadCampaignZip(campaign);
  }

  const open = (c) => navigate(`/campaigns/${c.id}`);

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">Dashboard</span>
          <h1 className="page-title">Campaigns</h1>
          <p className="page-subtitle">Every campaign, every letter and every scan in one place.</p>
        </div>
        <Link to="/new" className="button-link">
          <IconPlus width={16} height={16} />
          {hasDraft ? "Continue draft" : "New campaign"}
        </Link>
      </div>

      {hasDraft && (
        <div className="notice notice-info">
          <span>You have a campaign you haven't finished creating.</span>
          <div className="button-row">
            <Link to="/new" className="button-link small-button">
              Continue
            </Link>
            <button
              type="button"
              className="secondary small-button"
              onClick={() => window.confirm("Discard the unfinished campaign?") && onDiscardDraft()}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="stats-row">
        <Stat icon={<IconLayers />} value={campaigns.length} label="Campaigns" />
        <Stat icon={<IconUsers />} value={totals.people} label="People (letters)" />
        <Stat icon={<IconEye />} value={totals.viewed} label={`Viewed · ${percent(totals.viewed, totals.people)}`} />
        <Stat icon={<IconScan />} value={totals.scans} label="Total scans" />
      </div>

      <section className="card">
        <div className="table-header">
          <h2>All campaigns ({campaigns.length})</h2>
          <div className="button-row">
            {campaigns.length > 5 && (
              <input type="search" placeholder="Search campaigns…" value={search} onChange={(e) => setSearch(e.target.value)} />
            )}
            <button className="secondary" onClick={refresh} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
        {loading && !campaigns.length ? (
          <p className="muted">Loading campaigns…</p>
        ) : campaigns.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon">
              <IconInbox width={26} height={26} />
            </span>
            <strong>No campaigns yet</strong>
            <p className="muted">Create your first campaign to generate personalised letters with trackable QR codes.</p>
            <Link to="/new" className="button-link">
              <IconPlus width={16} height={16} /> New campaign
            </Link>
          </div>
        ) : (
          <div className="campaign-list">
            <div className="campaign-list-head" aria-hidden="true">
              <span>Campaign</span>
              <span>People</span>
              <span>Viewed</span>
              <span>Scans</span>
              <span>Links</span>
              <span>Created</span>
              <span />
            </div>
            {shown.map((c) => (
              <div
                key={c.id}
                className="campaign-row"
                role="link"
                tabIndex={0}
                onClick={() => open(c)}
                onKeyDown={(e) => e.key === "Enter" && open(c)}
              >
                <span className="campaign-row-name">{c.name}</span>
                <span data-label="People">{c.peopleCount}</span>
                <span data-label="Viewed">
                  {c.viewedCount} <small className="muted">({percent(c.viewedCount, c.peopleCount)})</small>
                </span>
                <span data-label="Scans">{c.totalScans}</span>
                <span data-label="Links">{c.linkCount}</span>
                <span data-label="Created">{formatDate(c.createdAt)}</span>
                <span className="row-actions">
                  <button className="icon-action-btn" title="Download the zip again" aria-label="Download zip" onClick={(e) => handleDownload(e, c)}>
                    <IconDownload width={15} height={15} />
                  </button>
                  <button className="icon-action-btn danger" title="Delete campaign" aria-label="Delete campaign" onClick={(e) => handleDelete(e, c)}>
                    <IconTrash width={15} height={15} />
                  </button>
                </span>
              </div>
            ))}
            {shown.length === 0 && <p className="muted">No campaign matches "{search}".</p>}
          </div>
        )}
      </section>
    </>
  );
}

export function Stat({ icon, value, label }) {
  return (
    <div className="stat">
      <span className="stat-icon">{icon}</span>
      <div>
        <span className="stat-value">{value}</span>
        <span className="stat-label">{label}</span>
      </div>
    </div>
  );
}
