"""Production-CSS static preview, representative Library + modal/menu DOM, not a running app."""
from pathlib import Path
import re,json
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[2]
out=root/'.td3-pass9-preview-output';out.mkdir(exist_ok=True)
def flatten(p,seen=None):
 seen=seen or set();p=p.resolve()
 if p in seen:return ''
 seen.add(p)
 return re.sub(r'@import\s+["\']([^"\'\n]+)["\']\s*;',lambda m:flatten(p.parent/m.group(1),seen),p.read_text())
css='\n'.join(flatten(root/p) for p in ('packages/renderer/src/styles.css','packages/renderer/src/features/shell/shell.css','packages/renderer/src/features/shell/shell-v2.css'))
html=(root/'tools/fixtures/td3-pass7-workspace.html').read_text().replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+css.replace('</style>','')+'</style>')
styles='''<style>
.td9-backdrop{background:rgba(6,10,19,.58)!important;backdrop-filter:blur(7px);padding:16px!important;}
.td9-dialog{width:min(540px,calc(100vw - 25px))!important;max-width:calc(100vw - 25px)!important;padding:0!important;margin:10vh auto 0!important;background:var(--td-panel)!important;border:1px solid var(--td-border)!important;border-radius:18px!important;box-shadow:0 22px 72px #050a1959!important;color:var(--td-text)!important;overflow:visible!important;}
.td9-dialog>header{display:flex;align-items:center;gap:14px;padding:22px 24px!important;border-bottom:1px solid var(--td-border)!important}
.td9-dialog h2{font-size:20px!important;margin:0 0 4px!important;color:var(--td-text)!important;letter-spacing:-.025em}
.td9-dialog p{font-size:12px;color:var(--td-muted);margin:0;line-height:1.55}
.td9-badge{width:38px;height:38px;border:1px solid var(--td-border);border-radius:12px;display:grid;place-items:center;font-size:18px;background:var(--td-panel-2);color:var(--td-accent)}
.td9-body{display:grid;gap:14px;padding:22px 24px 27px}.td9-body label{display:grid;gap:7px;font-size:11px;font-weight:700;color:var(--td-muted)}
.td9-field{min-height:42px;display:flex;align-items:center;justify-content:space-between;padding:11px 12px;border:1px solid var(--td-border);background:var(--td-panel-2);border-radius:10px;color:var(--td-text);font-size:12px}
.td9-field.accent{border-color:color-mix(in srgb,var(--td-accent) 60%,var(--td-border));box-shadow:0 0 0 3px color-mix(in srgb,var(--td-accent) 14%,transparent)}
.td9-steps{display:flex;gap:7px;flex-wrap:wrap}.td9-steps span{padding:7px 9px;border-radius:7px;font-size:10px;color:var(--td-muted);background:var(--td-panel-2);border:1px solid var(--td-border)}
.td9-dialog footer{display:flex;justify-content:flex-end;gap:9px;padding:15px 24px!important;border-top:1px solid var(--td-border);background:var(--td-panel-2)}.td9-dialog footer button{padding:10px 16px;border:1px solid var(--td-border);border-radius:9px;background:var(--td-panel);color:var(--td-text);font-weight:700;font-size:11px}
.td9-dialog footer button.primary{background:color-mix(in srgb,var(--td-accent) 25%,var(--td-panel));border-color:var(--td-accent)}
.td9-popover{width:248px!important;min-width:0!important;padding:7px!important;background:var(--td-panel)!important;border-color:var(--td-border)!important;color:var(--td-text)!important;box-shadow:0 16px 32px #0006!important;border-radius:12px!important;}
.td9-popover small{display:block;padding:10px 10px 5px;color:var(--td-muted);font-size:9px;letter-spacing:.09em;font-weight:800}
.td9-popover button{display:block;width:100%;padding:11px 12px;text-align:left;border:0;border-radius:8px;background:transparent;color:var(--td-text);font-size:12px}
.td9-popover button.active{background:color-mix(in srgb,var(--td-accent) 17%,var(--td-panel));color:var(--td-text)}
.td9-popover button b{font-weight:600}.td9-popover button span{display:block;font-size:10px;color:var(--td-muted);margin-top:3px}
.td9-caption{position:fixed;bottom:14px;left:14px;z-index:1850;background:var(--td-panel);padding:9px 13px;border:1px solid var(--td-border);color:var(--td-muted);border-radius:10px;font-size:10px;max-width:calc(100vw - 28px)}
@media(max-width:700px){.td9-dialog{margin:9vh auto 0!important}.td9-dialog>header{padding:16px!important}.td9-body{padding:18px 16px}.td9-dialog footer{padding:13px!important}.td9-popover{width:calc(100vw - 24px)!important;max-width:calc(100vw - 24px)!important}.td9-caption{font-size:9px}}
</style>'''
html=html.replace('</head>',styles+'</head>')
scenes=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 for theme,sidebar,taskbar,w,h in [('dark','floating','floating',1440,900),('light','floating','floating',1440,900),('dark','docked','full-width',1120,820),('light','docked','full-width',1120,820),('dark','floating','floating',390,844),('light','floating','floating',390,844)]:
  page=browser.new_page(viewport={'width':w,'height':h},device_scale_factor=1,is_mobile=w<=500,has_touch=w<=500)
  page.set_content(html)
  page.evaluate('''([theme,sidebar,taskbar,w])=>{
   const r=document.documentElement;Object.assign(r.dataset,{theme,sidebarLayout:sidebar,taskbarLayout:taskbar,surfaceTexture:'fine',surfaceDepth:'soft',highContrast:'false'});
   document.querySelector('.td7-menu')?.remove();
   const backdrop=document.createElement('div');backdrop.className='modal-backdrop td9-backdrop';backdrop.innerHTML=`<section role="dialog" aria-modal="true" aria-labelledby="td9-title" id="td9-dialog" class="cluster-dialog-v389 modal panel td9-dialog"><header><div class="td9-badge">▦</div><div><h2 id="td9-title">Organize project files</h2><p>Edit Library metadata and relationships</p></div></header><div class="td9-body"><div class="td9-steps"><span>▣  Project Orion</span><span>◇  Production</span><span>24 assets</span></div><label>Folder name <div class="td9-field">Environment</div></label><label>Move to <div class="td9-field accent" id="td9-anchor">Project Orion / Production <strong>⌄</strong></div></label><label>Access level <div class="td9-field">Project members <strong>⌄</strong></div></label><p>Changes remain inside the active project Library. External distribution permissions are separate.</p></div><footer><button>Cancel</button><button class="primary">Save changes</button></footer></section>`;document.body.appendChild(backdrop);
   const pop=document.createElement('div');pop.className='cluster-floating-surface-v504 td9-popover';pop.setAttribute('data-cluster-floating','true');pop.setAttribute('data-cluster-modal-owner','td9-dialog');pop.setAttribute('role','listbox');pop.setAttribute('aria-label','Move to folder');pop.innerHTML='<small>SELECT DESTINATION</small><button class="active"><b>▱ &nbsp; Production</b><span>Current parent folder</span></button><button><b>▱ &nbsp; Deliverables</b><span>Approved project outputs</span></button><button><b>▱ &nbsp; Concept Art</b><span>Artwork and references</span></button><button><b>▱ &nbsp; Review Queue</b><span>Pending review and approval</span></button>';document.body.appendChild(pop);
   const anchor=document.getElementById('td9-anchor').getBoundingClientRect();pop.style.left=w<=500?'12px':Math.round(anchor.left)+'px';pop.style.top=Math.round(anchor.bottom+6)+'px';
   const cap=document.createElement('div');cap.className='td9-caption';cap.innerText=`TD3 Pass 9 · ${theme} · ${sidebar} sidebar · ${taskbar} taskbar · illustrative browser fixture`;document.body.appendChild(cap);
  }''',[theme,sidebar,taskbar,w]);page.wait_for_timeout(140)
  metrics=page.evaluate('''()=>{const modal=document.querySelector('.modal-backdrop'),menu=document.querySelector('.td9-popover');const rect=menu.getBoundingClientRect();return {viewport:innerWidth,scroll:document.documentElement.scrollWidth,modalLayer:getComputedStyle(modal).zIndex,menuLayer:getComputedStyle(menu).zIndex,menuBottom:rect.bottom,viewHeight:innerHeight,taskbar:getComputedStyle(document.querySelector('.taskbar-unified-v3430')).position,menuVisible:rect.width>0&&rect.height>0}}''')
  assert metrics['scroll']<=w+1,metrics
  assert int(metrics['menuLayer'])>int(metrics['modalLayer']),metrics
  assert metrics['menuVisible'] and metrics['menuBottom']<=h+1,metrics
  assert metrics['taskbar']=='sticky',metrics
  name=f'Cluster-TD3-Pass9-Overlay-{theme}-{sidebar}-{w}.png';page.screenshot(path=str(out/name),animations='disabled')
  scenes.append({'file':name,'theme':theme,'sidebar':sidebar,'taskbar':taskbar,'width':w,'metrics':metrics})
  print('PASS',name,metrics,flush=True);page.close()
 browser.close()
(root/'TD3_PASS9_PREVIEW_METRICS.json').write_text(json.dumps({'fixtureOnly':True,'scenarios':scenes},indent=2)+'\n')
print(f'{len(scenes)}/{len(scenes)} production CSS static preview scenarios passed')
