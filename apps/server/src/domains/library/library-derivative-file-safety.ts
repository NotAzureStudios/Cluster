import fs from "node:fs/promises";
import path from "node:path";

/** Refuse symlinks/junctions in managed derivative paths before streaming. */
export async function validateManagedDerivativePath(rootPath: string, candidatePath: string): Promise<string | null> {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) return null;
  if (await fs.realpath(root).catch(() => null) !== root) return null;
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  let current = root;
  for (const [index, segment] of relative.split(path.sep).entries()) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch(() => null);
    if (!stat || stat.isSymbolicLink()) return null;
    if (index === relative.split(path.sep).length - 1 ? !stat.isFile() : !stat.isDirectory()) return null;
  }
  return await fs.realpath(candidate).catch(() => null) === candidate ? candidate : null;
}
