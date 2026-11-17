-- Email and phone become real login identifiers.
--
-- Before this, the login route resolved a phone number by reading up to 5,000
-- users and filtering them in memory, country codes broke matching, and
-- neither column was unique: two accounts sharing an email made the resolver
-- ambiguous, so both people silently failed to sign in with it.

-- 1. Email is stored lower-cased so one address has one stored form.
UPDATE "User" SET "email" = lower(btrim("email")) WHERE "email" IS NOT NULL AND "email" <> lower(btrim("email"));
UPDATE "User" SET "email" = NULL WHERE "email" IS NOT NULL AND btrim("email") = '';

-- 2. Stop rather than guess if two accounts claim one address. Resolving which
--    person keeps it is an administrator's decision, not a migration's.
DO $$
DECLARE conflicts text;
BEGIN
  SELECT string_agg(label, ', ') INTO conflicts FROM (
    SELECT format('%s (%s accounts)', "email", count(*)) AS label
      FROM "User" WHERE "email" IS NOT NULL GROUP BY "email" HAVING count(*) > 1
  ) duplicates;
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot make email a login identifier: these addresses are on more than one account: %. Clear the duplicates in People, then run the upgrade again.', conflicts;
  END IF;
END $$;

-- 3. phoneLookup holds the digits a sign-in attempt is matched against: the
--    last ten, so "+1 (555) 123-4567" and "555 123 4567" are one person.
ALTER TABLE "User" ADD COLUMN "phoneLookup" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

UPDATE "User"
SET "phoneLookup" = CASE
      WHEN length(regexp_replace(regexp_replace("phoneNumber", '\D', '', 'g'), '^00+', '')) < 7 THEN NULL
      WHEN length(regexp_replace(regexp_replace("phoneNumber", '\D', '', 'g'), '^00+', '')) > 10
        THEN right(regexp_replace(regexp_replace("phoneNumber", '\D', '', 'g'), '^00+', ''), 10)
      ELSE regexp_replace(regexp_replace("phoneNumber", '\D', '', 'g'), '^00+', '')
    END
WHERE "phoneNumber" IS NOT NULL;

DO $$
DECLARE conflicts text;
BEGIN
  SELECT string_agg(label, ', ') INTO conflicts FROM (
    SELECT format('%s (%s accounts)', "phoneLookup", count(*)) AS label
      FROM "User" WHERE "phoneLookup" IS NOT NULL GROUP BY "phoneLookup" HAVING count(*) > 1
  ) duplicates;
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot make a phone number a login identifier: these numbers are on more than one account: %. Clear the duplicates in People, then run the upgrade again.', conflicts;
  END IF;
END $$;

-- 4. Unique indexes serve both uniqueness and the login lookup.
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_phoneLookup_key" ON "User"("phoneLookup");

-- 5. An address that was already in use before verification existed is treated
--    as unverified: nothing has ever proved the mailbox belongs to the account.
