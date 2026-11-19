// The inline theme bootstrap in index.html duplicates applyTheme() because it
// has to run before the bundle exists. These checks keep the copy honest.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../../apps/web/index.html", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../../packages/renderer/src/features/application/modules/application-shell-runtime.ts", import.meta.url), "utf8");

let passed = 0;
const check = (name, condition) => { assert.ok(condition, name); passed += 1; console.log(`PASS ${name}`); };

check("the document does not start in a theme the app will immediately change",
  /<html[^>]*data-theme="dark"/.test(html) && /<html[^>]*data-theme-mode="dark"/.test(html));

check("a surface colour is inline, so the first paint is not a white flash",
  /background-color:\s*#101214/.test(html) && /\[data-theme="light"\][^}]*background-color:\s*#f7f8f9/.test(html));

check("the inline bootstrap reads the same storage key as the app",
  html.includes('"cluster-theme-mode"') && runtime.includes('THEME_STORAGE_KEY = "cluster-theme-mode"'));

check("it accepts the same values and falls back the same way",
  /stored === "dark" \|\| stored === "light" \|\| stored === "system"/.test(html) &&
  /stored === "dark" \|\| stored === "light" \|\| stored === "system" \? stored : "dark"/.test(runtime) &&
  /var theme = "dark"/.test(html));

check("it resolves \"system\" against the same media query as the app",
  html.includes('matchMedia("(prefers-color-scheme: dark)")') &&
  runtime.includes('matchMedia("(prefers-color-scheme: dark)")'));

check("it sets the same attributes the app sets",
  /dataset\.theme = resolved/.test(html) && /dataset\.themeMode = theme/.test(html) &&
  /dataset\.theme = resolved/.test(runtime) && /dataset\.themeMode = theme/.test(runtime));

check("storage access is guarded, because it throws with site data blocked",
  /try\s*\{[\s\S]{0,200}localStorage[\s\S]{0,200}\}\s*catch/.test(html));

console.log(`\n${passed}/7 first-paint checks passed`);
