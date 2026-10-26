export const REAUTHENTICATION_REQUEST_EVENT = "cluster:reauthentication-request";

export type ReauthenticationPurpose =
  | "security_export"
  | "privacy"
  | "session_management"
  | "mfa"
  | "server_configuration"
  | "studio_administration"
  | "context_export"
  | "context_secret_export"
  | "library_administration"
  | "personnel_records";

export type ReauthenticationRequestDetail = {
  title: string;
  description: string;
  purpose?: ReauthenticationPurpose;
  pinAllowed: boolean;
  passwordAllowed: boolean;
  passkeyAvailable: boolean;
  passkeyRequired: boolean;
  minimumStrength?: "knowledge" | "mfa" | "phishing_resistant" | "hardware_backed";
  reasonMode?: "none" | "optional" | "required";
  resolve: (confirmed: boolean) => void;
};

export function requestReauthentication(input: { title?: string; description?: string; purpose?: ReauthenticationPurpose; pinAllowed?: boolean; passwordAllowed?: boolean; passkeyAvailable?: boolean; passkeyRequired?: boolean; minimumStrength?: "knowledge" | "mfa" | "phishing_resistant" | "hardware_backed"; reasonMode?: "none" | "optional" | "required" } = {}) {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    window.dispatchEvent(new CustomEvent<ReauthenticationRequestDetail>(REAUTHENTICATION_REQUEST_EVENT, {
      detail: {
        title: input.title || "Confirm your identity",
        description: input.description || "This security-sensitive action requires a short re-authentication check.",
        purpose: input.purpose,
        pinAllowed: Boolean(input.pinAllowed),
        passwordAllowed: input.passwordAllowed !== false,
        passkeyAvailable: Boolean(input.passkeyAvailable),
        passkeyRequired: Boolean(input.passkeyRequired),
        minimumStrength: input.minimumStrength,
        reasonMode: input.reasonMode,
        resolve,
      },
    }));
  });
}
