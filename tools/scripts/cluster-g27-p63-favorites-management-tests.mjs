import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const file=(r)=>fs.readFileSync(new URL('../../'+r,import.meta.url),'utf8');
const parse=(raw)=>{
 if(typeof raw!=='string')return null;
 let x=raw.trim().replace(/^#/,''); try{x=decodeURIComponent(x)}catch{return null};x=x.replace(/^\/+|\/+$/g,'');
 const [screen,a,b]=x.split('/');const known=new Set(['project','board','whiteboard','settings','calendar','people','inbox']);
 if(!known.has(screen)||!x||x.length>420)return null;
 return {route:screen,context:{projectId:screen==='project'?a:(screen==='board'||screen==='whiteboard')&&b?a:null,boardId:screen==='board'?(b||a):null,whiteboardId:screen==='whiteboard'?(b||a):null}};
};
const serialize=(r)=>r.route==='project'?`project/${r.context.projectId}`:r.route==='board'?`board/${r.context.projectId?r.context.projectId+'/':''}${r.context.boardId}`:r.route==='whiteboard'?`whiteboard/${r.context.projectId?r.context.projectId+'/':''}${r.context.whiteboardId}`:r.route;
const module={exports:{}};
vm.runInNewContext(ts.transpileModule(file('packages/renderer/src/features/search/navigation-favorites.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:(id)=>{if(id.endsWith('/navigation'))return{parseNavigationRoute:parse,serializeNavigationRoute:serialize};throw Error(id)}},{filename:'navigation-favorites.ts'});
const {removeWorkspaceFavorite,moveWorkspaceFavorite,normalizeWorkspaceFavorites}=module.exports;
const json=(v)=>JSON.stringify(v);let n=0;function check(label,fn){fn();n++;console.log('PASS '+label)}
check('revoked saved project can be deleted without resolving its owner/title',()=>{
 assert.equal(json(removeWorkspaceFavorite(['project/revoked','project/allowed'],'project/revoked')),json(['project/allowed']));
});
check('malformed deletion request cannot affect another favorite',()=>{
 const a=['project/one','project/two'];for(const x of ['https://elsewhere.invalid','project','%E0%A4%A'])assert.equal(json(removeWorkspaceFavorite(a,x)),json(a));
});
check('removing one Favorite preserves order and ignores duplicates',()=>{
 assert.equal(json(removeWorkspaceFavorite(['project/x','project/y','project/x','settings'],'#project/y')),json(['project/x','settings']));
});
check('move up and down reorders the matching canonical route only',()=>{
 const a=['project/x','project/y','settings'];
 assert.equal(json(moveWorkspaceFavorite(a,'project/y',-1)),json(['project/y','project/x','settings']));
 assert.equal(json(moveWorkspaceFavorite(a,'project/y',1)),json(['project/x','settings','project/y']));
});
check('boundary moves and missing IDs leave the canonical list untouched',()=>{
 const a=['project/x','project/y'];for(const [id,dir] of [['project/x',-1],['project/y',1],['project/z',1],['bogus',1]])assert.equal(json(moveWorkspaceFavorite(a,id,dir)),json(a));
});
check('management helpers do not mutate incoming values',()=>{
 const a=Object.freeze(['project/x','settings']);removeWorkspaceFavorite(a,'project/x');moveWorkspaceFavorite(a,'settings',-1);assert.equal(json(a),json(['project/x','settings']));
});
check('reorder and removal continue to enforce the same 24-entry limit',()=>{
 const a=Array.from({length:35},(_,i)=>`project/p${i}`);
 assert.equal(normalizeWorkspaceFavorites(moveWorkspaceFavorite(a,'project/p20',-1)).length,24);
 assert.equal(removeWorkspaceFavorite(a,'project/p0').length,23);
});
const palette=file('packages/renderer/src/features/search/CommandPalette.tsx');
check('manager provides accessible keyboard buttons for removal and ordering',()=>{
 assert.match(palette,/aria-label="Manage navigation favorites"/);
 assert.match(palette,/aria-label=\{`Move \$\{genericLabel\} up`\}/);
 assert.match(palette,/aria-label=\{`Move \$\{genericLabel\} down`\}/);
 assert.match(palette,/aria-label=\{`Remove \$\{genericLabel\}`\}/);
});
check('manager shows only route type and relative order, never unverified resource names',()=>{
 assert.match(palette,/`\$\{route \? screenLabel\(route\.route\) : "Workspace"\} favorite \$\{index \+ 1\}`/);
 assert.doesNotMatch(palette,/const genericLabel = .*recentWorkspaceTitle/);
});
check('manager uses existing account-scoped preference writer and handles save failures',()=>{
 assert.match(palette,/setStoredFavorites\(\(current\) => removeWorkspaceFavorite\(current, saved\)\)/);
 assert.match(palette,/setStoredFavorites\(\(current\) => moveWorkspaceFavorite\(current, saved, [-+]?1\)\)/);
 assert.match(palette,/favoritesState\.error && <p role="alert">Favorite changes could not be saved/);
});
check('manager can clear inaccessible entries without navigating',()=>{
 assert.match(palette,/onClick=\{\(\) => setStoredFavorites\(\[\]\)\}>Clear all/);
 assert.match(palette,/Removing a revoked favorite never opens the resource/);
});
check('manager is dismissed whenever palette/account session reopens',()=>{
 assert.match(palette,/setShowFavoritesManager\(false\)/);
 assert.match(palette,/\}, \[open, user\.id\]\);/);
});
check('clearing all leaves a way to close the manager',()=>{
 assert.match(palette,/favoriteRoutes.length > 0 \|\| showFavoritesManager/);
 assert.match(palette,/favoriteRoutes.length === 0 && <p role="status">No favorites saved/);
});
console.log(`${n}/${n} G27 P63 favorites management checks passed`);
