/** Local feedback only. The server remains authoritative for identity, role
 * assignment, expiry policy, duplicate usernames, and account provisioning. */
export type PeopleAccountCreateDraft = {
  username: string;
  email: string;
  accountType: string;
  accessExpiresAt: string;
  role: string;
};

export type PeopleAccountCreateErrors = Partial<Record<"username" | "email" | "accessExpiresAt" | "role", string>>;

export function validatePeopleAccountCreation(
  draft: PeopleAccountCreateDraft,
  canAssignRole: boolean,
  now = new Date(),
): PeopleAccountCreateErrors {
  const errors: PeopleAccountCreateErrors = {};
  const username = draft.username.trim();
  if (username.length < 3 || username.length > 32) {
    errors.username = "Username must be 3–32 characters.";
  }

  const email = draft.email.trim();
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    errors.email = "Enter a valid email address, or leave it blank.";
  }

  const external = ["contractor", "client", "guest"].includes(draft.accountType);
  if (!draft.accessExpiresAt) {
    if (external) errors.accessExpiresAt = "Contractor, client, and guest accounts need an expiration date.";
  } else {
    const raw = draft.accessExpiresAt;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    const expires = match ? new Date(`${raw}T23:59:59`) : new Date(NaN);
    if (!match || !Number.isFinite(expires.getTime()) ||
      expires.getFullYear() !== Number(match[1]) ||
      expires.getMonth() + 1 !== Number(match[2]) ||
      expires.getDate() !== Number(match[3]) ||
      expires <= now) {
      errors.accessExpiresAt = "Choose a valid future expiration date.";
    }
  }

  if (!canAssignRole) {
    errors.role = "Select an enabled workspace role you are allowed to assign.";
  }

  return errors;
}

export function firstPeopleAccountCreateError(errors: PeopleAccountCreateErrors): string {
  return errors.username || errors.email || errors.accessExpiresAt || errors.role || "";
}
