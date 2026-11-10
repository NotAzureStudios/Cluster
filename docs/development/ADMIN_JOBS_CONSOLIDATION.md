# Cluster administration and Jobs navigation

## Jobs worklist

Operations → **Jobs** is the canonical screen for durable queue work. It reuses the existing authorized `/api/admin/operations/jobs` endpoints rather than creating duplicate job storage. Operators can inspect status, live progress, queue and type, start/finish times, attempts, traces and errors, retry eligible jobs, cancel running or queued jobs, and export filtered results. The worker and database remain authoritative.

The existing `operations-center` section resolves to Jobs for old navigation links, but the **Systems** page no longer embeds a second constantly refreshing Jobs panel. The scheduler and operational event history mount only when explicitly opened. Job list refresh uses the pre-existing visibility-aware interval (20 seconds) and cursor paging.

## Settings consolidation

Studio Settings top-level categories: Studio, People & Access, Projects, Delivery, Automation. Server Configuration top-level categories: Runtime, Network & domains, Security & Access, Data & Recovery, Extensions. Both show a contextual subsection selector that preserves the old concrete section IDs (for existing deep links, search, save gates and permissions). Studio Settings search indexes previously hidden destinations such as studio forms/policies and project types.

The main application sidebar keeps one Studio Settings link and an optional expandable collection of specialist shortcuts, reducing duplicate administration links while retaining power-user paths.

No DB migration, arbitrary job management authority, hidden automatic restart or new recurring polling loop is introduced.

## Follow-up validation

CI source tests and shared/renderer compilation validate the new navigation. Test manually on Windows and tablet widths: open each tab, verify original protected-save flows and maintenance/backup gates, test job filtering/detail/cancel/retry with actual queued jobs, and confirm no duplicate requests from collapsed panels.

The separately supplied Cluster sign-in screenshot shows an API failure message, not a specific cause. Authentication cannot be diagnosed from the visual alone; use the associated API response code/request ID and Server logs. This UI pass does not change sign-in/authentication behavior.

## Visual and copy pass

Jobs uses the existing Cluster status chip and offline curated icons. Running is accent/info, succeeded is success, failed/dead-letter is danger, and queued/cancelled remain neutral. Counts are shown as labelled, keyboard-operable filters; progress bars preserve the actual source percentage rather than fabricating completion. The duplicate state selector and repeated lease count were removed. Loading and API-error states must not display a false 'queue clear' indicator.

Studio and Server category tabs have small offline icons and understated selected-state borders. Studio search shares the tab row at desktop widths. A clean Studio draft no longer displays both 'Saved' and 'No pending edits'; unsafe/draft changes retain their warnings and review paths. Server technical configuration source/path is visible under All settings rather than every section. Network restart and authentication safety copy stays visible.

The Systems-to-Jobs link is one compact interactive row, not another explanatory card. Event history and analytics remain opt-in.
