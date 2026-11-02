// Explicit release boundaries for the prebuilt Windows Server product.
// Source-mode developer bundles are intentionally separate from Server distributions.
const desktopFiles = new Set([
  "bin/Cluster.exe",
  "bin/cluster-package-stager.exe",
  "bin/PACKAGE_STAGER_SECURITY.txt",
]);
const desktopDirectories = [
  "apps/desktop-qt",
  "tools/native/package-stager-go",
];
export function isDesktopOnlyDistributionPath(relativePath) {
  if (typeof relativePath !== "string") throw new TypeError("Distribution path must be a string");
  const path = relativePath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  return desktopFiles.has(path)
    || desktopDirectories.some(prefix => path === prefix || path.startsWith(prefix + "/"));
}
