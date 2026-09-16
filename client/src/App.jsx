import Dashboard from "./components/Dashboard.jsx";

// TEMPORARY: login screen bypassed for testing (matches server DISABLE_AUTH=true).
// To bring it back: restore the session-check + Login flow that used to live here.
export default function App() {
  return <Dashboard onLoggedOut={() => {}} />;
}
