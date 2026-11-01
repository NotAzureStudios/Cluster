# Cluster 1.0 RC46: Setup, Network, Whiteboard, People & Profile UI polish

Built from RC45 source, with no database schema migration. This is a combined test checkpoint, not the certified stable release.

## First-run UI
- Native setup option buttons explicitly inherit semantic foreground colors. Covers title, supporting text, selected/hover, focus states and light/dark UI.

## Guided network access
- Adds **Server Configuration → Network → Connection assistant** with trusted LAN, private Tailscale Serve, and Cloudflare Tunnel/Access guidance.
- Steps, copied local connection details, and public HTTPS URL staging feed the **existing** protected network preview and PIN-confirmed save path.
- No automatic DNS, firewall, public port, tunnel, host binding, TLS, or connectivity certification. Public API and PostgreSQL must stay private. Verify a real remote client and MFA before sharing.

## Department visual identity
- Departments receive editable offline icons and accent colors in Studio Settings, inherited default presets, visible department list and People representations, and backend validation for allowed IDs/colors.
- This metadata uses the existing Studio Settings authority, not a separate directory or request per icon.

## People profiles and responsiveness
- Clicking a person in the directory now opens a full-width profile with a stronger header, bio, project/team summary, authorized activity and tabs for Work, Calendar, Activity, Access, and Full Profile. Back returns to the directory. No invented social posts, feeds, or publishing API.
- Explicit desktop inspector close control. Fixed rigid desktop grid override that made resizing inconsistent.
- Person profile loads immediately from its authorized API, without waiting for an unrelated 1000-record Team context request. Context is loaded separately and remains identity-scoped. Hidden location does not show in overview.
- Existing sensitive account details and personnel records retain their authorization gates. Exact profile fields remain accessible.

## Boards and Whiteboards
- Corrected Board close to navigate to its originating screen rather than automatically navigating to the board's parent Project. From the Project itself, returning to that Project remains correct.
- Whiteboards create a blank canvas by default. Templates are deliberate actions.
- MS Paint-style brush eraser now clips freehand paths/standalone lines to the brush footprint, preserves distant stroke fragments, and interpolates pointer movement. Object delete is a separate explicit mode; locked items remain intact. Non-pen diagram shapes are preserved in brush mode.

## Domains and integrations
- Shortened repeated domain description text, added optional help disclosures for registrar and server binding details.
- Provider table shows local platform service identity glyphs and hides the advanced capability/permissions columns by default without removing them. Preserves health and configuration indicators.

## Validation and known gaps
- Node and source-level checks pass, including actual eraser geometry checks, inherited RC36–RC45 checks, and 139 domain-network cases.
- Full Windows Node 24/Prisma/renderer compilation, React interaction tests and the native Windows control panel have **not** been executed in this environment. The RC46 EXE runs the dependency-backed build on Windows when installed. No claim that network connectivity is automatically activated.
- Global sidebar collapse and the broader profile social features (custom covers, publishing content, followers and comments) are not part of this pass; the social-style profile uses existing authorized work data only.
