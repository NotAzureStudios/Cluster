export type SecurityPinMode = "verify" | "setup" | "change";

export type SecurityPinRequest = {
  title: string;
  description: string;
  purpose: string;
  confirmLabel?: string;
  mode?: SecurityPinMode;
};

type SecurityPinRequestDetail = SecurityPinRequest & {
  resolve: (pin: string | null) => void;
};

export const SECURITY_PIN_REQUEST_EVENT = "cluster:security-pin-request";
export const SECURITY_PIN_CONFIGURED_EVENT = "cluster:security-pin-configured";

export function requestSecurityPin(
  request: SecurityPinRequest,
): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    window.dispatchEvent(
      new CustomEvent<SecurityPinRequestDetail>(SECURITY_PIN_REQUEST_EVENT, {
        detail: { mode: "verify", ...request, resolve },
      }),
    );
  });
}

export function requestSecurityPinSetup(input?: {
  title?: string;
  description?: string;
  purpose?: string;
}): Promise<string | null> {
  return requestSecurityPin({
    mode: "setup",
    title: input?.title || "Create security PIN",
    description:
      input?.description ||
      "Choose 4–8 digits.",
    purpose: input?.purpose || "create_security_pin",
    confirmLabel: "Save PIN",
  });
}

export function requestSecurityPinChange(input?: {
  title?: string;
  description?: string;
  purpose?: string;
}): Promise<string | null> {
  return requestSecurityPin({
    mode: "change",
    title: input?.title || "Change security PIN",
    description:
      input?.description ||
      "",
    purpose: input?.purpose || "change_security_pin",
    confirmLabel: "Save new PIN",
  });
}

export function openPinSettings() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("cluster:open-account-settings", {
      detail: { section: "pin" },
    }),
  );
}

export type { SecurityPinRequestDetail };
