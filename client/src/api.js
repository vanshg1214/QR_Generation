// Automatically use the Vite proxy during local development,
// and point to the Render backend in production. No env vars required in Vercel!
export const API_BASE = import.meta.env.DEV ? "" : "https://qr-generation-ag74.onrender.com";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    credentials: "include",
    headers: options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data.error) message = data.error;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(message);
  }
  return res;
}

export const api = {
  getSession: () => request("/session").then((r) => r.json()),
  login: (password) =>
    request("/login", { method: "POST", body: JSON.stringify({ password }) }).then((r) => r.json()),
  logout: () => request("/logout", { method: "POST" }).then((r) => r.json()),

  getCampaigns: () => request("/campaigns").then((r) => r.json()),
  getCampaign: (id) => request(`/campaigns/${id}`).then((r) => r.json()),
  updateCampaign: (id, fields) =>
    request(`/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(fields) }).then((r) => r.json()),
  updateLink: (campaignId, linkId, fields) =>
    request(`/campaigns/${campaignId}/links/${linkId}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    }).then((r) => r.json()),

  deleteCampaign: (id) =>
    request(`/campaigns/${id}`, { method: "DELETE" }).then((r) => r.json()),

  // The zip plus the counts the server checked it against.
  downloadQrZip: (id) => request(`/campaigns/${id}/download-qr.zip`).then(zipResult),

  // What an Excel file contains (rows, people, skipped rows, repeated names), before upload.
  checkSheet(file) {
    const formData = new FormData();
    formData.append("file", file);
    return request("/sheet-check", { method: "POST", body: formData }).then((r) => r.json());
  },

  // One real letter page (PDF) for `personName`, made by the same code as "All Letters.pdf",
  // plus the server's timings, used to estimate how long the whole campaign will take.
  async previewLetter({ personName, ...settings }) {
    const formData = letterForm(settings);
    formData.append("personName", personName);
    const started = performance.now();
    const res = await request("/preview-letter", { method: "POST", body: formData });
    const blob = await res.blob();
    const ms = (name) => Number(res.headers.get(name)) || 0;
    return {
      blob,
      clientMs: performance.now() - started,
      setupMs: ms("X-Setup-Ms"),
      firstPageMs: ms("X-First-Page-Ms"),
      perPageMs: ms("X-Per-Page-Ms"),
    };
  },

  async createCampaign({ campaignName, file, ...settings }) {
    const formData = letterForm(settings);
    formData.append("campaignName", campaignName);
    formData.append("file", file);
    const res = await fetch(`${API_BASE}/api/upload`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    if (!res.ok) {
      let message = "Upload failed";
      try {
        const data = await res.json();
        if (data.error) message = data.error;
      } catch {
        // ignore
      }
      throw new Error(message);
    }
    return zipResult(res);
  },
};

// The letter settings, as the server's /upload and /preview-letter read them.
function letterForm({ links, graphic, boxes, signatureName, signatureTitle, includeGreeting, greetingPos, padding, qrCaption, textStyles }) {
  const formData = new FormData();
  formData.append("links", JSON.stringify(links));
  if (graphic) formData.append("graphic", graphic);
  if (boxes) formData.append("boxes", JSON.stringify(boxes));
  if (signatureName) formData.append("signatureName", signatureName);
  if (signatureTitle) formData.append("signatureTitle", signatureTitle);
  if (textStyles) formData.append("textStyles", JSON.stringify(textStyles));
  if (includeGreeting !== undefined) formData.append("includeGreeting", includeGreeting.toString());
  if (greetingPos) formData.append("greetingPos", JSON.stringify(greetingPos));
  formData.append("padding", padding ? "true" : "false");
  if (qrCaption) formData.append("qrCaption", JSON.stringify(qrCaption));
  return formData;
}

async function zipResult(res) {
  const count = (name) => {
    const v = res.headers.get(name);
    return v == null ? null : Number(v);
  };
  return {
    blob: await res.blob(),
    campaignId: count("X-Campaign-Id"),
    peopleCount: count("X-People-Count"),
    letterPages: count("X-Letter-Pages"),
  };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking straight away can cancel the download in Safari/Firefox; give it time to start.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
