#!/usr/bin/env node
/** Execute a self-contained inherited regression and terminate its fixture timers
 * once its top-level assertions finish. Production runtime is not involved. */
const name = process.argv[2];
if (!/^cluster-[a-z0-9-]+-tests\.mjs$/.test(name || "")) {
  console.error("Expected a named Cluster regression test file.");
  process.exit(2);
}
try {
  await import(new URL(`./${name}`, import.meta.url));
  // Older database fixtures leave background handles alive after all their tests
  // have reported completion; those should not stall the combined test command.
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
