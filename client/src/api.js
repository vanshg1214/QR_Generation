// Use the Vite environment variable if available, otherwise default to empty string
// which will use the Vite proxy during local development.
export const API_BASE = import.meta.env.VITE_API_URL || "";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    credentials: "include",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
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

  downloadQrZip: (id) =>
    request(`/campaigns/${id}/download-qr.zip`).then((r) => r.blob()),

  async createCampaign({ campaignName, links, file }) {
    const formData = new FormData();
    formData.append("campaignName", campaignName);
    formData.append("links", JSON.stringify(links));
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
    return res.blob();
  },
};

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
