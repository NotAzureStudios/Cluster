#!/usr/bin/env node
/** Built-in tool development kit. This registers compiled source, not remotely
 * executable plugins. Tool APIs still require independent server permissions. */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const paths = {
  manifest: 'packages/shared/src/cluster-manifest.ts',
  registry: 'packages/renderer/src/features/application/modules/application-standalone-tool-registry.tsx',
  application: 'packages/renderer/src/features/application/ClusterApplication.tsx',
  prefetch: 'packages/renderer/src/features/shell/feature-prefetch.ts',
  lazy: 'packages/renderer/src/features/application/modules/application-lazy-workspaces.ts',
};
function objectDeclaration(file, symbol, base) {
  const text = fs.readFileSync(path.join(base, file), 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let node;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (decl.name.getText(source) === symbol) node = decl.initializer;
    }
  }
  if (!node) throw new Error(`Missing ${symbol} in ${file}`);
  while (ts.isSatisfiesExpression(node) || ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression;
  if (!ts.isObjectLiteralExpression(node)) throw new Error(`${symbol} is not a declarative object`);
  const entries = new Map();
  for (const item of node.properties) {
    if (!ts.isPropertyAssignment(item)) throw new Error(`Unsupported dynamic property in ${symbol}`);
    const key = item.name && (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) ? item.name.text : null;
    if (!key || entries.has(key)) throw new Error(`Duplicate or dynamic key in ${symbol}`);
    entries.set(key, item.initializer);
  }
  return { source, text, entries };
}
function field(object, name) {
  while (ts.isSatisfiesExpression(object) || ts.isAsExpression(object)) object = object.expression;
  if (!ts.isObjectLiteralExpression(object)) return;
  return object.properties.find((item) => ts.isPropertyAssignment(item) && (item.name?.text === name))?.initializer;
}
function value(object, name) {
  const node = field(object, name);
  return node && (ts.isStringLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword)
    ? (ts.isStringLiteral(node) ? node.text : node.kind === ts.SyntaxKind.TrueKeyword)
    : undefined;
}

export function checkTools(base = root) {
  const manifest = objectDeclaration(paths.manifest, 'CLUSTER_APP_ROUTE_MANIFEST', base);
  const permissions = objectDeclaration(paths.manifest, 'CLUSTER_TOOL_PERMISSION_MANIFEST', base);
  const registry = objectDeclaration(paths.registry, 'STANDALONE_TOOL_MODULES', base);
  const errors = [];
  const standalone = new Set();
  for (const [route, definition] of manifest.entries) {
    const tool = value(definition, 'tool');
    if (tool && !permissions.entries.has(tool)) errors.push(`${route}: unknown permission tool ${tool}`);
    if (value(definition, 'surface') === 'standalone-tool') {
      standalone.add(route);
      if (!tool) errors.push(`${route}: standalone tool must declare a server authorization tool key`);
      if (!registry.entries.has(route)) errors.push(`${route}: no renderer module registered`);
    }
  }
  for (const id of registry.entries.keys()) {
    if (!standalone.has(id)) errors.push(`${id}: renderer module has no canonical standalone route`);
  }
  for (const [id, entry] of registry.entries) {
    if (!field(entry, 'preload') || !field(entry, 'render')) errors.push(`${id}: missing preload/render module contract`);
  }
  const app = fs.readFileSync(path.join(base, paths.application), 'utf8');
  const prefetch = fs.readFileSync(path.join(base, paths.prefetch), 'utf8');
  const lazy = fs.readFileSync(path.join(base, paths.lazy), 'utf8');
  if (!app.includes('isStandaloneToolRoute(screen) && <StandaloneToolRoute')) errors.push('application missing canonical standalone mount');
  if (!prefetch.includes('isStandaloneToolRoute(screen)') || !prefetch.includes('preloadStandaloneTool(screen)')) errors.push('prefetch not integrated with standalone registry');
  for (const route of standalone) {
    // Regression guard against the previous three-place registration hazard.
    if (new RegExp(`\\b${route}: \\(\\) => import\\(`).test(prefetch)) errors.push(`${route}: duplicated prefetch loader`);
    const Pascal = route[0].toUpperCase() + route.slice(1);
    if (lazy.includes(`Lazy${Pascal}WorkspacePage`)) errors.push(`${route}: duplicate legacy lazy-loader export`);
  }
  if (errors.length) throw new Error(`Tool registry validation failed:\n- ${errors.join('\n- ')}`);
  return { routes: manifest.entries.size, tools: permissions.entries.size, standalone: [...standalone] };
}

function scaffold({ id, label, adminOnly, outputRoot }) {
  if (!/^[a-z][A-Za-z0-9]{1,35}$/.test(id || '')) throw new Error('Tool ID must be a camelCase identifier (2-36 characters).');
  if (!label || label.length > 64 || /[<>{}\r\n]/.test(label)) throw new Error('Supply a plain-text display label, at most 64 characters.');
  const base = path.resolve(outputRoot || path.join(root, 'tools/tool-scaffolds'));
  const dest = path.join(base, id);
  if (fs.existsSync(dest)) throw new Error(`Scaffold already exists at ${dest}; refusing to overwrite.`);
  const Pascal = id[0].toUpperCase() + id.slice(1);
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, `${Pascal}ToolPage.tsx`), `/** Copy into packages/renderer/src/features/${id}/ after review. */\nexport function ${Pascal}ToolPage() {\n  return <main className="cluster-resource-workspace" aria-label=${JSON.stringify(label + ' workspace')}>\n    <header className="cluster-resource-workspace__header"><h1>{${JSON.stringify(label)}}</h1></header>\n    <p>Connect this tool to its authorized API before enabling navigation.</p>\n  </main>;\n}\n`);
  const note = `# ${label}: built-in tool checklist\n\nThis is a source scaffold, **not** an installed/runtime plugin. It deliberately DOES NOT enable a new route or server endpoint.\n\n1. Declare permission tool key \`${id}\` in CLUSTER_TOOL_PERMISSION_MANIFEST. Define default role access and enforce every server API operation through central authorization. Never rely on sidebar hiding.\n2. Add a route \`${id}\` to CLUSTER_APP_ROUTE_MANIFEST with \`tool: '${id}'\`, \`surface: 'standalone-tool'\`, optional sidebar/action metadata, and \`adminOnly: ${adminOnly}\`.\n3. Add one module to STANDALONE_TOOL_MODULES in application-standalone-tool-registry.tsx. Use lazy import of the copied ${Pascal}ToolPage and a render adapter. No edits to ClusterApplication or feature-prefetch are necessary.\n4. Register actual server routes with validated inputs, object-level authorization, audit for privileged mutations, and client/API types. Grant no authority from client-provided tool metadata.\n5. Add Tool Config only if administrator-configurable behavior exists; keep working UI inside the tool itself.\n6. Add focused API, route/access, UI, and registry tests. Run \`npm run tool:check\` and the relevant suites before publishing.\n7. Keep the tool built-in and versioned with Cluster. Remote execution and downloadable third-party plugins are NOT supported by this contract.\n`;
  fs.writeFileSync(path.join(dest, 'INTEGRATION.md'), note);
  return dest;
}

const args = process.argv.slice(2);
const command = args[0] || 'check';
try {
  if (command === 'check') {
    const base = args.includes('--root') ? path.resolve(args[args.indexOf('--root') + 1]) : root;
    const result = checkTools(base);
    console.log(`Tool registry OK: ${result.routes} routes, ${result.tools} permission identities, ${result.standalone.length} standalone modules (${result.standalone.join(', ')}).`);
  } else if (command === 'new') {
    const read = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
    const dest = scaffold({ id: read('--id'), label: read('--label'), adminOnly: args.includes('--admin-only'), outputRoot: read('--out') });
    console.log(`Generated unregistered tool scaffold: ${dest}`);
  } else {
    throw new Error('Usage: node tools/scripts/cluster-tool.mjs check [--root path] | new --id camelCase --label "Display Name" [--admin-only] [--out directory]');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
