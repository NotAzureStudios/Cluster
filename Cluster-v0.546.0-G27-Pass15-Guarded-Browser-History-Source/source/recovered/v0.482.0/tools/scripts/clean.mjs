import { rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const targets = [
  "apps/server/dist",
  "apps/server/src/generated/prisma",
  "apps/web/dist",
  "apps/desktop-qt/build",
  "apps/desktop-qt/release",
  "packages/shared/dist",
  "bin",
  ".cluster",
];
for (const target of targets) await rm(path.join(root, target), { recursive: true, force: true });
console.log(`Removed ${targets.length} generated Cluster build targets.`);
