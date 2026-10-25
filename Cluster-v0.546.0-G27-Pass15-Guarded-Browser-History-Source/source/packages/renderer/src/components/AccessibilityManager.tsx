import { useEffect } from "react";
import { readAccessibilitySystemPreferences } from "../core/accessibility-preferences";
import { CLUSTER_MODAL_SELECTOR, topVisibleClusterDialog, trapFocusInTopClusterDialog, visibleFocusable } from "../core/dialog-focus";

const modalCandidateSelector = [
  ".modal-backdrop > .modal",
  ".modal-backdrop > .modal-card",
  ".modal-backdrop > section",
  "[class*='backdrop'] > section",
  "[class*='backdrop'] > .modal",
  "[class*='backdrop'] > .modal-card",
].join(",");

let generatedId = 0;

function nextGeneratedId(prefix: string) {
  generatedId += 1;
  return `${prefix}-${generatedId}`;
}

function textLabel(element: Element | null) {
  return element?.textContent?.replace(/\s+/g, " ").trim() || "";
}

function isControlLabelled(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  if (control.getAttribute("aria-label")?.trim() || control.getAttribute("aria-labelledby")?.trim()) return true;
  if (control.closest("label")) return true;
  if (control.labels?.length) return true;
  return false;
}

function inferControlLabel(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  let parent: HTMLElement | null = control.parentElement;
  for (let depth = 0; parent && depth < 3; depth += 1, parent = parent.parentElement) {
    const candidates = Array.from(parent.children).filter((child): child is HTMLLabelElement => child instanceof HTMLLabelElement && !child.contains(control));
    const label = candidates.map(textLabel).find(Boolean);
    if (label) return label;
    if (parent.matches(".field, .form-field, .settings-field")) {
      const heading = parent.querySelector<HTMLElement>(".field-label, strong, h3, h4");
      const headingLabel = textLabel(heading);
      if (headingLabel) return headingLabel;
    }
  }
  const placeholder = control.getAttribute("placeholder")?.trim();
  if (placeholder) return placeholder;
  if (control.getAttribute("name")?.trim()) return control.getAttribute("name")!.replace(/[-_]+/g, " ");
  return "";
}

function ensureMainLandmark() {
  const existing = document.getElementById("cluster-main-content");
  const main = existing instanceof HTMLElement ? existing : document.querySelector<HTMLElement>("main");
  if (!main) return;
  if (!main.id) main.id = "cluster-main-content";
  if (!main.hasAttribute("tabindex")) main.tabIndex = -1;
}

function normalizeAccessibility(root: ParentNode = document) {
  ensureMainLandmark();

  const dialogs = root instanceof HTMLElement && root.matches(modalCandidateSelector)
    ? [root, ...root.querySelectorAll<HTMLElement>(modalCandidateSelector)]
    : Array.from(root.querySelectorAll<HTMLElement>(modalCandidateSelector));
  dialogs.forEach((dialog) => {
    if (!dialog.hasAttribute("role")) dialog.setAttribute("role", "dialog");
    if (["dialog", "alertdialog"].includes(dialog.getAttribute("role") || "") && dialog.getAttribute("aria-modal") !== "true") dialog.setAttribute("aria-modal", "true");
    if (!dialog.hasAttribute("tabindex")) dialog.tabIndex = -1;
    if (!dialog.hasAttribute("aria-label") && !dialog.hasAttribute("aria-labelledby")) {
      const heading = dialog.querySelector<HTMLElement>("h1, h2, h3");
      if (heading?.textContent?.trim()) {
        if (!heading.id) heading.id = nextGeneratedId("cluster-dialog-title");
        dialog.setAttribute("aria-labelledby", heading.id);
      }
    }
  });

  const statusSelector = ".status-box, .system-status-box-v053, [data-a11y-status='true']";
  const statuses = root instanceof HTMLElement && root.matches(statusSelector)
    ? [root, ...root.querySelectorAll<HTMLElement>(statusSelector)]
    : Array.from(root.querySelectorAll<HTMLElement>(statusSelector));
  statuses.forEach((status) => {
    if (!status.hasAttribute("role")) status.setAttribute("role", "status");
    if (!status.hasAttribute("aria-live")) status.setAttribute("aria-live", "polite");
    if (!status.hasAttribute("aria-atomic")) status.setAttribute("aria-atomic", "true");
  });

  const alertSelector = ".error-box, [class*='warning-box']";
  const alerts = root instanceof HTMLElement && root.matches(alertSelector)
    ? [root, ...root.querySelectorAll<HTMLElement>(alertSelector)]
    : Array.from(root.querySelectorAll<HTMLElement>(alertSelector));
  alerts.forEach((error) => {
    if (!error.hasAttribute("role")) error.setAttribute("role", "alert");
    if (!error.hasAttribute("aria-live")) error.setAttribute("aria-live", "assertive");
    if (!error.hasAttribute("aria-atomic")) error.setAttribute("aria-atomic", "true");
  });

  root.querySelectorAll<HTMLButtonElement>("button[title]:not([aria-label]):not([aria-labelledby])").forEach((button) => {
    const text = textLabel(button);
    if (!text || /^[^\p{L}\p{N}]+$/u.test(text)) button.setAttribute("aria-label", button.title);
  });
  root.querySelectorAll<HTMLButtonElement>("button:not([aria-label]):not([aria-labelledby])").forEach((button) => {
    const text = textLabel(button);
    if (["×", "✕", "✖", "✗"].includes(text)) button.setAttribute("aria-label", "Close");
  });

  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not([type='hidden']), textarea, select").forEach((control) => {
    if (isControlLabelled(control)) return;
    const label = inferControlLabel(control);
    if (label) control.setAttribute("aria-label", label);
  });

  root.querySelectorAll<HTMLElement>("nav button").forEach((button) => {
    const currentEligible = button.classList.contains("active") && !button.hasAttribute("aria-selected") && !button.hasAttribute("aria-pressed");
    if (currentEligible) button.setAttribute("aria-current", "page");
    else if (button.getAttribute("aria-current") === "page") button.removeAttribute("aria-current");
  });
}

type IsolationRecord = { element: HTMLElement; hadInert: boolean; ariaHidden: string | null };

function isolateModal(dialog: HTMLElement) {
  // Keep newly mounted background content inert while a dialog is already open.
  // A one-time sibling scan misses toasts, lazy-loaded panes and delayed portals.
  const records = new Map<HTMLElement, IsolationRecord>();
  function sync() {
    let node: HTMLElement = dialog;
    while (node.parentElement && node.parentElement !== document.documentElement) {
      const parent = node.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (!(sibling instanceof HTMLElement) || sibling === node || sibling.contains(dialog)) continue;
        // Floating layers have their own reversible isolation and modal ownership.
        if (sibling.dataset.clusterFloating === "true") continue;
        // Pointer-only backdrop is the dismissal hit area for this drawer, not
        // background content. It is aria-hidden and excluded from Tab order.
        if (dialog.id && sibling.dataset.clusterBackdropFor === dialog.id) continue;
        if (records.has(sibling)) continue;
        records.set(sibling, { element: sibling, hadInert: sibling.hasAttribute("inert"), ariaHidden: sibling.getAttribute("aria-hidden") });
        sibling.setAttribute("inert", "");
        sibling.setAttribute("aria-hidden", "true");
      }
      if (parent === document.body) break;
      node = parent;
    }
  }
  sync();
  return {
    sync,
    dispose() {
      for (const { element, hadInert, ariaHidden } of records.values()) {
        if (!element.isConnected) continue;
        if (!hadInert) element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      records.clear();
    },
  };
}

/** The background floating stack is not guaranteed to exist when a modal opens.
 * Keep it isolated as layers mount/unmount or ownership changes. This also
 * prevents the old 1800 z-index floating layer from covering a later dialog. */
function createFloatingLayerIsolation() {
  const suspended = new Map<HTMLElement, { hadInert: boolean; ariaHidden: string | null }>();
  function restore(surface: HTMLElement, original: { hadInert: boolean; ariaHidden: string | null }) {
    surface.removeAttribute("data-cluster-modal-suspended");
    if (!original.hadInert) surface.removeAttribute("inert");
    if (original.ariaHidden === null) surface.removeAttribute("aria-hidden");
    else surface.setAttribute("aria-hidden", original.ariaHidden);
  }
  return {
    sync(dialog: HTMLElement | null) {
      const surfaces = Array.from(document.querySelectorAll<HTMLElement>("[data-cluster-floating='true']"));
      const current = new Set(surfaces);
      for (const surface of surfaces) {
        const blocked = Boolean(dialog && surface.dataset.clusterModalOwner !== dialog.id);
        const original = suspended.get(surface);
        if (!blocked && original) {
          restore(surface, original);
          suspended.delete(surface);
        } else if (blocked && !original) {
          suspended.set(surface, { hadInert: surface.hasAttribute("inert"), ariaHidden: surface.getAttribute("aria-hidden") });
          surface.setAttribute("data-cluster-modal-suspended", "true");
          surface.setAttribute("inert", "");
          surface.setAttribute("aria-hidden", "true");
        }
      }
      for (const [surface, original] of suspended) {
        if (current.has(surface)) continue;
        restore(surface, original);
        suspended.delete(surface);
      }
    },
    dispose() {
      for (const [surface, original] of suspended) restore(surface, original);
      suspended.clear();
    },
  };
}

function syncSystemAccessibilityPreferences() {
  const root = document.documentElement;
  const system = readAccessibilitySystemPreferences();
  if (root.dataset.motionPreference === "system") root.dataset.motion = system.reducedMotion ? "reduced" : "full";
  if (root.dataset.contrastPreference === "system") root.dataset.highContrast = system.highContrast ? "true" : "false";
  if (root.dataset.transparencyPreference === "system") {
    root.dataset.transparency = system.reducedTransparency ? "off" : "full";
    root.dataset.reduceTransparency = system.reducedTransparency ? "true" : "false";
  }
}

export function AccessibilityManager() {
  useEffect(() => {
    document.documentElement.classList.add("cluster-accessibility-v370", "cluster-accessibility-settings-v371");
    syncSystemAccessibilityPreferences();
    normalizeAccessibility();

    let activeDialog: HTMLElement | null = null;
    let modalIsolation: ReturnType<typeof isolateModal> | null = null;
    let scheduledDialogFocus: number | null = null;
    const dialogFocusOrigins = new WeakMap<HTMLElement, HTMLElement | null>();
    const floatingIsolation = createFloatingLayerIsolation();

    const syncDialog = () => {
      const dialog = topVisibleClusterDialog();
      // Also run when the dialog is unchanged, because a floating panel might
      // have been portaled in afterwards.
      floatingIsolation.sync(dialog);
      if (dialog === activeDialog) { modalIsolation?.sync(); return; }

      const previousDialog = activeDialog;
      const previousRestoreTarget = previousDialog ? (dialogFocusOrigins.get(previousDialog) || null) : null;
      if (scheduledDialogFocus !== null) window.clearTimeout(scheduledDialogFocus);
      modalIsolation?.dispose();
      modalIsolation = null;
      activeDialog = dialog;

      if (!dialog) {
        if (previousRestoreTarget?.isConnected) window.setTimeout(() => previousRestoreTarget.focus({ preventScroll: true }), 0);
        return;
      }

      if (!dialogFocusOrigins.has(dialog)) {
        dialogFocusOrigins.set(dialog, document.activeElement instanceof HTMLElement ? document.activeElement : null);
      }
      const returnToNestedOrigin = Boolean(previousDialog && previousRestoreTarget?.isConnected && dialog.contains(previousRestoreTarget));
      scheduledDialogFocus = window.setTimeout(() => {
        scheduledDialogFocus = null;
        if (activeDialog !== dialog || !dialog.isConnected) return;
        const autofocus = dialog.querySelector<HTMLElement>("[autofocus]");
        const target = returnToNestedOrigin ? previousRestoreTarget : autofocus || visibleFocusable(dialog)[0] || dialog;
        target?.focus({ preventScroll: true });
        modalIsolation = isolateModal(dialog);
      }, 0);
    };

    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) normalizeAccessibility(node);
        });
        if (record.type === "attributes" && record.target instanceof HTMLButtonElement && record.target.closest("nav")) {
          const button = record.target;
          const currentEligible = button.classList.contains("active") && !button.hasAttribute("aria-selected") && !button.hasAttribute("aria-pressed");
          if (currentEligible) button.setAttribute("aria-current", "page");
          else if (button.getAttribute("aria-current") === "page") button.removeAttribute("aria-current");
        }
      });
      syncDialog();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "open", "aria-hidden", "aria-modal"] });
    syncDialog();

    function markKeyboardInput(event: KeyboardEvent) {
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      document.documentElement.dataset.inputModality = "keyboard";
    }
    function markPointerInput() {
      document.documentElement.dataset.inputModality = "pointer";
    }
    function keepKeyboardFocusVisible(event: FocusEvent) {
      if (document.documentElement.dataset.inputModality !== "keyboard") return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.closest(CLUSTER_MODAL_SELECTOR)) return;
      window.requestAnimationFrame(() => {
        if (!target.isConnected) return;
        const rect = target.getBoundingClientRect();
        const topSafe = 12;
        const bottomSafe = Math.max(topSafe, window.innerHeight - 12);
        if (rect.top < topSafe || rect.bottom > bottomSafe) target.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    }

    const systemQueries = [
      window.matchMedia("(prefers-reduced-motion: reduce)"),
      window.matchMedia("(prefers-contrast: more)"),
      window.matchMedia("(forced-colors: active)"),
      window.matchMedia("(prefers-reduced-transparency: reduce)"),
    ];
    systemQueries.forEach((query) => query.addEventListener?.("change", syncSystemAccessibilityPreferences));

    document.addEventListener("keydown", trapFocusInTopClusterDialog);
    document.addEventListener("keydown", markKeyboardInput, true);
    document.addEventListener("pointerdown", markPointerInput, true);
    document.addEventListener("focusin", keepKeyboardFocusVisible, true);
    return () => {
      observer.disconnect();
      if (scheduledDialogFocus !== null) window.clearTimeout(scheduledDialogFocus);
      modalIsolation?.dispose();
      floatingIsolation.dispose();
      systemQueries.forEach((query) => query.removeEventListener?.("change", syncSystemAccessibilityPreferences));
      document.removeEventListener("keydown", trapFocusInTopClusterDialog);
      document.removeEventListener("keydown", markKeyboardInput, true);
      document.removeEventListener("pointerdown", markPointerInput, true);
      document.removeEventListener("focusin", keepKeyboardFocusVisible, true);
      document.documentElement.classList.remove("cluster-accessibility-v370", "cluster-accessibility-settings-v371");
      delete document.documentElement.dataset.inputModality;
    };
  }, []);

  return null;
}
