/**
 * Form-review assignments are not Studio Settings authority. Non-admins
 * receive only their own My Forms review workbench. All response and reviewer
 * permissions are rechecked by the Studio Systems API after navigation.
 */
export const DELEGATED_FORM_INSPECT_SCOPES = new Set(["studio-form", "form-submission"]);

export function delegatedFormDestination(input: {
  screen: string;
  scope?: string | null;
  id?: string | null;
  isAdmin: boolean;
}): "forms" | null {
  if (input.isAdmin || input.screen !== "studioSettings") return null;
  if (!input.scope || !DELEGATED_FORM_INSPECT_SCOPES.has(input.scope)) return null;
  if (!input.id || !input.id.trim() || input.id.length > 160) return null;
  return "forms";
}

export function formInspectorFromSearch(search: string): { scope: "studio-form" | "form-submission"; id: string } | null {
  const value = new URLSearchParams(search).get("inspect") || "";
  const divider = value.indexOf(":");
  const scope = value.slice(0, divider);
  const id = value.slice(divider + 1);
  return divider > 0 && DELEGATED_FORM_INSPECT_SCOPES.has(scope) && id.trim().length > 0 && id.length <= 160
    ? { scope: scope as "studio-form" | "form-submission", id } : null;
}
