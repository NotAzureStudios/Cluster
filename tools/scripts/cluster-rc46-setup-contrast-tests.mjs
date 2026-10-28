import assert from 'node:assert/strict';
import fs from 'node:fs';
const css = fs.readFileSync(new URL('../../packages/renderer/src/features/application/styles/phase1-identity-v473.css', import.meta.url), 'utf8');
const wizard = fs.readFileSync(new URL('../../packages/renderer/src/features/application/modules/ApplicationSetupWizard.tsx', import.meta.url), 'utf8');
const release = JSON.parse(fs.readFileSync(new URL('../../config/release-candidate.json', import.meta.url), 'utf8'));
const selector = '.setup-phase1-v473 .setup-mode-picker-v506 > button';
const rule = (suffix = '') => {
  const escaped = (selector + suffix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(escaped+'\\s*\\{([^}]*)\\}'));
  assert.ok(match, `missing style rule: ${selector}${suffix}`);
  return match[1];
};
let passed = 0;
const test = (name, fn) => { fn(); console.log('PASS', name); passed++; };
test('native setup button foreground explicitly follows theme text token',()=>{
  assert.match(rule(), /color:\s*var\(--text,\s*#f2f5f9\)/);
});
test('button heading inherits foreground',()=>{
  assert.match(rule(' > strong'), /color:\s*inherit/);
});
test('description has explicit theme-safe foreground and no dim opacity',()=>{
  assert.match(rule(' > small'), /color:\s*var\(--soft-text,/);
  assert.match(rule(' > small'), /opacity:\s*1/);
});
test('selected option does not override foreground with a dark color',()=>{
  assert.ok(!/(?:^|[;\s])color\s*:/.test(rule('.selected')));
});
test('keyboard focus has a visible outline',()=>{
  assert.match(rule(':focus-visible'), /outline:\s*2px/);
});
test('setup choices keep semantic pressed state and native unstyled rendering',()=>{
  assert.match(wizard,/className=\{mode === item.id \? "selected"/);
  assert.match(wizard,/aria-pressed=\{mode === item.id\}/);
  assert.match(wizard,/ClusterButton unstyled type="button" key=\{item.id\}/);
});
test('RC46 release identity',()=>{
  assert.ok(release.sequence >= 46); assert.equal(release.release, `1.0.0-rc.${release.sequence}`);
});
console.log(`${passed}/${passed} RC46 setup-contrast source checks passed.`);
