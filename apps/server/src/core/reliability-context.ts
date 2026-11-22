import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type ClusterReliabilityContext = {
  correlationId: string;
  causationId?: string | null;
  requestId?: string | null;
  workspaceId?: string | null;
  userId?: string | null;
};

const storage = new AsyncLocalStorage<ClusterReliabilityContext>();

function bounded(value: unknown, maximum = 200) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maximum) : null;
}

export function currentReliabilityContext(): ClusterReliabilityContext | null {
  return storage.getStore() || null;
}

export function enterReliabilityContext(input: Partial<ClusterReliabilityContext>) {
  const current = storage.getStore();
  const correlationId = bounded(input.correlationId) || current?.correlationId || randomUUID();
  const next: ClusterReliabilityContext = {
    correlationId,
    causationId: bounded(input.causationId) ?? current?.causationId ?? null,
    requestId: bounded(input.requestId) ?? current?.requestId ?? null,
    workspaceId: bounded(input.workspaceId) ?? current?.workspaceId ?? null,
    userId: bounded(input.userId) ?? current?.userId ?? null,
  };
  storage.enterWith(next);
  return next;
}

/* Fill in the current context in place. Request hooks resolve the user after
   an await, and enterWith there does not reach the route handler: the handler
   continues from the context the onRequest hook entered. Mutating that same
   per-request object is what makes userId and workspaceId visible to it. */
export function updateReliabilityContext(input: Partial<ClusterReliabilityContext>) {
  const current = storage.getStore();
  if (!current) return enterReliabilityContext(input);
  current.correlationId = bounded(input.correlationId) || current.correlationId;
  current.causationId = bounded(input.causationId) ?? current.causationId ?? null;
  current.requestId = bounded(input.requestId) ?? current.requestId ?? null;
  current.workspaceId = bounded(input.workspaceId) ?? current.workspaceId ?? null;
  current.userId = bounded(input.userId) ?? current.userId ?? null;
  return current;
}

export function runWithReliabilityContext<T>(input: Partial<ClusterReliabilityContext>, fn: () => T): T {
  const current = storage.getStore();
  const next: ClusterReliabilityContext = {
    correlationId: bounded(input.correlationId) || current?.correlationId || randomUUID(),
    causationId: bounded(input.causationId) ?? current?.causationId ?? null,
    requestId: bounded(input.requestId) ?? current?.requestId ?? null,
    workspaceId: bounded(input.workspaceId) ?? current?.workspaceId ?? null,
    userId: bounded(input.userId) ?? current?.userId ?? null,
  };
  return storage.run(next, fn);
}
