"""Static contract fixture, not an app screenshot or Web/Qt runtime certification."""
from pathlib import Path
import json, re, os
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[2]
output=Path(os.environ.get('CLUSTER_VISUAL_OUTPUT_DIR', str(root/'.td3-visual-output')))
output.mkdir(parents=True,exist_ok=True)
def flatten(p):
    css=p.read_text()
    return re.sub(r'@import\s+"([^"\n]+)"\s*;',lambda m:flatten((p.parent/m.group(1)).resolve()),css)
css='\n'.join(flatten(root/path) for path in ('packages/renderer/src/styles.css','packages/renderer/src/features/shell/shell-v2.css','packages/renderer/src/styles/visual-system.css'))
html=(root/'tools/fixtures/td3-inspector-workspace-smoke.html').read_text().replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+css.replace('</style>','')+'</style>')
# Source fixture uses legacy self-closing link? Support both forms and enforce actual injection.
html=html.replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+css.replace('</style>','')+'</style>')
html=html.replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css">','<style>'+css.replace('</style>','')+'</style>')
assert '<link rel="stylesheet"' not in html, 'Production CSS not injected'
cases=[('dark-desktop','dark','outlined',1440,900,1,False),('light-desktop','light','outlined',1440,900,1,False),('dark-125','dark','outlined',1440,900,1.25,False),('light-150','light','outlined',1440,900,1.5,False),('dark-tablet','dark','outlined',820,1000,1,False),('dark-phone','dark','outlined',390,844,1,True),('light-phone','light','outlined',390,844,1,True),('dark-glass','dark','glass',1440,900,1,False),('dark-flat','dark','flat',1440,900,1,False),('dark-high-contrast','dark','outlined',1440,900,1,False)]
reports=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 for label,theme,surface,width,height,dpi,touch in cases:
  page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=dpi,has_touch=touch,is_mobile=touch)
  page.set_content(html,wait_until='domcontentloaded')
  page.evaluate('''([theme,surface,high])=>{let e=document.documentElement;e.dataset.theme=theme;e.dataset.surfaceStyle=surface;e.dataset.highContrast=high?'true':'false'}''',[theme,surface,label.endswith('high-contrast')])
  if width<=900:
   # The production React component uses createPortal(document.body) for mobile
   # detail. Mirror that ownership in the visual fixture, without pretending
   # the static fixture is a mounted React app.
   page.evaluate("""() => {
     const pane = document.querySelector('.td3-workspace-detail > .cluster-detail-pane-v429');
     const wrapper = document.createElement('div');
     wrapper.className='cluster-master-detail-v429 detail-open cluster-inspector-portal-v546';
     wrapper.appendChild(pane);document.body.appendChild(wrapper);
   }""")
  page.wait_for_timeout(80)
  values=page.evaluate('''()=>{
    const q=s=>document.querySelector(s), r=s=>q(s).getBoundingClientRect(), c=s=>getComputedStyle(q(s));
    const viewport=innerWidth, pane=r('.cluster-detail-pane-v429'), root=r('.td3-preview');
    return {viewport, bodyWidth:document.body.scrollWidth, previewWidth:root.width,
      detailPaneWidth:pane.width, detailPaneLeft:pane.left, detailPaneRight:pane.right,detailPaneTop:pane.top,
      inspectorDisplay:c('.cluster-detail-pane-v429').display,inspectorPosition:c('.cluster-detail-pane-v429').position,
      inspectorBackground:c('.cluster-detail-pane-v429').backgroundImage, inspectorShadow:c('.cluster-detail-pane-v429').boxShadow,
      cardBackground:c('.td3-metric').backgroundImage,cardShadow:c('.td3-metric').boxShadow,
      navVisible:c('.cluster-sidebar-shell').display!='none',detailDividerVisible:c('.cluster-detail-resizer-v429').display!='none',
      fileNameFont:parseFloat(c('.td3-file-name').fontSize), toolbarHeight:r('.cluster-taskbar').height,
      documentScrollWidth:document.documentElement.scrollWidth,
      inspectorBackgroundColor:c('.cluster-detail-pane-v429').backgroundColor,
    }
  }''')
  assert values['bodyWidth']<=width+1 and values['documentScrollWidth']<=width+1, f'{label}: horizontal overflow: {values}'
  assert values['detailPaneLeft']>=-1 and values['detailPaneRight']<=width+1, f'{label}: inspector clipped: {values}'
  assert values['detailPaneWidth']>=min(300,width-3),f'{label}: insufficient inspector width: {values}'
  assert values['fileNameFont']>=11,f'{label}: text too small: {values}'
  if width<=900:
   assert values['inspectorPosition']=='fixed' and not values['detailDividerVisible'] and values['detailPaneTop']<=90,f'{label}: inspector should portal at viewport top without resizer: {values}'
  else:
   assert values['inspectorPosition']=='relative' and values['detailDividerVisible'],f'{label}: docked inspector expected: {values}'
  if surface=='flat' or label.endswith('high-contrast'):
   assert values['cardBackground']=='none' and values['inspectorBackground']=='none',f'{label}: decorative texture not suppressed: {values}'
  else:
   assert 'gradient' in values['cardBackground'] and 'gradient' in values['inspectorBackground'],f'{label}: material missing: {values}'
  if label in ('dark-desktop','light-desktop','dark-phone','light-phone','dark-glass'):
   file=f'Cluster-v0.546-TD3-Pass4-Library-{label}.png'
   page.screenshot(path=str(output/file),full_page=False)
   values['screenshot']=file
  values.update({'case':label,'dpi':dpi,'fixtureOnly':True})
  reports.append(values)
  print('PASS',label,values,flush=True)
  page.close()
 browser.close()
(root/'TD3_PASS4_INSPECTOR_VISUAL_METRICS.json').write_text(json.dumps({'cases':reports,'sourceFixture':'tools/fixtures/td3-inspector-workspace-smoke.html','staticOnly':True,'note':'Visual fixture uses production renderer CSS and fixture content, not a running React/Qt app.'},indent=2)+'\n')
