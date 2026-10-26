import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../core/api";
import {
  SECURITY_PIN_CONFIGURED_EVENT,
  SECURITY_PIN_REQUEST_EVENT,
  type SecurityPinMode,
  type SecurityPinRequestDetail,
} from "../core/security-pin";
import "./security-pin.css";
import { ClusterTextInput } from "./ClusterTextInput";
import { ClusterButton } from "./ClusterButton";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterModal } from "./ClusterModal";

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
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
      return { label: "Current PIN", helper: "Enter your existing PIN." };
    if (phase === "new")
      return { label: "New PIN", helper: "Choose 4–8 digits." };
    if (phase === "confirm")
      return { label: "Confirm PIN", helper: "Enter the new PIN again." };
    return { label: "Security PIN", helper: "Enter your 4–8 digit PIN." };
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

  function append(value: number) {
    if (verifying) return;
    setError("");
    setPin((current) => `${current}${value}`.slice(0, 8));
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

  const stepNumber =
    mode === "verify" ? 1 : mode === "setup" ? (phase === "new" ? 1 : 2) : phase === "current" ? 1 : phase === "new" ? 2 : 3;
  const stepTotal = mode === "verify" ? 1 : mode === "setup" ? 2 : 3;

  return (
    <ClusterModal
      open
      onClose={close}
      busy={verifying}
      backdropClassName="security-pin-backdrop-v262 security-pin-backdrop-v267"
      includeDefaultBackdropClass={false}
      className="security-pin-dialog-v262 security-pin-dialog-v267"
      labelledBy="security-pin-title-v262"
      describedBy="security-pin-description-v262"
      portal={false}
      dialogProps={{
        "data-mode": mode,
        "data-phase": phase,
      }}
    >
      <>
      <header>
        <div>
          <span className="security-pin-eyebrow-v262">
            {mode === "verify" ? "Protected action" : "Account security"}
          </span>
          <h2 id="security-pin-title-v262">{request.title}</h2>
          <p id="security-pin-description-v262">{request.description}</p>
        </div>
        <ClusterButton unstyled
          type="button"
          className="security-pin-close-v262"
          onClick={close}
          aria-label="Cancel PIN entry"
        >
          <ClusterIcon name="close" />
        </ClusterButton>
      </header>

      <div className="security-pin-step-v267">
        <span>
          Step {stepNumber} of {stepTotal}
        </span>
        <strong>{phaseCopy.label}</strong>
        <small>{phaseCopy.helper}</small>
      </div>

      <div className="security-pin-display-v262" data-length={pin.length}>
        <ClusterTextInput
          ref={inputRef}
          value={pin}
          onChange={(event) => {
            setError("");
            setPin(event.target.value.replace(/\D/g, "").slice(0, 8));
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void advance();
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label={phaseCopy.label}
        />
        <div className="security-pin-dots-v262" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <span key={index} className={index < pin.length ? "filled" : ""} />
          ))}
        </div>
        <small>{pin.length}/8 digits</small>
      </div>

      <div className="security-pin-keypad-v262" aria-label="PIN keypad">
        {DIGITS.slice(0, 9).map((digit) => (
          <ClusterButton unstyled key={digit} type="button" onClick={() => append(digit)}>
            {digit}
          </ClusterButton>
        ))}
        <ClusterButton unstyled
          type="button"
          className="secondary-action"
          onClick={() => resetEntry()}
        >
          Clear
        </ClusterButton>
        <ClusterButton unstyled type="button" onClick={() => append(0)}>
          0
        </ClusterButton>
        <ClusterButton unstyled
          type="button"
          className="secondary-action"
          onClick={() => {
            setError("");
            setPin((current) => current.slice(0, -1));
          }}
          aria-label="Delete last digit"
        >
          Delete
        </ClusterButton>
      </div>

      {error && (
        <div className="security-pin-error-v262" role="alert">
          {error}
        </div>
      )}

      <footer>
        <ClusterButton type="button" className="" onClick={close} variant="secondary">
          Cancel
        </ClusterButton>
        <ClusterButton
          type="button"
          className=""
          onClick={() => void advance()}
          disabled={verifying || pin.length < 4}
         variant="primary">
          {verifying
            ? "Working…"
            : phase === "confirm"
              ? request.confirmLabel || "Save PIN"
              : mode === "verify"
                ? request.confirmLabel || "Confirm PIN"
                : "Continue"}
        </ClusterButton>
      </footer>
      </>
    </ClusterModal>
  );
}
