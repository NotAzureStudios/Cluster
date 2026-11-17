/**
 * Normalisation for the three things a person can sign in with: username,
 * email address and phone number.
 *
 * Server and client share this file so a value typed into the sign-in box is
 * matched the same way it was stored.
 */

/**
 * Lower-cases and trims an email address for storage and lookup.
 *
 * Email domains are case-insensitive, and every mail provider Cluster is
 * likely to meet treats the local part that way too, so one stored casing
 * keeps the address usable as a unique login identifier. Returns null when
 * the value is empty or obviously not an address.
 */
export function normalizeLoginEmail(value: unknown): string | null {
  const raw = String(value ?? "").normalize("NFKC").trim().toLowerCase();
  if (!raw || raw.length > 320) return null;
  const at = raw.indexOf("@");
  // Exactly one "@", with something either side, and no whitespace.
  if (at < 1 || at !== raw.lastIndexOf("@") || at === raw.length - 1) return null;
  if (/\s/.test(raw)) return null;
  return raw;
}

/**
 * Reduces a phone number to the digits a login attempt is matched against.
 *
 * Everything but digits is dropped, an international prefix (00) is removed,
 * and numbers longer than ten digits keep their last ten. That makes
 * "+1 (555) 123-4567", "1-555-123-4567" and "555 123 4567" the same person,
 * which is the case that failed before.
 *
 * Keeping the last ten digits means two numbers that differ only in their
 * country code collide. That is the right trade for a studio whose people
 * share a country, and the stored phoneNumber keeps the original text; if
 * Cluster ever needs several countries at once, this becomes a real E.164
 * parse and the column is rebuilt from phoneNumber.
 */
export function normalizePhoneLookup(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "").replace(/^00+/, "");
  if (digits.length < 7) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** True when the text looks like someone meant an email address. */
export function looksLikeEmail(value: unknown): boolean {
  return String(value ?? "").includes("@");
}
