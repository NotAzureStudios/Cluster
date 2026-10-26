import fs from "node:fs/promises";
import path from "node:path";

/**
 * Inventory only. Unreferenced paths are NOT destruction-eligible: writers,
 * restores, published deliveries and backups can race a filesystem scan.
 * Never turn these observations into an unlink list without a separate,
 * transactionally authorized retention/hold/provenance workflow.
 */
export const LIBRARY_ORPHAN_AUDIT_LIMITS = {
  referenceLimit: 250_000,
  entryLimit: 100_000,
  depthLimit: 48,
  sampleLimit: 40,
  minimumAgeMs: 7 * 24 * 60 * 60 * 1000,
} as const;

function normalizedRelative(root: string, candidate: string): string | null {
  if (!candidate || candidate.includes("\0")) return null;
  const resolvedRoot = path.resolve(root);
  const full = path.resolve(resolvedRoot, candidate);
  const rel = path.relative(resolvedRoot, full);
  if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  const key = rel.split(path.sep).join("/");
  return process.platform === "win32" ? key.toLowerCase() : key;
}

export function canonicalLibraryStorageReference(root: string, name: unknown): string | null {
  if (typeof name !== "string" || !name.trim()) return null;
  // Absolute derivative paths may point to external storage; these are not
  // Library-root cleanup candidates and must never escape this inventory.
  return normalizedRelative(root, name);
}

export type LibraryStorageOrphanSample = { relativePath: string; sizeBytes: number; modifiedAt: string };

export async function auditLibraryOrphanFiles(input: {
  root: string;
  references: ReadonlySet<string>;
  now?: number;
  check?: () => Promise<void>;
  reportProgress?: (inspected: number) => Promise<void>;
}) {
  const { root, references } = input;
  const limits = LIBRARY_ORPHAN_AUDIT_LIMITS;
  const now = input.now ?? Date.now();
  const realRoot = await fs.realpath(root);
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Library audit root must be a real directory.");
  const stack: Array<{ directory: string; depth: number }> = [{ directory: realRoot, depth: 0 }];
  const sample: LibraryStorageOrphanSample[] = [];
  let entries = 0, inspectedFiles = 0, protectedReferences = 0, recentUnreferenced = 0;
  let agedUnreferenced = 0, agedBytes = 0, symlinksSkipped = 0, nonFilesSkipped = 0, internalSkipped = 0;
  const cutoff = now - limits.minimumAgeMs;
  while (stack.length) {
    await input.check?.();
    const { directory, depth } = stack.pop()!;
    if (depth > limits.depthLimit) throw new Error("Library orphan audit exceeded maximum folder depth. No complete report was produced.");
    // Directory entries can change between enumeration and traversal. Reject
    // redirected trees and symlink substitutions instead of scanning outside
    // the storage root. This remains an observational, non-deleting audit.
    const currentStat = await fs.lstat(directory);
    const currentReal = await fs.realpath(directory);
    const relativeDirectory = path.relative(realRoot, currentReal);
    if (!currentStat.isDirectory() || currentStat.isSymbolicLink() ||
        relativeDirectory === ".." || relativeDirectory.startsWith(`..${path.sep}`) || path.isAbsolute(relativeDirectory)) {
      throw new Error("Library audit detected a redirected directory. No complete report was produced.");
    }
    const children = await fs.readdir(directory, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (++entries > limits.entryLimit) throw new Error("Library orphan audit exceeded filesystem scan limit. No complete report was produced.");
      if (entries % 100 === 0) { await input.check?.(); await input.reportProgress?.(entries); }
      const filePath = path.join(directory, child.name);
      // All symlinks are skipped. Do not follow linked trees, even if their
      // target currently appears to be inside Library.
      if (child.isSymbolicLink()) { symlinksSkipped++; continue; }
      if (child.isDirectory()) { stack.push({ directory: filePath, depth: depth + 1 }); continue; }
      if (!child.isFile()) { nonFilesSkipped++; continue; }
      const relative = canonicalLibraryStorageReference(realRoot, filePath);
      if (!relative) throw new Error("Library audit encountered a path outside its root.");
      inspectedFiles++;
      if (relative === canonicalLibraryStorageReference(realRoot, path.join(realRoot, "Library Index.json")) ||
          /^\.cluster-reconcile-[^/]+\.tmp$/i.test(child.name)) { internalSkipped++; continue; }
      if (references.has(relative)) { protectedReferences++; continue; }
      const stat = await fs.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) { symlinksSkipped++; continue; }
      if (stat.mtimeMs > cutoff || stat.mtimeMs > now) { recentUnreferenced++; continue; }
      agedUnreferenced++;
      agedBytes += stat.size;
      if (sample.length < limits.sampleLimit) sample.push({ relativePath: relative, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
  }
  return {
    scope: "library-root", readOnly: true, destructiveActionsEnabled: false,
    auditedAt: new Date(now).toISOString(), minimumAgeDays: 7,
    scannedEntries: entries, inspectedFiles, protectedReferences, recentUnreferenced,
    agedUnreferenced, agedBytes, internalSkipped, symlinksSkipped, nonFilesSkipped,
    sample,
    warning: "Unreferenced paths are review candidates only, not safe-to-delete files. The scan is not an atomic filesystem/database snapshot. Library versions, derivatives, legal holds, ongoing jobs and external storage must be checked again before any future cleanup.",
  };
}
