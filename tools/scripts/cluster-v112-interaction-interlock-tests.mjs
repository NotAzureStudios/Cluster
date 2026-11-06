// Guard against UI actions that are technically present but unusable,
// and against losing sensitive one-time data during ordinary navigation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(path, "utf8");
const applications = read("packages/renderer/src/features/settings/StudioApplicationsPanel.tsx");
const scoped = read("packages/renderer/src/features/settings/StudioScopedGrantsPanel.tsx");
const renewals = read("packages/renderer/src/features/settings/StudioAccessRenewalsPanel.tsx");
const offboarding = read("packages/renderer/src/features/settings/StudioOffboardingPanel.tsx");

let count = 0;
function check(name, passed) { assert.ok(passed, name); count++; console.log("PASS", name); }

check("Application review notes and conversion drafts are tracked",
  applications.includes('const unsavedNote = Boolean(selected') &&
  applications.includes('const unsavedConversion = Boolean(') &&
  applications.includes('dirty: unsavedNote || unsavedConversion || Boolean(credential)'));
check("One-time credentials require a discard confirmation for local navigation",
  applications.includes('async function confirmReviewNavigation()') &&
  applications.includes('The one-time password for @') &&
  applications.includes('cannot be recovered after leaving') &&
  applications.includes('confirmLabel: "Discard and continue"'));
check("Application selection uses guarded transition",
  applications.includes('onClick={() => void selectApplication(item.id)}') &&
  applications.includes('async function selectApplication(nextId: string)') &&
  applications.includes('if (!(await confirmReviewNavigation())) return;'));
check("Filters and page changes honor reviewer drafts and one-time credentials",
  applications.includes('async function applyFilters()') &&
  applications.includes('async function nextPage()') &&
  applications.includes('async function previousPage()') &&
  (applications.match(/await confirmReviewNavigation\(\)/g) || []).length >= 5);
check("Credential dismissal and People navigation are guarded separately",
  applications.includes('async function dismissCredentials()') &&
  applications.includes('async function openCreatedPerson()') &&
  applications.includes('onClick={() => void openCreatedPerson()}') &&
  applications.includes('onClick={() => void dismissCredentials()}'));
check("Application transition discards all local drafts only after confirmation",
  applications.includes('function discardTransientReview()') &&
  applications.includes('setUsername("");') &&
  applications.includes('setSelectedFields([]);') &&
  applications.includes('setOnboardingVersionId("");'));

check("Grant creation explains a competing existing grant",
  scoped.includes('const requestBlocker =') &&
  scoped.includes('An active grant already exists. Choose Extend existing grant instead.') &&
  scoped.includes('disabled={busy || loading || Boolean(requestBlocker)}'));
check("Grant end dates and account expiration are explained before submit",
  scoped.includes('Grant expiry cannot exceed the account') &&
  scoped.includes('Choose a future expiration date.') &&
  scoped.includes('role="status">{requestBlocker}</p>'));
check("Grant review minimum is visible",
  scoped.includes('Decision reason (8+ characters)') &&
  scoped.includes('trim().length < 8'));

check("Access renewal explains invalid dates and missing business reasons",
  renewals.includes('const requestBlocker =') &&
  renewals.includes('The new expiry must extend access into the future.') &&
  renewals.includes('Enter a business reason with at least 12 characters.') &&
  renewals.includes('disabled={busy || loading || Boolean(requestBlocker)}'));
check("Renewal review minimum is visible",
  renewals.includes('Review reason (8+ characters)') &&
  renewals.includes('trim().length < 8'));

check("Offboarding previews are tied to the exact person and handoff",
  offboarding.includes('const [previewSelection, setPreviewSelection]') &&
  offboarding.includes('previewSelection?.userId === subjectUserId') &&
  offboarding.includes('previewSelection.handoffUserId === handoffUserId'));
check("No stale preview can enable case creation",
  offboarding.includes('if (!subjectUserId || !currentPreview') &&
  offboarding.includes('disabled={busy || !subjectUserId || !currentPreview') &&
  offboarding.includes('{currentPreview && <div className="settings-card-v092">'));
check("Changing the selected person or handoff invalidates previous preview",
  offboarding.includes('useEffect(() => { setPreview(null); setPreviewSelection(null); }, [subjectUserId, handoffUserId]);'));

console.log(`Cluster v1.1.2 interaction interlocks: ${count} checks passed.`);
