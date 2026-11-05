// Canonical Server release ordering, shared by Node release checks, packaging,
// and the protected signer. The Go updater independently verifies the same rule.
// Stable 1.0.x keeps its historic sequence (50 + patch).
// Stable 1.1.0 and later reserve non-overlapping ranges per minor version.
export function stableServerSequence(release) {
  const match = /^1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(release);
  if (!match) return null;
  const minor = Number(match[1]);
  const patch = Number(match[2]);
  if (!Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) return null;
  if (minor === 0) {
    return patch >= 1 && patch <= 10000 ? 50 + patch : null;
  }
  if (minor > 1000 || patch > 99999) return null;
  return minor * 100000 + patch;
}

export function validStableServerRelease(candidate) {
  return candidate.channel === "stable"
    && candidate.release === candidate.sourceVersion
    && Number.isInteger(candidate.sequence)
    && stableServerSequence(candidate.release) === candidate.sequence;
}
