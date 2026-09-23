import { useState } from "react";
import { toast } from "react-hot-toast";
import { api } from "../api.js";
import Logo from "./Logo.jsx";

export default function Login({ onLoggedIn }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.login(password);
      toast.success("Successfully signed in!");
      onLoggedIn();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-center">
      <form className="card login-card" onSubmit={handleSubmit}>
        <Logo size="md" />
        <p className="muted">Enter the admin password to continue.</p>
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
