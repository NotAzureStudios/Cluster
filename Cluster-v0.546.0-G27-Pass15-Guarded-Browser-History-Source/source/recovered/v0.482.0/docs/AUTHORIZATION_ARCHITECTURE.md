# Cluster authorization architecture

Cluster treats server-side authorization as the only security boundary for application resources. Renderer visibility, disabled buttons, navigation guards, and native-shell state are usability controls only. A request that reaches the API must independently prove both the required capability and access to the concrete resource it targets.

## Request boundary

Authenticated requests pass through a centralized Fastify `preHandler` authorization boundary before route handlers execute. The boundary is method-aware and fail-closed:

- safe reads require at least `view` for the route capability;
- ordinary mutations require the corresponding edit/contribute level;
- administrative namespaces and privileged configuration mutations require an administrator;
- public routes are explicit method/path pairs rather than broad path-prefix exemptions;
- CSRF and origin enforcement remain independent controls and apply to unsafe API requests even when a route is intentionally public.

The route policy maps behavior to the capability that owns it, not merely the URL section in which it happens. Build workflow records require Builds access, QA workflow records require QA access, tickets require Tickets access, server configuration requires Server Configuration access, and so on.

## Capability plus resource access

Authorization is the intersection of two checks:

1. **Tool capability**: the user's resolved studio role, department template, and per-user override determine the maximum permission for a tool (`none`, `view`, `edit`, or `manage`).
2. **Resource access**: project membership/role and explicit access rules determine access to the concrete project or child resource (`none`, `view`, `contribute`, or `manage`).

A project permission can never raise a user above the owning tool's permission. Access-rule grants are likewise capped by the tool capability. Missing or projectless resources do not receive an implicit `view` grant.

Owners and administrators retain the explicit administrative override. Expired users fail closed.

## Authoritative target resolution

Client-supplied parent IDs are hints, never proof of ownership. Before applying a permission decision Cluster resolves the target from PostgreSQL and derives its real parent chain. This is required for:

- projects and project children;
- boards, lists, cards, checklist items, and tickets;
- project files and video assets;
- whiteboards and library items;
- calendar and timeline records;
- time entries and schedule blocks;
- custom-field values and access-rule targets;
- project share links;
- build and QA workflow records.

If a request supplies both a child and parent, Cluster rejects a mismatch instead of authorizing against the submitted parent. This prevents broken-object-level-authorization attacks where access to Project A is presented alongside an object ID that actually belongs to Project B.

## Alias and secondary-route enforcement

A protected resource must keep the same security semantics through every API alias. In particular, ticket cards cannot bypass the Tickets capability by using generic Boards, Cards, or Checklist endpoints. System ticket boards and cards labelled as tickets are capped by Tickets permission in addition to their board/project permission.

The same rule applies to workflow records: a generic persistence route does not turn build or QA data into an unscoped generic object.

## User-scoped resources

User-owned resources use an explicit self-versus-manager policy. A user can operate on their own resource only when they hold the underlying tool permission. Access to another user's resource requires the tool's manage permission unless a narrower route explicitly defines otherwise.

Calendar events, timeline records, time entries, and schedule blocks combine this user-scope check with project authorization when they are attached to a project. A Time manager therefore does not automatically gain visibility into every project.

## Collection filtering

Authorizing a collection endpoint is not sufficient if individual rows have different resource scopes. Cluster filters returned calendar, timeline, scheduler, and related aggregate records against the same object-level checks used by detail endpoints before serialization or summarization. Hidden rows do not contribute names, counts, exceptions, or project summaries.

## Mutation and re-parenting rules

Create and update routes validate both the existing resource and its proposed destination. Re-parenting an object requires access to the destination project/resource before the database mutation occurs. Scheduler references are canonicalized from card to board to project, and inconsistent combinations are rejected.

Custom-field reads and writes resolve the concrete entity first. Batch custom-field requests cannot gain access by attaching an allowed `projectId` to an entity from another project, and stored custom-field parent metadata uses the server-resolved canonical project.

## Administrative and secret-bearing surfaces

`/api/admin/*` fails closed at the request boundary. Context-pack reads and exports also require administrator access because exported context may contain integration or configuration secrets. Privileged server configuration, persistence administration, user administration, and similar control-plane mutations are classified as administrative operations even if a renderer happens to hide them.

## Regression requirements

A release must fail its source/release contracts if it loses any of these properties:

- method-aware public-route allowlisting;
- centralized pre-handler authorization;
- capability caps on project and child resources;
- default-deny behavior for projectless targets;
- authoritative child-to-parent resolution;
- ticket alias enforcement;
- user-scope enforcement;
- project-aware collection filtering;
- destination authorization on re-parenting;
- admin-only context-pack/control-plane access;
- origin and CSRF protection on unsafe public API requests.

New resource types must declare their owning capability, parent-resolution strategy, user-scope semantics where applicable, and collection filtering behavior before being considered production-ready.
