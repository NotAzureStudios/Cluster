import { useEffect, useMemo, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { RequestErrorState } from "../../components/RequestState";
import { StudioPolicyGate } from "../legal/StudioPolicyGate";
import { AuthEntryLayout } from "./AuthEntryLayout";

export type FirstLoginUser = {
  id: string;
  username: string;
  displayName?: string | null;
  preferredName?: string | null;
  timezone?: string | null;
  email?: string | null;
  profileRevision?: number;
  preferences?: Record<string, unknown>;
  firstLoginCompletedAt?: string | null;
};

type FirstLoginOnboardingPlan = {
  assignmentId: string;
  lifecycle: { dueAt?: string | null; overdue?: boolean };
  plan: { title: string };
  progress: { requiredComplete: number; requiredTotal: number; done: boolean };
};

type FirstLoginStep = "profile" | "policies" | "onboarding" | "session" | "review";
type SessionRecord = { id: string; current: boolean; authMethod: string; userAgent: string; lastSeenAt: string; expiresAt: string; deviceId?: string | null };
type DeviceRecord = { id: string; deviceId: string; label: string; platform?: string | null; current: boolean; activeSessionCount: number; lastSeenAt: string };

const STEPS: FirstLoginStep[] = ["profile", "policies", "onboarding", "session", "review"];
const STEP_LABELS: Record<FirstLoginStep, string> = { profile: "Profile", policies: "Policies", onboarding: "Onboarding", session: "Session", review: "Ready" };

function validStoredStep(value: unknown): FirstLoginStep {
  return STEPS.includes(value as FirstLoginStep) ? value as FirstLoginStep : "profile";
}

function StepHeader({ step }: { step: FirstLoginStep }) {
  const index = STEPS.indexOf(step);
  return <nav className="cluster-first-login-progress-v11" aria-label="First-login progress"><ol>{STEPS.map((item, itemIndex) => <li key={item} aria-current={item === step ? "step" : undefined}><strong>{itemIndex + 1}</strong><span>{STEP_LABELS[item]}</span></li>)}</ol><small>Step {index + 1} of {STEPS.length} · {STEP_LABELS[step]}</small></nav>;
}

export function FirstLoginExperience({ user, onUserUpdated, onLogout }: { user: FirstLoginUser; onUserUpdated: (user: FirstLoginUser) => void; onLogout: () => void | Promise<void> }) {
  const [step, setStep] = useState<FirstLoginStep>(() => validStoredStep(user.preferences?.entryFirstLoginStep));
  const [displayName, setDisplayName] = useState(user.displayName || "");
  const [preferredName, setPreferredName] = useState(user.preferredName || "");
  const [timezone, setTimezone] = useState(user.timezone || (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } })());
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [onboarding, setOnboarding] = useState<FirstLoginOnboardingPlan[]>([]);
  const [onboardingLoaded, setOnboardingLoaded] = useState(false);
  const [contextLoading, setContextLoading] = useState(true);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [completeBusy, setCompleteBusy] = useState(false);
  const [completeError, setCompleteError] = useState("");

  const activeOnboarding = useMemo(() => onboarding.filter((plan) => !plan.progress.done), [onboarding]);
  const currentSession = sessions.find((entry) => entry.current) || null;
  const currentDevice = devices.find((entry) => entry.current) || null;

  async function loadContext() {
    setLoadError(null);
    setOnboardingLoaded(false);
    setContextLoading(true);
    try {
      const [onboardingResult, sessionResult, deviceResult] = await Promise.all([
        api<{ plans: FirstLoginOnboardingPlan[] }>("/api/onboarding"),
        api<{ sessions: SessionRecord[] }>("/api/me/sessions"),
        api<{ devices: DeviceRecord[] }>("/api/me/devices"),
      ]);
      setOnboarding(onboardingResult.plans || []);
      setOnboardingLoaded(true);
      setSessions(sessionResult.sessions || []);
      setDevices(deviceResult.devices || []);
    } catch (error) { setLoadError(error); }
    finally { setContextLoading(false); }
  }

  useEffect(() => { void loadContext(); }, []);

  async function persistStep(next: FirstLoginStep) {
    setStep(next);
    try {
      const result = await api<{ user: FirstLoginUser }>("/api/me/preferences", { method: "PATCH", body: JSON.stringify({ preferences: { entryFirstLoginStep: next } }) });
      if (result.user) onUserUpdated(result.user);
    } catch { /* Resume state is convenience only; canonical completion remains server-backed. */ }
  }

  async function saveProfile() {
    setProfileBusy(true); setProfileError("");
    try {
      const result = await api<{ user: FirstLoginUser }>("/api/me/profile", { method: "PATCH", body: JSON.stringify({ displayName: displayName.trim() || null, preferredName: preferredName.trim() || null, timezone: timezone.trim() || null, expectedProfileRevision: user.profileRevision }) });
      onUserUpdated(result.user);
      await persistStep("policies");
    } catch (error) { setProfileError(error instanceof Error ? error.message : "Your profile could not be saved."); }
    finally { setProfileBusy(false); }
  }

  async function finish() {
    setCompleteBusy(true); setCompleteError("");
    try {
      const result = await api<{ user: FirstLoginUser }>("/api/me/first-login/complete", { method: "POST" });
      onUserUpdated(result.user);
    } catch (error) { setCompleteError(error instanceof Error ? error.message : "First login could not be completed."); }
    finally { setCompleteBusy(false); }
  }

  if (step === "policies") {
    return <StudioPolicyGate onLogout={onLogout}><AuthEntryLayout mode="setup"><StepHeader step={step} /><h1>Policies</h1><p className="muted">Required policies accepted.</p><div className="login-actions"><ClusterButton type="button" variant="primary" onClick={() => void persistStep("onboarding")}>Continue</ClusterButton><ClusterButton type="button" variant="secondary" onClick={() => void persistStep("profile")}>Back</ClusterButton></div></AuthEntryLayout></StudioPolicyGate>;
  }

  return <AuthEntryLayout mode="setup">
    <div className="managed-auth-brand-row"><img className="cluster-brand-logo" src="/cluster-logo.png" alt="Cluster" /></div>
    <StepHeader step={step} />
    {Boolean(loadError) && <RequestErrorState error={loadError} title="Account context could not be loaded" onRetry={() => void loadContext()} />}

    {step === "profile" && <>
      <h1>Your profile</h1>
      <div className="managed-auth-form">
        <label className="field"><span>Display name</span><ClusterTextInput autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={user.username} /></label>
        <label className="field"><span>Preferred name</span><ClusterTextInput value={preferredName} onChange={(event) => setPreferredName(event.target.value)} placeholder="Optional" /></label>
        <label className="field"><span>Timezone</span><ClusterTextInput autoComplete="off" value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/New_York" /></label>
      </div>
      {profileError && <div className="error-box" role="alert">{profileError}</div>}
      <div className="login-actions"><ClusterButton type="button" variant="primary" disabled={profileBusy} onClick={() => void saveProfile()}>{profileBusy ? "Saving…" : "Save and continue"}</ClusterButton><ClusterButton type="button" variant="secondary" disabled={profileBusy} onClick={() => void persistStep("policies")}>Skip for now</ClusterButton></div>
    </>}

    {step === "onboarding" && <>
      <h1>Onboarding</h1>
      <div className="studio-form-field-list-v34f">{!onboardingLoaded ? <div className="settings-card-v092" role="status"><strong>{contextLoading ? "Checking onboarding assignments…" : "Onboarding assignments unavailable"}</strong><span>Refresh account context to check your required steps. You can resume them from My Work after entering Cluster.</span><ClusterButton type="button" variant="secondary" onClick={() => void loadContext()}>Retry</ClusterButton></div> : onboarding.length ? onboarding.map((plan) => <div className="settings-card-v092" key={plan.assignmentId}><strong>{plan.plan.title}</strong><span>{plan.progress.requiredComplete}/{plan.progress.requiredTotal} required steps complete</span><small>{plan.progress.done ? "Complete" : plan.lifecycle.overdue ? "Overdue" : plan.lifecycle.dueAt ? `Due ${new Date(plan.lifecycle.dueAt).toLocaleDateString()}` : "Continue from My Work after entry"}</small></div>) : <div className="settings-card-v092"><strong>No onboarding assigned</strong><span>You can continue directly into the workspace.</span></div>}</div>
      <div className="login-actions"><ClusterButton type="button" variant="primary" onClick={() => void persistStep("session")}>{activeOnboarding.length ? "Continue setup" : "Continue"}</ClusterButton><ClusterButton type="button" variant="secondary" onClick={() => void persistStep("policies")}>Back</ClusterButton></div>
    </>}

    {step === "session" && <>
      <h1>Signed-in device</h1>
      <div className="studio-form-field-list-v34f"><div className="settings-card-v092"><strong>{currentDevice?.label || "Current device"}</strong><span>{currentDevice?.platform || currentSession?.userAgent || "Current client"}</span><small>{currentDevice ? `${currentDevice.activeSessionCount} active session${currentDevice.activeSessionCount === 1 ? "" : "s"} on this device` : "Device registration is handled by the canonical session service."}</small></div><div className="settings-card-v092"><strong>Current session</strong><span>{currentSession ? `${currentSession.authMethod} authentication` : "Active Cluster session"}</span><small>{currentSession?.expiresAt ? `Expires ${new Date(currentSession.expiresAt).toLocaleString()}` : `${sessions.length} active session${sessions.length === 1 ? "" : "s"} on your account`}</small></div></div>
      <div className="login-actions"><ClusterButton type="button" variant="primary" onClick={() => void persistStep("review")}>Continue</ClusterButton><ClusterButton type="button" variant="secondary" onClick={() => void persistStep("onboarding")}>Back</ClusterButton></div>
    </>}

    {step === "review" && <>
      <h1>Ready</h1>
      <div className="studio-form-field-list-v34f"><div className="settings-card-v092"><strong>@{user.username}</strong><span>{user.preferredName || user.displayName || "Profile details can be completed later"}</span></div><div className="settings-card-v092"><strong>{!onboardingLoaded ? "Onboarding status not loaded" : activeOnboarding.length ? `${activeOnboarding.length} onboarding plan${activeOnboarding.length === 1 ? "" : "s"} still active` : "Onboarding clear"}</strong><span>{!onboardingLoaded ? "Review your assignments in My Work after signing in." : activeOnboarding.length ? "Continue them from My Work." : "No required onboarding is waiting."}</span></div></div>
      {completeError && <div className="error-box" role="alert">{completeError}</div>}
      <div className="login-actions"><ClusterButton type="button" variant="primary" disabled={completeBusy} onClick={() => void finish()}>{completeBusy ? "Opening…" : "Enter Cluster"}</ClusterButton><ClusterButton type="button" variant="secondary" disabled={completeBusy} onClick={() => void persistStep("session")}>Back</ClusterButton></div>
    </>}

    <div className="managed-auth-help-v473"><ClusterButton unstyled type="button" onClick={() => void onLogout()}>Sign out</ClusterButton></div>
  </AuthEntryLayout>;
}
