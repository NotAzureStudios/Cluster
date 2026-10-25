import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const text = (relative) => readFile(path.join(root, relative), "utf8");
let passed = 0;
let total = 0;
function check(label, ok) {
  total += 1;
  if (!ok) { console.error(`FAIL  ${label}`); process.exitCode = 1; return; }
  passed += 1;
  console.log(`PASS  ${label}`);
}

const [contracts, errors, apiResponse, server, openapi, apiClient, rendererApi, requestState, appBoundary, featureBoundary, createError, styles, docs, pkgText, packager, notes] = await Promise.all([
  text("packages/shared/src/api-contracts.ts"),
  text("packages/shared/src/error-codes.ts"),
  text("apps/server/src/core/api-response.ts"),
  text("apps/server/src/app/cluster-server.ts"),
  text("apps/server/src/core/openapi.ts"),
  text("packages/api-client/src/index.ts"),
  text("packages/renderer/src/core/api.ts"),
  text("packages/renderer/src/components/RequestState.tsx"),
  text("packages/renderer/src/components/AppErrorBoundary.tsx"),
  text("packages/renderer/src/components/FeatureBoundary.tsx"),
  text("packages/renderer/src/features/create/CreateErrorPanel.tsx"),
  text("packages/renderer/src/styles/design-system/workspace-polish.css"),
  text("docs/ERROR_RECOVERY_PHASE11.md"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("RELEASE_NOTES_v0.434.0.md"),
]);

check("API error contract requires operation", contracts.includes("operation: string;") && contracts.includes("route-template"));
check("API error contract requires occurrence time", contracts.includes("occurredAt: string;"));
check("API contract advances for additive error metadata", contracts.includes('version: "2026-08-02.63"'));
check("client render error codes are catalogued", errors.includes('code: "CLIENT_RENDER_ERROR"') && errors.includes('code: "CLIENT_FEATURE_RENDER_ERROR"'));

check("server operation label uses route template", apiResponse.includes("request.routeOptions?.url") && apiResponse.includes("apiOperationLabel"));
check("server operation label excludes query string fallback", apiResponse.includes('.split("?")[0]'));
check("server apiError stamps operation", apiResponse.includes("operation: apiOperationLabel(request)"));
check("server apiError stamps occurrence", apiResponse.includes("occurredAt: new Date().toISOString()"));
check("server normalization preserves operation and occurrence", apiResponse.includes("body.operation || context.operation") && apiResponse.includes("body.occurredAt || context.occurredAt"));
check("server onSend normalizes all API errors", server.includes("normalizeApiErrorBody(JSON.parse(payload)") && server.includes("apiOperationLabel(request)"));
check("OpenAPI requires new error metadata", openapi.includes('"operation", "occurredAt"') && openapi.includes('occurredAt: { type: "string", format: "date-time" }'));

check("API client preserves operation", apiClient.includes("readonly operation") && apiClient.includes("record?.operation"));
check("API client preserves occurrence time", apiClient.includes("readonly occurredAt") && apiClient.includes("record?.occurredAt"));
check("API client sanitizes fallback operation", apiClient.includes("sanitizedOperation") && apiClient.includes('return ":id"'));
check("invalid-response fallback records operation", apiClient.includes("context?.pathname ? sanitizedOperation"));

check("renderer ApiError owns operation", rendererApi.includes("operation?: string | null") && rendererApi.includes("this.operation"));
check("renderer ApiError owns occurrence time", rendererApi.includes("occurredAt: string") && rendererApi.includes("this.occurredAt"));
check("renderer separates matchable recovery kinds", rendererApi.includes('ApiErrorRecoveryKind = "retry"') && rendererApi.includes('"work_offline"') && rendererApi.includes('"review"'));
check("renderer network errors retain failed operation", rendererApi.includes('"NETWORK_UNAVAILABLE", { operation, occurredAt }'));
check("renderer timeout errors retain failed operation", rendererApi.includes('"REQUEST_TIMEOUT", { operation, occurredAt }'));
check("renderer diagnostic bundle is bounded", rendererApi.includes('.slice(0, 8_000)'));
const diagnosticsBlock = rendererApi.slice(rendererApi.indexOf("export function formatApiErrorPresentationDiagnostics"), rendererApi.indexOf("function combineSignals"));
check("diagnostic bundle excludes raw payload", !diagnosticsBlock.includes("detail.payload") && !diagnosticsBlock.includes("detail.details"));
check("diagnostic bundle includes support references", diagnosticsBlock.includes("Request ID") && diagnosticsBlock.includes("Operation") && diagnosticsBlock.includes("Occurred"));

check("shared request errors expose operation", requestState.includes("detail.operation") && requestState.includes("Failure context"));
check("shared request errors expose occurrence time", requestState.includes("compactDateTime(detail.occurredAt)"));
check("shared request errors expose status and request reference", requestState.includes("HTTP {detail.status}") && requestState.includes("request {detail.requestId}"));
check("shared request errors expose recovery posture", requestState.includes("data-recovery-kind={detail.recoveryKind}"));
check("shared request errors offer explicit retry", requestState.includes("onRetry") && requestState.includes("primaryRetryLabel"));
check("shared request errors support reload", requestState.includes("onReload") && requestState.includes("reloadLabel"));
check("shared request errors support offline work when supplied", requestState.includes("onWorkOffline") && requestState.includes("Work offline"));
check("shared request errors support review when supplied", requestState.includes("onReview") && requestState.includes("reviewLabel"));
check("copy diagnostics uses write-only clipboard helper", requestState.includes("copyClusterText") && requestState.includes("Copy diagnostics"));
check("diagnostics stay contextual rather than primary", requestState.includes("ClusterActionMenu") && requestState.includes('triggerLabel="Details"'));
check("Phase 11 styles add no important override", styles.includes("v0.434 error recovery contract") && !styles.slice(styles.indexOf("v0.434 error recovery contract")).includes("!important"));

check("application crash uses structured recovery", appBoundary.includes("CLIENT_RENDER_ERROR") && appBoundary.includes("<RequestErrorState"));
check("application crash keeps retry and reload", appBoundary.includes('retryLabel="Try again"') && appBoundary.includes('reloadLabel="Reload Cluster"'));
check("application crash does not render raw exception text", !appBoundary.includes("this.state.error.message"));
check("feature crash uses structured recovery", featureBoundary.includes("CLIENT_FEATURE_RENDER_ERROR") && featureBoundary.includes("<RequestErrorState"));
check("feature crash keeps bounded incident reporting", featureBoundary.includes("reportClientIncident") && featureBoundary.includes("info.componentStack"));
check("feature crash does not render raw exception text", !featureBoundary.includes("this.state.error.message"));

check("create errors expose operation and occurrence", createError.includes("detail.operation") && createError.includes("detail.occurredAt"));
check("create storage repair uses canonical button", createError.includes("<ClusterButton") && createError.includes("Verify storage"));
check("create errors copy bounded diagnostics", createError.includes("formatApiErrorPresentationDiagnostics") && createError.includes("copyClusterText"));

check("Phase 11 docs preserve server authority", docs.includes("server remains authoritative") && docs.includes("route template"));
check("Phase 11 docs forbid destructive automatic replay", docs.includes("does not automatically replay destructive mutations"));
check("Phase 11 docs forbid raw payload diagnostics", docs.includes("Raw response payloads") && docs.includes("excluded"));
check("Phase 11 docs define release-blocking gate", docs.includes("## Release-blocking boundary") && docs.includes("error-recovery-phase11-audit.mjs"));
check("Phase 11 notes identify capability", notes.includes("error-recovery-phase11-v1") && notes.includes("2026-08-02.63"));

const pkg = JSON.parse(pkgText);
check("aggregate audit includes Phase 11 gate", String(pkg.scripts?.audit || "").includes("error-recovery-phase11-audit.mjs"));
check("named Phase 11 audit exists", String(pkg.scripts?.["audit:error-recovery-phase11"] || "").includes("error-recovery-phase11-audit.mjs"));
check("master packager invokes Phase 11 gate", packager.includes("error-recovery-phase11-audit.mjs"));
const docOccurrences = packager.split("docs/ERROR_RECOVERY_PHASE11.md").length - 1;
check("master and source packages carry Phase 11 docs", docOccurrences >= 2);

console.log(`\nError & recovery Phase 11 audit: ${passed}/${total} passed.`);
if (passed !== total) process.exitCode = 1;
