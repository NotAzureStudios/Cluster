/**
 * RC15 icon-catalog compiler: select verified, local Iconify glyphs from our
 * pinned Phosphor, Tabler and Lucide collections before the renderer build.
 * No remote assets, no legacy icon family and no missing semantic glyphs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const requireRenderer = createRequire(path.join(root,'packages/renderer/package.json'));
const names = [
  'activity','archive','audio','bell','calendar','check','chevron-down','chevron-left','chevron-right','chevron-up',
  'clock','close','cloud','cloud-off','code','comment','download','drag','file','folder','forward','fullscreen',
  'game','grid','home','image','inventory','keyboard','library','link','list','lock','menu','minus','minimize','model','more',
  'mute','next','note','operations','packet','pages','palette','panel-close','panel-open','pause','pdf','pin',
  'play','playlist','plus','previous','print','project','refresh','reset','rewind','rotate','search','settings',
  'spark','speed','star','star-filled','sync','text','ticket','timeline','tools','trash','upload','user',
  'users','video','volume','warning','work','zoom-in','zoom-out',
];
// Semantic, not arbitrary asset identifiers. Each glyph chooses its own
// treatment at the application boundary (sidebar / action / workspace).
export const iconCandidates = {
  ph: {
    'star-filled':'star-fill',
    activity:'chart-line-up-duotone',archive:'archive-duotone',audio:'headphones-duotone',bell:'bell-duotone',
    calendar:'calendar-blank-duotone',clock:'clock-duotone',cloud:'cloud-duotone',code:'code-duotone',
    comment:'chat-circle-duotone',file:'file-duotone',folder:'folder-duotone',game:'game-controller-duotone',inventory:'package-duotone',
    grid:'squares-four-duotone',home:'house-duotone',image:'image-duotone',library:'books-duotone',
    lock:'lock-key-duotone',model:'cube-duotone',note:'notepad-duotone',operations:'chart-bar-duotone',
    packet:'files-duotone',pages:'files-duotone',palette:'palette-duotone',pdf:'file-pdf-duotone',
    project:'stack-duotone',settings:'gear-six-duotone',ticket:'ticket-duotone',timeline:'list-numbers-duotone',
    tools:'wrench-duotone',user:'user-circle-duotone',users:'users-three-duotone',video:'film-strip-duotone',
    warning:'warning-duotone',work:'briefcase-duotone',star:'star-duotone',search:'magnifying-glass-duotone',
    trash:'trash-duotone',upload:'upload-simple-duotone',download:'download-simple-duotone',
    link:'link-duotone',play:'play-duotone',pause:'pause-duotone',pin:'push-pin-duotone',
    sync:'arrows-clockwise-duotone',refresh:'arrow-clockwise-duotone',spark:'sparkle-duotone',
    list:'list-duotone',menu:'list-duotone',check:'check-duotone',

  },
  tabler: {
    'star-filled':'star-filled',
    activity:'activity',archive:'archive',audio:'headphones',bell:'bell',calendar:'calendar',
    check:'check',clock:'clock',cloud:'cloud',code:'code',comment:'message-circle',file:'file',
    folder:'folder',game:'device-gamepad',inventory:'package',grid:'layout-grid',home:'home',image:'photo',library:'book',
    list:'list',lock:'lock',model:'cube',note:'note',operations:'adjustments-horizontal',
    packet:'files',pages:'files',palette:'palette',pdf:'file-type-pdf',project:'stack-2',
    settings:'settings',ticket:'ticket',timeline:'list-numbers',tools:'tool',user:'user',
    users:'users',video:'video',warning:'alert-triangle',work:'briefcase',
    search:'search',star:'star',trash:'trash',download:'download',upload:'upload',
    'chevron-down':'chevron-down','chevron-left':'chevron-left','chevron-right':'chevron-right',
    'chevron-up':'chevron-up',close:'x',link:'link',pin:'pin',play:'player-play',pause:'player-pause',
    plus:'plus',minus:'minus',more:'dots',refresh:'refresh',sync:'refresh',
    'zoom-in':'zoom-in','zoom-out':'zoom-out',fullscreen:'maximize',minimize:'minimize',
    'panel-close':'layout-sidebar-right-collapse','panel-open':'layout-sidebar-right-expand',

  },
  lucide: {
    activity:'activity',archive:'archive',audio:'headphones',bell:'bell',calendar:'calendar',
    check:'check', 'chevron-down':'chevron-down','chevron-left':'chevron-left',
    'chevron-right':'chevron-right','chevron-up':'chevron-up',clock:'clock',close:'x',
    cloud:'cloud','cloud-off':'cloud-off',code:'code',comment:'message-circle',download:'download',
    drag:'grip-vertical',file:'file',folder:'folder',forward:'fast-forward',fullscreen:'maximize',
    game:'gamepad-2',inventory:'package',grid:'grid-2x2',home:'house',image:'image',keyboard:'keyboard',
    library:'book-open',link:'link',list:'list',lock:'lock',menu:'menu',minus:'minus',
    minimize:'minimize',model:'box',more:'ellipsis',mute:'volume-x',next:'skip-forward',
    note:'notebook',operations:'sliders-horizontal',packet:'files',pages:'files',palette:'palette',
    'panel-close':'panel-right-close','panel-open':'panel-right-open',pause:'pause',pdf:'file-text',
    pin:'pin',play:'play',playlist:'list-plus',plus:'plus',previous:'skip-back',print:'printer',
    project:'layers',refresh:'refresh-cw',reset:'rotate-ccw',rewind:'rewind',rotate:'rotate-cw',
    search:'search',settings:'settings',spark:'sparkles',speed:'gauge',star:'star','star-filled':'star',
    sync:'refresh-cw',text:'file-text',ticket:'ticket',timeline:'list-ordered',tools:'wrench',
    trash:'trash-2',upload:'upload',user:'user',users:'users',video:'video',volume:'volume-2',
    warning:'triangle-alert',work:'briefcase-business','zoom-in':'zoom-in','zoom-out':'zoom-out',
  }
};
function getCollection(prefix) {
  // Node resolves the pinned dependency from the root workspace after npm install.
  const packagePath = `@iconify-json/${prefix}/icons.json`;
  let filepath;
  try { filepath=requireRenderer.resolve(packagePath); }
  catch { filepath=require.resolve(packagePath); }
  return JSON.parse(fs.readFileSync(filepath,'utf8'));
}
function expand(collection, name, depth=0){
  if(depth>4)return null;
  let icon=collection.icons?.[name];
  if(!icon && collection.aliases?.[name]){
    const alias=collection.aliases[name];
    const parent=expand(collection,alias.parent,depth+1);
    if(!parent)return null;
    // Aliases with transforms must not be flattened into incorrect artwork.
    if(alias.rotate || alias.hFlip || alias.vFlip) return null;
    icon={...parent,...alias,body:parent.body};
  }
  if(!icon?.body)return null;
  return {body:icon.body,width:icon.width??collection.width??24,height:icon.height??collection.height??24};
}
function compile(packs){
  const catalog={};const missing={};const included={};
  for(const prefix of ['ph','tabler','lucide']){
    const collection=packs[prefix];let count=0;
    for(const name of names){
      const identifier=iconCandidates[prefix][name];if(!identifier)continue;
      const data=expand(collection,identifier);
      if(data){catalog[`${prefix}:${name}`]=data;count++;}
      else (missing[prefix]??=[]).push(`${name}=${identifier}`);
    }
    included[prefix]=count;
  }
  const uncovered = names.filter((name) => !['ph','tabler','lucide'].some((pack) => catalog[`${pack}:${name}`]));
  return {catalog,missing,included,uncovered};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const iconComponent = fs.readFileSync(path.join(root,'packages/renderer/src/components/ClusterIcon.tsx'),'utf8');
  const exportedNames = iconComponent.match(/export type ClusterIconName\s*=([\s\S]*?);/)?.[1];
  if (!exportedNames) throw Error('ClusterIconName type was not found');
  const semanticNames = [...exportedNames.matchAll(/\| \"([^\"]+)\"/g)].map(match=>match[1]);
  const typeGap = semanticNames.filter(name=>!names.includes(name));
  const generatorGap = names.filter(name=>!semanticNames.includes(name));
  if(typeGap.length||generatorGap.length)throw Error(`Semantic/icon catalog drift: missing=${typeGap} obsolete=${generatorGap}`);
  const compiled=compile(Object.fromEntries(['ph','tabler','lucide'].map(pack=>[pack,getCollection(pack)])));
  // Fail explicitly if a whole pack fails to resolve. Individual icon aliases
  // vary across versions and fall back deterministically to another pack.
  for(const pack of ['ph','tabler','lucide'])if(compiled.included[pack]<20)throw Error(`Icon set ${pack} resolved only ${compiled.included[pack]} glyphs`);
  if(compiled.uncovered.length)throw Error(`Uncovered semantic Cluster icons: ${compiled.uncovered.join(', ')}`);
  if(!compiled.catalog['ph:star-filled'] && !compiled.catalog['tabler:star-filled'])throw Error('A true filled-star glyph is mandatory');
  const output=path.join(root,'packages/renderer/src/components/icon-catalog.generated.json');
  fs.writeFileSync(output,JSON.stringify(Object.fromEntries(Object.entries(compiled.catalog).sort(([a],[b])=>a.localeCompare(b))))+'\n');
  console.log(JSON.stringify({output,icons:Object.keys(compiled.catalog).length,included:compiled.included,missing:compiled.missing,uncovered:compiled.uncovered}));
}
export {compile,expand,names};
