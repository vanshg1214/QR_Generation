// If the zip fails before any bytes were sent the client gets a clear JSON error; if it
// fails mid-stream the connection is destroyed so the browser reports a failed download
// rather than saving a half-written file that Windows then calls "invalid".
export function failZip(res, archive, err) {
  console.error("Zip generation failed:", err);
  archive.abort();
  if (!res.headersSent) {
    res.status(500).json({ error: "Could not generate the download. Please try again." });
  } else {
    res.destroy(err);
  }
}
