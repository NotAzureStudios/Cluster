"""Source CSS preview fixtures of TD3 P15 People/Projects and Ticket; not a mounted app."""
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright
from html import escape
import json, re
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'.td3-pass15-previews';OUT.mkdir(exist_ok=True)
FIXTURE=ROOT/'tools/fixtures/td3-pass7-workspace.html'
STYLES='\n'.join((ROOT/path).read_text() for path in [
 'packages/renderer/src/features/people/people.css',
 'packages/renderer/src/features/projects/projects.css',
])
NEW_CSS='''
.td5-demo.app-shell.shell-unified-v3430{display:grid!important;grid-template-columns:236px minmax(0,1fr)!important;width:100%!important;min-height:100dvh}
.td5-demo .taskbar-unified-v3430{display:grid!important;grid-template-columns:auto minmax(130px,1fr) auto!important;grid-template-rows:minmax(0,1fr)!important;align-items:center!important;gap:12px!important;padding:6px 12px!important;min-height:58px!important;height:58px!important}
.td5-demo .cluster-taskbar__tabs{display:flex!important;min-width:0!important;overflow:hidden!important}
.td5-demo .cluster-taskbar__left,.td5-demo .cluster-taskbar__utilities{display:flex!important;align-items:center!important;flex-wrap:nowrap!important;white-space:nowrap}

.td5-demo .content-shell{min-width:0!important;width:auto!important;height:100dvh!important;overflow-y:auto!important}
.td5-sidebar.shell-sidebar-v3430{width:236px!important;min-width:236px!important}
@media(max-width:900px){.td5-demo.app-shell.shell-unified-v3430{display:block!important}.td5-sidebar.shell-sidebar-v3430{display:none!important}.td5-demo .content-shell{width:100%!important;height:100dvh!important}}
:root{--td-accent:#89aeff}
.td15-caption{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--td-muted);font-weight:800;margin-bottom:8px}
.td15-alert{padding:13px 16px;background:color-mix(in srgb,var(--td-accent) 11%,var(--td-panel));border:1px solid var(--td-border);border-radius:12px;color:var(--td-text);font-size:12px;margin:14px 0 18px}
.td15-panel{background:var(--td-panel);color:var(--td-text);border:1px solid var(--td-border);border-radius:13px;overflow:hidden;margin-bottom:12px;box-shadow:0 8px 25px #0000000b}
.td15-head{padding:13px 16px;border-bottom:1px solid var(--td-border);display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px}
.td15-head small,.td15-row small{color:var(--td-muted);font-size:10px}
.td15-line{padding:13px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--td-border);min-width:0;font-size:12px}
.td15-line:last-child{border:0}.td15-line span{display:flex;gap:8px;align-items:center;min-width:0}.td15-line small{font-size:10px;color:var(--td-muted)}
.td15-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(260px,.65fr);gap:16px;align-items:start}
.td15-row{display:flex;align-items:center;gap:10px;min-width:0}.td15-row strong{display:block;font-size:12px}.td15-avatar{width:37px;height:37px;flex:0 0 37px;border-radius:9px;border:2px solid var(--user-avatar-accent,#8fb2ff);position:relative;background:color-mix(in srgb,var(--user-avatar-accent,#8fb2ff) 28%,var(--td-panel));display:grid;place-items:center;color:var(--td-text);font-size:12px;font-weight:750}
.td15-avatar::after{content:'';position:absolute;right:-5px;bottom:-5px;width:11px;height:11px;border-radius:50%;border:2px solid var(--td-panel);background:var(--status-color,#8bd5af)}
.td15-menu-data{padding:16px;display:grid;gap:12px}.td15-stat{display:flex;gap:10px;flex-wrap:wrap}.td15-stat article{border:1px solid var(--td-border);border-radius:10px;background:var(--td-panel-2);padding:13px;min-width:100px;flex:1}.td15-stat small{display:block;color:var(--td-muted);font-size:10px}.td15-stat b{font-size:19px}
.td15-tickets{padding:16px}.td15-tickets label{display:grid;gap:6px;font-size:11px;color:var(--td-muted);margin-bottom:13px}.td15-tickets input,.td15-tickets select,.td15-tickets textarea{width:100%;color:var(--td-text);background:var(--td-panel-2);border:1px solid var(--td-border);border-radius:8px;min-height:37px;padding:10px;font:inherit;resize:none}.td15-tickets select{color:var(--td-text)}.td15-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}.td15-button{min-height:37px;padding:9px 14px;border:1px solid var(--td-border);border-radius:9px;color:var(--td-text);background:color-mix(in srgb,var(--td-accent) 19%,var(--td-panel));font-weight:700;font-size:11px}
.td15-disclosure{margin:16px 0}.td15-disclosure summary{list-style:none}.td15-disclosure summary::-webkit-details-marker{display:none}.td15-disclosure>summary{color:var(--td-text)}
.td15-disclosure>summary small{color:var(--td-muted)}
.td15-grid .cluster-field-v425{background:var(--td-panel);border:1px solid var(--td-border);border-radius:12px;overflow:hidden}
.td15-grid .cluster-field-v425>summary{display:flex;align-items:center;min-height:47px;justify-content:space-between;padding:12px 16px;cursor:pointer;background:var(--td-panel)}
.td15-grid .cluster-field-v425>summary strong{font-size:12px}.td15-grid .cluster-field-v425>summary small{display:block;font-size:10px;margin-top:4px}
.td15-grid .cluster-field-v425[open]>summary{border-bottom:1px solid var(--td-border)}
.td15-grid .people-data-tools-body-v524,.td15-grid .projects-data-tools-body-v528{display:grid;gap:10px;padding:14px;background:var(--td-panel)}
.td15-footnote{font-size:10px;color:var(--td-muted);padding-top:13px}.td15-workspace .td5-heading{margin-bottom:17px}
.td15-workspace .td5-heading h1{font-size:26px}
@media(max-width:940px){.td15-grid{grid-template-columns:minmax(0,1fr)}.td15-stat{flex-wrap:wrap}}
@media(max-width:600px){.td15-fields{grid-template-columns:1fr}.td15-workspace .td5-heading h1{font-size:23px}.td15-footnote{line-height:1.5}}
'''

def disclosure(kind):
 cls='people' if kind=='people' else 'projects'
 label='People' if kind=='people' else 'Project'
 body='people-data-tools-body-v524' if kind=='people' else 'projects-data-tools-body-v528'
 return f'''<details class="cluster-field-v425 {cls}-data-tools-v{'524' if kind=='people' else '528'} td15-disclosure" open><summary aria-controls="{cls}-tools"><span><strong>Data tools</strong><small>Saved views, analytics, layout</small></span><span>⌄</span></summary><div id="{cls}-tools" class="{body}"><div class="td15-stat"><article><small>Saved views</small><b>4</b></article><article><small>Active filters</small><b>2</b></article><article><small>{label} analytics</small><b>Live</b></article></div><div class="td15-line"><span>▦ &nbsp; Saved data view</span><small>Portfolio overview　⌄</small></div><div class="td15-line"><span>◈ &nbsp; Analytics and drilldowns</span><small>Current scope</small></div><div class="td15-line"><span>☷ &nbsp; Layout and columns</span><small>Customizable</small></div></div></details>'''

def ticket():
 return '''<div class="td15-panel"><div class="td15-head"><strong>My tickets</strong><small>2 open and assigned to you</small></div><div style="padding:12px 16px;border-bottom:1px solid var(--td-border);display:flex;gap:8px"><button class="td15-button">New ticket</button><button class="td15-button" style="background:var(--td-panel-2)">Open my tickets</button></div><div class="td15-tickets"><label>Title<input value="Review environment collision" readonly /></label><div class="td15-fields"><label>Priority<select><option>High</option></select></label><label>Project<select><option>Project Orion</option></select></label></div><label>Details<textarea rows="3" readonly>Collision issue found during build review.</textarea></label><button class="td15-button">Submit ticket</button><p style="font-size:10px;color:var(--td-muted);line-height:1.55">Immediate duplicate-submit protection · durable request receipt</p></div></div>'''

def page(kind):
 if kind=='people':
  heading='<div class="td5-heading"><div><h1>People</h1><p>Studio profiles, availability, and shared work.</p></div><div class="td5-buttons"><button class="primary">＋ &nbsp; Add person</button></div></div>'
  data=''.join(f'<div class="td15-line"><div class="td15-row"><span class="td15-avatar" style="--user-avatar-accent:{color};--status-color:{status}">{ini}</span><div><strong>{name}</strong><small>{role}</small></div></div><small>{avail}</small></div>' for ini,name,role,color,status,avail in [('AL','Alex Lin','Creative Director','#92b4fb','#8bd5af','Available'),('JM','Jordan Moss','Environment Artist','#8bd7af','#8bd5af','Available'),('SK','Sam Kim','QA Engineer','#c4a7f0','#e8bd78','Focus'),('DR','Drew Reyes','Developer','#e8c18f','#87919e','Offline')])
  left=f'<div class="td15-panel"><div class="td15-head"><strong>Studio directory</strong><small>4 members</small></div>{data}</div>'
  right=disclosure('people')+ticket()
 else:
  heading='<div class="td5-heading"><div><h1>Projects</h1><p>Current portfolio and delivery health.</p></div><div class="td5-buttons"><button class="primary">＋ &nbsp; New project</button></div></div>'
  data=''.join(f'<div class="td15-line"><span><b style="font-size:17px">◈</b> {name}</span><small>{status}</small></div>' for name,status in [('Project Orion','Production'),('Project Atlas','At risk'),('Project Cascade','Planning'),('Project Drift','On hold')])
  left=f'<div class="td15-panel"><div class="td15-head"><strong>Studio projects</strong><small>4 projects</small></div>{data}</div>'
  right=disclosure('projects')+ticket()
 return f'''<div class="td15-workspace"><div class="td15-caption">CLUSTER TD3 PASS 15 · SOURCE-CSS PREVIEW · REPRESENTATIVE CONTENT</div>{heading}<div class="td15-alert">Preserves Project Tabs, My Work, Tickets, Transfer Center, and separate People presence indicators.</div><div class="td15-grid"><div>{left}</div><div>{right}</div></div><div class="td15-footnote">Illustrative browser fixture using Cluster renderer styles. Not a running React or native Qt capture.</div></div>'''

def inline_css(path, seen=None):
 seen=seen if seen is not None else set()
 path=path.resolve()
 if path in seen: return ''
 seen.add(path)
 data=path.read_text()
 return re.sub(r'@import\s+["\']([^"\'\n]+)["\']\s*;',lambda match:inline_css(path.parent/match.group(1),seen),data)
html=FIXTURE.read_text().replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+inline_css(ROOT/'packages/renderer/src/styles.css').replace('</style>','')+'</style>')
files=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
 for theme in ('dark','light'):
  for kind in ('people','projects'):
   for width,height in ((1440,900),(390,844)):
    context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=1)
    target=context.new_page()
    target.set_content(html, wait_until="domcontentloaded")
    target.add_style_tag(content=STYLES+'\n'+NEW_CSS)
    target.evaluate('''(payload) => {const root=document.documentElement;root.dataset.theme=payload.theme;document.querySelector('.td5-workspace').innerHTML=payload.html;for(const item of document.querySelectorAll('.td5-nav-item')) {const active=item.textContent.trim().toLowerCase().includes(payload.kind);item.classList.toggle('active',active)}}''',{'theme':theme,'kind':kind,'html':page(kind)})
    target.wait_for_timeout(150)
    overflow=target.evaluate('document.documentElement.scrollWidth > window.innerWidth')
    name=f'Cluster-TD3-Pass15-{kind}-{theme}-{width}.png';target.screenshot(path=str(OUT/name),full_page=False)
    files.append({'file':name,'theme':theme,'kind':kind,'viewport':width,'documentHorizontalOverflow':overflow})
    context.close()
 browser.close()
# comparison board for desktop previews; each image exactly from source-CSS fixture
thumbs=[]
for kind in ('people','projects'):
 for theme in ('dark','light'):
  f=OUT/f'Cluster-TD3-Pass15-{kind}-{theme}-1440.png'
  im=Image.open(f).convert('RGB')
  im.thumbnail((900,563))
  thumbs.append((kind.title()+' · '+theme.title(), im))
w=1850;h=1240
board=Image.new('RGB',(w,h),'#171c24');d=ImageDraw.Draw(board)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',19)
for i,(label,img) in enumerate(thumbs):
 x=20+(i%2)*925;y=32+(i//2)*610
 d.text((x,y-26),label,font=font,fill='#edf3fc');board.paste(img,(x,y))
board.save(OUT/'Cluster-TD3-Pass15-Review-Board.png')
(OUT/'METRICS.json').write_text(json.dumps(files,indent=2))
print(json.dumps({'screenshots':len(files),'overflow':sum(x['documentHorizontalOverflow'] for x in files),'output':str(OUT)}))
