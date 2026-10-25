"""Illustrative static production-CSS preview, never a mounted React/Qt screenshot."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json,re
ROOT=Path(__file__).resolve().parents[2]; OUT=ROOT/'.td3-pass10-preview-output'; OUT.mkdir(exist_ok=True)
def flatten(file, seen=None):
 seen=seen or set();file=file.resolve()
 if file in seen:return ''
 seen.add(file)
 return re.sub(r'@import\s+["\']([^"\'\n]+)["\']\s*;',lambda m:flatten(file.parent/m.group(1),seen),file.read_text())
css='\n'.join(flatten(ROOT/p) for p in ('packages/renderer/src/styles.css','packages/renderer/src/features/shell/shell.css','packages/renderer/src/features/shell/shell-v2.css'))
html=(ROOT/'tools/fixtures/td3-pass7-workspace.html').read_text().replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+css.replace('</style>','')+'</style>')
html=html.replace('</head>','''<style>
.td10-overlay{position:fixed!important;z-index:1800;top:315px;left:min(780px,56vw);width:330px;visibility:visible!important;border-radius:14px!important;background:var(--td-panel)!important;padding:10px!important;color:var(--td-text)!important;box-shadow:0 18px 44px #0005!important;}
.td10-heading{display:flex;justify-content:space-between;margin:5px 9px 13px;font-weight:700;font-size:13px;color:var(--td-text)}
.td10-search{display:flex;align-items:center;gap:8px;width:100%;height:38px;border:1px solid var(--td-border);border-radius:8px;background:var(--td-panel-2);color:var(--td-text);padding:10px;font-size:12px;}
.td10-hint{color:var(--td-muted);font-size:10px;padding:8px 11px;line-height:1.6}
.td10-divider{border-top:1px solid var(--td-border);margin:7px 0}
.td10-foot{display:flex;justify-content:flex-end;margin-top:6px;padding:5px}
.td10-foot button{background:color-mix(in srgb,var(--td-accent) 18%,var(--td-panel-2));border:1px solid var(--td-border);border-radius:8px;color:var(--td-text);padding:7px 14px;font-size:11px}
.td10-info{margin:12px 0 20px;background:var(--td-panel);border:1px solid var(--td-border);border-radius:12px;padding:12px 14px;font-size:11px;color:var(--td-muted)}
.td10-scrim{position:fixed;inset:0;background:#0008;z-index:1000;}
.td5-sidebar.shell-sidebar-v3430.td10-drawer{position:fixed!important;top:0!important;left:0!important;width:min(316px,calc(100vw - 42px))!important;max-width:none!important;height:100dvh!important;display:flex!important;z-index:1002!important;transform:none!important;box-shadow:0 18px 48px #0007!important;}
.td10-drawer .td5-nav{overflow:auto}.td10-drawer .td5-brand{height:66px}
.td10-drawer .td5-nav-item{min-height:46px}
@media(max-width:600px){.td10-overlay{width:calc(100vw - 28px);top:auto;bottom:12px;left:14px;max-height:65vh;overflow:auto}.td10-overlay .cluster-select-option-v370{min-height:44px}}
</style></head>''')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 records=[]
 for theme,kind,w,h in [('dark','picker',1440,900),('light','multi',1440,900),('dark','drawer',390,844),('light','drawer',390,844)]:
  pg=browser.new_page(viewport={'width':w,'height':h},device_scale_factor=1,is_mobile=w<500,has_touch=w<500)
  pg.set_content(html,wait_until='domcontentloaded')
  pg.evaluate('''([theme,kind])=>{const root=document.documentElement;Object.assign(root.dataset,{theme,sidebarLayout:'floating',taskbarLayout:'floating',surfaceDepth:'soft',surfaceTexture:'fine',highContrast:'false'});const menu=document.querySelector('.td7-menu');menu?.remove();const desc=document.querySelector('.td5-heading p');if(desc)desc.textContent=kind==='drawer'?'Keyboard-safe navigation, focus return, and expandable sections.':'Search and select resources from a shared keyboard-friendly picker.';
   const workspace=document.querySelector('.td5-workspace');const info=document.createElement('div');info.className='td10-info';info.textContent=kind==='drawer'?'Navigation drawer uses Escape to close, restores its launcher focus, and has accessible group expansion states.': 'Shared picker: results preserve their highlighted identity during filtering, disabled entries are skipped, Enter selects, and Home/End keep normal caret behavior while typing.';workspace.querySelector('.td5-heading')?.after(info);
   if(kind==='drawer'){const scrim=document.createElement('div');scrim.className='td10-scrim';document.body.appendChild(scrim);const sidebar=document.querySelector('.td5-sidebar');sidebar.classList.add('td10-drawer');sidebar.setAttribute('role','dialog');sidebar.setAttribute('aria-modal','true');sidebar.setAttribute('aria-label','Cluster navigation');const brand=sidebar.querySelector('.td5-brand');const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Close navigation');close.style.cssText='margin-left:auto;color:var(--td-text);border:1px solid var(--td-border);border-radius:50%;width:30px;height:30px;background:var(--td-panel-2)';brand.append(close);}
   else{const floating=document.createElement('div');floating.className='cluster-floating-surface-v504 cluster-select-menu-v227 td10-overlay';floating.setAttribute('role','dialog');floating.setAttribute('aria-label',kind==='multi'?'Filter by team':'Select project');floating.setAttribute('data-cluster-floating','true');const rows=kind==='multi'?[['✓','Engineering','8 people','active'],['✓','Design','5 people','active'],['','QA','3 people','highlighted'],['','Inactive team','Unavailable','disabled']]:[['✓','Project Orion','Active workspace','active'],['','Artemis','Project lead','highlighted'],['','Atlas','On hold',''],['','Archived','Unavailable','disabled']];floating.innerHTML=`<div class="td10-heading"><span>${kind==='multi'?'Select teams':'Switch project'}</span><span style="color:var(--td-muted)">${kind==='multi'?'2 selected':'Esc to close'}</span></div><input class="td10-search" type="search" role="combobox" aria-controls="td10-results" aria-expanded="true" aria-label="Search options" value="${kind==='multi'?'':'ar'}"/><div id="td10-results" role="listbox" aria-label="Results" aria-multiselectable="${kind==='multi'}">${rows.map((r,i)=>`<div class="cluster-select-option-v370 ${r[3]}" role="option" aria-selected="${r[0]==='✓'}" ${r[3]==='disabled'?'aria-disabled="true"':''}><span>${r[1]}</span><em>${r[2]}</em><span>${r[0]}</span></div>`).join('')}</div><div class="td10-divider"></div><div class="td10-hint">↑ ↓ Navigate　·　Enter Select　·　Esc Close</div><div class="td10-foot"><button type="button">Done</button></div>`;document.body.appendChild(floating)}
  }''',[theme,kind])
  pg.wait_for_timeout(120)
  layout=pg.evaluate('''()=>({scrollWidth:document.documentElement.scrollWidth,width:innerWidth,taskbar:getComputedStyle(document.querySelector('.taskbar-unified-v3430')).position,dialogVisible:!!document.querySelector('.td10-drawer'),pickerVisible:!!document.querySelector('.td10-overlay')})''')
  assert layout['scrollWidth']<=w+1 and layout['taskbar']=='sticky',layout
  name=f'Cluster-TD3-Pass10-{theme}-{kind}-{w}.png';pg.screenshot(path=str(OUT/name),animations='disabled');records.append({'name':name,'scenario':kind,'theme':theme,'type':'static Chromium production CSS composition','layout':layout});print('PASS',name,layout,flush=True);pg.close()
 browser.close()
(OUT/'TD3_PASS10_PREVIEW_METRICS.json').write_text(json.dumps({'illustrativeStaticFixtures':True,'scenarios':records},indent=2)+'\n')
print(f'{len(records)}/{len(records)} preview scenarios passed')
