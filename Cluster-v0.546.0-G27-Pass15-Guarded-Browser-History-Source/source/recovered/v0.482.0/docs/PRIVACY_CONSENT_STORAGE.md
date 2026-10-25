# Privacy consent and browser storage

Cluster v0.363.0 introduces an explicit browser-storage and external-content consent boundary for both the web renderer and the shared renderer hosted by the native desktop application.

## Categories

Cluster exposes four categories. **Strictly necessary** is always enabled because it covers authentication, security, offline synchronization, pending mutations/uploads, crash-recovery drafts, short-lived navigation handoff state, and the record of the user's privacy choice itself. **Preferences** is optional and covers local interface/media/search personalization. **External content** is optional and currently controls YouTube privacy-enhanced embeds. **Analytics** is optional and becomes available only when the self-hosted first-party analytics provider has been explicitly reviewed and enabled by an administrator. Cluster does not load third-party behavioral analytics SDKs, scripts, or tracking pixels.

Rejecting optional storage does not delete pending work, offline queues, authorized read caches, synchronization identity, or recovery drafts.

## Consent behavior

The current renderer consent notice is version 2.0. It presents equal access to **Reject optional**, **Customize**, and **Accept optional** actions. Step 18 intentionally advanced the notice from 1.0 so a pre-analytics optional choice cannot be reinterpreted as analytics consent. The choice is stored locally so the renderer can enforce it before login. When a user is authenticated, the same choice is synchronized to the user's `PrivacyConsentPreference` record so another browser can recover the last server-side choice after authentication.

A material consent-notice change must increment `PRIVACY_CONSENT_NOTICE_VERSION`. A stale local choice then becomes undecided and optional behavior returns to disabled until reviewed again.

Users can reopen the controls from authentication screens, User Settings, the authenticated sidebar, or the public Privacy Policy page.

## Declared storage

The public `GET /api/public/privacy/consent-config` endpoint is the machine-readable inventory used by the renderer and Studio Settings. It declares the authentication cookie, necessary local/session storage patterns, IndexedDB offline storage, optional preference keys, external providers, and the analytics provider list.

The authenticated endpoints are:

- `GET /api/privacy/consent`
- `PUT /api/privacy/consent`

The server does not accept a client request to enable analytics unless a reviewed provider is currently enabled, and the event-ingest endpoint independently re-checks the current persisted consent record before storing an event.

## Preference storage

The renderer's optional preference helper guards persistence for:

- theme mode;
- sidebar collapsed state;
- media volume, playback rate, and skip interval;
- local search-usage ranking personalization;
- the whiteboard autosave preference.

When preference consent is rejected or withdrawn, those known optional keys are purged. Necessary storage is not included in that purge list.

## External content

YouTube previews use `www.youtube-nocookie.com`, but Cluster still treats the iframe as optional external content. The iframe element is not created before consent. When blocked, Cluster shows a local placeholder with a Privacy choices action and a normal external link the user may choose to follow directly.

Revoking external-content consent unmounts an already visible embed on the next consent state update.

## What this step does not claim

This system is a technical consent and storage-control mechanism. It does not decide which laws apply to a particular self-hosted Cluster operator, whether a specific category legally requires consent in a jurisdiction, or whether future integrations are automatically safe to add to a category. New optional storage, tracking, analytics, or embedded providers must be added to the inventory and enforcement path before release. Roadmap Step 18 adds only Cluster's minimized first-party provider; any future third-party analytics provider remains a separate disclosure and consent review boundary.
