import { useEffect, useState } from "react";
import { api } from "./api.js";
import Login from "./components/Login.jsx";
import Dashboard from "./components/Dashboard.jsx";

export default function App() {
  const [authenticated, setAuthenticated] = useState(null); // null = loading

  useEffect(() => {
    api
      .getSession()
      .then((data) => setAuthenticated(data.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) {
    return <div className="page-center">Loading…</div>;
  }

  if (!authenticated) {
    return <Login onLoggedIn={() => setAuthenticated(true)} />;
  }

  return <Dashboard onLoggedOut={() => setAuthenticated(false)} />;
}
