// Individual per-person Letter.pdf files each carry their own copy of the campaign
// graphic (a standalone PDF can't share one with the others), so their combined size
// grows as graphic size x people. Past this budget they're left out of the zip and only
// "All Letters.pdf" (one shared copy of the graphic) is included, keeping big campaigns
// within the server's memory/time limits instead of producing a truncated, invalid zip.
const MAX_INDIVIDUAL_LETTERS_BYTES = 200 * 1024 * 1024;

export function shouldIncludeIndividualLetters(graphicBytes, peopleCount) {
  return graphicBytes * peopleCount <= MAX_INDIVIDUAL_LETTERS_BYTES;
}

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
