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

export function sanitizeFilename(name) {
  return String(name).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "item";
}

// Gives every name in one folder its own file/folder name, adding "_2", "_3"... to repeats.
// Compared ignoring case, because Windows and macOS treat "RAHUL" and "Rahul" as the same
// folder and would merge them on unzip. Also skips a suffix that's already taken (e.g. a
// real person named "Rahul Sharma 2").
export function uniqueNamer() {
  const used = new Set();
  return (rawName) => {
    const base = sanitizeFilename(rawName);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}_${n}`;
    used.add(name.toLowerCase());
    return name;
  };
}

// Last check before a zip is sent: one PDF page and one folder per person, one QR image
// per person per link. Throws (so the user gets an error, not a wrong file) if not.
export function verifyZipContents({ book, people, links, qrFiles, personFolders }) {
  const problems = [];
  if (book && book.pdfDoc.getPageCount() !== people) {
    problems.push(`the PDF has ${book.pdfDoc.getPageCount()} pages for ${people} people`);
  }
  if (new Set(personFolders.map((f) => f.toLowerCase())).size !== people) {
    problems.push(`${personFolders.length} folders for ${people} people`);
  }
  if (qrFiles.length !== people * links) {
    problems.push(`${qrFiles.length} QR images for ${people} people x ${links} links`);
  }
  if (problems.length) throw new Error(`Download check failed: ${problems.join("; ")}`);
}
