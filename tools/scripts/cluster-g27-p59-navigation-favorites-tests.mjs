import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const file=(r)=>readFileSync(new URL('../../'+r,import.meta.url),'utf8');
const parser=(raw)=>{
 if(typeof raw!=='string')return null;
 let normalized=raw.trim().replace(/^#/,'');
 try{normalized=decodeURIComponent(normalized)}catch{return null}
 normalized=normalized.replace(/^\/+|\/+$/g,'');
 if(!normalized || normalized.length>420)return null;
 const [screen,a,b]=normalized.split('/');
 const known=new Set(['project','board','whiteboard','calendar','scheduler','people','mywork','settings','inbox','projects','library','activity','dashboard']);
 if(!known.has(screen))return null;
 return {route:screen,context:{projectId:screen==='project'?a:(screen==='board'||screen==='whiteboard')&&b?a:null, boardId:screen==='board'?(b||a):null, whiteboardId:screen==='whiteboard'?(b||a):null}};
};
const serializer=(route)=>{
 const {route:s,context:c}=route;
 if(s==='project')return `project/${c.projectId}`;
 if(s==='board')return `board/${c.projectId?`${c.projectId}/`:''}${c.boardId}`;
 if(s==='whiteboard')return `whiteboard/${c.projectId?`${c.projectId}/`:''}${c.whiteboardId}`;
 return s;
};
const src=file('packages/renderer/src/features/search/navigation-favorites.ts');
const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
vm.runInNewContext(js,{module,exports:module.exports,require(spec){if(spec.endsWith('/navigation'))return{parseNavigationRoute:parser,serializeNavigationRoute:serializer};throw Error('unexpected '+spec)}},{filename:'navigation-favorites.ts'});
const {canonicalWorkspaceFavorite,normalizeWorkspaceFavorites,toggleWorkspaceFavorite,MAX_WORKSPACE_FAVORITES}=module.exports;
let n=0;const check=(name,fn)=>{fn();n++;console.log('PASS '+name)};
const json=(x)=>JSON.stringify(x);
check('canonical favorites normalize permitted route syntax without storing names',()=>{
 assert.equal(canonicalWorkspaceFavorite('#project/abc'),'project/abc');
 assert.equal(canonicalWorkspaceFavorite('board/abc/card42'),'board/abc/card42');
 assert.equal(canonicalWorkspaceFavorite('settings'),'settings');
});
check('invalid, external, and incomplete resource links are refused',()=>{
 for(const val of [null,42,{},'https://evil.example/p','project','board','whiteboard','nosuch/1','%E0%A4%A']) assert.equal(canonicalWorkspaceFavorite(val),null);
});
check('malformed server preference records fail closed',()=>{
 assert.equal(json(normalizeWorkspaceFavorites({items:['project/one']})),json([]));
 assert.equal(json(normalizeWorkspaceFavorites(null)),json([]));
});
check('duplicates normalize to one canonical route',()=>{
 assert.equal(json(normalizeWorkspaceFavorites(['project/a','#project/a','project/a','settings','settings'])),json(['project/a','settings']));
});
check('favorites are bounded to 24 entries',()=>{
 const many=Array.from({length:55},(_,i)=>`project/p${i}`);
 const output=normalizeWorkspaceFavorites(many);
 assert.equal(MAX_WORKSPACE_FAVORITES,24);
 assert.equal(output.length,24);
 assert.equal(output.at(-1),'project/p23');
});
check('toggle pins newest first, respects cap, and unpins without changing neighbors',()=>{
 const first=toggleWorkspaceFavorite(['project/a','settings'],parser('project/b'));
 assert.equal(json(first),json(['project/b','project/a','settings']));
 const second=toggleWorkspaceFavorite(first,parser('project/a'));
 assert.equal(json(second),json(['project/b','settings']));
});
const palette=file('packages/renderer/src/features/search/CommandPalette.tsx');
check('Favorites use existing per-user sync engine',()=>{
 assert.match(palette,/useServerState<string\[]>\("user", "navigation\.favorites", \[\]\)/);
 assert.match(palette,/normalizeWorkspaceFavorites\(storedFavorites\)/);
});
check('no stale private Board or Whiteboard names from stored favorites',()=>{
 assert.match(palette,/title: navigation\.route === "project" \? recentWorkspaceTitle\(navigation, projects\) : `Favorite \$\{screenLabel\(navigation\.route\)\}`/);
});
check('Favorites only show while workspace route is still accessible',()=>{
 assert.match(palette,/if \(!navigation \|\| !canOpenScreen\(user, navigation\.route\)\) return \[\]/);
 assert.match(palette,/navigation\.route === "project" && !projects\.some/);
});
check('favorite activation reuses fresh server authorization rather than direct setScreen',()=>{
 assert.match(palette,/key: `favorite-navigation-\$\{saved\}`/);
 assert.match(palette,/action: \(\) => openRecentRoute\(saved\)/);
 assert.match(palette,/await admitRecentWorkspace\(/);
});
check('current workspace favorite only offered for active authorized route',()=>{
 assert.match(palette,/currentFavoriteTarget\?\.route === currentScreen && canOpenScreen\(user, currentScreen\)/);
 assert.match(palette,/const favoriteToggleAction: PaletteItem\[] = pinnableRoute/);
});
check('favoriting persists canonical route with no resource payload',()=>{
 assert.match(palette,/setStoredFavorites\(\(current\) => toggleWorkspaceFavorite\(current, pinnableRoute\)\)/);
 assert.doesNotMatch(src,/(resourcePayload|cachedTitle|password|privateName)/);
});
check('favorite saves show pending, queued, and failed status',()=>{
 assert.match(palette,/favoritesState\.error/);
 assert.match(palette,/favoritesState\.queued/);
 assert.match(palette,/favoritesState\.saving/);
});
console.log(`${n}/${n} G27 P59 account-scoped favorites checks passed`);
