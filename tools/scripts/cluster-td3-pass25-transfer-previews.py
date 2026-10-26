"""TD3 Pass25 representative Cluster source-CSS interaction fixture, NOT mounted React."""
from pathlib import Path
import re, json
from playwright.sync_api import sync_playwright
from PIL import Image,ImageDraw,ImageFont
root=Path(__file__).resolve().parents[2]
out=root/'.td3-pass25-previews';out.mkdir(exist_ok=True)
seen=set()
def css(file):
 file=file.resolve()
 if file in seen:return ''
 seen.add(file)
 text=file.read_text()
 return re.sub(r'@import\s+["\']([^"\'\n]+)["\']\s*;',lambda m:css(file.parent/m.group(1)),text)
html=(root/'tools/fixtures/td3-pass7-workspace.html').read_text().replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+css(root/'packages/renderer/src/styles.css').replace('</style','')+'</style>')
local_css='''
.td5-demo.app-shell.shell-unified-v3430{display:grid!important;grid-template-columns:236px minmax(0,1fr)!important;min-height:100dvh!important}
.td5-demo .content-shell{height:100dvh!important;width:auto!important;overflow-y:auto!important}
.td5-demo .taskbar-unified-v3430{display:grid!important;grid-template-columns:auto minmax(0,1fr) auto!important;min-height:60px!important;align-items:center!important}
.td5-demo .td5-workspace{max-width:1490px!important;padding:25px 29px!important}
.td5-demo .td5-avatar{border-radius:9px!important;border:2px solid #719aff!important;position:relative}
.td5-demo .td5-avatar:after{content:'';position:absolute;right:-4px;bottom:-4px;background:#73ce9f;border:2px solid var(--td-panel);border-radius:50%;width:9px;height:9px}
.p23-hero{display:grid;gap:9px;border:1px solid var(--td-border);border-radius:16px;padding:20px;margin:14px 0 24px;background:var(--td-panel);box-shadow:0 8px 30px #0001;max-width:840px}
.p23-hero h1{font-size:23px;margin:0}.p23-hero p{font-size:12px;color:var(--td-muted);margin:0;line-height:1.6}.p23-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:9px}.p23-kpis div{border:1px solid var(--td-border);border-radius:10px;padding:12px;background:var(--td-panel-2)}.p23-kpis strong{font-size:14px}.p23-kpis small{display:block;color:var(--td-muted);font-size:10px;margin-top:6px}
.p23-menu.cluster-floating-surface-v504{position:fixed!important;visibility:visible!important;display:grid!important;width:min(385px,calc(100vw - 20px))!important;min-width:0;z-index:5000!important;color:var(--td-text);background:var(--td-panel)!important;box-shadow:0 28px 70px #0005!important;border:1px solid var(--td-border)!important;border-radius:14px!important;max-height:min(620px,75dvh)!important;overflow:auto!important;gap:0}
.p23-menu header,.p23-menu footer{padding:14px;display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:1px solid var(--td-border);font-size:12px}.p23-menu header div{display:grid;gap:4px}.p23-menu header small{color:var(--td-muted)}.p23-menu button{color:var(--td-text);font-size:11px;cursor:pointer}
.p23-menu button:focus-visible{outline:2px solid #7faaff;outline-offset:2px}.p23-menu footer{border-top:1px solid var(--td-border);border-bottom:0}.p23-menu footer button{border:1px solid var(--td-border);border-radius:8px;padding:9px 13px;background:var(--td-panel-2)}
.p23-preview-list{display:grid;gap:3px;padding:9px}.p23-preview-item{display:grid;gap:5px;padding:10px;border:1px solid transparent;border-radius:9px;background:var(--td-panel-2)}.p23-preview-item strong{font-size:12px}.p23-preview-item small{color:var(--td-muted);font-size:10px}.p23-section{font-size:12px;padding:12px 15px;color:var(--td-muted);border-bottom:1px solid var(--td-border)}
.p23-presence-row{display:flex;align-items:center;justify-content:space-between;gap:7px;padding:12px;margin:5px 9px;border-radius:9px;background:var(--td-panel-2);font-size:12px}.p23-presence-row span{display:flex;align-items:center;gap:8px}.p23-presence-row i{height:9px;width:9px;border-radius:50%;background:#77cd9c}.p23-presence-row b{color:#89b7ff;font-size:11px}.p23-menu :is(.taskbar-notification-error-v548,.taskbar-presence-error-v548){margin:9px!important}
.p23-menu [role=alert]{font-size:12px!important}
@media(max-width:900px){.td5-demo.app-shell.shell-unified-v3430{display:block!important}.td5-demo .content-shell{width:100%!important;height:100dvh!important}.td5-demo .td5-workspace{padding:17px!important}.td5-demo .cluster-taskbar__tabs{display:none!important}.p23-kpis{grid-template-columns:1fr}.p23-menu.cluster-floating-surface-v504{left:8px!important;right:8px!important;bottom:8px!important;top:auto!important;width:calc(100vw - 16px)!important;max-height:70dvh!important}}
'''
# Error scenarios intentionally demonstrate the new status region, not fake operation success.
transfer_active='''<header class="cluster-transfer-popover__header"><div><strong>Transfer Center</strong><span>2 active or queued · 1 completed</span></div><button class="cluster-button-v425 compact secondary">Retry failed</button></header><div class="cluster-transfer-list"><article data-state="running"><div class="cluster-transfer-list__body"><strong>Orion_Build_420.zip</strong><span>Desktop download · running · 1.8 GB / 2.5 GB</span><progress value="72" max="100" aria-label="72% transferred"></progress></div><div class="cluster-transfer-list__actions"><button class="cluster-button-v425 compact quiet">Pause</button><button class="cluster-button-v425 compact quiet">Cancel</button></div></article><article data-state="pending"><div class="cluster-transfer-list__body"><strong>level_art_reference.png</strong><span>Browser upload · pending · 14.5 MB</span></div><div class="cluster-transfer-list__actions"><button class="cluster-button-v425 compact quiet">Pause</button><button class="cluster-button-v425 compact quiet">Remove</button></div></article><article data-state="complete"><div class="cluster-transfer-list__body"><strong>Daily_Review.pdf</strong><span>Browser download · handed to browser</span><small class="cluster-transfer-list__note">Browser-managed progress is not available to Cluster.</small></div><div class="cluster-transfer-list__actions"><button class="cluster-button-v425 compact quiet">Remove</button></div></article></div><footer class="cluster-transfer-popover__footer"><span>1 completed Desktop transfer</span><button class="cluster-button-v425 compact quiet">Open latest</button></footer>'''
transfer_failed='''<header class="cluster-transfer-popover__header"><div><strong>Transfer Center</strong><span>1 transfer needs attention</span></div><button class="cluster-button-v425 compact secondary" disabled aria-busy="true">Retrying…</button></header><p class="cluster-transfer-action-error" role="alert">The connection to the workstation was interrupted. Retry the failed transfer after reconnecting.</p><div class="cluster-transfer-list"><article data-state="failed"><div class="cluster-transfer-list__body"><strong>Orion_Build_420.zip</strong><span>Desktop download · failed · 1.8 GB / 2.5 GB</span><small>Connection interrupted during verification.</small><progress value="72" max="100" aria-label="72% transferred"></progress></div><div class="cluster-transfer-list__actions"><button class="cluster-button-v425 compact secondary" disabled>Retry</button><button class="cluster-button-v425 compact quiet" disabled>Cancel</button></div></article><article data-state="paused"><div class="cluster-transfer-list__body"><strong>level_art_reference.png</strong><span>Browser upload · paused · 14.5 MB</span></div><div class="cluster-transfer-list__actions"><button class="cluster-button-v425 compact secondary" disabled>Resume</button></div></article></div>'''
manifest=[]
with sync_playwright() as play:
 browser=play.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 for theme in ('dark','light'):
  for mode in ('active','failed'):
   for width,height in ((1440,900),(390,844)):
    page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
    page.set_content(html,wait_until='domcontentloaded')
    page.add_style_tag(content=(root/'packages/renderer/src/features/shell/shell-v2.css').read_text())
    page.add_style_tag(content=local_css)
    page.evaluate('''({theme,mode,markup})=>{document.documentElement.dataset.theme=theme;document.querySelector('.td5-workspace').innerHTML=`<div class="td5-breadcrumb">Studio › Home</div><section class="p23-hero"><h1>Transfer Center</h1><p>Active work and recovery feedback for ${mode}. Project tabs, My Work and Tickets remain in the taskbar.</p><div class="p23-kpis"><div><strong>Project Orion</strong><small>Active workspace tab</small></div><div><strong>My Work</strong><small>6 assigned tasks</small></div><div><strong>Transfer Center</strong><small>Downloads and uploads</small></div></div></section>`; document.querySelectorAll('.td7-menu').forEach(x=>x.remove());const menu=document.createElement('div');menu.className='p23-menu cluster-floating-surface-v504 '+('cluster-transfer-popover');menu.dataset.clusterFloating='true';menu.setAttribute('aria-label','Transfer Center');menu.innerHTML=markup;document.body.append(menu);if(innerWidth>900){menu.style.left='auto';menu.style.right='32px';menu.style.top='75px';menu.style.bottom='auto';} }''',{'theme':theme,'mode':mode,'markup':transfer_active if mode=='active' else transfer_failed})
    page.wait_for_timeout(150)
    checks=page.evaluate('''()=>({overflow:document.documentElement.scrollWidth>innerWidth,alertVisible:!!document.querySelector('.cluster-transfer-list'),taskbarUtilities:['My Work','Tickets','Transfer Center'].every(s=>!!document.querySelector('[aria-label="'+s+'"]'))})''')
    assert checks['alertVisible'] and checks['taskbarUtilities'] and not checks['overflow'],checks
    name=f'Cluster-TD3-Pass25-{mode}-{theme}-{width}.png'
    page.screenshot(path=str(out/name));manifest.append({'file':name,'theme':theme,'surface':mode,'width':width,**checks});page.close()
 browser.close()
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
for theme in ('dark','light'):
 board=Image.new('RGB',(1560,1910),(23,28,37) if theme=='dark' else (234,238,244))
 pen=ImageDraw.Draw(board)
 pen.text((20,12),f'Cluster TD3 Pass 25 · Transfer Center review · {theme}',font=font,fill='#e8edf6' if theme=='dark' else '#273447')
 for i,mode in enumerate(('active','failed')):
  wide=Image.open(out/f'Cluster-TD3-Pass25-{mode}-{theme}-1440.png').convert('RGB');wide.thumbnail((1160,860))
  phone=Image.open(out/f'Cluster-TD3-Pass25-{mode}-{theme}-390.png').convert('RGB');phone.thumbnail((350,860))
  y=50+i*925;board.paste(wide,(5,y));board.paste(phone,(1190,y));pen.text((20,y+868),mode.title()+' transfers and recovery feedback',font=font,fill='#e8edf6' if theme=='dark' else '#273447')
 board.save(out/f'Cluster-TD3-Pass25-{theme}-Review-Board.png')
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('TD3 PASS25 PREVIEWS',len(manifest),'layout checks passed')
