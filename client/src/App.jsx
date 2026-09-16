import { useState } from "react";
import CampaignsList from "./components/CampaignsList.jsx";
import CampaignDetail from "./components/CampaignDetail.jsx";

// TEMPORARY: login screen bypassed for testing (matches server DISABLE_AUTH=true).
export default function App() {
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);

  if (selectedCampaignId) {
    return (
      <CampaignDetail
        campaignId={selectedCampaignId}
        onBack={() => setSelectedCampaignId(null)}
      />
    );
  }

  return <CampaignsList onSelectCampaign={setSelectedCampaignId} />;
}
