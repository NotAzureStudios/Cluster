"""Source-CSS UI fixture for TD3 P17. Representative content, not mounted React/Qt."""
from pathlib import Path
from html import escape
from PIL import Image, ImageOps, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright
import re, json
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'.td3-pass17-previews';OUT.mkdir(exist_ok=True)
FIXTURE=ROOT/'tools/fixtures/td3-pass7-workspace.html'
seen=set()
def css(path):
 path=path.resolve()
 if path in seen:return ''
 seen.add(path); data=path.read_text()
 return re.sub(r'@import\s+["\']([^"\'\n]+)["\']\s*;', lambda m: css(path.parent/m.group(1)), data)
base=FIXTURE.read_text().replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+css(ROOT/'packages/renderer/src/styles.css').replace('</style>','')+'\n'+css(ROOT/'packages/renderer/src/features/projects/project-detail-workspace.css').replace('</style>','')+'\n'+css(ROOT/'packages/renderer/src/features/tickets/tickets.css').replace('</style>','')+'</style>')
STYLE='''
.td5-demo.app-shell.shell-unified-v3430{display:grid!important;grid-template-columns:236px minmax(0,1fr)!important;width:100%!important;min-height:100dvh}
.td5-sidebar.shell-sidebar-v3430{width:236px!important;min-width:236px!important}
.td5-demo .content-shell{min-width:0;width:auto!important;height:100dvh!important;overflow-y:auto!important}
.td5-demo .taskbar-unified-v3430{display:grid!important;grid-template-columns:auto minmax(100px,1fr) auto!important;grid-template-rows:minmax(0,1fr)!important;align-items:center!important;gap:9px!important;padding:6px 12px!important;min-height:58px!important;height:58px!important}
.td5-demo .cluster-taskbar__tabs{display:flex!important;min-width:0!important;overflow:hidden!important}
.td5-demo .cluster-taskbar__left,.td5-demo .cluster-taskbar__utilities{display:flex!important;align-items:center!important;white-space:nowrap!important;gap:5px!important}
.td5-demo .td5-workspace{max-width:1440px;min-width:0}
.td16-kicker{font-size:10px;font-weight:750;letter-spacing:.1em;color:var(--td-muted);margin-bottom:12px}
.td16-layout{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(280px,.8fr);gap:16px}
.td16-stack{display:grid;gap:13px;align-content:start;min-width:0}
.td16-card{min-width:0;background:var(--td-panel);border:1px solid var(--td-border);border-radius:14px;padding:17px;box-shadow:0 12px 25px #0000000c}
.td16-card h3{font-size:13px;margin:0 0 12px}.td16-card small,.td16-secondary{font-size:10px;color:var(--td-muted)}
.td16-card p{font-size:11px;color:var(--td-muted);line-height:1.6}
.td16-row{display:flex;align-items:center;gap:9px;min-height:40px;justify-content:space-between;border-bottom:1px solid var(--td-border);font-size:11px}
.td16-row:last-child{border-bottom:0}.td16-row strong{font-size:11px}.td16-row small{white-space:nowrap}
.td16-meta{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border:1px solid var(--td-border);border-radius:9px;background:var(--td-panel-2);font-size:10px;color:var(--td-text)}
.td16-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;padding-top:12px}
.td16-form label{min-width:0;color:var(--td-muted);font-size:10px;display:grid;gap:7px}
.td16-form input,.td16-form select,.td16-form textarea{min-height:37px;min-width:0;width:100%;padding:7px 10px;color:var(--td-text);background:var(--td-panel-2);border:1px solid var(--td-border);border-radius:8px;font-size:11px}
.td16-form label.wide{grid-column:1/-1}
.td16-form button,.td16-button{min-height:36px;border:1px solid var(--td-border);border-radius:8px;background:color-mix(in srgb,#88aeff 15%,var(--td-panel-2));color:var(--td-text);padding:8px 11px;font-size:10px;text-align:center}
.td16-disclosure{display:block!important;min-width:0;border:1px solid var(--td-border);border-radius:14px;background:var(--td-panel);overflow:hidden;margin:0 0 12px}
.td16-disclosure>summary{list-style:none!important;display:flex;align-items:center;justify-content:space-between;padding:14px 16px;min-height:47px;border:0;cursor:pointer;color:var(--td-text);font-size:12px}
.td16-disclosure>summary strong{font-size:12px}.td16-disclosure>summary small{display:block;font-size:10px;margin-top:3px;color:var(--td-muted)}
.td16-disclosure[open]>summary{border-bottom:1px solid var(--td-border)}
.td16-disclosure>.td16-content{padding:13px 16px;min-width:0}
.td16-disclosure .cluster-disclosure-trailing-v546{margin-left:auto;color:var(--td-muted);font-size:10px}
.td16-divider{height:1px;background:var(--td-border);margin:10px 0}
.td16-avatar{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;border:2px solid var(--avatar-color);background:color-mix(in srgb,var(--avatar-color) 15%,var(--td-panel));font-size:10px;font-weight:800;position:relative}
.td16-avatar::after{content:'';width:9px;height:9px;border-radius:50%;background:var(--activity-color,#89d2a6);border:2px solid var(--td-panel);position:absolute;bottom:-4px;right:-4px}
.td16-identity{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
.td16-resource{padding:12px;border:1px solid var(--td-border);border-radius:11px;background:var(--td-panel-2);display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:8px;font-size:10px}
.td16-resource small{grid-column:1/-1}
.td16-workspace-header{display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:14px}
.td16-workspace-header h1{font-size:26px;margin:0 0 6px;letter-spacing:-.04em}
.td16-workspace-header p{font-size:11px;color:var(--td-muted);margin:0}
.td16-pill{display:inline-flex;align-items:center;padding:7px 9px;border-radius:8px;background:var(--td-panel-2);border:1px solid var(--td-border);font-size:10px;color:var(--td-muted)}
.td16-note{font-size:10px;color:var(--td-muted);padding:16px 0;line-height:1.6}
@media(max-width:900px){.td5-demo.app-shell.shell-unified-v3430{display:block!important}.td5-sidebar.shell-sidebar-v3430{display:none!important}.td5-demo .content-shell{width:100%!important;height:100dvh!important}.td5-demo .taskbar-unified-v3430{padding-left:8px!important}.td5-demo .cluster-taskbar__tabs{display:none!important}.td5-demo .cluster-taskbar__utilities .td5-pill{display:none!important}.td16-layout{grid-template-columns:1fr}.td16-workspace-header h1{font-size:22px}}
@media(max-width:480px){.td16-card{padding:12px}.td16-form{grid-template-columns:1fr}.td16-form label.wide{grid-column:auto}.td16-workspace-header{align-items:flex-start}.td16-workspace-header .td16-pill{display:none}.td16-disclosure .td16-content{padding:10px}}
'''
def disc(title,body,cls='',meta=None):
 return f'<details class="cluster-field-v425 td16-disclosure {cls}" open><summary aria-controls="d-{title.replace(" ", "-")}"><span><strong>{escape(title)}</strong><small>Shared Cluster disclosure · keyboard accessible</small></span>{f"<span class=cluster-disclosure-trailing-v546>{escape(str(meta))}</span>" if meta is not None else ""}</summary><div id="d-{title.replace(" ", "-")}" class="td16-content">{body}</div></details>'
def rows(labels):return ''.join(f'<div class="td16-row"><strong>{escape(l)}</strong><small>{escape(s)}</small></div>' for l,s in labels)
def av(initial,name,color,presence='available'):
 return f'<span class="cluster-presence-avatar-v227" style="--avatar-size:26px;--presence-size:9px;--user-avatar-accent:{color}" role="img" aria-label="{name}"><span class="cluster-presence-avatar-fallback-v227" aria-hidden="true">{initial}</span><span class="cluster-presence-indicator-v227 {presence}" role="img" aria-label="{name} is {presence}"></span></span>'
def page(kind):
 data={
 'projects':('Projects','Project overview · Team identity and control center',
 '''<div class="td16-card"><h3>Project Orion · Delivery pulse</h3>'''+rows([('Delivery readiness','82%'),('Milestones','6 planned'),('Open decisions','3'),('Linked work','124 items')])+'''</div><div class="td16-card"><h3>Upcoming milestones</h3>'''+rows([('Environment pass','Oct 15'),('Internal QA','Oct 22'),('Feature lock','Nov 02')])+'''</div>''',
 disc('Team & recent activity','<div class="project-team-summary-v57">'+''.join(f'<div>{av(i,n,c,p)}<strong>{n}</strong></div>' for i,n,c,p in [('AL','Alex Lin','#82a8e8','available'),('JM','Jordan Moss','#a2c78e','available'),('SR','Sam Reyes','#c29ad6','focus'),('CL','Casey Lee','#e7b580','away')])+'</div><div class="td16-divider"></div>'+rows([('Alex revised milestone dates','12m ago'),('Jordan updated asset references','47m ago')]),'project-secondary-details-v57',meta='4 people · 2 updates')+disc('Controls & project data',rows([('Deliverables','12 tracked'),('High risks','2'),('Decisions','3 pending'),('Relationships','15 links'),('Version history','8 revisions')]),'project-secondary-details-v57',meta='2 attention')+disc('Workflow handoff',rows([('Recurring work','3 active'),('Dependencies','8 linked'),('Meetings','4 upcoming')]),'project-plan-handoff-v57')),
 'tickets':('Tickets','Queue · Shared analytics and saved views',
 '''<div class="td16-card"><h3>Tickets queue</h3>'''+rows([('Asset import regression','Bug · High'),('Control mapping update','Task · In progress'),('Animation state drift','Regression · Review'),('Project permissions','Access · Waiting')])+'''</div><div class="td16-card"><h3>Queue lanes</h3>'''+rows([('Open','18'),('Waiting','6'),('Review','3'),('Resolved this week','27')])+'''</div>''',
 disc('Analytics & saved views',rows([('Analytical projections','Status by type'),('Saved queue layout','My triage'),('Formula columns','2 active'),('Facet filters','Priority, owner')]),'tickets-advanced-tools',meta='Advanced')+disc('Work actions',rows([('Assign','Choose person'),('Change status','Triage → Review'),('Add relationship','Link project')]))),
 'people':('People','Studio directory and filters', '''<div class="td16-card"><h3>Studio directory</h3>'''+''.join(f'<div class="td16-row"><div class="td16-identity"><div class="td16-avatar" style="--avatar-color:{c};--activity-color:{a}">{i}</div><div><strong>{n}</strong><div class="td16-secondary">{role}</div></div></div><small>{status}</small></div>' for i,n,role,c,a,status in [('AL','Alex Lin','Creative Director','#89abf2','#79d9ae','Available'),('JM','Jordan Moss','Environment Artist','#a8c99d','#79d9ae','Available'),('SR','Sam Reyes','Technical Artist','#c19ae2','#f0b764','Focus'),('CL','Casey Lee','Project Lead','#e4b586','#8995ab','Away')])+'''</div>''',disc('People filters','<div class="td16-form"><label class="wide">Search people<input value="environment" readonly></label><label>Role<select><option>All roles</option></select></label><label>Status<select><option>Available</option></select></label></div>','filter-menu-v0102',meta='4 shown')+disc('Profile activity',rows([('Availability','Available'),('Clock state','Clocked in'),('Last seen','Just now')]))),
 'boards':('Boards','Cards, relationships, and delivery history', '''<div class="td16-card"><h3>Production sprint</h3>'''+''.join(f'<div class="td16-resource"><strong>{x}</strong><span class="td16-pill">{s}</span><small>{desc}</small></div>' for x,s,desc in [('Environment optimization','In progress','Jordan Moss · Production'),('Asset import verification','Review','Alex Lin · QA'),('Combat prototype','Blocked','Dependencies: input pass')])+'''</div>''',disc('Relationships, fields & history',rows([('Related records','8 links'),('Board fields','6 custom fields'),('Version history','12 snapshots'),('Discussion','3 open threads')]),'project-tool-meta-v195')+disc('History',rows([('Snapshot 12','Today 14:30'),('Snapshot 11','Yesterday'),('Snapshot 10','Oct 10')]),'version-history-v195',meta=12)),
 'whiteboards':('Whiteboards','Collaboration, relationships, and restore points','''<div class="td16-card"><h3>Environment planning board</h3><div style="height:240px;border:1px solid var(--td-border);background:var(--td-panel-2);border-radius:11px;padding:18px;display:grid;grid-template-columns:repeat(2,1fr);gap:13px"><div class="td16-resource" style="align-content:center"><strong>Reference pass</strong><small>Textures and materials</small></div><div class="td16-resource" style="align-content:center"><strong>Optimization</strong><small>LOD review</small></div><div class="td16-resource" style="align-content:center"><strong>Milestone</strong><small>Ready for review</small></div><div class="td16-resource" style="align-content:center"><strong>QA checks</strong><small>Verify collisions</small></div></div></div>''',disc('Relationships, fields & history',rows([('Related items','11'),('Whiteboard fields','4'),('Discussion','3 active'),('Shared evidence','8 documents')]),'project-tool-meta-v195')+disc('Server history',rows([('Sequence 31','Today 14:15'),('Sequence 30','Today 12:08'),('Sequence 29','Yesterday')]),'version-history-v195',meta=3)),
 'library':('Library','Files, metadata, and managed revisions','''<div class="td16-card"><h3>Production assets</h3>'''+rows([('Environment','Folder · 24 files'),('Trailer_Master.mov','Video · 3.2 GB'),('Orion_Pitch.pdf','Document · 9.8 MB'),('Material_Atlas.png','Image · 12 MB')])+'''</div>''',disc('Custom metadata','<div class="td16-form"><label class="wide">Metadata JSON<textarea rows="5" readonly>{"classification":"internal","review":"approved","project":"Orion"}</textarea></label></div>','library-metadata-editor-v219')+disc('Version history',rows([('Current','v17'),('Previous','v16'),('Review notes','2')]),meta='3 versions')),
 }
 title,subtitle,left,right=data[kind]
 return f'''<div class="td16-kicker">CLUSTER · TD3 PASS 17 · SOURCE-CSS UI FIXTURE</div><div class="td16-workspace-header"><div><h1>{title}</h1><p>{subtitle}</p></div><span class="td16-pill">Project Orion</span></div><div class="td16-layout"><div class="td16-stack">{left}</div><div class="td16-stack">{right}</div></div><div class="td16-note">Representative HTML for reviewing production CSS and markup contracts, not an authenticated React/Qt screenshot.</div>'''
files=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for theme in ('dark','light'):
  for kind in ('projects','tickets'):
   for width,height in ((1440,900),(390,844)):
    context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=1)
    tab=context.new_page();tab.set_content(base,wait_until='domcontentloaded');tab.add_style_tag(content=STYLE)
    tab.evaluate('''(args) => {document.documentElement.dataset.theme=args.theme;document.querySelector('.td5-workspace').innerHTML=args.body;for(const e of document.querySelectorAll('.td5-nav-item')) e.classList.toggle('active',e.textContent.toLowerCase().includes(args.kind));}''',{'theme':theme,'kind':kind,'body':page(kind)})
    tab.wait_for_timeout(130)
    obj=tab.evaluate('''() => ({overflow:document.documentElement.scrollWidth>innerWidth,summaryCount:document.querySelectorAll('details.cluster-field-v425>summary').length,tabHasUtilities:!!document.querySelector('[aria-label="Tickets"]')&&!!document.querySelector('[aria-label="Transfer Center"]')})''')
    fn=f'Cluster-TD3-Pass17-{kind}-{theme}-{width}.png';tab.screenshot(path=str(OUT/fn),full_page=False)
    files.append({'file':fn,'page':kind,'theme':theme,'width':width,**obj});context.close()
 browser.close()
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
try:fnt=ImageFont.truetype(font,18)
except:fnt=ImageFont.load_default()
for theme in ('dark','light'):
 thumbs=[]
 for kind in ('projects','tickets'):
  im=Image.open(OUT/f'Cluster-TD3-Pass17-{kind}-{theme}-1440.png').convert('RGB');im.thumbnail((760,480));thumbs.append((kind,im))
 bg=(21,26,33) if theme=='dark' else (226,232,240)
 board=Image.new('RGB',(1560,570),bg); d=ImageDraw.Draw(board)
 for i,(kind,im) in enumerate(thumbs):
  x=15+(i%2)*775;y=35;board.paste(im,(x,y+22));d.text((x+6,y),f'{kind.capitalize()} · {theme}',font=fnt,fill=(240,244,249) if theme=='dark' else (22,33,48))
 board.save(OUT/f'Cluster-TD3-Pass17-{theme}-review-board.png')
(OUT/'scenario-results.json').write_text(json.dumps(files,indent=2))
print('PREVIEWS',len(files),'OVERFLOW',sum(x['overflow'] for x in files),'MISSING UTILITIES',sum(not x['tabHasUtilities'] for x in files))
