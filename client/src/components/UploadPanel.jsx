import { useRef, useState } from "react";
import { api, downloadBlob } from "../api.js";

export default function UploadPanel({ onUploaded }) {
  const fileInput = useRef(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleUpload(e) {
    e.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setStatus("Choose an Excel file first.");
      return;
    }
    setBusy(true);
    setStatus("Processing… generating a QR code per person.");
    try {
      const blob = await api.uploadSheet(file);
      downloadBlob(blob, "qr-codes.zip");
      setStatus("Done — QR codes downloaded as qr-codes.zip.");
      fileInput.current.value = "";
      onUploaded?.();
    } catch (err) {
      setStatus(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Upload People List</h2>
      <p className="muted">
        Upload an Excel (.xlsx) file with a "Name" column (and any other detail columns you like).
        Each row becomes a person with a unique, trackable QR code. All QR codes download as a zip.
      </p>
      <form className="inline-form" onSubmit={handleUpload}>
        <input type="file" accept=".xlsx,.xls,.csv" ref={fileInput} />
        <button type="submit" disabled={busy}>
          {busy ? "Working…" : "Upload & Generate QR Codes"}
        </button>
      </form>
      {status && <p className="muted">{status}</p>}
    </section>
  );
}
