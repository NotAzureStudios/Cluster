"""TD3 Pass21: illustrative production-CSS viewer previews (NOT mounted React)."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image,ImageDraw,ImageFont
import json,re
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'.td3-pass21-previews';OUT.mkdir(exist_ok=True)
seen=set()
def sheet(path):
 path=path.resolve()
 if path in seen:return ''
 seen.add(path);s=path.read_text()
 return re.sub(r'@import\s+["\']([^"\'\n]+)["\']\s*;',lambda m:sheet(path.parent/m.group(1)),s)
base=ROOT/'tools/fixtures/td3-pass7-workspace.html'
html=base.read_text().replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+sheet(ROOT/'packages/renderer/src/styles.css').replace('</style','')+'</style>')
css=(ROOT/'packages/renderer/src/features/viewer/viewer-shell.css').read_text()
style='''
.td5-demo.app-shell.shell-unified-v3430{display:grid!important;grid-template-columns:236px minmax(0,1fr)!important;min-height:100dvh!important}
.td5-demo .content-shell{height:100dvh!important;width:auto!important;overflow-y:auto!important}
.td5-demo .taskbar-unified-v3430{display:grid!important;grid-template-columns:auto minmax(0,1fr) auto!important;min-height:58px!important;align-items:center!important}
.td5-demo .td5-workspace{max-width:1450px!important}
.p21-viewer.cluster-viewer-shell{height:560px!important;min-height:480px!important;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;background:var(--td-panel);border:1px solid var(--td-border);border-radius:14px;overflow:hidden;--cluster-workbench-panel:var(--td-panel);--cluster-workbench-panel-raised:var(--td-panel);--cluster-workbench-panel-muted:var(--td-panel-2);--cluster-workbench-canvas:var(--td-bg);--cluster-workbench-border:var(--td-border);--cluster-workbench-border-strong:var(--td-border);--cluster-workbench-text:var(--td-text);--cluster-workbench-muted:var(--td-muted)}
.p21-viewer .cluster-viewer-header{padding:12px 16px}.p21-viewer .cluster-viewer-command-bar{padding:10px 12px;display:flex;justify-content:space-between;gap:8px}.p21-viewer .cluster-viewer-command-primary{display:flex;gap:7px;overflow:hidden}.p21-viewer button,.p21-popup button{font-size:11px;padding:8px 11px;border:1px solid var(--td-border);background:var(--td-panel-2);color:var(--td-text);border-radius:8px;white-space:nowrap}.p21-viewer .cluster-viewer-workspace{display:grid;grid-template-columns:minmax(0,1fr) 285px;height:100%;min-height:0}.p21-viewer .cluster-viewer-stage{min-width:0;display:grid;place-items:center;background:radial-gradient(circle at 65% 45%,#61768a7e,transparent 48%),linear-gradient(130deg,#283549,#161d26);color:#dae8fd}.p21-art{width:65%;height:60%;border:1px solid #abc6ef4d;border-radius:13px;display:grid;place-content:center;text-align:center;gap:12px;transform:perspective(500px) rotateY(-10deg);background:linear-gradient(140deg,#83a1c251,#32455d5c);box-shadow:0 25px 60px #00000055}.p21-art strong{font-size:24px}.p21-art span{font-size:11px}.p21-viewer .cluster-viewer-drawer{padding:15px;border-left:1px solid var(--td-border);background:var(--td-panel)}.p21-viewer .cluster-viewer-drawer h3{margin:0 0 17px;font-size:14px}.p21-fact{border-bottom:1px solid var(--td-border);padding:9px 0;font-size:11px;display:flex;justify-content:space-between;gap:8px}.p21-fact span{color:var(--td-muted)}.p21-viewer .p21-footer{padding:8px 14px;font-size:10px;color:var(--td-muted);border-top:1px solid var(--td-border)}
.p21-popup.cluster-viewer-command-menu.cluster-floating-surface-v504{--cluster-workbench-panel-raised:var(--td-panel);--cluster-workbench-border-strong:var(--td-border);--cluster-workbench-muted:var(--td-muted);color:var(--td-text);background:var(--td-panel)!important;box-shadow:0 25px 70px #00000065!important;z-index:10000!important;visibility:visible!important;min-width:220px}.p21-popup button{display:flex;justify-content:space-between;width:100%;border:0;background:transparent;padding:12px 9px;gap:12px;text-align:left}.p21-popup button:hover,.p21-popup button:focus{background:var(--td-panel-2)}.p21-popup kbd{font-size:10px}.p21-popup hr{border:0;border-top:1px solid var(--td-border)}
@media(max-width:900px){.td5-demo.app-shell.shell-unified-v3430{display:block!important}.td5-demo .content-shell{height:100dvh!important;width:100%!important}.td5-demo .cluster-taskbar__tabs{display:none!important}.td5-demo .td5-workspace{padding:14px 10px}.p21-viewer.cluster-viewer-shell{height:620px!important;min-height:0!important}.p21-viewer .cluster-viewer-workspace{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) 180px}.p21-viewer .cluster-viewer-drawer{width:auto;max-height:none;border-left:0;border-top:1px solid var(--td-border)}.p21-art{width:75%;height:70%}.p21-art strong{font-size:17px}}
@media(max-width:450px){.p21-viewer .cluster-viewer-command-primary button:nth-child(n+3){display:none}.p21-popup.cluster-viewer-command-menu.cluster-floating-surface-v504{left:8px!important;right:8px!important;top:auto!important;bottom:8px!important;width:calc(100vw - 16px)!important;max-width:calc(100vw - 16px)!important;max-height:65vh}.p21-viewer .cluster-viewer-header{padding:10px}.p21-viewer .cluster-viewer-command-bar{padding:7px}.p21-viewer .cluster-viewer-workspace{grid-template-rows:minmax(0,1fr) 220px}.p21-viewer.cluster-viewer-shell{height:660px!important}}
'''
work='''<div class="td5-breadcrumb">Studio › Project Orion › Library › Review</div><div class="td5-heading"><div><h1>Media review</h1><p>Source artwork and viewer commands with context-aware actions.</p></div></div>
<div class="p21-viewer cluster-viewer-shell" data-medium="image" data-mode="review"><div class="cluster-viewer-header"><div class="cluster-viewer-identity"><div><strong>Orion_Environment_Concept.png</strong><span>Image · 4096 × 2304 · Source revision 12</span></div></div><span style="font-size:10px;color:var(--td-muted)">REVIEW MODE</span></div><div class="cluster-viewer-command-bar" role="toolbar"><div class="cluster-viewer-command-primary"><button>Zoom in</button><button>Compare</button><button>Overlays</button><button>Fit</button></div><div class="cluster-viewer-command-overflow"><button aria-haspopup="menu" aria-expanded="true" aria-label="More viewer commands" id="p21-anchor">•••</button></div></div><div class="cluster-viewer-workspace"><div class="cluster-viewer-stage"><div class="p21-art"><strong>ORION / ENVIRONMENT</strong><span>Concept visualization · source preview</span></div></div><aside class="cluster-viewer-drawer"><h3>Inspector</h3><div class="p21-fact"><strong>Review state</strong><span>In progress</span></div><div class="p21-fact"><strong>Assigned</strong><span>Creative team</span></div><div class="p21-fact"><strong>Last updated</strong><span>Oct 13</span></div><div class="p21-fact"><strong>Version</strong><span>12</span></div><div class="p21-fact"><strong>References</strong><span>8 resources</span></div></aside></div><div class="p21-footer">View · Review · Technical modes　　Command shortcuts retained　　Keyboard-safe menu</div></div>
<p style="margin:18px 0;color:var(--td-muted);font-size:10px">Production CSS fixture and representative content; not a mounted React or native Qt screenshot.</p>'''
popup='''<div role="menu" data-cluster-floating="true" data-mobile-sheet="false" class="p21-popup cluster-viewer-command-menu cluster-floating-surface-v504 cluster-action-menu-panel-v428" aria-label="Viewer commands" style="position:fixed;left:calc(100vw - 385px);top:230px;width:265px;max-height:400px;overflow:auto;visibility:visible"><button role="menuitem">Export derivative <kbd>Ctrl+E</kbd></button><button role="menuitem">Copy resource link <kbd>Ctrl+Shift+C</kbd></button><button role="menuitem">Review diagnostics</button><hr><button role="menuitem">Open in separate window</button></div>'''
manifest=[]
with sync_playwright() as playwright:
 browser=playwright.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for theme in ('dark','light'):
  for width,height in ((1440,900),(390,844)):
   page=browser.new_page(viewport={'width':width,'height':height})
   page.set_content(html,wait_until='domcontentloaded')
   page.add_style_tag(content=css+'\n'+style)
   page.evaluate('''({theme,content,popup})=>{document.documentElement.dataset.theme=theme;document.querySelector('.td5-workspace').innerHTML=content;document.querySelector('.td5-menu')?.remove();document.querySelector('.td7-menu')?.remove();document.body.insertAdjacentHTML('beforeend',popup);document.querySelectorAll('.td5-nav-item').forEach(e=>e.classList.toggle('active',e.textContent.includes('Library'))); }''',{'theme':theme,'content':work,'popup':popup})
   page.wait_for_timeout(160)
   result=page.evaluate('''()=>({overflow:document.documentElement.scrollWidth>innerWidth, commandVisible:!!document.querySelector('.cluster-viewer-command-menu [role="menuitem"]'),taskbarUtilities:['My Work','Tickets','Transfer Center'].every(x=>!!document.querySelector('[aria-label="'+x+'"]'))})''')
   img=OUT/f'Cluster-TD3-Pass21-viewer-{theme}-{width}.png';page.screenshot(path=str(img),full_page=False)
   manifest.append({'filename':img.name,'theme':theme,'width':width,**result})
   page.close()
 browser.close()
for theme in ('dark','light'):
 canvas=Image.new('RGB',(1510,1000),(22,28,36) if theme=='dark' else (232,235,241))
 d=ImageDraw.Draw(canvas)
 font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
 d.text((18,12),f'Cluster TD3 Pass 21 / Viewer commands / {theme}',font=font,fill=(232,236,243) if theme=='dark' else (35,45,60))
 desktop=Image.open(OUT/f'Cluster-TD3-Pass21-viewer-{theme}-1440.png').convert('RGB');desktop.thumbnail((1150,800))
 phone=Image.open(OUT/f'Cluster-TD3-Pass21-viewer-{theme}-390.png').convert('RGB');phone.thumbnail((345,800))
 canvas.paste(desktop,(5,55));canvas.paste(phone,(1160,55));canvas.save(OUT/f'Cluster-TD3-Pass21-{theme}-Review-Board.png')
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('PREVIEWS',len(manifest),'OK',all(not i['overflow'] and i['commandVisible'] and i['taskbarUtilities'] for i in manifest))
