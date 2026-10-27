import { useCallback, useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { api, API_BASE } from "../api.js";
import { goBack, navigate } from "../router.jsx";
import { downloadCampaignZip } from "../lib/downloads.js";
import PeopleTable from "./PeopleTable.jsx";
import CampaignCharts from "./CampaignCharts.jsx";
import { Stat } from "./CampaignsList.jsx";
import { IconUsers, IconLink, IconEye, IconScan, IconArrowLeft, IconTrash, IconDownload } from "./icons.jsx";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "people", label: "People" },
  { key: "links", label: "Links" },
  { key: "settings", label: "Settings" },
];

function LinkEditRow({ campaignId, link, onSaved }) {
  const [labelDraft, setLabelDraft] = useState(link.label);
  const [urlDraft, setUrlDraft] = useState(link.destinationUrl);
  const [saving, setSaving] = useState(false);
  const changed = labelDraft !== link.label || urlDraft !== link.destinationUrl;

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateLink(campaignId, link.id, { label: labelDraft, destinationUrl: urlDraft });
      toast.success("Link saved. Printed QR codes now open the new address.");
      onSaved?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="link-detail-row" onSubmit={handleSave}>
      <input type="text" className="link-detail-label" value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} required aria-label="Link name" />
      <input type="url" value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} required aria-label="Destination address" />
      <button type="submit" disabled={saving || !changed}>
        {saving ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

// What the uploaded Excel contained, so the numbers can be checked against the sheet.
function SheetCheckCard({ campaign, summary }) {
  const sheet = campaign.sheet;
  const letters = campaign.hasLetters ? summary.totalPeople : 0;
  if (!sheet) {
    return (
      <section className="card">
        <span className="eyebrow">Excel check</span>
        <h2>{summary.totalPeople} people</h2>
        <p className="muted">
          {campaign.hasLetters
            ? `"All Letters.pdf" has ${letters} pages: one per person. `
            : ""}
          This campaign was created before row-by-row Excel checks were added, so the skipped-row details aren't
          available.
        </p>
      </section>
    );
  }
  return (
    <section className="card">
      <span className="eyebrow">Excel check</span>
      <div className="sheet-equation">
        <div>
          <strong>{sheet.dataRows}</strong>
          <span>rows in the Excel</span>
        </div>
        <span className="sheet-equation-op">=</span>
        <div className="is-good">
          <strong>{summary.totalPeople}</strong>
          <span>people{campaign.hasLetters ? ` · ${letters} letter pages` : ""}</span>
        </div>
        <span className="sheet-equation-op">+</span>
        <div className={sheet.skipped.length ? "is-warn" : ""}>
          <strong>{sheet.skipped.length}</strong>
          <span>rows skipped</span>
        </div>
      </div>
      <p className="muted small">Names were read from the "{sheet.nameColumn}" column.</p>
      {sheet.skipped.length > 0 && <SkippedRows skipped={sheet.skipped} />}
    </section>
  );
}

export function SkippedRows({ skipped }) {
  return (
    <details className="sheet-details">
      <summary>
        {skipped.length} {skipped.length === 1 ? "row was" : "rows were"} skipped (no name). See which ones.
      </summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Excel row</th>
              <th>Why</th>
              <th>What the row contains</th>
            </tr>
          </thead>
          <tbody>
            {skipped.map((s) => (
              <tr key={s.row}>
                <td>{s.row}</td>
                <td>{s.reason}</td>
                <td className="muted">{s.values.join(" · ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default function CampaignDetail({ campaignId, tab }) {
  const activeTab = TABS.some((t) => t.key === tab) ? tab : "overview";
  const [campaign, setCampaign] = useState(null);
  const [links, setLinks] = useState([]);
  const [people, setPeople] = useState([]);
  const [summary, setSummary] = useState({ totalPeople: 0, totalLinks: 0, totalViewed: 0, totalScans: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [targetPerson, setTargetPerson] = useState(null);

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
        setLoadError("");
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [campaignId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Tabs replace the address instead of adding to history, so Back leaves the campaign.
  const openTab = (key) => navigate(`/campaigns/${campaignId}${key === "overview" ? "" : `/${key}`}`, { replace: true });

  async function handleSaveName(e) {
    e.preventDefault();
    setSavingName(true);
    try {
      await api.updateCampaign(campaignId, { name: nameDraft });
      toast.success("Campaign title saved.");
      refresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingName(false);
    }
  }

  async function handleDelete() {
    if (
      !window.confirm(
        `Delete campaign "${campaign?.name}"? This permanently removes its ${summary.totalPeople} people, their QR codes and all scan data. Printed QR codes will stop being tracked. This cannot be undone.`
      )
    )
      return;
    const toastId = toast.loading("Deleting campaign…");
    try {
      await api.deleteCampaign(campaignId);
      toast.success("Campaign deleted.", { id: toastId });
      goBack("/");
    } catch (err) {
      toast.error(err.message, { id: toastId });
    }
  }

  if (!campaign) {
    return (
      <div className="page-center-inline">
        {loading ? (
          <p className="muted">Loading campaign…</p>
        ) : (
          <div className="empty-state">
            <strong>{loadError || "Campaign not found"}</strong>
            <button className="secondary" onClick={() => goBack("/")}>
              Back to campaigns
            </button>
          </div>
        )}
      </div>
    );
  }

  const viewRate = summary.totalPeople ? Math.round((summary.totalViewed / summary.totalPeople) * 100) : 0;

  return (
    <>
      <div className="page-header">
        <div className="page-header-main">
          <button className="icon-button back-button" onClick={() => goBack("/")} aria-label="Back" title="Back">
            <IconArrowLeft />
          </button>
          <div>
            <span className="eyebrow">Campaign · created {new Date(campaign.createdAt).toLocaleDateString()}</span>
            <h1 className="page-title">{campaign.name}</h1>
          </div>
        </div>
        <div className="button-row">
          <button onClick={() => downloadCampaignZip({ id: campaignId, name: campaign.name, peopleCount: summary.totalPeople })}>
            <IconDownload width={15} height={15} />
            Download zip
          </button>
          <a className="button-link secondary-link" href={`${API_BASE}/api/campaigns/${campaignId}/export.xlsx`}>
            Export Excel report
          </a>
        </div>
      </div>

      <div className="stats-row">
        <Stat icon={<IconUsers />} value={summary.totalPeople} label="People (letters)" />
        <Stat icon={<IconEye />} value={summary.totalViewed} label={`Viewed · ${viewRate}%`} />
        <Stat icon={<IconScan />} value={summary.totalScans} label="Total scans" />
        <Stat icon={<IconLink />} value={summary.totalLinks} label="Links" />
      </div>

      <div className="campaign-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            className={`tab-button ${activeTab === t.key ? "active" : ""}`}
            onClick={() => {
              if (t.key === "people") setTargetPerson(null);
              openTab(t.key);
            }}
          >
            {t.label}
          </button>
        ))}
        <button className="secondary tab-refresh" onClick={refresh} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {activeTab === "overview" && (
        <>
          <SheetCheckCard campaign={campaign} summary={summary} />
          <CampaignCharts
            people={people}
            summary={summary}
            links={links}
            onPersonClick={(p) => {
              setTargetPerson(p);
              openTab("people");
            }}
          />
        </>
      )}

      {activeTab === "people" && (
        <PeopleTable
          key={targetPerson?.id ?? "all"}
          people={people}
          initialSearch={targetPerson ? targetPerson.name : ""}
          initialExpandedId={targetPerson ? targetPerson.id : null}
        />
      )}

      {activeTab === "links" && (
        <section className="card">
          <h2>Links ({links.length})</h2>
          <p className="muted">
            Changing a link's address here takes effect straight away for every QR code already printed. Nothing needs to
            be regenerated or reprinted.
          </p>
          {links.map((link) => (
            <LinkEditRow key={link.id} campaignId={campaignId} link={link} onSaved={refresh} />
          ))}
        </section>
      )}

      {activeTab === "settings" && (
        <>
          <section className="card">
            <h2>Campaign title</h2>
            <form className="inline-form" onSubmit={handleSaveName}>
              <input type="text" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} required />
              <button type="submit" disabled={savingName || nameDraft.trim() === campaign.name}>
                {savingName ? "Saving…" : "Save"}
              </button>
            </form>
          </section>
          <section className="card danger-card">
            <span className="eyebrow">Danger zone</span>
            <h2>Delete campaign</h2>
            <p className="muted">
              Permanently removes all people, QR codes and scan history for this campaign. Printed QR codes will stop being
              tracked. This cannot be undone.
            </p>
            <button className="danger-button" onClick={handleDelete}>
              <IconTrash width={15} height={15} />
              Delete this campaign
            </button>
          </section>
        </>
      )}
    </>
  );
}
