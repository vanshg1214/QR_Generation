import { useEffect, useRef, useState } from "react";
import CampaignsList from "./components/CampaignsList.jsx";
import CampaignDetail from "./components/CampaignDetail.jsx";
import NewCampaignWizard from "./components/NewCampaignWizard.jsx";
import Logo from "./components/Logo.jsx";
import { IconPlus } from "./components/icons.jsx";
import { Link, navigate, useRoute } from "./router.jsx";

// Screens (each has its own address, so Back works everywhere):
//   #/                         all campaigns
//   #/new/<step>               new campaign: details, people, design, review
//   #/campaigns/<id>[/<tab>]   one campaign: overview, people, links, settings
//
// TEMPORARY: login screen bypassed for testing (matches server DISABLE_AUTH=true).
export default function App() {
  const { path, parts } = useRoute();
  const onNew = parts[0] === "new";
  const campaignId = parts[0] === "campaigns" && Number(parts[1]) ? Number(parts[1]) : null;
  const screen = onNew ? "new" : campaignId ? "campaign" : "home";

  // The new-campaign form stays alive while you visit other screens (e.g. Back by mistake),
  // so nothing typed or uploaded is lost until it's created or discarded.
  const [draftKey, setDraftKey] = useState(null);
  useEffect(() => {
    if (onNew && draftKey === null) setDraftKey(Date.now());
  }, [onNew, draftKey]);

  // New screens open at the top.
  const lastScreen = useRef(`${screen}:${campaignId}`);
  useEffect(() => {
    const key = `${screen}:${campaignId}:${screen === "new" ? parts[1] : ""}`;
    if (key !== lastScreen.current) window.scrollTo(0, 0);
    lastScreen.current = key;
  }, [screen, campaignId, parts]);

  // Unknown addresses go home.
  useEffect(() => {
    if (screen === "home" && path !== "/") navigate("/", { replace: true });
  }, [screen, path]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="topbar-home" aria-label="All campaigns">
            <Logo size="md" tone="light" />
          </Link>
          <nav className="topbar-nav">
            <Link to="/" className={screen === "home" || screen === "campaign" ? "is-active" : ""}>
              Campaigns
            </Link>
            <Link to="/new" className={`topbar-new${screen === "new" ? " is-active" : ""}`}>
              <IconPlus width={15} height={15} />
              <span>{draftKey && !onNew ? "Continue draft" : "New campaign"}</span>
            </Link>
          </nav>
        </div>
      </header>

      <main className="dashboard">
        {screen === "home" && (
          <CampaignsList
            hasDraft={draftKey !== null}
            onDiscardDraft={() => setDraftKey(null)}
          />
        )}
        {screen === "campaign" && <CampaignDetail key={campaignId} campaignId={campaignId} tab={parts[2]} />}
        {draftKey !== null && (
          <div hidden={!onNew}>
            <NewCampaignWizard
              key={draftKey}
              step={onNew ? parts[1] : null}
              active={onNew}
              onFinished={() => setDraftKey(null)}
              onDiscard={() => {
                setDraftKey(null);
                navigate("/", { replace: true });
              }}
            />
          </div>
        )}
        <p className="footer-note">LINK-2-QR — bulk QR campaigns &amp; scan tracking</p>
      </main>
    </div>
  );
}
