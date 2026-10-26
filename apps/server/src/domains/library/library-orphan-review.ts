import fs from "node:fs/promises";
import path from "node:path";
import { canonicalLibraryStorageReference, LIBRARY_ORPHAN_AUDIT_LIMITS } from "./library-orphan-audit.js";

/** Re-examines ONE sampled storage path without modifying it. This is not a
 * deletion permit: even a clean review cannot make an FS+DB snapshot atomic or
 * establish off-system distribution, retention and backup provenance. */
export async function reviewLibraryOrphanCandidate(input: {
  root: string;
  sample: { relativePath: string; sizeBytes: number; modifiedAt: string };
  references: ReadonlySet<string>;
  activeLibraryJobs: number;
  now?: number;
}) {
  const { root, sample } = input;
  const blockers: string[] = [];
  const normalized = canonicalLibraryStorageReference(root, sample.relativePath);
  // A sampled filename is always relative to the audit root. Refuse absolute
  // paths, traversal and normalized aliases rather than trusting caller input.
  if (!normalized || path.isAbsolute(sample.relativePath) ||
      sample.relativePath.split(/[\\/]/).some((part) => part === ".." || part === ".") ||
      normalized !== sample.relativePath.split(path.sep).join("/")) {
    return { readOnly: true, dispositionAllowed: false, status: "blocked", blockers: ["INVALID_SAMPLE_PATH"] };
  }
  const canonicalRoot = await fs.realpath(root);
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Library root changed during review.");
  const absolute = path.resolve(canonicalRoot, sample.relativePath);
  const within = path.relative(canonicalRoot, absolute);
  if (!within || within === ".." || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)) {
    return { readOnly: true, dispositionAllowed: false, status: "blocked", blockers: ["INVALID_SAMPLE_PATH"] };
  }
  // Check every directory component: no redirected parents, junctions or
  // symbolic links are accepted, even if a link currently points inside root.
  let directory = canonicalRoot;
  for (const segment of path.dirname(within).split(path.sep).filter((part) => part !== "." && part)) {
    directory = path.join(directory, segment);
    const stat = await fs.lstat(directory).catch(() => null);
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) {
      blockers.push("UNSAFE_OR_CHANGED_DIRECTORY");
      break;
    }
  }
  let bytes: number | null = null;
  let mtime: string | null = null;
  if (!blockers.length) {
    const stat = await fs.lstat(absolute).catch(() => null);
    if (!stat || !stat.isFile() || stat.isSymbolicLink()) blockers.push("FILE_MISSING_OR_REDIRECTED");
    else {
      bytes = stat.size;
      mtime = stat.mtime.toISOString();
      if (bytes !== sample.sizeBytes || mtime !== sample.modifiedAt) blockers.push("FILE_CHANGED_SINCE_AUDIT");
      if (stat.mtimeMs > (input.now ?? Date.now()) - LIBRARY_ORPHAN_AUDIT_LIMITS.minimumAgeMs) blockers.push("FILE_TOO_RECENT");
    }
  }
  if (input.references.has(normalized)) blockers.push("LIBRARY_REFERENCE_APPEARED");
  if (input.activeLibraryJobs > 0) blockers.push("LIBRARY_WORK_IN_PROGRESS");
  // No live-reference scan can establish past immutable publications, legal
  // retention, backups, external storage or a concurrent write that starts
  // immediately afterward. Do not generate any actionable unlink authority.
  blockers.push("RETENTION_AND_PROVENANCE_UNVERIFIED");
  return { readOnly: true, dispositionAllowed: false, status: blockers.length > 1 ? "blocked" : "requires_governance_review",
    relativePath: normalized, sizeBytes: bytes, modifiedAt: mtime, blockers };
}
