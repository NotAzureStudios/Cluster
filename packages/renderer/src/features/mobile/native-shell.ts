import "./native-shell.css";
// Inside the Cluster mobile app the server's web app runs in a native
// WebView. The connect screen opens it with ?shell=mobile&shellOrigin=…;
// remember that for the session so phone navigation and "Switch server" work.
const KEY = "cluster.native-shell";

function readShell(): { origin: string } | null {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("shell") === "mobile") {
      const origin = params.get("shellOrigin") || "";
      localStorage.setItem(KEY, JSON.stringify({ origin }));
      params.delete("shell"); params.delete("shellOrigin");
      const query = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
    const stored = JSON.parse(localStorage.getItem(KEY) || "null");
    return stored && typeof stored.origin === "string" ? stored : null;
  } catch { return null; }
}

export const nativeShell = typeof window === "undefined" ? null : readShell();
if (nativeShell) document.documentElement.dataset.nativeShell = "mobile";

/** Back to the app's connect screen to pick another server. */
export function switchServer() {
  if (!nativeShell?.origin) return;
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  window.location.href = `${nativeShell.origin}/?change=1`;
}
