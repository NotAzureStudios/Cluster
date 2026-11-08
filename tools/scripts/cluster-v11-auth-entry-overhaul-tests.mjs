import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(file,"utf8");
const screen = read("packages/renderer/src/features/auth/AuthScreens.tsx");
const layout = read("packages/renderer/src/features/auth/AuthEntryLayout.tsx");
const firstLogin = read("packages/renderer/src/features/auth/FirstLoginExperience.tsx");
const css = read("packages/renderer/src/features/auth/auth.css");
const gate = read("packages/renderer/src/features/auth/AuthenticatedEntryGate.tsx");
const cover = read("packages/renderer/src/features/auth/PublicClusterCover.tsx");
let checks=0;
function check(name,condition) {assert.ok(condition,name);checks++;console.log("PASS",name);}

check("One responsive auth shell owns the public sign-in and setup layout",
  layout.includes('cluster-auth-entry-grid-v11') &&
  layout.includes('cluster-auth-entry-intro-v11') &&
  layout.includes('cluster-auth-entry-card-v11') &&
  screen.includes('<AuthEntryLayout studioName={studioName}') &&
  (screen.match(/<AuthEntryLayout mode="setup"/g)||[]).length===3 &&
  firstLogin.includes('<AuthEntryLayout mode="setup">'));
check("Mobile presentation is not dependent on external imagery or font requests",
  css.includes('@media(max-width:820px)') &&
  css.includes('@media(max-width:480px)') &&
  css.includes('min-height:100dvh') &&
  layout.includes('src="/cluster-logo.png"') &&
  !layout.includes('http://') && !layout.includes('https://'));
check("All sign-in modes keep a concise title and separate recovery state",
  screen.includes('mfaChallenge ? "Verify your sign-in"') &&
  screen.includes('recoveryMode === "request" ? "Recover account access"') &&
  screen.includes('mode={recoveryMode === "request" ? "recovery" : "signin"}'));
check("Config failure is explicit and retryable instead of silently permitting submissions",
  screen.includes('const [configLoading, setConfigLoading] = useState(true)') &&
  screen.includes('const [configError, setConfigError] = useState("")') &&
  screen.includes('onClick={() => void loadConfig()}') &&
  screen.includes('disabled={busy || configLoading || !config || !config.passwordLoginEnabled}'));
check("Password, MFA and recovery labels are attached to the corresponding inputs",
  screen.includes('label htmlFor={identifierFieldId}') && screen.includes('id={identifierFieldId}') &&
  screen.includes('label htmlFor={passwordFieldId}') && screen.includes('id={passwordFieldId}') &&
  screen.includes('label htmlFor={mfaFieldId}') && screen.includes('id={mfaFieldId}') &&
  screen.includes('label htmlFor={recoveryFieldId}') && screen.includes('id={recoveryFieldId}'));
check("Password visibility is a deliberate accessible control",
  screen.includes('aria-label={showPassword ? "Hide password" : "Show password"}') &&
  screen.includes('aria-pressed={showPassword}') &&
  screen.includes('autoComplete="current-password"'));
check("Submission cannot be accidentally duplicated across methods",
  (screen.match(/authActionRef.current = true;/g)||[]).length===6 &&
  (screen.match(/authActionRef.current = false; setBusy\(false\);/g)||[]).length===6 &&
  screen.includes('if (authActionRef.current || !mfaChallenge) return;'));
check("MFA no longer retains the entered password in component state",
  screen.includes('setMfaChallenge(result.challenge);') &&
  screen.includes('setPassword(""); // Do not retain the password'));
check("MFA verification requires a complete code and blocks mid-request mode changes",
  screen.includes('mfaUseRecovery ? !mfaRecoveryCode.trim() : mfaCode.length !== 6') &&
  screen.includes('disabled={busy} onClick={() => { setMfaUseRecovery') &&
  screen.includes('disabled={busy} onClick={() => { setMfaChallenge("")'));
check("Passkeys and password policies still use existing Server authorities",
  screen.includes('"/api/auth/passkeys/login/start"') &&
  screen.includes('"/api/auth/passkeys/login/verify"') &&
  screen.includes('"/api/auth/mfa/challenge"') &&
  screen.includes('"/api/auth/mfa/passkeys/challenge"') &&
  screen.includes('"/api/auth/session-password"') &&
  screen.includes('"/api/auth/login"') &&
  gate.includes('PasswordMigrationScreen') &&
  gate.includes('MfaEnrollmentScreen'));
check("One-time MFA recovery codes require an explicit saved-code acknowledgment",
  screen.includes('const [recoveryCodesSaved, setRecoveryCodesSaved] = useState(false)') &&
  screen.includes('checked={recoveryCodesSaved}') &&
  screen.includes('disabled={busy || !recoveryCodesSaved}') &&
  screen.includes('setRecoveryCodesSaved(false)') &&
  css.includes('cluster-auth-recovery-ack-v11'));
check("Recovery keeps generic non-enumerating response and a clear back path",
  screen.includes('Cluster does not reveal whether an account exists') &&
  screen.includes('"/api/auth/password-reset-request"') &&
  screen.includes('Back to sign in'));
check("Studio cover, loading, error and application routes share the login design",
  cover.includes('if (loadError && !cover) return <AuthEntryLayout>') &&
  cover.includes('if (!cover) return <AuthEntryLayout>') &&
  cover.includes('mode="setup" cardClassName="cluster-auth-application-v11"') &&
  cover.includes('return <AuthEntryLayout studioName={cover.studioName}>') &&
  css.includes('cluster-auth-application-v11'));
check("First-login remains server-backed, with readable step progress",
  firstLogin.includes('aria-current={item === step ? "step" : undefined}') &&
  firstLogin.includes('Step {index + 1} of {STEPS.length}') &&
  firstLogin.includes('"/api/me/first-login/complete"') &&
  css.includes('.cluster-first-login-progress-v11 li[aria-current=step]'));
check("Focus styling and reduced-motion preferences stay accessible",
  css.includes('button:focus-visible') &&
  css.includes('@media(prefers-reduced-motion:reduce)'));
console.log(`Auth entry overhaul: ${checks} checks passed.`);
