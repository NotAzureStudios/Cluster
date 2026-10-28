import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../core/api";
import {
  SECURITY_PIN_CONFIGURED_EVENT,
  SECURITY_PIN_REQUEST_EVENT,
  type SecurityPinMode,
  type SecurityPinRequestDetail,
} from "../core/security-pin";
import "./security-pin.css";
import { ClusterPinEntry } from "./ClusterPinEntry";
import { ClusterButton } from "./ClusterButton";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterModal } from "./ClusterModal";

type PinPhase = "verify" | "current" | "new" | "confirm";

function initialPhase(mode: SecurityPinMode): PinPhase {
  if (mode === "setup") return "new";
  if (mode === "change") return "current";
  return "verify";
}

export function SecurityPinHost() {
  const [request, setRequest] = useState<SecurityPinRequestDetail | null>(null);
  const [phase, setPhase] = useState<PinPhase>("verify");
  const [pin, setPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const mode = request?.mode || "verify";
  const phaseCopy = useMemo(() => {
    if (phase === "current")
      return { label: "Current PIN" };
    if (phase === "new")
      return { label: "New PIN" };
    if (phase === "confirm")
      return { label: "Confirm PIN" };
    return { label: "Security PIN" };
  }, [phase]);

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<SecurityPinRequestDetail>).detail;
      if (!detail?.resolve) return;
      setRequest((current) => {
        current?.resolve(null);
        return detail;
      });
      setPhase(initialPhase(detail.mode || "verify"));
      setPin("");
      setCurrentPin("");
      setNewPin("");
      setError("");
      setVerifying(false);
    };
    window.addEventListener(SECURITY_PIN_REQUEST_EVENT, receive);
    return () =>
      window.removeEventListener(SECURITY_PIN_REQUEST_EVENT, receive);
  }, []);

  useEffect(() => {
    if (!request) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [request, phase]);

  function resetEntry(nextPhase?: PinPhase) {
    setPin("");
    setError("");
    if (nextPhase) setPhase(nextPhase);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function close() {
    if (verifying) return;
    request?.resolve(null);
    setRequest(null);
    setPin("");
    setCurrentPin("");
    setNewPin("");
    setError("");
  }

  async function finishSetup(finalPin: string, priorPin?: string) {
    const result = await api<{ ok: boolean; user: unknown }>("/api/me/pin", {
      method: "PUT",
      body: JSON.stringify({
        currentPin: priorPin || undefined,
        pin: finalPin,
      }),
    });
    window.dispatchEvent(
      new CustomEvent(SECURITY_PIN_CONFIGURED_EVENT, {
        detail: { user: result.user },
      }),
    );
    request?.resolve(finalPin);
    setRequest(null);
    setPin("");
    setCurrentPin("");
    setNewPin("");
  }

  async function advance() {
    if (!request || verifying) return;
    if (!/^\d{4,8}$/.test(pin)) {
      setError("Enter 4–8 digits.");
      return;
    }

    setVerifying(true);
    setError("");
    try {
      if (mode === "verify") {
        await api("/api/me/pin/verify", {
          method: "POST",
          body: JSON.stringify({ pin, purpose: request.purpose }),
        });
        request.resolve(pin);
        setRequest(null);
        setPin("");
        return;
      }

      if (mode === "change" && phase === "current") {
        await api("/api/me/pin/verify", {
          method: "POST",
          body: JSON.stringify({ pin, purpose: request.purpose }),
        });
        setCurrentPin(pin);
        resetEntry("new");
        return;
      }

      if (phase === "new") {
        setNewPin(pin);
        resetEntry("confirm");
        return;
      }

      if (phase === "confirm") {
        if (pin !== newPin) {
          setError("PINs do not match.");
          setPin("");
          return;
        }
        await finishSetup(newPin, mode === "change" ? currentPin : undefined);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The PIN request could not be completed.",
      );
      setPin("");
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      setVerifying(false);
    }
  }

  if (!request) return null;

  return (
    <ClusterModal
      open
      onClose={close}
      busy={verifying}
      backdropClassName="security-pin-backdrop-v262 security-pin-backdrop-v267"
      includeDefaultBackdropClass={false}
      className="security-pin-dialog-v262 security-pin-dialog-v267"
      labelledBy="security-pin-title-v262"
      portal={true}
      dialogProps={{
        "data-mode": mode,
        "data-phase": phase,
      }}
    >
      <>
      <header>
        <h2 id="security-pin-title-v262">{request.title}</h2>
        <ClusterButton unstyled type="button" className="security-pin-close-v262" onClick={close} aria-label="Close PIN pad"><ClusterIcon name="close" /></ClusterButton>
      </header>
      {mode !== "verify" && <span className="security-pin-phase-v124" aria-live="polite">{phaseCopy.label}</span>}
      <ClusterPinEntry value={pin} onChange={(next) => { setError(""); setPin(next); }} disabled={verifying} inputRef={inputRef} label={phaseCopy.label} onEnter={() => void advance()} />

      {error && (
        <div className="security-pin-error-v262" role="alert">
          {error}
        </div>
      )}

      <footer>
        <ClusterButton
          type="button"
          className=""
          onClick={() => void advance()}
          disabled={verifying || pin.length < 4}
         variant="primary">
          {verifying
            ? "Working…"
            : phase === "confirm"
              ? "Save PIN"
              : mode === "verify"
                ? request.confirmLabel || "Confirm"
                : "Next"}
        </ClusterButton>
      </footer>
      </>
    </ClusterModal>
  );
}
