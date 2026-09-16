// Hardcoded fallback so this works even if the VITE_API_BASE_URL build-time env var
// never gets applied on Vercel. Override via that env var if the API's URL changes.
export const API_BASE = import.meta.env.VITE_API_BASE_URL || "https://qr-generation-ag74.onrender.com";

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

  getPeople: () => request("/people").then((r) => r.json()),

  getSettings: () => request("/settings").then((r) => r.json()),
  saveSettings: (destinationUrl) =>
    request("/settings", { method: "POST", body: JSON.stringify({ destinationUrl }) }).then((r) => r.json()),

  async uploadSheet(file) {
    const formData = new FormData();
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
