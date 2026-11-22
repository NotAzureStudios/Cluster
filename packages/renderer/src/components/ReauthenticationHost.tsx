import { useEffect, useRef, useState } from "react";
import { api } from "../core/api";
import { REAUTHENTICATION_REQUEST_EVENT, type ReauthenticationRequestDetail } from "../core/reauthentication";
import "./reauthentication.css";
import "./security-pin.css";
import { ClusterTextInput } from "./ClusterTextInput";
import { ClusterPinEntry } from "./ClusterPinEntry";
import { ClusterButton } from "./ClusterButton";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterModal } from "./ClusterModal";
import { getWebAuthnCredential, webAuthnAvailable } from "../core/webauthn-client";

type CredentialMode = "password" | "pin" | "passkey";

export function ReauthenticationHost() {
  const [request, setRequest] = useState<ReauthenticationRequestDetail | null>(null);
  const [credential, setCredential] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<CredentialMode>("password");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<ReauthenticationRequestDetail>).detail;
      if (!detail?.resolve) return;
      setRequest((current) => {
        current?.resolve(false);
        return detail;
      });
      setMode(detail.passkeyRequired ? "passkey" : detail.pinAllowed ? "pin" : detail.passwordAllowed ? "password" : detail.passkeyAvailable ? "passkey" : "password");
      setCredential("");
      setReason("");
      setError("");
      setWorking(false);
    };
    window.addEventListener(REAUTHENTICATION_REQUEST_EVENT, receive);
    return () => window.removeEventListener(REAUTHENTICATION_REQUEST_EVENT, receive);
  }, []);

  useEffect(() => {
    if (!request) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 30);
    return () => { document.body.style.overflow = previousOverflow; };
  }, [request, mode]);

  function close() {
    if (working) return;
    request?.resolve(false);
    setRequest(null);
    setCredential("");
    setReason("");
    setError("");
  }

  function chooseMode(nextMode: CredentialMode) {
    if (working) return;
    setMode(nextMode);
    setCredential("");
    setError("");
  }

  async function submitReauthentication() {
    if (!request || working || (mode !== "passkey" && !credential)) return;
    if (request.reasonMode === "required" && reason.trim().length < (request.purpose === "context_secret_export" ? 12 : 1)) {
      setError("Enter a reason for this security-sensitive action.");
      return;
    }
    setWorking(true);
    setError("");
    try {
      if (mode === "passkey") {
        if (!request.purpose) throw new Error("This action did not provide a security verification purpose.");
        const start = await api<{ ok: boolean; challenge: string; publicKey: any }>("/api/auth/reauth/passkey/start", { method: "POST", body: JSON.stringify({ purpose: request.purpose, reason: reason.trim() || undefined }) });
        const passkeyCredential = await getWebAuthnCredential(start.publicKey);
        await api("/api/auth/reauth/passkey/verify", { method: "POST", body: JSON.stringify({ challenge: start.challenge, credential: passkeyCredential }) });
      } else {
        await api("/api/auth/reauth", {
          method: "POST",
          body: JSON.stringify({ credentialType: mode, credential, purpose: request.purpose, reason: reason.trim() || undefined }),
        });
      }
      request.resolve(true);
      setRequest(null);
      setCredential("");
      setReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Identity confirmation failed.");
      setCredential("");
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      setWorking(false);
    }
  }

  if (!request) return null;
  const passkeyUsable = Boolean(request.passkeyAvailable && webAuthnAvailable());
  const alternatives = ([
    passkeyUsable ? ["passkey", "Use passkey"] : null,
    !request.passkeyRequired && request.pinAllowed ? ["pin", "Use PIN"] : null,
    !request.passkeyRequired && request.passwordAllowed ? ["password", "Use password"] : null,
  ].filter(Boolean) as Array<[CredentialMode, string]>).filter(([option]) => option !== mode);
  const reasonMissing = request.reasonMode === "required" && reason.trim().length < (request.purpose === "context_secret_export" ? 12 : 1);
  const blocked = working || reasonMissing || (request.passkeyRequired && (mode !== "passkey" || !passkeyUsable)) || (mode !== "passkey" && !credential) || (mode === "pin" && credential.length < 4);
  // Same sheet as the Security PIN pad, so every identity check looks alike.
  return (
    <ClusterModal open onClose={close} busy={working} backdropClassName="security-pin-backdrop-v262 security-pin-backdrop-v267" includeDefaultBackdropClass={false} className="security-pin-dialog-v262 security-pin-dialog-v267 reauth-sheet" labelledBy="reauth-title-v349" describedBy="reauth-description-v349" portal={false} dialogProps={{ "data-mode": mode, "data-error": error ? "true" : undefined }}>
      <>
      <ClusterButton unstyled type="button" className="security-pin-close-v262" onClick={close} aria-label="Cancel identity confirmation" tabIndex={-1}><ClusterIcon name="close" /></ClusterButton>
      <header>
        <h2 id="reauth-title-v349">{request.title}</h2>
        <p id="reauth-description-v349">{request.description}</p>
      </header>
      {mode === "pin" ? <ClusterPinEntry inputRef={inputRef} label="Security PIN" value={credential} disabled={working} onChange={(next) => { setCredential(next); setError(""); }} onEnter={() => void submitReauthentication()} />
        : mode === "password" ? <ClusterTextInput ref={inputRef} type="password" aria-label="Password" placeholder="Password" className="reauth-sheet__field" value={credential} autoComplete="current-password" disabled={working} onChange={(event) => { setCredential(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") void submitReauthentication(); }} />
        : <p className="reauth-sheet__note">{request.minimumStrength === "hardware_backed" ? "Use your hardware security key." : "Use your passkey or security key."}</p>}
      {request.reasonMode === "required" && <ClusterTextInput className="reauth-sheet__field" aria-label="Reason" value={reason} maxLength={500} autoComplete="off" onChange={(event) => { setReason(event.target.value); setError(""); }} placeholder="Reason for this action" />}
      {request.passkeyRequired && !passkeyUsable && <div className="security-pin-error-v262" role="alert">This action needs an enrolled passkey or security key.</div>}
      {error && <div className="security-pin-error-v262" role="alert">{error}</div>}
      <footer>
        <ClusterButton type="button" variant="primary" disabled={blocked} onClick={() => void submitReauthentication()}>{working ? "Confirming…" : mode === "passkey" ? "Use authenticator" : "Confirm"}</ClusterButton>
        {alternatives.length ? <div className="reauth-sheet__alt">{alternatives.map(([option, label]) => <ClusterButton key={option} unstyled type="button" onClick={() => chooseMode(option)}>{label}</ClusterButton>)}</div> : null}
      </footer>
      </>
    </ClusterModal>
  );
}
