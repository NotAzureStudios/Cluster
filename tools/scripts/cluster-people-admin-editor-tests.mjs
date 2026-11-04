// Prevent disappearance of the People admin editor and unintended privilege
// edits via an otherwise ordinary profile save.
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("packages/renderer/src/features/people/PeoplePages.tsx", "utf8");
const editor = fs.readFileSync("packages/renderer/src/features/people/PeopleUserEditor.tsx", "utf8");
const css = fs.readFileSync("packages/renderer/src/features/people/people.css", "utf8");
const api = fs.readFileSync("apps/server/src/domains/users/user-directory-routes.ts", "utf8");

const checks = [
  [page.includes('import { PeopleUserEditor } from "./PeopleUserEditor";'), "admin editor imported"],
  [page.includes('label: "Edit user"') && page.includes('>Edit user</ClusterButton>'), "admin Edit User action visible"],
  [page.includes('profileView === "edit" && effectiveAdminMode && !profile.archived'), "no edit affordance for archived account"],
  [page.includes('onDirtyChange={setEditorDirty}') && page.includes('useUnsavedChangesGuard({'), "draft state and app leave guard linked"],
  [page.includes('await confirmEditorDiscard()') && page.includes('setProfileViewState(next);'), "tab changes ask before discarding"],
  [page.includes('await api(`/api/users/${encodeURIComponent(profile.id)}`'), "save uses canonical user PATCH"],
  [editor.includes('expectedProfileRevision: person.profileRevision || 1'), "optimistic profile revision included"],
  [editor.includes('await onSave(changes)') && editor.includes('if (saving || !dirty) return;'), "single bounded save"],
  [editor.includes('Minimum hours cannot exceed capacity hours.'), "hours constraints validated locally"],
  [editor.includes('Managed departments only.'), "no creation of arbitrary department by editor"],
  [editor.includes('Role grants, access expiry, suspension and credential recovery are handled separately.'), "governed access/lifecycle not mixed into profile edit"],
  [!editor.includes('projectPermissions:') && !editor.includes('toolPermissions:') && !editor.includes('accessExpiresAt:'), "admin profile patch does not send elevated grant or expiry fields"],
  [api.includes('PROFILE_REVISION_CONFLICT') && api.includes('ACCESS_RENEWAL_GOVERNED') && api.includes('SCOPED_GRANT_REVIEW_REQUIRED'), "server retains profile concurrency and governed-grant rules"],
  [css.includes('.people-user-editor-grid-v106') && css.includes('@media(max-width:700px)'), "responsive editor styles present"],
];
for (const [ok, message] of checks) assert.ok(ok, message);
console.log(`People admin editor integration: ${checks.length} contracts passed.`);
