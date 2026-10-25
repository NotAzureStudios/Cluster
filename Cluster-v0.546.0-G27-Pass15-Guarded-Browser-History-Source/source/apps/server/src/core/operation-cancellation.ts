export class OperationCancelledError extends Error {
  readonly code = "OPERATION_CANCELLED";
  readonly statusCode = 499;
  constructor(message = "Operation was cancelled.") {
    super(message);
    this.name = "OperationCancelledError";
  }
}

export function throwIfAborted(signal?: AbortSignal | null, message = "Operation was cancelled.") {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new OperationCancelledError(message);
}

export function linkedAbortController(parent?: AbortSignal | null) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(parent?.reason instanceof Error ? parent.reason : new OperationCancelledError());
    }
  };
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  return {
    controller,
    dispose: () => parent?.removeEventListener("abort", abort),
  };
}

export async function withRequestCancellation<T>(
  request: any,
  reply: any,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(new OperationCancelledError("Client disconnected before the operation completed."));
  };
  const requestRaw = request?.raw;
  const replyRaw = reply?.raw;
  requestRaw?.once?.("aborted", abort);
  replyRaw?.once?.("close", abort);
  try {
    return await operation(controller.signal);
  } finally {
    requestRaw?.off?.("aborted", abort);
    replyRaw?.off?.("close", abort);
  }
}
