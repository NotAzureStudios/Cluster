# Cluster TD3 Pass 25 | Transfer and job feedback ownership

Baseline: TD3 Pass 24. Source implementation only; no PostgreSQL schema, Windows native executable, or release-certification changes.

## Changes

- **Transfer Center** now owns immediate single-flight admission for bulk retry, browser uploads (pause/resume/retry/remove), desktop transfers (pause/resume/retry/cancel/open), and guarded menu dismissal. A second action cannot begin before the pending UI renders. Errors are visible inside the existing taskbar panel rather than swallowed or left as unhandled async rejections.
- Native transfer push events can arrive faster than asynchronous list refreshes. Only the latest requested refresh may replace the displayed list, and unmount invalidates outstanding results.
- Retry All only invokes transports that have failed transfers. Browser-only users no longer receive a spurious Desktop-capability failure when retrying an offline browser upload. Partial retry failures are displayed, not swallowed by Promise.allSettled.
- **Import/export progress feedback** now consumes a shared job-ID-owned polling hook. It never renders a previous job's success/download link for a newly selected job. Status requests from obsolete jobs/unmounted panels are ignored. Hidden pages stop polling; visibility restoration resumes only nonterminal jobs.
- Error feedback has scoped, contrast-aware CSS using existing shell material variables. No new Appearance options were created.

## Regression preservation

Project tabs remain the only default taskbar tabs. Animated search replaces only the project tab area. My Work, Tickets, Transfer Center, notifications, account/presence, floating/docked shell modes, and People rounded-square color-ring/presence-dot treatment remain in place.

## Development validation boundary

Source syntax/import/CSS scans, inherited TD1/TD2 and TD3 development scripts, new action/newest-response tests, and illustrative Chromium CSS fixtures are development checks, not a compiled application or native Windows runtime certification. The latter stays exclusively in the separate release roadmap.
