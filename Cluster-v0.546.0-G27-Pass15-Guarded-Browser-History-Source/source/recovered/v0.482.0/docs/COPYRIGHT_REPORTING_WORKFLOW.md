# Copyright Reporting Workflow

Cluster v0.369 adds a structured copyright case workflow for self-hosted deployments. It is operational infrastructure, not legal advice and not a representation that a deployment qualifies for any U.S. DMCA safe harbor.

## Case intake

A public reporter can submit a claimed-infringement notice without a Cluster account. The form requires the core notice elements used by the U.S. Copyright Office's section 512 guidance: identification of the copyrighted work, identification/location of the complained-of material, reporter contact information, a good-faith statement, an accuracy/authority statement under penalty of perjury, and a physical or electronic signature.

Cluster returns a public case reference plus a random private access token. The token is stored only as a SHA-256 hash. Reporter-side status is available only when both values are supplied. Case-status responses use `Cache-Control: no-store`.

## Evidence

A notice or counter-notice may include up to five supporting files. Each file is limited to 2 MiB and the total submission is capped. Evidence accepts passive image, PDF, or text formats only. Executable/script-like payloads are rejected. Stored filenames are server-generated, content is SHA-256 hashed, and evidence is written under Cluster-managed upload storage with private file permissions where supported. The upload tree is included in Cluster's normal backup generations.

## Managed-resource linking

A case may be linked to one Cluster-managed resource:

- `knowledge_item`
- `project_file`
- `video_asset`

The server resolves the resource and authoritative uploader account. A public reporter cannot directly force a takedown by supplying an identifier; only an administrator can apply a resource restriction.

## Reversible takedown

The operator can disable access without deleting the underlying file. Disabled resources return HTTP 451 from their normal content endpoint and are omitted from ordinary project media/file listings where appropriate. The restriction record remains tied to the copyright case so restoration is reversible and auditable.

## Uploader notification and counter-notice

When access is disabled, Cluster records an in-app activity notification for the associated uploader and links to the authenticated counter-notice page. A counter-notice requires the submitter's contact information, signature, identification/location of the disabled material, an attestation under penalty of perjury that removal resulted from mistake or misidentification, consent to the applicable federal-court jurisdiction, and agreement to accept service of process.

Cluster calculates the 10- and 14-business-day dates from receipt of the counter-notice using a conservative U.S. workflow calendar that excludes weekends and common observed federal holidays. These timestamps are workflow aids, not legal conclusions; operators remain responsible for confirming any applicable deadline.

## Forwarding and reporter notification

Cluster does not currently ship a general outbound-email provider. Instead, the operator must forward the counter-notice copy to the original reporter using the recorded contact information and explicitly confirm that delivery in the case workflow. Once forwarding is recorded, the reporter's private case portal exposes the forwarded counter-notice and the public case timeline records the event.

This explicit delivery task is intentional: Cluster must not claim a counter-notice was forwarded when no delivery transport exists.

## Restoration and legal action

Normal counter-notice restoration is blocked before the 10-business-day minimum. A recorded legal-action notice puts the case on legal hold and blocks the normal counter-window restoration path. Administrative correction or rejection-based restoration is available with a required operator note.

Cluster does not automatically restore at day 14 or automatically adjudicate infringement. The admin workflow highlights restoration deadlines so the deployment operator can make the required decision.

## Repeat-infringer review

An administrator may record or rescind a copyright strike tied to a case and uploader. Cluster groups active strikes by user and marks accounts with three or more active strikes as `reviewRecommended`.

The value `3` is an operational review signal only. Cluster does not automatically terminate accounts and does not claim that any fixed strike count satisfies a deployment's repeat-infringer obligations. The operator's published policy and legal review remain authoritative.

## Auditability

The workflow records:

- immutable notice/counter-notice content hashes;
- case status and reviewer assignment;
- evidence hashes and metadata;
- access-disable and restore state;
- counter-notice forwarding confirmation;
- legal-action timestamps;
- repeat-infringer strike state;
- case timeline events; and
- security-audit events for privileged case actions.

Sensitive reporter/token/signature/contact fields are removed from generic case-event metadata.

## Security boundaries

- Public notice/status endpoints are method-specific public routes and remain subject to Cluster's IP/workload limits.
- Notice/counter evidence receives a dedicated heavy-request body ceiling.
- Admin case actions remain under `/api/admin/*`, central server authorization, recent-authentication rules, CSRF/origin enforcement, idempotency, backpressure, and the security audit trail.
- Reporter status tokens are never stored in plaintext.
- A public case token does not grant access to the underlying reported Cluster resource.

## Deliberate non-claims

This feature does not determine whether a deployment is an eligible online service provider, whether a notice or counter-notice is legally sufficient in a particular jurisdiction, whether content actually infringes copyright, whether fair use applies, or whether a deployment satisfies section 512. Operators should obtain appropriate legal review.
