import type { FastifyInstance } from "fastify";

export type ServerShutdownReason = NodeJS.Signals | "startup-error" | "managed-host";

type ServerLifecycleOptions = {
  app: FastifyInstance;
  onDraining?: (signal: ServerShutdownReason) => void | Promise<void>;
  onClose: () => void | Promise<void>;
  shutdownTimeoutMs?: number;
};

export function createServerLifecycle({ app, onDraining, onClose, shutdownTimeoutMs = 30_000 }: ServerLifecycleOptions) {
  let shutdownPromise: Promise<void> | null = null;
  let handlersInstalled = false;

  app.addHook("onClose", onClose);

  async function closeWithDeadline() {
    let timeout: NodeJS.Timeout | null = null;
    try {
      await Promise.race([
        app.close(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            app.server.closeAllConnections?.();
            reject(new Error(`Cluster shutdown exceeded ${shutdownTimeoutMs} ms and remaining connections were closed.`));
          }, Math.max(1_000, shutdownTimeoutMs));
          timeout.unref?.();
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function shutdown(signal: ServerShutdownReason) {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      app.log.info({ signal }, "Cluster shutdown started");
      // Draining and closing are separate obligations. If a worker or optional
      // provider refuses to drain, still run Fastify's onClose hooks so the
      // database, runtime marker, and network resources are not abandoned.
      // Never report that shutdown succeeded when a drain failed.
      let drainError: unknown;
      let drainFailed = false;
      try {
        await onDraining?.(signal);
      } catch (error) {
        drainError = error;
        drainFailed = true;
        app.log.error(error, "Cluster background drain failed; closing server resources");
      }
      let closeError: unknown;
      let closeFailed = false;
      try {
        await closeWithDeadline();
      } catch (error) {
        closeError = error;
        closeFailed = true;
      }
      if (drainFailed && closeFailed) {
        throw new AggregateError([drainError, closeError], "Cluster shutdown failed during drain and close");
      }
      if (drainFailed) throw drainError;
      if (closeFailed) throw closeError;
      app.log.info({ signal }, "Cluster shutdown completed");
    })();
    return shutdownPromise;
  }

  async function shutdownAndExit(signal: Exclude<ServerShutdownReason, "startup-error">) {
    // Managed Windows shutdown is request-driven rather than a real POSIX signal.
    // A clean Fastify close can still leave unrelated Node handles alive, which
    // previously made the native host wait until its fallback termination path.
    // Keep an outer watchdog, complete the normal drain/close path first, then
    // explicitly terminate the managed Node process with the resulting status.
    let exitCode = 0;
    let watchdog: NodeJS.Timeout | null = null;
    try {
      watchdog = setTimeout(() => {
        app.log.error({ signal, shutdownTimeoutMs }, "Cluster shutdown watchdog expired; forcing process exit");
        app.server.closeAllConnections?.();
        process.exit(1);
      }, Math.max(5_000, shutdownTimeoutMs + 5_000));
      watchdog.unref?.();
      await shutdown(signal);
    } catch (error) {
      exitCode = 1;
      app.log.error(error, "Cluster shutdown failed");
    } finally {
      if (watchdog) clearTimeout(watchdog);
    }
    process.exitCode = exitCode;
    process.exit(exitCode);
  }

  function installSignalHandlers() {
    if (handlersInstalled) return;
    handlersInstalled = true;
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        void shutdownAndExit(signal);
      });
    }
  }

  return { shutdown, shutdownAndExit, installSignalHandlers };
}

type ServerStartupOptions = {
  app: FastifyInstance;
  prepare: () => Promise<void>;
  listen: () => Promise<void>;
  onReady: () => void | Promise<void>;
  shutdown: (signal: "startup-error") => Promise<void>;
};

export async function runServerStartup({ app, prepare, listen, onReady, shutdown }: ServerStartupOptions) {
  try {
    await prepare();
    await listen();
    await onReady();
  } catch (error) {
    app.log.error(error, "Cluster server failed to start");
    await shutdown("startup-error").catch(() => undefined);
    process.exitCode = 1;
    // Do not swallow startup failure. The ESM entrypoint awaits this promise, so rejecting here
    // terminates a failed server process even if an unrelated runtime handle survived cleanup.
    throw error;
  }
}
