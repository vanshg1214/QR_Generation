import { useEffect, useState } from "react";

// A tiny hash router: every screen has its own address (#/, #/new/people, #/campaigns/12),
// so the browser's and the phone's Back button step through the portal's screens instead
// of leaving the site. Hash addresses need no server or Vercel configuration.
//
// Each history entry the portal creates records its position (idx), so in-app "Back"
// buttons can tell whether there is a portal screen to go back to.

const ROUTE_EVENT = "portal:route";

function currentPath() {
  const path = window.location.hash.replace(/^#/, "");
  return path.startsWith("/") ? path : "/";
}

export function historyIndex() {
  return window.history.state?.idx ?? 0;
}

export function navigate(path, { replace = false } = {}) {
  if (path === currentPath() && !replace) return;
  const idx = replace ? historyIndex() : historyIndex() + 1;
  window.history[replace ? "replaceState" : "pushState"]({ idx }, "", `#${path}`);
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

// Back to the previous portal screen, like the phone's Back button; if this is the first
// screen opened in the tab, go to `fallback` instead of leaving the site.
export function goBack(fallback = "/") {
  if (historyIndex() > 0) window.history.back();
  else navigate(fallback, { replace: true });
}

// Moves back through history to entry `idx` (e.g. where a multi-step flow started), then
// resolves; used so finishing the flow doesn't leave its steps behind in Back history.
export function goBackTo(idx) {
  const steps = idx - historyIndex();
  if (steps >= 0) return Promise.resolve();
  return new Promise((resolve) => {
    window.addEventListener("popstate", () => resolve(), { once: true });
    window.history.go(steps);
  });
}

export function useRoute() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener("popstate", onChange);
    window.addEventListener("hashchange", onChange);
    window.addEventListener(ROUTE_EVENT, onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener(ROUTE_EVENT, onChange);
    };
  }, []);
  return { path, parts: path.split("/").filter(Boolean) };
}

// A link to another portal screen. Goes through navigate() so the history entry gets its
// position; ctrl/cmd-click still opens it in a new tab.
export function Link({ to, replace, onClick, ...props }) {
  return (
    <a
      href={`#${to}`}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        navigate(to, { replace });
      }}
      {...props}
    />
  );
}
