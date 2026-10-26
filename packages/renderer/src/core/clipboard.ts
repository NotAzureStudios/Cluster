export async function copyClusterText(text: string) {
  const value = String(text || "");
  if (!value) return false;
  try {
    if (typeof window !== "undefined" && window.clusterDesktop?.writeClipboardText) {
      if (await window.clusterDesktop.writeClipboardText(value)) return true;
      // The native bridge can explicitly return false; try the web path instead.
    }
  } catch {
    // Native clipboard delivery is best-effort; the browser clipboard remains a safe fallback.
  }
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
