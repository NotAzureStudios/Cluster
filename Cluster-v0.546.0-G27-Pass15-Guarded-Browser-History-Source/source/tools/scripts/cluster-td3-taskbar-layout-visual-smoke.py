"""Static source-backed Chromium fixture, not a mounted Cluster/Qt screenshot."""
from pathlib import Path
import os,re,json
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[2]
output=Path(os.environ.get('CLUSTER_VISUAL_OUTPUT_DIR',str(root/'.td3-visual-output')));output.mkdir(parents=True,exist_ok=True)
def flatten(p):
 s=p.read_text();return re.sub(r'@import\s+["\']([^"\'\n]+)["\']\s*;',lambda m:flatten((p.parent/m.group(1)).resolve()),s)
css='\n'.join(flatten(root/p) for p in ('packages/renderer/src/styles.css','packages/renderer/src/features/shell/shell.css','packages/renderer/src/features/shell/shell-v2.css','packages/renderer/src/styles/visual-system.css'))
html=(root/'tools/fixtures/td3-taskbar-layout-smoke.html').read_text().replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+css.replace('</style>','')+'</style>')
assert '<link rel="stylesheet"' not in html
cases=[('dark','floating',1440,900,False),('dark','full-width',1440,900,False),('light','floating',1440,900,False),('light','full-width',1440,900,False),('dark','floating',390,844,True),('dark','full-width',390,844,True),('light','floating',390,844,True),('light','full-width',390,844,True)]
reports=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 for theme,layout,width,height,mobile in cases:
  page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1,has_touch=mobile,is_mobile=mobile)
  page.set_content(html,wait_until='domcontentloaded')
  page.evaluate('''([theme,layout])=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.taskbarLayout=layout;}''',[theme,layout])
  page.wait_for_timeout(120)
  before=page.evaluate('''()=>{const m=document.querySelector('.content-shell'), t=document.querySelector('.taskbar-unified-v3430');const c=m.getBoundingClientRect(),r=t.getBoundingClientRect(),cs=getComputedStyle(t);return {viewport:innerWidth,bodyWidth:document.body.scrollWidth,htmlWidth:document.documentElement.scrollWidth,scrollWidth:m.scrollWidth,clientWidth:m.clientWidth,scrollHeight:m.scrollHeight,clientHeight:m.clientHeight,left:r.left,right:r.right,top:r.top,width:r.width,position:cs.position,radius:parseFloat(cs.borderTopLeftRadius),shadow:cs.boxShadow,marginTop:cs.marginTop,containerLeft:c.left,containerRight:c.right,paddingLeft:parseFloat(getComputedStyle(m).paddingLeft)}}''')
  assert before['position']=='sticky',(theme,layout,before)
  assert before['bodyWidth']<=width+1 and before['htmlWidth']<=width+1 and before['scrollWidth']<=before['clientWidth']+1,(theme,layout,before)
  assert before['scrollHeight']>before['clientHeight']+100,(theme,layout,before)
  assert before['right']<=width+1 and before['left']>=-1,(theme,layout,before)
  if layout=='full-width':
   assert before['radius']==0 and abs(before['left']-before['containerLeft'])<=1 and before['right']>=before['containerRight']-18,(theme,layout,before)
  else:
   assert before['radius']>=9 and before['left']>before['containerLeft']+4 and before['right']<before['containerRight']-4,(theme,layout,before)
  shot=f'Cluster-v0.546-TD3-Pass5-Taskbar-{theme}-{layout}-'+('phone' if mobile else 'desktop')+'.png'
  page.screenshot(path=str(output/shot),full_page=False)
  page.locator('.content-shell').evaluate('(el)=>{el.scrollTop=450;}')
  page.wait_for_timeout(50)
  after=page.locator('.taskbar-unified-v3430').evaluate('(el)=>({top:el.getBoundingClientRect().top,position:getComputedStyle(el).position})')
  assert abs(after['top']-before['top'])<=1,(theme,layout,before,after)
  print('PASS',shot,{**before,'scrollTopAfter':after['top']},flush=True)
  reports.append({'theme':theme,'layout':layout,'width':width,'height':height,'phone':mobile,'screenshot':shot,'before':before,'after':after})
  page.close()
 browser.close()
(root/'TD3_PASS5_TASKBAR_LAYOUT_VISUAL_METRICS.json').write_text(json.dumps({'fixtureOnly':True,'note':'Static DOM fixture using production CSS, not a mounted React or Qt application.','cases':reports},indent=2)+'\n')
