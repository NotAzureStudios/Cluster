from pathlib import Path
import re, json, os
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[2]
output=Path(os.environ.get('CLUSTER_VISUAL_OUTPUT_DIR',str(root/'.td3-visual-output')))
output.mkdir(parents=True,exist_ok=True)
def flatten(p):
    css=p.read_text()
    return re.sub(r'@import\s+"([^"\n]+)"\s*;',lambda m:flatten((p.parent/m.group(1)).resolve()),css)
css='\n'.join(flatten(root/path) for path in ('packages/renderer/src/styles.css','packages/renderer/src/features/shell/shell-v2.css','packages/renderer/src/styles/visual-system.css'))
html=(root/'tools/fixtures/td3-shell-material-smoke.html').read_text().replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+css.replace('</style>','')+'</style>')
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 cases=[('dark-desktop','dark','outlined',1440,900,False,False),('light-desktop','light','outlined',1440,900,False,False),('dark-touch','dark','outlined',390,844,True,False),('light-touch','light','outlined',390,844,True,False),('flat','dark','flat',1440,900,False,False),('high-contrast','dark','outlined',1440,900,False,True),('glass','dark','glass',1440,900,False,False)]
 for label,theme,surface,width,height,touch,high in cases:
    page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1,has_touch=touch,is_mobile=touch)
    page.set_content(html,wait_until='domcontentloaded')
    page.evaluate("""([theme,surface,high])=>{const html=document.documentElement;html.dataset.theme=theme;html.dataset.surfaceStyle=surface;html.dataset.highContrast=high?'true':'false';}""",[theme,surface,high]); page.wait_for_timeout(75)
    data=page.evaluate("""()=>{let c=(s)=>getComputedStyle(document.querySelector(s)),r=(s)=>document.querySelector(s).getBoundingClientRect();return {scrollWidth:document.body.scrollWidth,viewport:innerWidth,sidebarLabelPx:parseFloat(c('.cluster-sidebar-nav-item__label').fontSize),projectMetaPx:parseFloat(c('.cluster-sidebar-project__copy small').fontSize),sidebarTarget:r('.cluster-sidebar-nav-item').height,taskbarTarget:r('.cluster-taskbar-action').height,projectPinWidth:r('.cluster-sidebar-project__pin').width,material:c('.fixture-content .panel').backgroundImage,shadow:c('.fixture-content .panel').boxShadow,backdrop:c('.cluster-taskbar').backdropFilter}}""")
    assert data['scrollWidth']<=width,f'{label}: overflow {data}'
    assert data['sidebarLabelPx']>=13 and data['projectMetaPx']>=12,f'{label}: unreadable nav {data}'
    if touch:assert min(data['sidebarTarget'],data['taskbarTarget'],data['projectPinWidth'])>=44,f'{label}: small touch target {data}'
    if surface!='flat' and not high:assert 'gradient' in data['material'] and data['shadow']!='none',f'{label}: missing depth {data}'
    if surface=='flat' or high:assert data['material']=='none' or high and data['material']=='none',f'{label}: texture should not draw {data}'
    if label in ('dark-desktop','light-desktop','dark-touch','light-touch'):
      screenshot=f'Cluster-v0.546-TD3-Pass3-Shell-{label}.png';page.screenshot(path=str(output/screenshot),full_page=False);data['screenshot']=screenshot
    data.update({'case':label,'staticFixtureOnly':True})
    results.append(data)
    print('PASS',label,data,flush=True)
    page.close()
 browser.close()
(root/'TD3_PASS3_SHELL_VISUAL_METRICS.json').write_text(json.dumps({'fixtureOnly':True,'cases':results,'runtimeCertification':False},indent=2)+'\n')
