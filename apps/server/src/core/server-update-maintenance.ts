import { lstatSync } from "node:fs";
import path from "node:path";

/** Fail closed if a native supervised update hold exists or cannot safely
 * be inspected. This only protects incoming API requests. Background workers
 * must be held independently before an updater can claim zero writes. */
export function serverUpdateMaintenanceHeld(dataRoot: string): boolean {
  const filename = path.join(dataRoot, "system", "runtime", "cluster-update-hold.json");
  try {
    // Even a suspicious non-regular file holds admission closed. The native
    // supervisor alone is responsible for writing/removing its durable intent.
    lstatSync(filename);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException)?.code !== "ENOENT";
  }
}
