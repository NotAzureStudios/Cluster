import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const rendererRoot = path.join(root, "packages", "renderer", "src");
const failures = [];
const findings = [];
const nonSemanticInteractiveTags = ["div", "article", "section", "span", "li", "label"];

async function walk(directory) {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await walk(target));
    else if (/\.(tsx|ts|css)$/.test(entry.name)) out.push(target);
  }
  return out;
}

for (const file of await walk(rendererRoot)) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const content = await readFile(file, "utf8");
  if (file.endsWith(".tsx")) {
    if (/role\s*=\s*["']button["']/.test(content)) failures.push(`${relative}: fake role=button controls are prohibited; use a native button/link.`);
    if (/<iframe\b(?![^>]*\btitle\s*=)[^>]*>/is.test(content)) failures.push(`${relative}: iframe without an accessible title.`);
    if (/<img\b(?![^>]*\balt\s*=)[^>]*>/is.test(content)) failures.push(`${relative}: img without alt text.`);
    if (/tabIndex\s*=\s*(?:["']?[1-9]\d*["']?|\{\s*[1-9]\d*\s*\})/.test(content)) failures.push(`${relative}: positive tabIndex is prohibited; preserve DOM focus order.`);
    for (const tag of nonSemanticInteractiveTags) {
      const pattern = new RegExp(`<${tag}\\b[^>]*on(?:Click|DoubleClick)\\s*=`, "s");
      if (pattern.test(content)) failures.push(`${relative}: pointer-only <${tag}> interaction is prohibited; use a native button/link or move the action onto an existing semantic control.`);
    }
  }
}

const app = await readFile(path.join(rendererRoot, "App.tsx"), "utf8");
const webIndex = await readFile(path.join(root, "apps", "web", "index.html"), "utf8");
const manager = await readFile(path.join(rendererRoot, "components", "AccessibilityManager.tsx"), "utf8");
const select = await readFile(path.join(rendererRoot, "components", "ClusterSelect.tsx"), "utf8");
if (!app.includes("skip-link-v204") || !app.includes("cluster-main-content")) failures.push("Global skip-to-content link is missing.");
if (!manager.includes("modalCandidateSelector") || !manager.includes("focusableSelector")) failures.push("Global modal/focus normalization is missing.");
if (!select.includes('role="listbox"') || !select.includes('role="option"')) failures.push("ClusterSelect must retain listbox/option semantics.");
if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:[.,]0*)?/i.test(webIndex)) failures.push("Web viewport must not disable browser zoom.");
if (!manager.includes("keepKeyboardFocusVisible") || !manager.includes('document.addEventListener("focusin"')) failures.push("Keyboard focus visibility guard is missing.");

for (const finding of findings.slice(0, 30)) console.log(`INFO  ${finding}`);
if (failures.length) {
  for (const failure of failures) console.error(`FAIL  ${failure}`);
  console.error(`\nAccessibility static audit failed: ${failures.length} blocking finding(s).`);
  process.exit(1);
}
console.log(`Accessibility static audit passed (${findings.length} informational finding(s); zero pointer-only non-semantic controls).`);
