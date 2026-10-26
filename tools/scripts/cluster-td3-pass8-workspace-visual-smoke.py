"""Static representative DOM with production renderer CSS: not authenticated React/Qt screenshots."""
from pathlib import Path
import re,json
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[2];out=root/'.td3-pass8-preview-output';out.mkdir(exist_ok=True)
def flatten(p,seen=None):
 seen=seen or set();p=p.resolve()
 if p in seen:return ''
 seen.add(p)
 return re.sub(r'@import\s+["\']([^"\'\n]+)["\']\s*;',lambda m:flatten(p.parent/m.group(1),seen),p.read_text())
css='\n'.join(flatten(root/p) for p in ('packages/renderer/src/styles.css','packages/renderer/src/features/shell/shell.css','packages/renderer/src/features/shell/shell-v2.css'))
html=(root/'tools/fixtures/td3-pass7-workspace.html').read_text().replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+css.replace('</style>','')+'</style>')
extra_css='''<style>
.td8-rail{width:100%;margin-bottom:18px;border:1px solid var(--td-border);border-radius:16px;background:var(--td-panel);overflow:hidden;}
.td8-tree{display:grid;align-content:start;gap:7px;padding:18px 12px 16px 17px;background:color-mix(in srgb,var(--td-panel-2) 44%,var(--td-panel));border-right:1px solid var(--td-border);}
.td8-tree strong{font-size:12px;padding-bottom:9px}.td8-tree small{font-size:10px;color:var(--td-muted);text-transform:uppercase;letter-spacing:.1em;font-weight:750;margin:12px 4px 3px}
.td8-tree a{padding:9px 11px;border-radius:9px;color:var(--td-muted);font-size:11px;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.td8-tree a.active{background:color-mix(in srgb,var(--td-accent) 14%,var(--td-panel));color:var(--td-text);font-weight:700}
.td8-rail .td5-assets{border:0;border-radius:0;min-width:0;}.td8-rail .td5-file{grid-template-columns:minmax(0,1fr) 64px 85px 60px}.td8-rail .td5-tablehead{grid-template-columns:minmax(0,1fr) 64px 85px 60px}
.td8-handle{background:color-mix(in srgb,var(--td-accent) 13%,var(--td-panel))!important;outline:2px solid var(--td-accent)!important;outline-offset:-2px!important}
.td8-rail .td5-file-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td8-header{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:11px 16px;background:var(--td-panel-2);border-bottom:1px solid var(--td-border);font-size:12px}
.td8-tag{padding:5px 8px;background:color-mix(in srgb,var(--td-accent) 13%,var(--td-panel));border:1px solid var(--td-border);border-radius:7px;color:var(--td-text);font-size:10px}
.td8-rail .td5-assets-toolbar{padding:12px}.td8-rail .td5-tablehead{padding:10px 12px}.td8-rail .td5-file{margin:3px;padding:8px 11px}
@media(max-width:980px){.td8-tree{border:0;border-bottom:1px solid var(--td-border);display:flex;flex-wrap:wrap;padding:8px;gap:4px}.td8-tree strong,.td8-tree small{display:none}.td8-tree a{padding:8px;font-size:10px}.td8-rail .td5-assets{width:100%}}
@media(max-width:900px){.td8-rail .td5-file,.td8-rail .td5-tablehead{grid-template-columns:minmax(0,1fr) 70px}.td8-rail .td5-file>*:nth-child(n+3),.td8-rail .td5-tablehead>*:nth-child(n+3){display:none}}
@media(max-width:600px){.td8-rail .td5-assets-toolbar{flex-wrap:wrap}.td8-rail .td5-chip{display:none}}
</style>'''
html=html.replace('</head>',extra_css+'</head>')
script='''()=>{const assets=document.querySelector('.td5-assets');const host=document.createElement('div');host.className='td8-rail cluster-resizable-rail-v497';host.style.setProperty('--cluster-rail-width','268px');
 const rail=document.createElement('div');rail.className='cluster-resizable-rail-content-v497 td8-tree';rail.innerHTML='<strong>LIBRARY BROWSER</strong><small>Locations</small><a href="#">⌂ &nbsp; All files</a><a href="#" class="active">▱ &nbsp; Production</a><a href="#">▦ &nbsp; Concepts</a><a href="#">▰ &nbsp; Deliverables</a><small>Collections</small><a href="#">◇ &nbsp; Review queue</a><a href="#">☆ &nbsp; Favorites</a>';
 const handle=document.createElement('button');handle.className='cluster-resizable-rail-handle-v497 td8-handle';handle.type='button';handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-valuenow','268');handle.setAttribute('aria-label','Resize Library browser');handle.tabIndex=0;
 const main=document.createElement('div');main.className='cluster-resizable-main-v497';main.appendChild(assets);host.appendChild(rail);host.appendChild(handle);host.appendChild(main);
 assets.parentElement /* now main */;document.querySelector('.td5-metrics').after(host);
 const title=document.querySelector('.td5-heading h1');title.textContent='Project Library';const p=document.querySelector('.td5-heading p');p.textContent='Folders, collections, assets and inspector in one responsive workspace.';
 const panes=document.querySelector('.td7-demo-panes');panes.style.marginTop='20px';}
'''
reports=[]
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 for theme,sidebar,taskbar,w,h in [('dark','floating','floating',1440,900),('light','floating','floating',1440,900),('dark','docked','full-width',1120,850),('light','docked','full-width',1120,850),('dark','floating','floating',390,844),('light','floating','floating',390,844)]:
  page=b.new_page(viewport={'width':w,'height':h},device_scale_factor=1,is_mobile=w<500,has_touch=w<500)
  page.set_content(html,wait_until='domcontentloaded');page.evaluate(script)
  page.evaluate('''opts=>{const r=document.documentElement;Object.assign(r.dataset,{theme:opts[0],sidebarLayout:opts[1],taskbarLayout:opts[2],surfaceTexture:'fine',surfaceDepth:'soft',highContrast:'false'});}''',[theme,sidebar,taskbar]);page.wait_for_timeout(160)
  stats=page.evaluate('''()=>{const host=document.querySelector('.td8-rail'),rail=document.querySelector('.td8-tree'),main=host.querySelector('.cluster-resizable-main-v497'),b=host.getBoundingClientRect();return {documentWidth:document.documentElement.scrollWidth,viewport:innerWidth,hostWidth:b.width,railWidth:rail.getBoundingClientRect().width,mainWidth:main.getBoundingClientRect().width,railColumns:getComputedStyle(host).gridTemplateColumns,taskbar:getComputedStyle(document.querySelector('.taskbar-unified-v3430')).position}}''')
  assert stats['documentWidth']<=w+1,stats
  assert stats['mainWidth']>=280 if w>980 else stats['mainWidth']>=w*.65,stats
  assert stats['taskbar']=='sticky',stats
  # Simulate a nested narrow workspace even on a wide-screen desktop.
  if w > 980:
   stress=page.evaluate('''()=>{const el=document.querySelector('.td8-rail');el.style.width='520px';const main=el.querySelector('.cluster-resizable-main-v497');const rail=el.querySelector('.cluster-resizable-rail-content-v497');return {main:main.getBoundingClientRect().width,rail:rail.getBoundingClientRect().width,root:el.getBoundingClientRect().width}}''')
   assert stress['main']>=289 and stress['rail']<=223,(theme,w,stress)
   page.evaluate('''()=>{document.querySelector('.td8-rail').style.removeProperty('width')}''')
  name=f'Cluster-v0.546-TD3-Pass8-Library-{theme}-{sidebar}-{w}.png';page.screenshot(path=str(out/name),animations='disabled')
  print('PASS',name,stats,flush=True);reports.append({'name':name,'type':'static Chromium fixture','settings':[theme,sidebar,taskbar,w,h],'metrics':stats});page.close()
 b.close()
(root/'TD3_PASS8_VISUAL_METRICS.json').write_text(json.dumps({'fixtureOnly':True,'scenarios':reports},indent=2)+'\n')
print(f'{len(reports)}/{len(reports)} static scenarios passed')
