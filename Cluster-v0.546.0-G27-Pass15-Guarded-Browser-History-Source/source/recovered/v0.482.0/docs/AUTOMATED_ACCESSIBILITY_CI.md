# Automated Accessibility CI

Cluster v0.372.0 completes Legal / Privacy / Accessibility roadmap Step 11 by turning the accessibility baseline and user preferences from v0.370-v0.371 into an automated release gate.

## Goals

The automated accessibility gate is designed to catch regressions that source review alone cannot reliably detect. It combines source-level guardrails with a real Chromium session that renders Cluster, signs into a disposable test workspace, exercises keyboard behavior, and runs automated WCAG-oriented checks against representative surfaces.

This gate is a regression-control system. It is not a declaration that Cluster is fully conformant with WCAG, ADA, EN 301 549, Section 508, or any other legal or procurement standard.

## Commands

`npm run accessibility:static`

Runs fast renderer-source checks. It blocks known accessibility anti-patterns that Cluster has already removed, including fake `role="button"` controls, untitled iframes, missing image alternative text, and loss of the shared skip-link/focus/listbox infrastructure.

`npm run accessibility:ci`

Runs the static audit and then launches the built Cluster server and Web application against an isolated PostgreSQL schema. A headless Chromium session executes the runtime checks and writes:

`.cluster/accessibility/accessibility-report.json`

Screenshots are written under `.cluster/accessibility/screenshots/` when a runtime surface has blocking violations.

## Runtime surfaces

The automated browser currently checks representative public and authenticated surfaces:

- Sign in
- Public copyright-reporting flow
- Authenticated Home
- Projects when available in the seeded test workspace

The suite deliberately uses the real shared renderer, API, session cookie, authorization path, and disposable development-login account rather than a static component mock.

New high-risk shared surfaces should be added to this set when they introduce a new interaction primitive or accessibility pattern.

## Automated semantic checks

The Chromium run injects axe-core and evaluates a WCAG 2.x A/AA automated subset.

The CI gate fails on:

- axe findings classified as `critical`
- axe findings classified as `serious`
- color-contrast violations even when the engine classifies them below `serious`

All other violations and incomplete/manual-review findings remain in the JSON report for inspection rather than being discarded.

This policy intentionally makes contrast a hard gate while avoiding the false claim that every accessibility requirement can be automatically decided by a browser engine.

## Keyboard checks

The runtime gate also performs behavior that a source scanner cannot prove:

### Skip navigation

The first keyboard focus on the signed-out application must reach Cluster's global `Skip to main content` link. Activating that link must move focus to the main landmark.

The sign-in username input therefore no longer forcibly steals initial focus from keyboard users.

### Modal focus

The authenticated Command Palette is opened from its keyboard shortcut. CI verifies that:

- a modal dialog appears
- focus moves inside the dialog
- Escape closes it
- usable focus remains after closure

Additional keyboard-only flows should be added when Cluster introduces new shared modal, menu, canvas, drag-and-drop, or composite-widget primitives.

## Build requirements

Runtime accessibility CI requires:

- built server output
- built Web output
- a disposable PostgreSQL database
- Playwright Chromium
- axe-core

The script creates an isolated PostgreSQL schema and temporary Cluster data directory so it does not depend on a developer's real workspace.

CI installs the Chromium runtime explicitly before executing the gate.

## Pull-request / main CI

The Linux server/Web CI job now:

1. installs the dependency graph
2. installs Chromium for Playwright
3. runs the normal release preflight/build
4. runs `npm run accessibility:ci`
5. uploads `.cluster/accessibility` even when the accessibility step fails
6. continues with the existing integration and backup/restore gates only after accessibility passes

A blocking accessibility regression therefore fails ordinary CI rather than waiting for a tagged release.

## Release certification

Tagged release certification executes accessibility through the normal tamper-evident release evidence wrapper using the `accessibility` gate.

The final certification ledger requires:

- passing `accessibility` gate evidence
- a passing runtime accessibility report
- matching Cluster version
- at least three audited runtime surfaces
- keyboard-check evidence
- SHA-256 integrity for the packaged accessibility report

The report is preserved in the Master artifact as:

`Evidence/accessibility-report.json`

Certified packaging fails closed when the report or accessibility gate is missing.

## Native Desktop scope

The shared Web renderer is used inside Cluster Desktop, so the Chromium gate covers most application-level semantics and interaction logic used by both hosts.

Qt-native shell accessibility remains additionally protected by:

- the Step 9 source contract
- the Step 10 native preference contract
- Qt compilation in Windows CI
- Desktop launch smoke testing

Automated Windows screen-reader/UI Automation assertions are not claimed by this step. They can be added later as dedicated native certification evidence without weakening or replacing the shared-renderer gate.

## Manual review remains required

Automated tooling cannot reliably decide every accessibility question. Release review still needs human testing for areas such as:

- screen-reader reading order and usefulness
- whether names and descriptions make sense in context
- complex Board and Whiteboard workflows
- zoom/reflow at unusual viewport sizes
- high-contrast and forced-colors usability
- cognitive load and clarity
- captions/transcripts for future media features
- platform-specific accessibility APIs

An automated green result means Cluster passed the defined regression gate. It does not mean every human accessibility requirement has been proven.

## Roadmap boundary

Step 11 implements automated accessibility CI only.

Roadmap Step 12 remains the direct-resource authorization regression suite. The accessibility gate must not be treated as completion of later security/compliance work.
