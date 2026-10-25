# Cluster Terms of Service system

Cluster v0.366 adds a second versioned legal-policy type, `terms`, on top of the immutable `LegalPolicyVersion` store introduced for the Privacy Policy. The purpose of this feature is to give a self-hosted Cluster operator a technically reliable place to draft, publish, expose, and later reference its Terms of Service. It is not a substitute for jurisdiction-specific legal review.

## Security and publication invariants

- The public Terms document is readable before authentication at `/legal/terms` and `GET /api/public/legal/terms`.
- Public reads expose only the currently effective published `terms` document. Drafts remain administrator-only.
- Draft creation, editing, and publication live under `/api/admin/legal/terms/*`, so the normal administrator authorization, recent-authentication, CSRF/origin, idempotency, rate-limit, and security-audit boundaries apply.
- Published versions are immutable. Material changes require a new version instead of rewriting the historical document a user may have seen.
- Each version is SHA-256 hash-addressed over the document kind, normalized version, title, summary, and normalized Markdown body.
- Future effective dates are supported without hiding the currently effective published Terms.
- The server never silently publishes the starter document.
- The public renderer uses the same restricted Markdown presentation model as the Privacy Policy and does not enable raw HTML injection.

## Starter document

`starterTermsPolicy()` provides drafting scaffolding for common topics such as:

- operator/scope identification;
- eligibility and account responsibility;
- permission to use the service;
- ownership and operational permissions for user/studio content;
- Cluster/third-party software rights;
- acceptable use;
- third-party integrations;
- availability and maintenance;
- suspension/termination;
- privacy-policy linkage;
- warranty/liability/remedy placeholders;
- governing-law/dispute placeholders;
- change notices and legal contacts.

The starter deliberately labels provisions that need legal review and warns operators not to claim ownership or rights they do not actually possess. It is a scaffold, not a default legal position for every deployment.

## User surfaces

The Terms link is available from authentication screens, the authenticated sidebar, the Privacy & Data Control Center, privacy-choice surfaces, and the public Terms page itself. Studio administrators manage Terms versions from **Studio Settings → Privacy & data** alongside the other current legal/privacy controls.

## Explicit non-goals for v0.366

This step does **not**:

- force users to accept Terms before sign-in or workspace access;
- record who accepted which Terms version;
- decide when a policy change legally requires re-acceptance;
- create the separate studio/server-owner agreement planned for roadmap Step 6;
- implement Copyright/DMCA policy or reporting;
- determine whether consumer, employment, contractor, enterprise, or other contract law applies to a deployment.

Roadmap Step 17 is implemented in v0.378.0: an operator can explicitly require acknowledgement or affirmative acceptance of an immutable Terms version, and Cluster records exact version/content-hash evidence without treating publication itself as acceptance. See `docs/AUDITABLE_POLICY_ACCEPTANCE.md`.

## Operator guidance

Terms that are presented to users should be understandable and should not rely on hidden or misleading placement. Operators serving consumers in jurisdictions with mandatory consumer protections should have the finished document reviewed for required disclosures and potentially unfair/non-waivable terms before publication. Cluster provides versioning and delivery mechanics; enforceability remains a legal question outside the software boundary.
