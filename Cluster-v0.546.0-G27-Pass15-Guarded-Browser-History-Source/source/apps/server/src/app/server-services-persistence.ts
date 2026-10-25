import crypto from "node:crypto";
import { z } from "zod";import type { PersistenceValidationIssue } from "./server-composition-types.js";


export function createPersistenceServices(deps: Record<string, any>) {
  const {
    app,
    parseJsonObject,
    prisma
  } = deps;
  
  const PERSISTENCE_SCHEMA_VERSION = 3;
  
  const PERSISTENCE_KIND_RULES: Record<string, { required: string[]; recommended: string[]; label: string }> = {
    dependency: {
      label: "Dependency",
      required: ["source", "target"],
      recommended: ["ownerId", "dueAt", "status"],
    },
    recurring: {
      label: "Recurring work",
      required: ["title"],
      recommended: ["frequency", "cadence", "nextRunAt", "ownerId"],
    },
    watcher: {
      label: "Watcher",
      required: ["entity"],
      recommended: ["watcherUserId", "scope", "notificationScope"],
    },
    timeCorrection: {
      label: "Time correction",
      required: ["issueType"],
      recommended: ["userId", "before", "after", "status"],
    },
    timeRule: {
      label: "Shift rule",
      required: ["title"],
      recommended: ["expectedStart", "expectedEnd", "maxShiftMinutes", "overtimeThresholdMinutes"],
    },
    breakLedger: {
      label: "Break ledger",
      required: ["userId"],
      recommended: ["projectId", "breakType", "plannedMinutes", "takenMinutes", "status"],
    },
    closeout: {
      label: "Project closeout",
      required: ["projectId"],
      recommended: ["checklist", "approvedBy", "status"],
    },
    externalPortal: {
      label: "External portal",
      required: ["projectId"],
      recommended: ["visibility", "sections", "approvalState", "accessLevel"],
    },
    accessRule: {
      label: "Access rule",
      required: ["targetKind", "targetId", "subjectKind"],
      recommended: ["projectId", "effect", "level", "status"],
    },
    boardView: {
      label: "Board shared view",
      required: ["boardId", "name", "viewMode"],
      recommended: ["ownerId", "scope", "groupMode", "updatedAt"],
    },
    whiteboardComponent: {
      label: "Whiteboard component",
      required: ["name", "elements"],
      recommended: ["ownerId", "sourceWhiteboardId", "tags", "updatedAt"],
    },
    customFieldDefinition: {
      label: "Custom field definition",
      required: ["label", "entity", "fieldType"],
      recommended: ["slug", "viewAccess", "editAccess", "enabled"],
    },
    customFieldValue: {
      label: "Custom field value",
      required: ["entity", "entityId", "fieldId"],
      recommended: ["projectId", "updatedAt", "updatedBy"],
    },
    attachment: {
      label: "Attachment",
      required: ["fileName"],
      recommended: ["linkedEntity", "visibility", "reviewState", "uploadedBy"],
    },
    maintenance: {
      label: "Maintenance run",
      required: ["action"],
      recommended: ["status", "reviewedBy", "completedAt"],
    },
    diagnostic: {
      label: "Diagnostic snapshot",
      required: ["checks"],
      recommended: ["generatedAt", "status", "failures"],
    },
    automationRule: {
      label: "Automation rule",
      required: ["source"],
      recommended: ["targetArea", "actionType", "severity", "ownerId"],
    },
    controlSignal: {
      label: "Control signal",
      required: ["source"],
      recommended: ["severity", "targetArea", "status"],
    },
    approvalRequest: {
      label: "Approval request",
      required: ["type", "requestedById"],
      recommended: ["targetType", "targetId", "reason"],
    },
  };
  

  function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => typeof entryValue !== "undefined")
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
  }
  
  function checksumPersistencePayload(kind: string, payload: Record<string, unknown>, schemaVersion = PERSISTENCE_SCHEMA_VERSION) {
    return crypto
      .createHash("sha256")
      .update(`${schemaVersion}:${kind}:${stableStringify(payload || {})}`)
      .digest("hex");
  }
  
  function hasPayloadPath(payload: Record<string, any>, pathValue: string) {
    const parts = pathValue.split(".");
    let cursor: any = payload;
    for (const part of parts) {
      if (cursor === null || typeof cursor !== "object" || !(part in cursor)) return false;
      cursor = cursor[part];
    }
    if (Array.isArray(cursor)) return cursor.length > 0;
    return cursor !== undefined && cursor !== null && String(cursor).trim() !== "";
  }
  
  function payloadHasAny(payload: Record<string, any>, paths: string[]) {
    return paths.some((pathValue) => hasPayloadPath(payload, pathValue));
  }
  
  
  function summarizeValidation(issues: PersistenceValidationIssue[], warnings: PersistenceValidationIssue[]) {
    const failCount = issues.filter((issue) => issue.severity === "fail").length;
    const warnCount = warnings.length + issues.filter((issue) => issue.severity === "warn").length;
    if (failCount) return `${failCount} blocking issue(s), ${warnCount} warning(s).`;
    if (warnCount) return `${warnCount} warning(s).`;
    return "Validated.";
  }
  
  
  function validatePersistencePayload(kind: string, payloadInput: Record<string, any>, recordId?: string | null) {
    const payload = payloadInput && typeof payloadInput === "object" ? payloadInput : {};
    const rule = PERSISTENCE_KIND_RULES[kind] || {
      label: kind,
      required: [],
      recommended: [],
    };
    const issues: PersistenceValidationIssue[] = [];
    const warnings: PersistenceValidationIssue[] = [];
    const pushIssue = (severity: "warn" | "fail", code: string, message: string) => {
      const issue = {
        severity,
        code,
        message,
        kind,
        recordId: recordId || undefined,
      };
      if (severity === "fail") issues.push(issue);
      else warnings.push(issue);
    };
  
    for (const required of rule.required) {
      if (!hasPayloadPath(payload, required)) pushIssue("fail", "missing_required_field", `${rule.label} is missing required field '${required}'.`);
    }
    for (const recommended of rule.recommended) {
      if (!hasPayloadPath(payload, recommended)) pushIssue("warn", "missing_recommended_field", `${rule.label} should include '${recommended}' for stronger backend automation.`);
    }
  
    if (["external", "public"].includes(String(payload.visibility || payload.accessVisibility || "").toLowerCase())) {
      const approved = ["approved", "active", "reviewed"].includes(String(payload.approvalState || payload.reviewState || payload.status || "").toLowerCase());
      if (!approved) pushIssue("warn", "external_without_approval", "External/public record is not clearly approved yet.");
    }
    if (kind === "attachment") {
      if (!payloadHasAny(payload, ["url", "path", "filePath", "storagePath"])) pushIssue("warn", "attachment_missing_location", "Attachment has metadata but no storage URL/path.");
      if (["external", "public"].includes(String(payload.visibility || "").toLowerCase()) && String(payload.reviewState || "") !== "approved") pushIssue("fail", "attachment_exposed_unapproved", "External/public attachment must be approved before exposure.");
    }
    if (kind === "dependency") {
      const status = String(payload.status || "").toLowerCase();
      if (["blocked", "open", "watching"].includes(status) && !payloadHasAny(payload, ["ownerId", "owner", "assigneeId"])) pushIssue("warn", "dependency_missing_owner", "Open dependency should have an owner.");
      if (payload.source?.id && payload.target?.id && payload.source.id === payload.target.id) pushIssue("fail", "self_dependency", "Dependency cannot point to the exact same entity.");
    }
    if (kind === "timeCorrection") {
      if (payload.before && payload.after && stableStringify(payload.before) === stableStringify(payload.after)) pushIssue("warn", "correction_no_delta", "Time correction before/after values are identical.");
    }
    if (kind === "automationRule") {
      if (String(payload.status || "active").toLowerCase() === "active" && !payloadHasAny(payload, ["actionType", "targetArea"])) pushIssue("warn", "automation_missing_action", "Active automation rule needs an action type and target area.");
    }
  
    const checksum = checksumPersistencePayload(kind, payload);
    const state = issues.some((issue) => issue.severity === "fail") ? "fail" : warnings.length ? "warn" : "pass";
    return {
      state,
      checksum,
      schemaVersion: PERSISTENCE_SCHEMA_VERSION,
      issues,
      warnings,
      summary: summarizeValidation(issues, warnings),
    };
  }
  
  
  function buildPersistenceStorageData(kind: string, payload: Record<string, any>, recordId?: string | null) {
    const validation = validatePersistencePayload(kind, payload, recordId);
    return {
      schemaVersion: validation.schemaVersion,
      checksum: validation.checksum,
      validationState: validation.state,
      validationSummary: validation.summary,
      lastValidatedAt: new Date(),
    };
  }
  
  
  function checksumMatchesRecord(record: any) {
    const payload = parseJsonObject(record.payload);
    const expected = checksumPersistencePayload(record.kind, payload, record.schemaVersion || PERSISTENCE_SCHEMA_VERSION);
    return Boolean(record.checksum && record.checksum === expected);
  }
  
  
  const persistenceKindSchema = z.string().trim().min(1).max(80);
  
  function serializePersistenceRecord(record: any) {
    return {
      id: record.id,
      kind: record.kind,
      title: record.title,
      projectId: record.projectId,
      entityType: record.entityType,
      entityId: record.entityId,
      userId: record.userId,
      ownerId: record.ownerId,
      status: record.status,
      visibility: record.visibility || "internal",
      sourceKey: record.sourceKey,
      schemaVersion: record.schemaVersion || 1,
      checksum: record.checksum || null,
      validationState: record.validationState || "unchecked",
      validationSummary: record.validationSummary || null,
      lastValidatedAt: record.lastValidatedAt || null,
      locked: Boolean(record.locked),
      deletedAt: record.deletedAt || null,
      payload: parseJsonObject(record.payload),
      archived: Boolean(record.archived),
      syncedAt: record.syncedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      revision: Number(record.revision || 1),
    };
  }
  
  
  async function safePersistenceRecordCount() {
    try {
      const client = (prisma as any).clusterPersistenceRecord;
      return client?.count ? await client.count() : 0;
    } catch {
      return 0;
    }
  }
  
  
  async function logPersistenceAudit(input: { recordId?: string | null; kind: string; action: string; actorId?: string | null; summary: string; metadata?: Record<string, unknown> }) {
    try {
      await prisma.persistenceAuditLog.create({
        data: {
          recordId: input.recordId || null,
          kind: input.kind,
          action: input.action,
          actorId: input.actorId || null,
          summary: input.summary,
          metadata: JSON.stringify(input.metadata || {}),
        },
      });
    } catch (error) {
      app.log.warn(error, "persistence audit logging failed");
    }
  }

  return {
    buildPersistenceStorageData,
    checksumMatchesRecord,
    logPersistenceAudit,
    persistenceKindSchema,
    safePersistenceRecordCount,
    serializePersistenceRecord,
    validatePersistencePayload
  };
}
