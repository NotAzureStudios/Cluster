-- Drop the tables behind the retired public-product compliance features.
--
-- Cluster is a self-hosted internal tool, so the DMCA case workflow, the
-- duplicate policy-document system, GDPR data-subject requests, consent
-- banners and behavioral analytics were removed. These tables have no writer
-- and no reader left in the application.
--
-- This destroys whatever those tables hold. Take a backup first if any of it
-- matters to you; nothing in Cluster reads it after this point.

-- Children before parents so the foreign keys go quietly. CASCADE covers the
-- constraints that point at them from each other.
DROP TABLE IF EXISTS "CopyrightResourceRestriction" CASCADE;
DROP TABLE IF EXISTS "CopyrightStrike" CASCADE;
DROP TABLE IF EXISTS "CopyrightCaseEvent" CASCADE;
DROP TABLE IF EXISTS "CopyrightEvidence" CASCADE;
DROP TABLE IF EXISTS "CopyrightCounterNotice" CASCADE;
DROP TABLE IF EXISTS "CopyrightCase" CASCADE;

DROP TABLE IF EXISTS "PrivacyErasureReceipt" CASCADE;
DROP TABLE IF EXISTS "PrivacyLegalHold" CASCADE;
DROP TABLE IF EXISTS "PrivacyDataRequest" CASCADE;
DROP TABLE IF EXISTS "PrivacyConsentPreference" CASCADE;
DROP TABLE IF EXISTS "ThirdPartyDisclosureProvider" CASCADE;

DROP TABLE IF EXISTS "BehavioralAnalyticsEvent" CASCADE;
DROP TABLE IF EXISTS "BehavioralAnalyticsProvider" CASCADE;

-- The policy system that stayed is StudioPolicy / StudioPolicyAcceptance,
-- which has an editor behind it. These two backed the duplicate that did not.
DROP TABLE IF EXISTS "PolicyAcceptance" CASCADE;
DROP TABLE IF EXISTS "LegalPolicyVersion" CASCADE;

-- Retention policy rows for a category that no longer exists.
DELETE FROM "DataRetentionPolicy" WHERE "category" = 'behavioral_analytics';
