-- Cluster 0.506 removes the former permanent owner recovery password.
-- Recovery remains available through the authenticated owner and local server tools.
DROP TABLE IF EXISTS "OwnerRecoveryCredential";
