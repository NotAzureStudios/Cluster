import type { ViewerResourceScope } from "./viewer-resource-scope";

const PDF_PRINT_MAX_LIFETIME_MS = 30_000;
const PDF_PRINT_POST_DIALOG_MS = 1_800;

/** A print iframe owns its blob URL, load handlers and timers for a bounded lifetime.
 * The viewer scope also disposes it when the user navigates to another file. */
export function openPdfPrintFrame(blob: Blob, scope: Pick<ViewerResourceScope, "registerCleanup">) {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  let released = false;
  let expiryTimer: number | null = null;
  let postPrintTimer: number | null = null;
  let unregister: () => void = () => undefined;
  const release = () => {
    if (released) return;
    released = true;
    frame.onload = null;
    frame.onerror = null;
    if (expiryTimer !== null) window.clearTimeout(expiryTimer);
    if (postPrintTimer !== null) window.clearTimeout(postPrintTimer);
    frame.remove();
    URL.revokeObjectURL(url);
    unregister();
  };
  try {
    unregister = scope.registerCleanup(release);
    if (released) return; // A closed viewer cannot attach another print frame.
    frame.className = "cluster-static-pdf-print-frame";
    frame.onload = () => {
      if (released) return;
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } finally {
        if (!released) postPrintTimer = window.setTimeout(release, PDF_PRINT_POST_DIALOG_MS);
      }
    };
    frame.onerror = release;
    frame.src = url;
    document.body.append(frame);
    expiryTimer = window.setTimeout(release, PDF_PRINT_MAX_LIFETIME_MS);
  } catch (error) {
    release();
    throw error;
  }
}
