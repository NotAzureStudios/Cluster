const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const SENSITIVE_MUTATION_PREFIXES: Array<[string, string]> = [
  ["/api/admin/", "admin"],
  ["/api/server-config", "server_configuration"],
  ["/api/settings", "settings"],
  ["/api/access-rules", "authorization"],
  ["/api/context-packs", "context_pack"],
  ["/api/persistence", "persistence"],
  ["/api/communication", "communications"],
];

export function securityAuditPolicyForRequest(pathname: string, method: string, statusCode: number) {
  const path = String(pathname || "/").split("?")[0];
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (!UNSAFE_METHODS.has(normalizedMethod)) return null;

  let category: string | null = null;
  for (const [prefix, candidate] of SENSITIVE_MUTATION_PREFIXES) {
    if (path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)) {
      category = candidate;
      break;
    }
  }
  if (!category && path === "/api/users" && normalizedMethod === "POST") category = "identity";
  if (!category && /^\/api\/users\/[^/]+$/.test(path) && ["PATCH", "DELETE"].includes(normalizedMethod)) category = "identity";
  if (!category && path === "/api/projects" && normalizedMethod === "POST") category = "project_administration";
  if (!category && /^\/api\/projects\/[^/]+$/.test(path) && normalizedMethod === "DELETE") category = "project_administration";
  if (!category) return null;

  return {
    category,
    event: `request.${category}_mutation`,
    result: statusCode >= 400 ? "FAILURE" as const : "SUCCESS" as const,
    reasonCode: `HTTP_${statusCode}`,
  };
}
