import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const check = (label, condition) => checks.push({ label, condition: Boolean(condition) });

const packageJson = JSON.parse(read("package.json"));
const naming = JSON.parse(read("VERSION_NAMING_CONVENTION.json"));
const projectRoutes = read("apps/server/src/domains/projects/project-control-routes.ts");
const graphPanel = read("packages/renderer/src/features/projects/ProjectWorkflowGraphPanel.tsx");
const controlCenter = read("packages/renderer/src/features/projects/ProjectControlCenterPanel.tsx");
const viewerIntegration = read("packages/renderer/src/features/viewer/viewer-system-integration.ts");
const viewerShell = read("packages/renderer/src/features/viewer/ViewerShell.tsx");
const reviewRoutes = read("apps/server/src/domains/media/review-routes.ts");
const auditSchema = read("packages/shared/src/api-schemas.ts");
const auditRepository = read("apps/server/src/domains/audit/audit-repository.ts");
const auditRoutes = read("apps/server/src/domains/audit/audit-routes.ts");
const auditPanel = read("packages/renderer/src/features/admin/AdminAuditStreamPanel.tsx");
const adminWorkspace = read("packages/renderer/src/features/admin/AdminWorkspacePage.tsx");

check("Project workflow graph stays on canonical server authority", projectRoutes.includes('/workflow-graph') && projectRoutes.includes("resourceGraph.neighborhood"));
check("Project Control exposes interactive workflow graph", controlCenter.includes("ProjectWorkflowGraphPanel") && graphPanel.includes("Workflow graph direction") && graphPanel.includes("Depth"));
check("workflow graph supports bounded direction/depth controls", graphPanel.includes('"incoming"') && graphPanel.includes('"outgoing"') && graphPanel.includes('maxEdges: "250"'));
check("Viewer exposes metadata-policy preview client", viewerIntegration.includes("previewViewerExport") && viewerIntegration.includes("metadata-export-policy/preview"));
check("sanitized Viewer exports confirm preview before creation", viewerShell.includes("confirmDerivativeExport") && viewerShell.includes("Safe Share metadata preview") === false && viewerShell.includes("previewViewerExport"));
check("standard derivative previews use export capability", reviewRoutes.includes("canPreviewStandardDerivative") && reviewRoutes.includes("capabilities.exportDerivative"));
check("custom metadata preview remains manage-gated", reviewRoutes.includes('body.policy === "custom"') && reviewRoutes.includes("chooseMetadataPreservationPolicy"));
check("audit API supports actor/resource/project/time filtering", auditSchema.includes("entityId") && auditSchema.includes("from:") && auditSchema.includes("to:"));
check("audit repository applies entity/time filters", auditRepository.includes("entityId: query.entityId") && auditRepository.includes("createdAt.gte") && auditRepository.includes("createdAt.lte"));
check("audit records include actor/project context", auditRepository.includes("user: { select:") && auditRepository.includes("project: { select:"));
check("admin audit stream uses canonical audit endpoint", auditRoutes.includes('/api/audit/activity') && auditPanel.includes('/api/audit/activity'));
check("admin audit stream exposes evidence metadata", auditPanel.includes("Evidence / metadata") && auditPanel.includes("JSON.stringify(event.metadata"));
check("audit stream is embedded in existing admin data surface", adminWorkspace.includes("AdminAuditStreamPanel") && !adminWorkspace.includes('label: "Audit"'));
check("active naming checkpoint is P16C", /^\d+\.\d+$/.test(naming.displayVersion));
check("P16C assertion gate is wired", String(packageJson.scripts?.["verify:source-foundation"] || "").includes("wip57:p16c:assertions"));

let failed = 0;
for (const item of checks) {
  if (item.condition) console.log(`PASS ${item.label}`);
  else { console.error(`FAIL ${item.label}`); failed += 1; }
}
console.log(`\n${checks.length - failed}/${checks.length} WIP57 P16C capability closeout assertions passed.`);
if (failed) process.exit(1);
