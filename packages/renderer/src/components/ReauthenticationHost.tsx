import { useEffect, useRef, useState } from "react";
import { api } from "../core/api";
import { REAUTHENTICATION_REQUEST_EVENT, type ReauthenticationRequestDetail } from "../core/reauthentication";
import "./reauthentication.css";
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
    window.setTimeout(() => inputRef.current?.focus(), 0);
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
  return (
    <ClusterModal open onClose={close} busy={working} backdropClassName="reauth-backdrop-v349" includeDefaultBackdropClass={false} className="reauth-dialog-v349" labelledBy="reauth-title-v349" describedBy="reauth-description-v349" portal={false}>
        <header>
          <div>
            <span>Security check</span>
            <h2 id="reauth-title-v349">{request.title}</h2>
            <p id="reauth-description-v349">{request.description}</p>
          </div>
          <ClusterButton unstyled type="button" onClick={close} aria-label="Cancel identity confirmation"><ClusterIcon name="close" /></ClusterButton>
        </header>
        {(request.pinAllowed || request.passkeyAvailable) && (
          <div className="reauth-methods-v495" role="group" aria-label="Confirmation method">
            {request.passkeyAvailable && webAuthnAvailable() && <ClusterButton unstyled type="button" className={mode === "passkey" ? "active" : ""} aria-pressed={mode === "passkey"} onClick={() => chooseMode("passkey")}>Passkey / security key</ClusterButton>}
            {!request.passkeyRequired && request.pinAllowed && <ClusterButton unstyled type="button" className={mode === "pin" ? "active" : ""} aria-pressed={mode === "pin"} onClick={() => chooseMode("pin")}>Security PIN</ClusterButton>}
            {!request.passkeyRequired && request.passwordAllowed && <ClusterButton unstyled type="button" className={mode === "password" ? "active" : ""} aria-pressed={mode === "password"} onClick={() => chooseMode("password")}>Password</ClusterButton>}
          </div>
        )}
        {mode === "passkey" ? <div className="hint-box"><strong>Use your authenticator</strong><span>{request.minimumStrength === "hardware_backed" ? "This action requires a hardware security key." : "This action requires phishing-resistant verification with a passkey or security key."}</span></div> : mode === "pin" ? (
          <div className="reauth-pin-pad-v124">
            <span>Security PIN</span>
            <ClusterPinEntry
              inputRef={inputRef}
              label="Security PIN"
              value={credential}
              disabled={working}
              onChange={(next) => { setCredential(next); setError(""); }}
              onEnter={() => void submitReauthentication()}
            />
          </div>
        ) : <label>
          <span>Password</span>
          <ClusterTextInput
            ref={inputRef}
            type="password"
            value={credential}
            autoComplete="current-password"
            disabled={working}
            onChange={(event) => { setCredential(event.target.value); setError(""); }}
            onKeyDown={(event) => { if (event.key === "Enter") void submitReauthentication(); }}
          />
        </label>}
        {request.reasonMode === "required" && <label>
          <span>Reason for access</span>
          <ClusterTextInput value={reason} maxLength={500} autoComplete="off" onChange={(event) => { setReason(event.target.value); setError(""); }} placeholder="Explain why this privileged operation is necessary" />
        </label>}
        {request.passkeyRequired && (!request.passkeyAvailable || !webAuthnAvailable()) && <div className="reauth-error-v349" role="alert">An enrolled passkey or security key is required for this action.</div>}
        {error && <div className="reauth-error-v349" role="alert">{error}</div>}
        <footer>
          <ClusterButton type="button" className="" onClick={close} variant="secondary">Cancel</ClusterButton>
          <ClusterButton type="button" className="" disabled={working || (request.passkeyRequired && (mode !== "passkey" || !request.passkeyAvailable || !webAuthnAvailable())) || (request.reasonMode === "required" && reason.trim().length < (request.purpose === "context_secret_export" ? 12 : 1)) || (mode !== "passkey" && !credential) || (mode === "pin" && credential.length < 4)} onClick={() => void submitReauthentication()} variant="primary">{working ? "Confirming…" : mode === "passkey" ? "Use authenticator" : "Confirm"}</ClusterButton>
        </footer>
    </ClusterModal>
  );
}
