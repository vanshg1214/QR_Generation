import { useEffect, useRef, useState } from "react";
import CampaignsList from "./components/CampaignsList.jsx";
import CampaignDetail from "./components/CampaignDetail.jsx";
import NewCampaignWizard from "./components/NewCampaignWizard.jsx";
import ActivityFeed from "./components/ActivityFeed.jsx";
import ContactsPage from "./components/ContactsPage.jsx";
import Logo from "./components/Logo.jsx";
import { IconPlus } from "./components/icons.jsx";
import { Link, navigate, useRoute } from "./router.jsx";

// Screens (each has its own address, so Back works everywhere):
//   #/                         all campaigns
//   #/new/<step>               new campaign: details, people, design, review
//   #/campaigns/<id>[/<tab>]   one campaign: overview, activity, people, links, settings
//   #/activity                 every scan, newest first, across all campaigns
//   #/contacts                 people recognised across campaigns
//
// TEMPORARY: login screen bypassed for testing (matches server DISABLE_AUTH=true).
export default function App() {
  const { path, parts } = useRoute();
  const onNew = parts[0] === "new";
  const campaignId = parts[0] === "campaigns" && Number(parts[1]) ? Number(parts[1]) : null;
  const screen = onNew
    ? "new"
    : campaignId
    ? "campaign"
    : parts[0] === "activity"
    ? "activity"
    : parts[0] === "contacts"
    ? "contacts"
    : "home";

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
            <Link to="/activity" className={screen === "activity" ? "is-active" : ""}>
              Activity
            </Link>
            <Link to="/contacts" className={screen === "contacts" ? "is-active" : ""}>
              Contacts
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
        {screen === "activity" && (
          <>
            <div className="page-header">
              <div>
                <span className="eyebrow">Across all campaigns</span>
                <h1 className="page-title">Scan activity</h1>
                <p className="page-subtitle">
                  Every scan as it happens. NEW is someone's first scan ever; CAME BACK is someone returning after a month or
                  more. Hover a name to see all their scans.
                </p>
              </div>
            </div>
            <ActivityFeed title="All scans" />
          </>
        )}
        {screen === "contacts" && <ContactsPage />}
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

      {/* Phones: the main screens as a tab bar along the bottom. */}
      <nav className="bottom-nav" aria-label="Main">
        <Link to="/" className={screen === "home" || screen === "campaign" ? "is-active" : ""}>
          Campaigns
        </Link>
        <Link to="/activity" className={screen === "activity" ? "is-active" : ""}>
          Activity
        </Link>
        <Link to="/contacts" className={screen === "contacts" ? "is-active" : ""}>
          Contacts
        </Link>
      </nav>
    </div>
  );
}
