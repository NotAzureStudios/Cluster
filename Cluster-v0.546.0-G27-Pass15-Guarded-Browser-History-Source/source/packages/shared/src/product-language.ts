export const PRODUCT_TERMS = {
  home: "Home",
  projects: "Projects",
  boards: "Boards",
  whiteboards: "Whiteboards",
  timeline: "Timeline",
  tickets: "Tickets",
  builds: "Builds",
  qa: "QA",
  library: "Library",
  scheduler: "Scheduler",
  people: "People",
  operations: "Operations",
  administration: "Administration",
  inbox: "Inbox",
  myWork: "My Work",
  sourceControl: "Source Control",
  discord: "Discord",
  versioning: "Versioning",
} as const;

export type ProductTermKey = keyof typeof PRODUCT_TERMS;

export const PRODUCT_CONNECTION_STATES = {
  connected: "Connected",
  notConnected: "Not connected",
  checking: "Checking",
  healthy: "Healthy",
  needsAttention: "Needs attention",
  unavailable: "Unavailable",
  disabled: "Disabled",
  configured: "Configured",
  notConfigured: "Not configured",
} as const;

export const PRODUCT_OPERATION_STATES = {
  queued: "Queued",
  running: "In progress",
  retrying: "Retrying",
  completed: "Completed",
  failed: "Failed",
  blocked: "Blocked",
  cancelled: "Cancelled",
} as const;

export function productTerm(key: ProductTermKey) {
  return PRODUCT_TERMS[key];
}
