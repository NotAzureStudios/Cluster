# Server Operator Agreement system

Cluster v0.367 adds a third immutable legal-policy kind, `operator_agreement`, for the organization that deploys and administers a Cluster server. It is intentionally distinct from the user-facing Terms of Service.

## Purpose and parties

The Server Operator Agreement is a technical publication surface for an agreement between the actual Cluster licensor/distributor and the actual organization operating a deployment. Cluster does not assume that “Cluster” is itself a legal entity, and the starter scaffold requires administrators to identify the real parties before publication.

The agreement is meant to cover deployment authority, software/license scope, operator security responsibilities, user administration, content/IP boundaries, backups and disaster recovery, integrations, updates/support, termination, confidentiality, liability, and governing-law placeholders.

## Versioning and immutability

The agreement reuses `LegalPolicyVersion` with `kind = operator_agreement`. Each version has an independent version identifier and SHA-256 content hash. Drafts may be edited. Published versions are immutable and changes require a new version. A future effective date may be assigned while the currently effective published agreement remains available.

The starter scaffold is never automatically published.

## Access boundary

`GET /api/public/legal/operator-agreement` exposes only the currently effective published agreement and is readable before authentication. Administration uses `/api/admin/legal/operator-agreement/*` and therefore inherits Cluster's administrator authorization, recent-authentication, CSRF/origin, mutation-idempotency, rate/backpressure, and tamper-evident security-audit boundaries.

The public renderer is restricted Markdown and does not render raw HTML.

## Relationship to user Terms

The Server Operator Agreement is not the operator's Terms of Service with ordinary workspace users. Operators should use the separate `terms` policy for user-facing rules and the separate Privacy Policy for personal-data handling.

## Publication and acceptance are separate

Publishing an agreement does not prove that an operator accepted it. Cluster v0.367 intentionally does **not**:

- record an operator acceptance timestamp;
- bind an acceptance to the content hash;
- prevent operation until acceptance;
- implement re-acceptance after a material revision.

Roadmap Step 17 is implemented in v0.378.0. An operator can explicitly require acknowledgement or affirmative acceptance of an immutable Operator Agreement version for all users or administrators, with exact version/content-hash evidence. Publication by itself still does not create acceptance. See `docs/AUDITABLE_POLICY_ACCEPTANCE.md`.

## Legal review boundary

The starter agreement is drafting scaffolding, not legal advice. Sections that are especially transaction- or jurisdiction-sensitive are marked `[LEGAL REVIEW REQUIRED]`. Operators must review the actual software license, commercial relationship, local law, employment/consumer context, support obligations, and third-party licenses before publication.
