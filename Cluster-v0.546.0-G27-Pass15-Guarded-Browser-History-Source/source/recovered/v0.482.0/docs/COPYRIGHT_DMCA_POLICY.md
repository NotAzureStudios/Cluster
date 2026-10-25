# Copyright & DMCA Policy system

Cluster v0.368 adds an immutable `copyright_dmca` legal-policy kind for copyright notices and, where applicable, a U.S. DMCA process. It reuses the same versioned `LegalPolicyVersion` store as Privacy, Terms, and the Server Operator Agreement.

## Boundary

The public policy is publication infrastructure, not legal qualification. Cluster never silently publishes the starter document and does not claim that a self-hosted operator qualifies for a limitation on liability under 17 U.S.C. § 512 merely because this feature is enabled.

If a U.S. service provider seeks to use the designated-agent mechanism in § 512(c)(2), it must separately satisfy the applicable statutory and U.S. Copyright Office requirements. Publishing agent details in Cluster does not register an agent with the Copyright Office.

The starter scaffold prompts the operator to review the notice elements in § 512(c)(3), counter-notification requirements in § 512(g)(3), repeat-infringer/standard-technical-measures considerations in § 512(i), and operator/contact details. Those prompts are not a jurisdiction-specific legal opinion.

## Versioning and publication

`LegalPolicyVersion.kind = copyright_dmca` has its own version namespace. Drafts can be edited. Published versions are SHA-256 hash-addressed and immutable; revisions require a new version. A future effective date may be scheduled while the currently effective published version remains public.

Public read:

- `GET /api/public/legal/copyright`
- `/legal/copyright`

Administrator management:

- `GET /api/admin/legal/copyright`
- `POST /api/admin/legal/copyright/versions`
- `PATCH /api/admin/legal/copyright/versions/:policyId`
- `POST /api/admin/legal/copyright/versions/:policyId/publish`

Administrator mutations inherit Cluster's centralized authorization, recent-authentication, CSRF/origin, idempotency, abuse/backpressure, and security-audit boundaries.

## Rendering

The public page uses the same restricted Markdown renderer as the other legal documents. Raw HTML is not injected into the page.

## Explicit non-goals for v0.368

This release does **not**:

- register a DMCA designated agent with the U.S. Copyright Office;
- decide whether the deployment/operator is eligible for § 512 limitations on liability;
- accept or adjudicate infringement notices in a structured case workflow;
- accept or adjudicate counter-notifications in a structured case workflow;
- automatically remove, restore, or disable user content;
- implement repeat-infringer case scoring or automatic termination;
- replace legal review for notice/counter-notice language or jurisdiction-specific procedures; or
- treat publication as evidence of policy acceptance.

The structured copyright-reporting workflow is implemented in v0.369 and documented in `COPYRIGHT_REPORTING_WORKFLOW.md`. Auditable policy acceptance is implemented by Roadmap Step 17 in v0.378.0 for supported policy kinds; copyright policy publication itself still does not create acceptance evidence.
