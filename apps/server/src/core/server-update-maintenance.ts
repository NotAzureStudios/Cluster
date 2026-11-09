import { lstat } from "node:fs/promises";
import path from "node:path";

type HoldFileLookup = (filename: string) => Promise<unknown>;

/**
 * Fail closed on an update hold or an inaccessible hold location.
 * Never cache a negative lookup after it completes: the native supervisor
 * may create the hold between any two incoming requests.
 *
 * Concurrent requests share only the *pending* filesystem check, avoiding
 * synchronous I/O on the Node API event loop during request bursts.
 * Background worker draining remains independently supervised.
 */
export function createServerUpdateMaintenanceProbe(lookup: HoldFileLookup = lstat) {
  const pendingByFilename = new Map<string, Promise<boolean>>();
  return function serverUpdateMaintenanceHeld(dataRoot: string): Promise<boolean> {
    const filename = path.join(dataRoot, "system", "runtime", "cluster-update-hold.json");
    const existing = pendingByFilename.get(filename);
    if (existing) return existing;
    const check = (async () => {
      try {
        // Any existing file or non-regular path means the update hold is active.
        await lookup(filename);
        return true;
      } catch (error: unknown) {
        return (error as NodeJS.ErrnoException)?.code !== "ENOENT";
      }
    })();
    pendingByFilename.set(filename, check);
    // A completed negative answer must never be reused by later requests.
    void check.finally(() => {
      if (pendingByFilename.get(filename) === check) pendingByFilename.delete(filename);
    });
    return check;
  };
}

export const serverUpdateMaintenanceHeld = createServerUpdateMaintenanceProbe();
