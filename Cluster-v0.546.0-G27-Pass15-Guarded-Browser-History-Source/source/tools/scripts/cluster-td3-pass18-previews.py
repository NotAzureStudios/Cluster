"""Static Cluster production CSS fixture previews, NOT running app screenshots."""
from pathlib import Path
from html import escape
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont
import re, json
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'.td3-pass18-previews';OUT.mkdir(exist_ok=True)
seen=set()
def css(path):
    path=path.resolve()
    if path in seen:return ''
    seen.add(path)
    data=path.read_text()
    return re.sub(r'@import\s+["\']([^"\'\n]+)["\']\s*;',lambda m:css(path.parent/m.group(1)),data)
fixture=(ROOT/'tools/fixtures/td3-pass7-workspace.html').read_text()
add_css='\n'.join(css(ROOT/p) for p in [
 'packages/renderer/src/styles.css',
 'packages/renderer/src/features/projects/projects.css',
 'packages/renderer/src/features/projects/project-detail-workspace.css',
 'packages/renderer/src/features/projects/project-quality.css',
 'packages/renderer/src/features/notifications/notifications.css',
 'packages/renderer/src/features/library/library-workspace.css',
 'packages/renderer/src/features/viewer/viewer-shell.css'])
base=fixture.replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+add_css.replace('</style>','')+'</style>')
STYLE='''
.td5-demo.app-shell.shell-unified-v3430{display:grid!important;grid-template-columns:236px minmax(0,1fr)!important;width:100%!important;min-height:100dvh}
.td5-sidebar.shell-sidebar-v3430{width:236px!important;min-width:236px!important}
.td5-demo .content-shell{min-width:0;width:auto!important;height:100dvh!important;overflow-y:auto!important}
.td5-demo .taskbar-unified-v3430{display:grid!important;grid-template-columns:auto minmax(100px,1fr) auto!important;grid-template-rows:minmax(0,1fr)!important;align-items:center!important;gap:9px!important;padding:6px 12px!important;min-height:58px!important;height:58px!important}
.td5-demo .cluster-taskbar__tabs{display:flex!important;min-width:0!important;overflow:hidden!important}
.td5-demo .cluster-taskbar__left,.td5-demo .cluster-taskbar__utilities{display:flex!important;align-items:center!important;white-space:nowrap!important;gap:5px!important}
.td5-demo .td5-workspace{max-width:1440px;min-width:0}
.p18-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0 20px}.p18-top h1{font-size:26px;margin:0}.p18-top p{color:var(--td-muted);font-size:12px;margin:6px 0 0}.p18-stamp{padding:7px 10px;border:1px solid var(--td-border);border-radius:9px;color:var(--td-muted);font-size:10px;white-space:nowrap}
.p18-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(270px,.85fr);gap:15px;align-items:start}.p18-stack{min-width:0;display:grid;gap:14px}.p18-panel{min-width:0;border:1px solid var(--td-border);border-radius:12px;background:var(--td-panel);padding:17px;box-shadow:0 12px 26px #0000000c}.p18-panel h3{font-size:13px;margin:0 0 10px}.p18-panel p{font-size:11px;color:var(--td-muted)}.p18-panel>div.p18-row{display:flex;justify-content:space-between;gap:8px;padding:10px 0;border-top:1px solid var(--td-border);font-size:12px}.p18-row span{color:var(--td-muted);font-size:11px}
.p18-details.cluster-field-v425{display:grid;gap:0;min-width:0;border:1px solid var(--td-border);border-radius:12px;background:var(--td-panel);overflow:hidden;box-shadow:0 8px 24px #0000000a}
.p18-details.cluster-field-v425>summary{padding:14px 15px;display:flex;align-items:center;gap:10px;justify-content:space-between;min-width:0;background:var(--td-panel-2);color:var(--td-text)}
.p18-details.cluster-field-v425>summary>span:first-child{min-width:0;display:grid;gap:4px}
.p18-details.cluster-field-v425>summary strong{font-size:12px}.p18-details.cluster-field-v425>summary small{font-size:10px;color:var(--td-muted)}
.p18-details.cluster-field-v425>div{padding:12px 14px;display:grid;gap:8px;min-width:0}.p18-details.cluster-field-v425 .cluster-disclosure-trailing-v546{font-size:10px;color:var(--td-muted)}
.p18-details.cluster-field-v425 .cluster-disclosure-chevron-v546{display:block;width:14px;height:14px;border:solid var(--td-muted);border-width:0 1.5px 1.5px 0;transform:rotate(-45deg);margin-right:3px}
.p18-details.cluster-field-v425[open] .cluster-disclosure-chevron-v546{transform:rotate(45deg)}
.p18-fact{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--td-border);font-size:11px}.p18-fact:last-child{border:0}.p18-fact strong{font-size:11px}.p18-fact span{color:var(--td-muted)}
.p18-inspector-meta{display:grid;grid-template-columns: minmax(100px,1fr) auto;gap:8px;align-items:center;padding:7px 0;font-size:11px}.p18-inspector-meta label{color:var(--td-muted)}.p18-pill{border:1px solid var(--td-border);border-radius:8px;background:var(--td-panel-2);padding:6px 8px;font-size:10px;color:var(--td-text)}.p18-foot{margin:18px 0;font-size:10px;color:var(--td-muted)}
@media(max-width:900px){.td5-demo.app-shell.shell-unified-v3430{display:block!important}.td5-sidebar.shell-sidebar-v3430{display:none!important}.td5-demo .content-shell{width:100%!important;height:100dvh!important}.td5-demo .taskbar-unified-v3430{padding:7px!important}.td5-demo .cluster-taskbar__tabs{display:none!important}.td5-demo .cluster-taskbar__utilities .td5-pill{display:none!important}.p18-grid{grid-template-columns:1fr}.p18-top h1{font-size:21px}.p18-stamp{display:none}.p18-panel{padding:12px}}
@media(max-width:480px){.td5-demo .taskbar-unified-v3430{gap:2px!important}.td5-demo .cluster-taskbar__left .td5-hide-phone{display:none!important}.td5-demo .cluster-taskbar__utilities .td5-hide-phone{display:none!important}.p18-details.cluster-field-v425>summary{padding:11px}.p18-details.cluster-field-v425>div{padding:10px}.p18-foot{padding-bottom:20px}}
'''
def rows(data):return ''.join(f'<div class="p18-fact"><strong>{escape(str(k))}</strong><span>{escape(str(v))}</span></div>' for k,v in data)
def disclosure(title,desc,body,trail='',cls=''):
 return f'<details class="cluster-field-v425 p18-details {cls}" open data-cluster-state="selected"><summary aria-controls="p18-{title.replace(" ","-")}"><span><strong>{escape(title)}</strong><small>{escape(desc)}</small></span><span class="cluster-disclosure-trailing-v546">{escape(trail)}</span><i class="cluster-disclosure-chevron-v546" aria-hidden="true"></i></summary><div id="p18-{title.replace(" ","-")}">{body}</div></details>'
def view(kind):
 data={
 'projects':('Projects · Intelligence & delivery','Cross-project signals and release context',
 '<div class="p18-panel"><h3>Delivery readiness</h3>'+rows([('Readiness','82%'),('Open blockers','2'),('Next milestone','Oct 22'),('Latest build','0.546.0')])+'</div>'+disclosure('Portfolio signals','Cross-project risk and capacity',rows([('Projects at risk','2'),('Owners under pressure','1'),('Critical dependencies','4')]),'2 at risk')+disclosure('Release context','Platform gates, QA, candidates, next beat',rows([('Platform','Windows'),('Release stage','Validation'),('QA passed','18'),('Candidates','3')]),'2 blockers'),
 disclosure('Advanced operations & evidence','Dependencies, delivery pipeline and activity history',rows([('Cross-project dependencies','7'),('Delivery stages','5'),('Activity events','28'),('Critical path','Build → QA → Release')]),'7 dependencies')+disclosure('More QA context','Linked work, risk, evidence and discussion',rows([('Open QA sessions','3'),('Linked tickets','12'),('Last discussion','14 minutes ago')]),'Review') ),
 'notifications':('Notifications · Inbox','Notifications and activity controls',
 '<div class="p18-panel"><h3>Inbox activity</h3>'+rows([('Build pipeline updated','Project Orion'),('QA session needs review','Project Atlas'),('Release gate unblocked','Project Orion'),('Document revised','Library')])+'</div>'+disclosure('24-hour digest','Recent notification summary',rows([('Actions','8'),('Project changes','16'),('Builds','6')]),'30'),
 disclosure('Active threads','Grouped notification threads',rows([('Orion launch thread','7 events'),('Asset review thread','4 events'),('QA acceptance','2 events')]),'3')+disclosure('View sources','Control inbox source visibility',rows([('Projects','Enabled'),('Calendar','Enabled'),('Library','Enabled'),('Builds','Enabled')]),'4/4') ),
 'library':('Library · Governance','Retention, evidence and lifecycle controls',
 '<div class="p18-panel"><h3>Asset retention status</h3>'+rows([('Asset','Orion_Environment_02'),('Classification','Studio'),('Backlinks','12'),('Retention','7 years')])+'</div>'+disclosure('Child item evidence','Dependent Library objects',rows([('Source texture','Approved'),('Environment mesh','In use'),('Material instances','4 linked')]),'3'),
 disclosure('Version evidence','Saved versions and hashes',rows([('v18 Current','Oct 13'),('v17 Approved','Oct 11'),('v16 Archived','Oct 06')]),'3')+disclosure('Access sources','Inheritance and permission sources',rows([('Studio default','Contributor'),('Project override','Editor'),('Folder policy','Read only')]),'3') ),
 'viewer':('Media Viewer · Inspector','Canonical asset facts and sensitive metadata',
 '<div class="p18-panel"><h3>Selected asset</h3>'+rows([('File','Orion_Trailer_Final.mov'),('Type','Video'),('Duration','01:24'),('Revision','v18')])+'</div>'+disclosure('Overview','Asset identity and state',rows([('Owner','Studio Media'),('Project','Orion'),('Status','Approved')]),'3'),
 disclosure('Versions','Immutable asset revisions',rows([('v18','Current'),('v17','Approved'),('v16','Archived')]),'3')+disclosure('Sensitive metadata','Requires explicit authorized reveal',rows([('Recipient data','Not loaded'),('Location tags','Not loaded')]),'Locked') )
 }
 title,desc,left,right=data[kind]
 return f'<div class="p18-top"><div><h1>{escape(title)}</h1><p>{escape(desc)}</p></div><span class="p18-stamp">TD3 P18 · UI interaction convergence</span></div><div class="p18-grid"><div class="p18-stack">{left}</div><div class="p18-stack">{right}</div></div><p class="p18-foot">Representative production CSS fixture, not authenticated Cluster or native Qt runtime.</p>'
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for theme in ('dark','light'):
  for kind in ('projects','notifications','library','viewer'):
   for width,height in ((1440,900),(390,844)):
    ctx=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=1)
    tab=ctx.new_page();tab.set_content(base,wait_until='domcontentloaded');tab.add_style_tag(content=STYLE)
    metrics=tab.evaluate('''({theme,kind,body})=>{document.documentElement.dataset.theme=theme;document.querySelector('.td5-workspace').innerHTML=body;const q=document.querySelector('.td5-workspace');for(const nav of document.querySelectorAll('.td5-nav-item')){nav.classList.toggle('active',(kind==='projects' && nav.textContent.trim()==='Projects') || (['library','viewer'].includes(kind) && nav.textContent.trim()==='Library'));}return {overflow:document.documentElement.scrollWidth>innerWidth,disclosures:q.querySelectorAll('details.cluster-field-v425').length,missingUtilities:['My Work','Tickets','Transfer Center'].filter(a=>!document.querySelector(`[aria-label="${a}"]`)).length}}''',{'theme':theme,'kind':kind,'body':view(kind)})
    fn=f'Cluster-TD3-Pass18-{kind}-{theme}-{width}.png';tab.screenshot(path=str(OUT/fn),full_page=False)
    results.append({'file':fn,'kind':kind,'theme':theme,'width':width,**metrics});ctx.close()
 browser.close()
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
fnt=ImageFont.truetype(font,18)
for theme in ('dark','light'):
 bg=(19,25,33) if theme=='dark' else (228,233,241)
 board=Image.new('RGB',(1520,1050),bg);d=ImageDraw.Draw(board)
 for i,kind in enumerate(('projects','notifications','library','viewer')):
  im=Image.open(OUT/f'Cluster-TD3-Pass18-{kind}-{theme}-1440.png').convert('RGB');im.thumbnail((725,455))
  x=16+(i%2)*757;y=15+(i//2)*516
  d.text((x+4,y),f'{kind.title()} · {theme}',font=fnt,fill=(238,242,247) if theme=='dark' else (26,35,49))
  board.paste(im,(x,y+29))
 board.save(OUT/f'Cluster-TD3-Pass18-{theme}-overview.png')
(OUT/'scenario-results.json').write_text(json.dumps(results,indent=2))
print('PASS18_PREVIEWS',len(results),'OVERFLOW',sum(r['overflow'] for r in results),'MISSING_UTILITIES',sum(r['missingUtilities'] for r in results))
