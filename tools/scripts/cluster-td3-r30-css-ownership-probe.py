#!/usr/bin/env python3
"""TD3 R30 computed-style evidence; unrelated workspace appearance is preserved."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
r=Path(__file__).resolve().parents[2]
root=r/'packages/renderer/src'
files={'production':'styles/design-system/production-ui.css','people':'features/people/people.css','admin':'features/admin/admin-workspace.css','select':'styles/components/cluster-select.css','base':'styles/layers/application-base.css','mobile':'features/application/styles/mobile-runtime-v495.css'}
css={n:(root/p).read_text() for n,p in files.items()}
scenarios=[]
fixtures={
 'people':'<div class="people-metrics-v244">'+''.join(f'<button><span>Metric {i}</span><strong>{i*100}</strong></button>' for i in range(5))+'</div>',
 'chat':'<div class="chat-dock open"><div class="chat-panel"></div></div>',
 'select':'<div class="cluster-select-menu-v227 cluster-floating-surface-v504"><button class="cluster-select-option-v370">Option</button></div>',
 'admin':'<main class="admin-workspace-v298"><nav class="admin-subnav-v204">'+''.join(f'<button>Section {i}</button>' for i in range(8))+'</nav></main>',
}
base=':root{--cluster-surface-1:#242424;--cluster-shadow-float:0 10px 20px #111;--panel:#242424;--line:#888;--border:#888;--space-1:4px;--space-2:8px;--cluster-border-strong:#aaa;--cluster-radius-control:9px;--cluster-control-height:40px;--cluster-font-size-sm:13px;--cluster-border:#888;--accent:#55afff;--text:#fff;--border-soft:#555}*{box-sizing:border-box}body{margin:0}'
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for kind,widths,orders in [
  ('people',[375,800,1200],[['people','production'],['production','people']]),
  ('chat',[360,700,1100],[['base','mobile','production'],['base','production','mobile']]),
  ('select',[375,1200],[['select','production'],['production','select']]),
  ('admin',[375,700],[['admin','production'],['production','admin']])]:
  for width in widths:
   for order in orders:
    page=browser.new_page(viewport={'width':width,'height':740})
    page.set_content('<style>'+base+'</style><style>'+'\n'.join(css[n] for n in order)+'</style>'+fixtures[kind])
    element=page.locator({'people':'.people-metrics-v244','chat':'.chat-dock','select':'.cluster-select-menu-v227','admin':'.admin-subnav-v204'}[kind])
    info=element.evaluate('''e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect(),p=e.parentElement;return {display:s.display,gridTemplateColumns:s.gridTemplateColumns,shadow:s.boxShadow,left:s.left,right:s.right,top:s.top,bottom:s.bottom,width:r.width,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,parentScrollWidth:p.scrollWidth,parentClientWidth:p.clientWidth,childWidths:[...e.children].map(c=>Math.round(c.getBoundingClientRect().width))}}''')
    if kind=='people':
     count=2 if width<761 else 3 if width<1101 else 5
     passed=(info['display']=='grid' and len(info['gridTemplateColumns'].split(' '))==count and info['scrollWidth'] <= info['clientWidth']+1)
    elif kind=='chat':
     passed=(width>980 or (info['left']=='6px' and info['right']=='6px' and info['bottom']=='6px' and info['top']=='6px'))
    elif kind=='select':passed=('rgb(17, 17, 17)' in info['shadow'] and info['childWidths']==[210])
    else:passed=info['parentScrollWidth'] <= info['parentClientWidth']+1 and info['scrollWidth']>=info['clientWidth']
    scenarios.append({'kind':kind,'width':width,'order':order,'pass':passed,'computed':info})
    page.close()
 browser.close()
out=r/'TD3_R30_CSS_OWNERSHIP_EVIDENCE.json'
out.write_text(json.dumps(scenarios,indent=2)+'\n')
print(json.dumps({'tested':len(scenarios),'passed':sum(s['pass'] for s in scenarios),'failed':[{'kind':s['kind'],'width':s['width'],'order':s['order']} for s in scenarios if not s['pass']]}))
if not all(s['pass'] for s in scenarios):raise SystemExit(1)
