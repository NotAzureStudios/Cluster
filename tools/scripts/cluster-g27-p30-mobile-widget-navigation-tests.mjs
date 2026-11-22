// Phone and tablet Home: below the canvas width the grid becomes a flow in
// reading order, and every arrangement action stays reachable without dragging.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const grid=readFileSync(path.join(root,'packages/renderer/src/features/home-widgets/HomeWidgetGrid.tsx'),'utf8');
const css=readFileSync(path.join(root,'packages/renderer/src/features/home-widgets/home-widgets.css'),'utf8');
const dash=readFileSync(path.join(root,'packages/renderer/src/features/application/modules/ApplicationDashboard.tsx'),'utf8');
let n=0; function check(label,fn){fn();++n;console.log('PASS',label)}
check('narrow widths switch to a flow layout',()=>{assert.match(grid,/const GRID_MIN_WIDTH = 880;/);assert.match(grid,/width >= GRID_MIN_WIDTH \? "grid" : "flow"/);});
check('phone flows in two columns, tablet in four',()=>assert.match(grid,/const flowColumns = width < 560 \? 2 : 4;/));
check('flow renders in reading order',()=>assert.match(grid,/const ordered = mode === "flow" \? readingOrder\(shown\) : shown;/));
check('small widgets take half a row, others the full row',()=>assert.match(grid,/"--fspan": item\.size === "small" \? flowColumns \/ 2 : flowColumns/));
check('flow CSS packs rows densely',()=>{assert.match(css,/\.hw-grid\[data-mode="flow"\] \{[^}]*grid-auto-flow: row dense;/);assert.match(css,/grid-column: span var\(--fspan\);/);});
check('drag is canvas-only; flow uses the menu',()=>{assert.match(grid,/if \(!editMode \|\| mode !== "grid"/);assert.match(grid,/mode === "flow" \? \[\s*\{ id: "earlier", label: "Move up"/);});
check('keyboard arrows move in reading order on flow',()=>assert.match(grid,/if \(mode === "flow"\) moveInOrder\(item,/));
check('resize handle only on the canvas',()=>assert.match(grid,/mode === "grid" && \(entry\?\.sizes\.length \|\| 0\) > 1 && <span\s+className="hw-resize"/));
check('Auto-arrange is hidden where it has no effect',()=>{assert.match(dash,/className="home-arrange"/);assert.match(css,/@media \(max-width: 879px\) \{ \.home-arrange \{ display: none; \} \}/);});
check('retired carousel and focus modes stay removed',()=>{assert.doesNotMatch(dash,/mobileLayout|carousel/i);assert.doesNotMatch(css,/carousel|data-mobile-layout/);});
check('reduced motion stops grid animation',()=>assert.match(css,/@media \(prefers-reduced-motion: reduce\) \{\s*\.hw-item, \.hw-slot \{ transition: none; \}/));
console.log(`G27 P30 Home on phones: ${n}/${n} passed`);
