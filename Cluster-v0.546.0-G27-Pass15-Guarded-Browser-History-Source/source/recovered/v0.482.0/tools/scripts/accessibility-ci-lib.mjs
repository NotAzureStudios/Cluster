export const ACCESSIBILITY_FAIL_IMPACTS = new Set(["critical", "serious"]);
export const ACCESSIBILITY_ALWAYS_BLOCK_RULES = new Set(["color-contrast"]);

export function normalizeAxeViolation(violation) {
  return {
    id: String(violation?.id || "unknown"),
    impact: violation?.impact || "unknown",
    description: String(violation?.description || ""),
    help: String(violation?.help || ""),
    helpUrl: String(violation?.helpUrl || ""),
    nodes: Array.isArray(violation?.nodes)
      ? violation.nodes.slice(0, 20).map((node) => ({
          impact: node?.impact || violation?.impact || "unknown",
          target: Array.isArray(node?.target) ? node.target.map(String) : [],
          html: String(node?.html || "").slice(0, 600),
          failureSummary: String(node?.failureSummary || "").slice(0, 1200),
        }))
      : [],
  };
}

export function summarizeAxeResult(result) {
  const violations = Array.isArray(result?.violations) ? result.violations.map(normalizeAxeViolation) : [];
  const blocking = violations.filter((violation) => ACCESSIBILITY_FAIL_IMPACTS.has(violation.impact) || ACCESSIBILITY_ALWAYS_BLOCK_RULES.has(violation.id));
  const incomplete = Array.isArray(result?.incomplete) ? result.incomplete.map(normalizeAxeViolation) : [];
  return {
    violations,
    blocking,
    incomplete,
    passes: Array.isArray(result?.passes) ? result.passes.length : 0,
  };
}

export function reportPassed(report) {
  return Boolean(report)
    && Array.isArray(report.surfaces)
    && report.surfaces.length > 0
    && report.surfaces.every((surface) => surface?.status === "passed" && Number(surface?.blockingViolations || 0) === 0)
    && Array.isArray(report.keyboardChecks)
    && report.keyboardChecks.every((check) => check?.passed === true);
}

export function safeReportSlug(value) {
  const normalized = String(value || "surface").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 80) || "surface";
}
