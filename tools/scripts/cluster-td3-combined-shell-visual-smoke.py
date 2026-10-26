"""Static Chromium fixtures using production CSS, not a running Cluster or native Qt build."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import os,re,json
root=Path(__file__).resolve().parents[2]
out=Path(os.environ.get('CLUSTER_VISUAL_OUTPUT_DIR',str(root/'.td3-visual-output')))
out.mkdir(parents=True,exist_ok=True)
def flatten(p):
 s=p.read_text()
 return re.sub(r'@import\s+["\']([^"\'\n]+)["\']\s*;',lambda m:flatten((p.parent/m.group(1)).resolve()),s)
css='\n'.join(flatten(root/p) for p in ('packages/renderer/src/styles.css','packages/renderer/src/features/shell/shell.css','packages/renderer/src/features/shell/shell-v2.css','packages/renderer/src/styles/visual-system.css'))
html=(root/'tools/fixtures/td3-combined-shell-smoke.html').read_text().replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+css.replace('</style>','')+'</style>')
cases=[(theme,shell,taskbar,1440,900) for theme in ('dark','light') for shell,taskbar in (('docked','floating'),('floating','floating'),('floating','full-width'),('docked','full-width'))]
cases += [(theme,'floating','floating',390,844) for theme in ('dark','light')]
reports=[]
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 for theme,sidebar,taskbar,w,h in cases:
  page=b.new_page(viewport={'width':w,'height':h},device_scale_factor=1,is_mobile=w<500,has_touch=w<500)
  page.set_content(html,wait_until='domcontentloaded')
  page.evaluate('''([theme,sidebar,taskbar])=>{const r=document.documentElement;r.dataset.theme=theme;r.dataset.sidebarLayout=sidebar;r.dataset.taskbarLayout=taskbar;r.dataset.surfaceDepth='soft';r.dataset.surfaceTexture='fine';}''',[theme,sidebar,taskbar])
  page.wait_for_timeout(120)
  data=page.evaluate('''()=>{const sb=document.querySelector('.td5-sidebar'),tb=document.querySelector('.taskbar-unified-v3430'),main=document.querySelector('.content-shell'),s=sb.getBoundingClientRect(),t=tb.getBoundingClientRect();return {viewport:innerWidth,htmlWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,mainWidth:main.clientWidth,mainScrollWidth:main.scrollWidth,sidebarLeft:s.left,sidebarTop:s.top,sidebarWidth:s.width,sidebarMargin:getComputedStyle(sb).marginLeft,sidebarRadius:getComputedStyle(sb).borderTopLeftRadius,sidebarHeight:s.height,sidebarDisplay:getComputedStyle(sb).display,taskbarPosition:getComputedStyle(tb).position,taskbarTop:t.top,taskbarLeft:t.left,taskbarRadius:getComputedStyle(tb).borderTopLeftRadius,scrollHeight:main.scrollHeight,clientHeight:main.clientHeight}}''')
  assert data['htmlWidth']<=w+1 and data['bodyWidth']<=w+1 and data['mainScrollWidth']<=data['mainWidth']+1,(theme,sidebar,taskbar,data)
  assert data['taskbarPosition']=='sticky',(theme,sidebar,taskbar,data)
  if w>=900:
   assert data['sidebarDisplay']!='none'
   if sidebar=='floating':
    assert data['sidebarLeft']>=10 and data['sidebarTop']>=10 and float(data['sidebarRadius'].replace('px',''))>=10,(theme,sidebar,taskbar,data)
   else:
    assert data['sidebarLeft']<=1 and data['sidebarTop']<=1,(theme,sidebar,taskbar,data)
  else:
   assert data['sidebarDisplay']=='none',(theme,sidebar,taskbar,data)
  # Check effective material toggles on the shared chrome without rebuilding it.
  material=page.evaluate('''()=>{const r=document.documentElement,t=document.querySelector('.taskbar-unified-v3430');
    const sample=()=>({image:getComputedStyle(t).backgroundImage,shadow:getComputedStyle(t).boxShadow});
    const normal=sample();r.dataset.surfaceTexture='brushed';r.dataset.surfaceDepth='elevated';const raised=sample();
    r.dataset.highContrast='true';const safe=sample();
    r.dataset.highContrast='false';r.dataset.surfaceTexture='fine';r.dataset.surfaceDepth='soft';return {normal,raised,safe};}''')
  assert material['normal']['image'] != 'none',(theme,sidebar,taskbar,material)
  assert 'repeating-linear-gradient' in material['raised']['image'],(theme,sidebar,taskbar,material)
  assert material['safe']['image']=='none',(theme,sidebar,taskbar,material)
  filename=f'Cluster-v0.546-TD3-Pass6-{theme}-{sidebar}-sidebar-{taskbar}-taskbar-'+('phone' if w<500 else 'desktop')+'.png'
  page.screenshot(path=str(out/filename))
  page.locator('.content-shell').evaluate('(el)=>{el.scrollTop=400}')
  page.wait_for_timeout(100)
  after=page.locator('.taskbar-unified-v3430').evaluate('(el)=>el.getBoundingClientRect().top')
  assert abs(after-data['taskbarTop'])<=2,(theme,sidebar,taskbar,data,after)
  print('PASS',filename,{'sidebarLeft':data['sidebarLeft'],'sidebarTop':data['sidebarTop'],'taskbarTop':data['taskbarTop']},flush=True)
  reports.append({'name':filename,'theme':theme,'sidebar':sidebar,'taskbar':taskbar,'size':[w,h],'metrics':data})
  page.close()
 b.close()
(root/'TD3_PASS6_COMBINED_SHELL_VISUAL_METRICS.json').write_text(json.dumps({'fixtureOnly':True,'cases':reports},indent=2)+'\n')
