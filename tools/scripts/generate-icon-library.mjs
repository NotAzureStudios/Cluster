// Splits the Tabler and Simple Icons (brand) sets into small JSON chunks the
// web client fetches on demand: an index of names per set, then the SVG bodies
// in chunks of 200. Output goes to apps/web/public/icon-library (not committed).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'packages/renderer/package.json'));
const out = path.join(root, 'apps/web/public/icon-library');
const CHUNK = 200;
const SETS = { tabler: '@iconify-json/tabler/icons.json', 'simple-icons': '@iconify-json/simple-icons/icons.json' };

fs.rmSync(out, { recursive: true, force: true });
const summary = {};
for (const [prefix, source] of Object.entries(SETS)) {
  const set = require(source);
  const names = Object.keys(set.icons).filter((name) => !set.icons[name].hidden).sort();
  const dir = path.join(out, prefix);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ prefix, width: set.width || 24, height: set.height || 24, chunk: CHUNK, names }));
  for (let start = 0, n = 0; start < names.length; start += CHUNK, n++) {
    const chunk = {};
    for (const name of names.slice(start, start + CHUNK)) {
      const icon = set.icons[name];
      chunk[name] = icon.width || icon.height ? { body: icon.body, width: icon.width, height: icon.height } : icon.body;
    }
    fs.writeFileSync(path.join(dir, `${n}.json`), JSON.stringify(chunk));
  }
  summary[prefix] = names.length;
}
console.log('Icon library:', JSON.stringify(summary));
