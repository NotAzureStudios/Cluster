# Admin Legal & Compliance Center

Cluster v0.376.0 completes Legal / Privacy / Accessibility Roadmap Step 15 by consolidating the operator-facing legal, privacy, accessibility, copyright, retention, and security-disclosure controls into one administration surface.

## Purpose

Earlier roadmap steps intentionally built each control as a separate security or legal boundary. Step 15 does not merge those backend boundaries or weaken their authorization. It gives administrators one place to understand their current configuration and reach the existing workflows without treating a long Studio Settings page as a compliance program.

The center is available to administrators from Studio Settings → Legal & Compliance and reads a no-store snapshot from `GET /api/admin/legal/compliance`.

## Snapshot

The server snapshot reports:

- the currently effective version, drafts, and scheduled versions for Privacy Policy, Terms of Service, Server Operator Agreement, Copyright & DMCA Policy, and Security & Vulnerability Disclosure Policy;
- pending privacy data requests, consent-record counts, declared external/analytics providers, configured retention policies, and the most recent retention run;
- open copyright cases, active counter-notices, legal holds, and disabled resources;
- release-gated accessibility/security engineering capabilities introduced by earlier roadmap steps; and
- bounded attention items such as unpublished policies, privacy requests awaiting review, legal holds, or an expired/soon-expiring `security.txt` record.

The snapshot deliberately excludes policy bodies, reporter personal information, evidence files, user export contents, raw security-audit evidence, credentials, and secrets. Those remain behind their dedicated workflows.

## Privacy-request operations

Step 15 also exposes the already-existing administrator privacy-request API in the UI. Pending requests can be resolved or rejected only with a written resolution note. This preserves the existing request-review model rather than turning deletion requests into an automatic destructive cascade.

## No compliance score

Cluster does **not** calculate a legal-compliance percentage or claim that a green dashboard proves GDPR, CCPA/CPRA, ADA/WCAG, DMCA, contractual, employment, or other legal compliance. Applicability depends on the operator, deployment, users, data, contracts, jurisdictions, and actual operating practices.

The dashboard therefore uses configuration/workflow warnings and explicitly labels itself as **not a legal, privacy, accessibility, or regulatory certification**.

## Authorization

The aggregate endpoint remains under `/api/admin/*`, so the centralized request-authorization boundary requires administrator access. It is read-only and `Cache-Control: no-store`. Mutations continue to use their original endpoints, confirmation requirements, CSRF/origin protection, recent-authentication rules, security audit coverage, and immutable publication rules.

## Roadmap boundary

Step 15 is consolidation and operator visibility. Third-party disclosure generation is implemented by Roadmap Step 16 in v0.377.0, and auditable user policy acceptance is implemented by Roadmap Step 17 in v0.378.0. Behavioral analytics provider/consent architecture is implemented by Roadmap Step 18 in v0.379.0; it remains disabled by default and first-party only.
