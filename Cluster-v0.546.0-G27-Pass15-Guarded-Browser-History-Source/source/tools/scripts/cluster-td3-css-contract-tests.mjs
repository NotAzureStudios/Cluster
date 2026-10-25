import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const styles=path.join(root,'packages/renderer/src/styles');
const read=relative=>fs.readFileSync(path.join(styles,relative),'utf8');
const imports=[...read('../styles.css').matchAll(/@import\s+"([^"\n]+)"\s*;/g)].map(match=>match[1]);
let count=0;const check=(name,callback)=>{callback();count++;console.log('PASS',name)};
check('every CSS entry import resolves to a file',()=>{for(const imp of imports)assert.ok(fs.statSync(path.resolve(styles,'..',imp)).isFile(),imp)});
check('canonical select CSS imported exactly once',()=>assert.equal(imports.filter(value=>value==='./styles/components/cluster-select.css').length,1));
check('canonical primitives CSS imported exactly once',()=>assert.equal(imports.filter(value=>value==='./styles/design-system/primitives.css').length,1));
check('production-ui remains the last stylesheet layer',()=>assert.equal(imports.at(-1),'./styles/design-system/production-ui.css'));
check('select style has zero priority overrides',()=>assert.equal((read('components/cluster-select.css').match(/!important/g)||[]).length,0));
check('global application focus no longer hard-overrides primitive focus',()=>{
 const css=read('layers/application-adaptive.css');
 assert.doesNotMatch(css,/outline: 1px solid color-mix\([^;]*\) !important/);
 assert.match(css,/outline: 2px solid color-mix/);
});
check('canonical focus uses a readable two-pixel ring',()=>{
 const css=read('design-system/production-ui.css');
 assert.match(css,/outline:2px solid var\(--cluster-focus-color\);outline-offset:2px/);
 assert.match(read('design-system/primitives.css'),/\.cluster-button-v425:focus-visible[\s\S]*?outline: 2px solid/);
});
check('focus colors use semantic palette with accessible light fallback',()=>{
 const css=read('design-system/production-ui.css');
 assert.match(css,/--cluster-focus-color:var\(--cluster-semantic-focus-ring,#9BE7FF\)/);
 assert.match(css,/:root\[data-theme="light"\]\{--cluster-focus-color:var\(--cluster-semantic-focus-ring,#006D9A\)/);
});
check('known select !important debt has been retired',()=>{
 assert.doesNotMatch(read('components/cluster-select.css'),/!important/);
 assert.equal((read('layers/application-adaptive.css').match(/!important/g)||[]).length,37);
});
console.log(`${count}/${count} CSS ownership and focus checks passed`);
