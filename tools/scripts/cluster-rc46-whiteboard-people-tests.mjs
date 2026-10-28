import assert from 'node:assert/strict';
import fs from 'node:fs';
import { eraseWhiteboardElementsAt } from '../../packages/renderer/src/features/whiteboards/whiteboard-elements.ts';
const root = new URL('../../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');
let passed = 0;
function test(label, fn) { fn(); passed += 1; console.log(`PASS ${passed}: ${label}`); }
const horizontal = () => ({id: 'path1', type: 'path', stroke: '#fff', strokeWidth: 2, opacity:1, dashed:false, points:[{x:0,y:0},{x:100,y:0}]});
test('brush clipping splits a long sparsely sampled stroke at true circle intersections', () => {
  const fragments = eraseWhiteboardElementsAt([horizontal()], {x:50,y:0}, 5);
  assert.equal(fragments.length,2);
  assert.ok(Math.abs(fragments[0].points.at(-1).x-44)<.001);
  assert.ok(Math.abs(fragments[1].points[0].x-56)<.001);
});
test('brush ignores distant paths',()=> assert.deepEqual(eraseWhiteboardElementsAt([horizontal()], {x:50,y:60}, 5), [horizontal()]));
test('brush leaves diagram shapes intact even when touched',()=> {
  const shape={id:'shape',type:'shape',x:40,y:-10,width:20,height:20,shape:'rectangle',stroke:'#fff',fill:'#000',strokeWidth:2,opacity:1};
  assert.deepEqual(eraseWhiteboardElementsAt([shape], {x:50,y:0},10),[shape]);
});
test('object eraser deletes a touched full stroke',()=> assert.equal(eraseWhiteboardElementsAt([horizontal()], {x:50,y:0},5,'object').length,0));
test('locked strokes cannot be erased',()=> {
  const original={...horizontal(),locked:true};
  assert.deepEqual(eraseWhiteboardElementsAt([original],{x:50,y:0},5),[original]);
});
test('free-standing line clipped into brush-sized spans',()=> {
  const line={id:'line1',type:'line',x1:0,y1:0,x2:100,y2:0,stroke:'#fff',strokeWidth:2,opacity:1,dashed:false};
  const result=eraseWhiteboardElementsAt([line],{x:50,y:0},5);
  assert.equal(result.length,2);
});
test('profile opening does not await context query',()=> {
  const s=read('packages/renderer/src/features/people/PeoplePages.tsx');
  assert.match(s,/const profileResult = await api<PeopleProfilePayload>/);
  assert.match(s,/setProfile\(profileResult\);\s*setLoadStatus\("Profile loaded\."\);\s*void queryApi<PeopleContext>/);
});
test('full page profile is available and returnable',()=> {
  const s=read('packages/renderer/src/features/people/PeoplePages.tsx');
  assert.match(s,/people-profile-expanded-rc46/);
  assert.match(s,/Back to directory/);
  assert.match(s,/setProfileExpanded\(false\)/);
  assert.match(s,/people-profile-feed-rc46/);
});
test('private location remains hidden on public overview',()=>{
  const s=read('packages/renderer/src/features/people/PeoplePages.tsx');
  assert.match(s,/profile\.hideLocation \? "Hidden"/);
});
test('board close returns to origin, not owning project unless opened from project',()=>{
 const s=read('packages/renderer/src/features/application/ClusterApplication.tsx');
 assert.match(s,/boardReturnOriginRef/);assert.match(s,/origin\?\.screen === "project"/);
 assert.match(s,/origin\.screen !== "board" \? origin\.screen : "projects"/);
});
console.log(`RC46 whiteboard/people behavior: ${passed}/${passed} checks`);
