import { clusterCommandDescriptor } from "@cluster/shared";
import type {
  ClusterCommandAuditEvidence,
  ClusterCommandEnvelope,
  ClusterCommandFailure,
  ClusterCommandIssue,
  ClusterCommandResult,
  ClusterCommandSuccess,
  ClusterImpactPreview,
  ClusterResourceAddress,
  ClusterCommandType,
} from "@cluster/shared";
import { randomUUID } from "node:crypto";
import { currentReliabilityContext, runWithReliabilityContext } from "./reliability-context.js";

type Awaitable<T> = T | Promise<T>;

type CommandContext<TPayload> = {
  command: ClusterCommandEnvelope<TPayload>;
  correlationId: string;
  resource: ClusterResourceAddress | null;
};

export type ClusterCommandExecution<TResult = unknown> = {
  result: TResult;
  emittedEventIds?: string[];
  operationIds?: string[];
};

export type ClusterCommandDefinition<TPayload = unknown, TResult = unknown> = {
  type: string;
  authorize?: (context: CommandContext<TPayload>) => Awaitable<void | boolean | ClusterCommandIssue>;
  validate?: (context: CommandContext<TPayload>) => Awaitable<ClusterCommandIssue[] | void>;
  previewImpact?: (context: CommandContext<TPayload>) => Awaitable<ClusterImpactPreview | null | undefined>;
  execute: (context: CommandContext<TPayload>) => Awaitable<ClusterCommandExecution<TResult> | TResult>;
};

type CommandRuntimeDependencies = {
  audit?: (evidence: ClusterCommandAuditEvidence) => Awaitable<void>;
  logger?: {
    warn?: (payload: unknown, message?: string) => void;
    error?: (payload: unknown, message?: string) => void;
  };
};

function normalizeType(value: unknown) {
  const type = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{0,159}$/.test(type)) throw new Error("Command type is invalid.");
  return type;
}

function issue(input: Partial<ClusterCommandIssue> & Pick<ClusterCommandIssue, "code" | "message">): ClusterCommandIssue {
  return {
    code: String(input.code || "COMMAND_REJECTED").trim().slice(0, 120),
    message: String(input.message || "Command was rejected.").trim().slice(0, 2_000),
    severity: input.severity || "error",
    field: input.field || null,
    resource: input.resource || null,
    action: input.action || null,
  };
}

function executionResult<TResult>(value: ClusterCommandExecution<TResult> | TResult): ClusterCommandExecution<TResult> {
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "result")) {
    return value as ClusterCommandExecution<TResult>;
  }
  return { result: value as TResult };
}

export function createClusterCommand<TPayload>(input: Omit<ClusterCommandEnvelope<TPayload>, "id" | "type" | "schemaVersion" | "requestedAt" | "trace"> & {
  type: ClusterCommandType;
  id?: string;
  requestedAt?: string;
  correlationId?: string | null;
  causationId?: string | null;
  requestId?: string | null;
}): ClusterCommandEnvelope<TPayload> {
  const current = currentReliabilityContext();
  const id = String(input.id || randomUUID()).trim();
  if (!id) throw new Error("Command ID is required.");
  const descriptor = clusterCommandDescriptor(input.type);
  if (!descriptor) throw new Error(`Command ${input.type} is not registered.`);
  const correlationId = String(input.correlationId || current?.correlationId || id).trim();
  return {
    id,
    type: normalizeType(input.type),
    schemaVersion: descriptor.schemaVersion,
    requestedAt: input.requestedAt || new Date().toISOString(),
    workspaceId: input.workspaceId ?? current?.workspaceId ?? null,
    projectId: input.projectId ?? null,
    resource: input.resource ?? null,
    actor: input.actor ?? (current?.userId ? { userId: current.userId, source: "user" } : null),
    trace: {
      correlationId,
      causationId: input.causationId ?? current?.causationId ?? null,
      requestId: input.requestId ?? current?.requestId ?? null,
    },
    idempotencyKey: input.idempotencyKey ?? null,
    dryRun: Boolean(input.dryRun),
    payload: input.payload,
  };
}

export class ClusterCommandRuntime {
  constructor(private readonly deps: CommandRuntimeDependencies = {}) {}

  async execute<TPayload, TResult>(
    command: ClusterCommandEnvelope<TPayload>,
    definition: ClusterCommandDefinition<TPayload, TResult>,
  ): Promise<ClusterCommandResult<TResult>> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const type = normalizeType(command.type);
    const descriptor = clusterCommandDescriptor(type);
    if (!descriptor) throw new Error(`Command ${type} is not registered.`);
    if (command.schemaVersion !== descriptor.schemaVersion) throw new Error(`Command ${type} schema ${command.schemaVersion} does not match registry schema ${descriptor.schemaVersion}.`);
    if (command.resource && !descriptor.resourceKinds.includes(command.resource.kind as never)) throw new Error(`Command ${type} does not support resource kind ${command.resource.kind}.`);
    if (type !== normalizeType(definition.type)) throw new Error(`Command ${type} does not match handler ${definition.type}.`);
    const correlationId = String(command.trace?.correlationId || command.id).trim() || command.id;
    const context: CommandContext<TPayload> = { command, correlationId, resource: command.resource || null };
    let impact: ClusterImpactPreview | null = null;
    let outcome: ClusterCommandAuditEvidence["outcome"] = command.dryRun ? "dry-run" : "failed";
    let issueCodes: string[] = [];

    const finishAudit = async () => {
      if (!this.deps.audit) return;
      const finished = Date.now();
      try {
        await this.deps.audit({
          commandId: command.id,
          commandType: type,
          correlationId,
          causationId: command.trace?.causationId || null,
          actorUserId: command.actor?.userId || null,
          resource: command.resource || null,
          dryRun: Boolean(command.dryRun),
          outcome,
          startedAt,
          finishedAt: new Date(finished).toISOString(),
          durationMs: Math.max(0, finished - started),
          issueCodes,
        });
      } catch (error) {
        this.deps.logger?.warn?.({ error, commandId: command.id, commandType: type }, "command audit evidence write failed");
      }
    };

    try {
      return await runWithReliabilityContext({
        correlationId,
        causationId: command.id,
        requestId: command.trace?.requestId || null,
        workspaceId: command.workspaceId || null,
        userId: command.actor?.userId || null,
      }, async () => {
        if (definition.authorize) {
          const authorization = await definition.authorize(context);
          if (authorization === false || (authorization && typeof authorization === "object")) {
            const rejected = issue(authorization && typeof authorization === "object" ? authorization : {
              code: "COMMAND_FORBIDDEN",
              message: "This command is not authorized.",
            });
            outcome = "rejected";
            issueCodes = [rejected.code];
            const failure: ClusterCommandFailure = { ok: false, commandId: command.id, commandType: type, correlationId, dryRun: Boolean(command.dryRun), error: rejected };
            return failure;
          }
        }

        const validation = (await definition.validate?.(context)) || [];
        const blocking = validation.filter((entry) => entry.severity === "error");
        if (blocking.length) {
          outcome = "rejected";
          issueCodes = validation.map((entry) => entry.code);
          const failure: ClusterCommandFailure = {
            ok: false,
            commandId: command.id,
            commandType: type,
            correlationId,
            dryRun: Boolean(command.dryRun),
            error: blocking[0],
            issues: validation,
          };
          return failure;
        }

        impact = (await definition.previewImpact?.(context)) || null;
        if (command.dryRun) {
          outcome = "dry-run";
          const success: ClusterCommandSuccess<TResult> = {
            ok: true,
            commandId: command.id,
            commandType: type,
            correlationId,
            dryRun: true,
            result: null as TResult,
            impact,
          };
          return success;
        }

        const execution = executionResult(await definition.execute(context));
        outcome = "succeeded";
        const success: ClusterCommandSuccess<TResult> = {
          ok: true,
          commandId: command.id,
          commandType: type,
          correlationId,
          dryRun: false,
          result: execution.result,
          impact,
          emittedEventIds: execution.emittedEventIds || [],
          operationIds: execution.operationIds || [],
        };
        return success;
      });
    } catch (error) {
      const statusCode = Number((error as { statusCode?: unknown })?.statusCode || 500);
      const code = String((error as { code?: unknown })?.code || "COMMAND_EXECUTION_FAILED");
      issueCodes = [code];
      if (statusCode >= 400 && statusCode < 500) {
        outcome = "rejected";
        const rejected = issue({
          code,
          message: String((error as { message?: unknown })?.message || "Command was rejected."),
          severity: "error",
          resource: command.resource || null,
        });
        return { ok: false, commandId: command.id, commandType: type, correlationId, dryRun: Boolean(command.dryRun), error: rejected, impact };
      }
      outcome = "failed";
      this.deps.logger?.error?.({ error, commandId: command.id, commandType: type, correlationId }, "command execution failed");
      throw error;
    } finally {
      await finishAudit();
    }
  }
}
