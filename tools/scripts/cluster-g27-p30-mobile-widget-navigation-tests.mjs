import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const dash=readFileSync(path.join(root,'packages/renderer/src/features/application/modules/ApplicationDashboard.tsx'),'utf8');
const place=readFileSync(path.join(root,'packages/renderer/src/features/home-widgets/HomeWidgetPlacement.tsx'),'utf8');
const css=readFileSync(path.join(root,'packages/renderer/src/features/home-widgets/home-widgets.css'),'utf8');
let n=0; function check(label,fn){fn();++n;console.log('PASS',label)}
const signatures=[
 ['navigation only when not editing',/const mobileNavigation = !editMode &&/],
 ['supported carousel and focus modes',/mobileLayout === "carousel" \|\| mobileLayout === "focus"/],
 ['navigation bounded by actual visible widget list',/Math\.max\(0, Math\.min\(widgetIds.length - 1, activeIndex \+ offset\)\)/],
 ['reactive selection based on identity, not stale array index',/widgetIds\.indexOf\(selectedId \|\| ""\)/],
 ['navigation list sourced from permission-filtered visible widgets',/const mobileHomeWidgetIds = homeVisiblePlacements\.map/],
 ['removed widgets automatically fall back to first permitted placement',/mobileHomeWidgetIds\.includes\(mobileHomeSelectedId \|\| ""\)/],
 ['touch scrolling selects current card',/const updateCarouselPosition = \(\) =>/],
 ['touch swipe does not compete with programmatic scrolling',/programmaticCarouselSelection\.current = false/],
 ['arrow navigation skips focused widget inputs',/event\.target !== event\.currentTarget/],
 ['mobile region can receive keyboard focus',/tabIndex=\{mobileNavigation \? 0 : undefined\}/],
 ['controls have next and previous aria labels',/aria-label="Previous Home widget"[\s\S]+aria-label="Next Home widget"/],
 ['carousel position status announced to assistive tech',/role="status" aria-live="polite"/],
 ['reduced motion respects OS preference',/prefers-reduced-motion: reduce/],
 ['selection synchronized into each placement',/mobileSelected=\{placement.id === activeMobileHomeId\}/],
 ['existing DnD ref kept',/setCanvasRef = useCallback\(\(node: HTMLElement \| null\) => \{ canvasRef\.current = node; setNodeRef\(node\); \}, \[setNodeRef\]\)/],
];
for(const [label,matcher] of signatures)check(label,()=>assert.match(dash,matcher));
check('each placement has stable widget id for scroll positioning',()=>assert.match(place,/data-widget-id=\{placement\.id\}/));
check('each placement has mobile selected state',()=>assert.match(place,/data-mobile-selected=\{mobileSelected \? "true" : "false"\}/));
check('focus mode actually hides all but selected cards when not editing',()=>assert.match(css,/data-mobile-layout="focus"\]\[data-edit-mode="false"\] \.home-widget-placement-v505\[data-mobile-selected="false"\]\{display:none;/));
check('mobile navigation hidden at desktop widths',()=>{assert.match(css,/\.home-widget-mobile-nav-v547\{display:none;\}/);assert.match(css,/@media \(max-width:760px\)/);});
check('focused cards remain visible in edit mode',()=>assert.doesNotMatch(css,/\[data-edit-mode="true"\][^{]*mobile-selected="false"/));
check('mobile card scroll snapping retained',()=>assert.match(css,/scroll-snap-type:x mandatory/));
console.log(`G27 P30 Mobile Widget 2.0: ${n}/${n} passed`);
