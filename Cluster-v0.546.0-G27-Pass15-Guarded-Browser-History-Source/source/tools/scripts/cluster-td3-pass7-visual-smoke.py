"""TD3 Pass 7 material/structure previews. Static Chromium production-CSS fixtures, not running React or Qt."""
from pathlib import Path
import re, json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'.td3-pass7-preview-output'
OUT.mkdir(exist_ok=True)

def flatten(p, stack=None):
    stack=stack or set()
    p=p.resolve()
    if p in stack: return ''
    stack.add(p)
    css=p.read_text()
    return re.sub(r'@import\s+["\']([^"\'\n]+)["\']\s*;', lambda m:flatten(p.parent/m.group(1),stack),css)
css='\n'.join(flatten(ROOT/p) for p in ('packages/renderer/src/styles.css','packages/renderer/src/features/shell/shell.css','packages/renderer/src/features/shell/shell-v2.css','packages/renderer/src/features/settings/settings-workspace.css'))
configs=[
 ('Workspace-dark-floating', 'workspace','dark','floating','floating','large','defined','prominent',1440,900),
 ('Workspace-light-floating', 'workspace','light','floating','floating','large','defined','prominent',1440,900),
 ('Workspace-dark-integrated', 'workspace','dark','docked','full-width','standard','subtle','standard',1440,900),
 ('Workspace-light-integrated', 'workspace','light','docked','full-width','standard','subtle','standard',1440,900),
 ('Appearance-dark', 'appearance','dark','floating','floating','large','defined','prominent',1440,900),
 ('Appearance-light', 'appearance','light','floating','floating','large','defined','prominent',1440,900),
 ('Workspace-dark-phone', 'workspace','dark','floating','floating','large','defined','prominent',390,844),
 ('Workspace-light-phone', 'workspace','light','floating','floating','large','defined','prominent',390,844),
]
reports=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    for name,surface,theme,sidebar,taskbar,icons,borders,scrollbars,w,h in configs:
        html=(ROOT/f'tools/fixtures/td3-pass7-{surface}.html').read_text()
        html=html.replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+css.replace('</style>','')+'</style>')
        page=browser.new_page(viewport={'width':w,'height':h},device_scale_factor=1,is_mobile=w<500,has_touch=w<500)
        page.set_content(html,wait_until='domcontentloaded')
        page.evaluate('''(opts)=>{const r=document.documentElement;Object.assign(r.dataset,{theme:opts[0],sidebarLayout:opts[1],taskbarLayout:opts[2],iconSize:opts[3],panelBorders:opts[4],scrollbarStyle:opts[5],surfaceTexture:'fine',surfaceDepth:'soft',highContrast:'false',surfaceStyle:'outlined'});r.style.setProperty('--cluster-icon-scale',opts[3]==='large'?'1.1':opts[3]==='small'?'0.9':'1');r.style.setProperty('--cluster-panel-border-opacity',opts[4]==='defined'?'1':opts[4]==='minimal'?'.42':'.72')}''',[theme,sidebar,taskbar,icons,borders,scrollbars])
        page.wait_for_timeout(150)
        data=page.evaluate('''()=>{const tb=document.querySelector('.taskbar-unified-v3430');const main=document.querySelector('.content-shell');const sidebar=document.querySelector('.td5-sidebar');const icon=document.querySelector('.td7-nav-icon .cluster-icon-svg');const t=tb.getBoundingClientRect();return {windowWidth:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,mainWidth:main.clientWidth,mainScrollWidth:main.scrollWidth,taskbarTop:t.top,taskbarLeft:t.left,taskbarPosition:getComputedStyle(tb).position,sidebarDisplay:getComputedStyle(sidebar).display,iconScale:icon?getComputedStyle(icon).scale:null,sidebarBorder:getComputedStyle(sidebar).borderRightColor,scrollbarWidth:getComputedStyle(main).scrollbarWidth,canvasBackground:getComputedStyle(document.body).backgroundColor}}''')
        assert data['documentWidth']<=w+1 and data['bodyWidth']<=w+1 and data['mainScrollWidth']<=data['mainWidth']+1,(name,data)
        assert data['taskbarPosition']=='sticky',(name,data)
        if w>=900:
            assert data['sidebarDisplay']!='none',(name,data)
            if icons=='large': assert data['iconScale']=='1.1',(name,data)
        else: assert data['sidebarDisplay']=='none',(name,data)
        path=OUT/f'Cluster-v0.546-TD3-Pass7-{name}.png'
        page.screenshot(path=str(path),animations='disabled')
        if w>=900:
            page.locator('.content-shell').evaluate('(el)=>{el.scrollTop=350}')
            after=page.locator('.taskbar-unified-v3430').evaluate('(el)=>el.getBoundingClientRect().top')
            assert abs(after-data['taskbarTop'])<3,(name,data,after)
        print('PASS',name,{'top':round(data['taskbarTop'],2),'iconScale':data['iconScale'],'scrollbar':data['scrollbarWidth']},flush=True)
        reports.append({'name':name,'fixtureOnly':True,'metrics':data})
        page.close()
    # Verify appearance state transitions via actual CSS computation.
    page=browser.new_page(viewport={'width':1440,'height':900})
    html=(ROOT/'tools/fixtures/td3-pass7-workspace.html').read_text().replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+css.replace('</style>','')+'</style>')
    page.set_content(html)
    result=page.evaluate('''()=>{const r=document.documentElement,ic=document.querySelector('.td7-nav-icon .cluster-icon-svg'),task=document.querySelector('.taskbar-unified-v3430');r.dataset.iconSize='small';r.style.setProperty('--cluster-icon-scale','.9');const small=getComputedStyle(ic).scale;r.dataset.iconSize='large';r.style.setProperty('--cluster-icon-scale','1.1');const large=getComputedStyle(ic).scale;r.dataset.panelBorders='minimal';r.style.setProperty('--cluster-panel-border-opacity','.42');const minimal=getComputedStyle(task).borderTopColor;r.dataset.panelBorders='defined';r.style.setProperty('--cluster-panel-border-opacity','1');const defined=getComputedStyle(task).borderTopColor;return {small,large,minimal,defined}}''')
    assert result['small']=='0.9' and result['large']=='1.1',result
    assert result['minimal']!=result['defined'],result
    print('PASS visual context toggling',result)
    reports.append({'name':'Computed style preference transitions','metrics':result})
    page.close()
    browser.close()
(OUT/'TD3_PASS7_VISUAL_METRICS.json').write_text(json.dumps({'staticFixturesOnly':True,'cases':reports},indent=2)+'\n')
print(f'{len(configs)}/{len(configs)} static Chromium preview scenarios passed')
