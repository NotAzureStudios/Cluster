# Desktop-native notification delivery

Cluster v0.402.0 implements Phase 4.5 of the desktop-native roadmap. The signed-in shared renderer remains the only component that reads the authenticated notification inbox. Native code receives only bounded notification presentation data through the allowlisted capability broker.

## Trust boundary

The renderer polls `/api/notifications` from inside the isolated WebView profile, where the HttpOnly server session already lives. Session cookies are never copied into the notification broker. The broker accepts only a bounded title, body, canonical Cluster route, opaque notification tag, and priority.

The capability surface is split into `notification.status` and `notification.show`. Status reports whether the operating-system notification surface is available, whether the desktop preference is enabled, and whether Cluster is currently the active application. Show requests remain subject to same-origin renderer validation, request replay protection, payload limits, a six-per-minute notification budget, and native duplicate-tag suppression.

## Delivery behavior

The desktop renderer polls the inbox every 30 seconds and immediately on focus/read-state changes. The first successful poll seeds a profile-local baseline instead of replaying historical unread items after an upgrade. Seen notification IDs are stored in the isolated WebView profile and capped at 256 entries.

Notification category and project-mode preferences are applied before delivery. Activity-only noise is not sent to the operating system. Multiple arrivals in one poll are collapsed into one notification that opens the Inbox. A single notification routes directly to its board, project, Calendar, Tickets, or Inbox context when that route is known.

The native broker suppresses duplicate tags and suppresses non-critical toasts while Cluster is already the foreground application. Critical notifications may still surface. Clicking an operating-system notification activates Cluster and navigates the shared renderer to the validated route.

## Native presentation

Critical notifications use the critical system-tray presentation and a longer timeout. High-priority notifications use the warning presentation. Other notifications use the information presentation. Updating the unread badge no longer creates a second generic native toast, so one server inbox event cannot generate both a detailed notification and a redundant “new workspace update” message.

## Failure behavior

Notification polling is non-blocking. Server errors continue through the existing Cluster server/recovery surfaces and do not make the application unusable. If notifications are disabled or unavailable, the renderer observes the inbox baseline without replaying a backlog when the capability is enabled later.

## Release-blocking boundary

`desktop-native-notifications-audit.mjs` verifies the authenticated renderer boundary, preference-aware polling, bounded baseline/duplicate state, native availability reporting, rate limiting, foreground suppression, priority presentation, click-through routing, duplicate generic-toast removal, package wiring, release notes, and API capability marker.
