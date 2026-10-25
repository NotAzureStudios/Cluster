"""Production CSS + faithful structural fixture. Not an authenticated React screenshot."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import os,re,json
from PIL import Image,ImageOps,ImageDraw,ImageFont
root=Path(__file__).resolve().parents[2]
out=Path(os.environ.get('CLUSTER_VISUAL_OUTPUT_DIR',str(root/'.td3-pass12-preview-output')));out.mkdir(parents=True,exist_ok=True)
def flatten(p):
 s=p.read_text();return re.sub(r'@import\s+["\']([^"\'\n]+)["\']\s*;',lambda m:flatten((p.parent/m.group(1)).resolve()),s)
css='\n'.join(flatten(root/p) for p in ('packages/renderer/src/styles.css','packages/renderer/src/features/shell/shell.css','packages/renderer/src/features/shell/shell-v2.css','packages/renderer/src/features/search/search.css'))
html=(root/'tools/fixtures/td3-pass12-project-search.html').read_text().replace('<link href="../../packages/renderer/src/styles.css" rel="stylesheet"/>','<style>'+css.replace('</style>','')+'</style>')
assert 'cluster-taskbar-search-switch-v546' in html
cases=[('dark','floating',1440,900),('dark','full-width',1440,900),('light','floating',1440,900),('light','full-width',1440,900),('dark','floating',390,844),('light','full-width',390,844)]
reports=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 for theme,layout,width,height in cases:
  page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1,has_touch=width<500,is_mobile=width<500)
  page.set_content(html,wait_until='domcontentloaded')
  page.evaluate('''([theme,layout])=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.taskbarLayout=layout;}''',[theme,layout])
  page.wait_for_timeout(250)
  measure='''()=>{const tab=document.querySelector('.cluster-taskbar-search-switch-v546');const stage=tab.querySelector('.cluster-taskbar-search-switch__projects');const input=tab.querySelector('.cluster-taskbar-search-switch__input');const bar=document.querySelector('.taskbar-unified-v3430');const field=document.querySelector('.cluster-taskbar-search-field-v546');const results=document.querySelector('.td12-result-panel');const utilities=document.querySelector('.cluster-taskbar__utilities');const ur=utilities.getBoundingClientRect(),r=bar.getBoundingClientRect();return {state:tab.dataset.searchOpen,tabOpacity:getComputedStyle(stage).opacity,fieldOpacity:getComputedStyle(input).opacity,fieldVisible:getComputedStyle(input).visibility,fieldBackground:getComputedStyle(field).backgroundColor,utilitiesLeft:ur.left,utilitiesRight:ur.right,bodyWidth:document.body.scrollWidth,scrollWidth:document.documentElement.scrollWidth,barRight:r.right,barLeft:r.left,barTop:r.top,panelVisible:getComputedStyle(results).display,panelTop:results.getBoundingClientRect().top,fieldBottom:field.getBoundingClientRect().bottom,projectsInert:stage.inert,slotInert:input.inert}}'''
  closed=page.evaluate(measure)
  assert closed['state']=='false' and closed['slotInert'] and not closed['projectsInert'],(theme,layout,closed)
  assert closed['scrollWidth']<=width+1,(theme,layout,closed)
  name=f'Cluster-TD3-Pass12-{theme}-{layout}-{width}'
  if width>=768: page.screenshot(path=str(out/(name+'-tabs.png')))
  page.evaluate('td12Open(true)')
  page.wait_for_timeout(340)
  opened=page.evaluate(measure)
  assert opened['state']=='true' and opened['projectsInert'] and not opened['slotInert'],(theme,layout,opened)
  assert opened['fieldVisible']=='visible' and float(opened['fieldOpacity'])>0.98,(theme,layout,opened)
  assert opened['panelVisible']!='none' and opened['panelTop']>=opened['fieldBottom']-2,(theme,layout,opened)
  assert opened['scrollWidth']<=width+1,(theme,layout,opened)
  assert abs(opened['utilitiesRight']-closed['utilitiesRight'])<=2,(theme,layout,opened,closed)
  page.screenshot(path=str(out/(name+'-search.png')))
  page.evaluate('td12Open(false)')
  page.wait_for_timeout(340)
  restored=page.evaluate(measure)
  assert restored['state']=='false' and restored['projectsInert']==False and restored['slotInert'],(theme,layout,restored)
  assert abs(closed['utilitiesRight']-restored['utilitiesRight'])<=2,(theme,layout,restored,closed)
  reports.append({'theme':theme,'layout':layout,'width':width,'closed':closed,'open':opened,'restored':restored})
  print('PASS',theme,layout,width,'open/close animation, panel position, identity, utilities stable, no overflow',flush=True)
  page.close()
 browser.close()
(out/'TD3_PASS12_VISUAL_METRICS.json').write_text(json.dumps({'fixtureOnly':True,'cases':reports},indent=2))
# Comparison board: 2 themes, project tabs vs search results, plus mobile.
thumbs=[]
for theme in ['dark','light']:
 for state in ['tabs','search']:
  fp=out/f'Cluster-TD3-Pass12-{theme}-floating-1440-{state}.png'
  im=Image.open(fp).convert('RGB');im.thumbnail((720,450))
  thumbs.append((f'{theme.title()} · {"Project tabs" if state=="tabs" else "Search expanded"}',im.copy()))
board=Image.new('RGB',(1480,1010),(23,27,34))
draw=ImageDraw.Draw(board)
try: font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17)
except:font=ImageFont.load_default()
for i,(caption,im) in enumerate(thumbs):
 x=16+(i%2)*740;y=18+(i//2)*495
 draw.text((x+4,y),caption,font=font,fill=(227,234,242))
 board.paste(im,(x,y+29))
board.save(out/'Cluster-TD3-Pass12-Taskbar-Search-Comparison.png')
