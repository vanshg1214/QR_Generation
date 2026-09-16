import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function SettingsPanel() {
  const [destinationUrl, setDestinationUrl] = useState("");
  const [publicBaseUrl, setPublicBaseUrl] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettings().then((data) => {
      setDestinationUrl(data.destinationUrl);
      setPublicBaseUrl(data.publicBaseUrl);
    });
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setStatus("");
    try {
      await api.saveSettings(destinationUrl);
      setStatus("Saved.");
    } catch (err) {
      setStatus(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card">
      <h2>Destination Link</h2>
      <p className="muted">
        Every QR code redirects here. Change it any time without regenerating codes.
      </p>
      <form className="inline-form" onSubmit={handleSave}>
        <input
          type="url"
          placeholder="https://your-content-link.com"
          value={destinationUrl}
          onChange={(e) => setDestinationUrl(e.target.value)}
          required
        />
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
      {status && <p className="muted">{status}</p>}
      {publicBaseUrl && (
        <p className="muted small">
          QR codes point to <code>{publicBaseUrl}/r/&lt;code&gt;</code>
        </p>
      )}
    </section>
  );
}
