import { normalizeLoginEmail, normalizePhoneLookup } from "@cluster/shared";

/**
 * Keeps the columns a sign-in is matched against in step with what was typed.
 *
 * Email is stored lower-cased and phoneLookup is derived from phoneNumber on
 * every write, so the login path can use indexed equality lookups instead of
 * reading the user table and filtering in memory.
 *
 * This runs as a Prisma client extension rather than at each call site:
 * email and phone are written from the profile editor, the admin directory,
 * invitations and the seed paths, and a derived column that one of them
 * forgets is worse than no derived column at all.
 */

type Mutable = Record<string, unknown>;

/** Reads a Prisma field that may be given plainly or as `{ set: value }`. */
function fieldValue(container: Mutable, key: string): { present: boolean; value: unknown } {
  if (!(key in container)) return { present: false, value: undefined };
  const raw = container[key];
  if (raw && typeof raw === "object" && !(raw instanceof Date) && "set" in (raw as Mutable)) {
    return { present: true, value: (raw as Mutable).set };
  }
  return { present: true, value: raw };
}

export function applyUserIdentityNormalization(data: unknown): void {
  if (!data || typeof data !== "object") return;
  if (Array.isArray(data)) {
    for (const entry of data) applyUserIdentityNormalization(entry);
    return;
  }
  const record = data as Mutable;

  const email = fieldValue(record, "email");
  if (email.present) {
    record.email = email.value === null || email.value === undefined ? email.value : normalizeLoginEmail(email.value);
  }

  const phone = fieldValue(record, "phoneNumber");
  if (phone.present) {
    // Derived, never supplied: an explicit phoneLookup in the same write is
    // replaced so the two columns cannot disagree.
    record.phoneLookup = phone.value === null || phone.value === undefined ? null : normalizePhoneLookup(phone.value);
  }
}

/** Prisma client extension: normalises User identity columns on every write. */
export const userIdentityNormalizationExtension = {
  name: "cluster-user-identity-normalization",
  query: {
    user: {
      create({ args, query }: any) {
        applyUserIdentityNormalization(args.data);
        return query(args);
      },
      createMany({ args, query }: any) {
        applyUserIdentityNormalization(args.data);
        return query(args);
      },
      createManyAndReturn({ args, query }: any) {
        applyUserIdentityNormalization(args.data);
        return query(args);
      },
      update({ args, query }: any) {
        applyUserIdentityNormalization(args.data);
        return query(args);
      },
      updateMany({ args, query }: any) {
        applyUserIdentityNormalization(args.data);
        return query(args);
      },
      upsert({ args, query }: any) {
        applyUserIdentityNormalization(args.create);
        applyUserIdentityNormalization(args.update);
        return query(args);
      },
    },
  },
} as const;
