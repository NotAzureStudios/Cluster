"""TD3 P19 source-CSS previews. Illustrative markup, NOT mounted React/Qt screenshots."""
from pathlib import Path
from html import escape
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont
import re, json
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'.td3-pass19-previews';OUT.mkdir(exist_ok=True)
seen=set()
def stylesheet(path):
 path=path.resolve()
 if path in seen:return ''
 seen.add(path)
 raw=path.read_text()
 return re.sub(r'@import\s+["\']([^"\'\n]+)["\']\s*;',lambda m:stylesheet(path.parent/m.group(1)),raw)
css='\n'.join(stylesheet(ROOT/p) for p in [
 'packages/renderer/src/styles.css',
 'packages/renderer/src/features/projects/projects.css',
 'packages/renderer/src/features/people/people.css',
 'packages/renderer/src/features/admin/admin-workspace.css',
 'packages/renderer/src/features/settings/settings-workspace.css'])
base=(ROOT/'tools/fixtures/td3-pass7-workspace.html').read_text().replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+css.replace('</style>','')+'</style>')
STYLE='''
.p19-demo.app-shell.shell-unified-v3430{display:grid!important;grid-template-columns:236px minmax(0,1fr)!important;min-height:100dvh;width:100%!important}
.p19-sidebar.shell-sidebar-v3430{width:236px!important;min-width:236px!important}
.p19-demo .content-shell{min-width:0;width:auto!important;height:100dvh!important;overflow-y:auto!important}
.p19-demo .taskbar-unified-v3430{display:grid!important;grid-template-columns:auto minmax(0,1fr) auto!important;align-items:center!important;gap:9px!important;padding:6px 12px!important;min-height:58px!important;height:58px!important}
.p19-demo .cluster-taskbar__tabs{display:flex!important;min-width:0!important;overflow:hidden!important}
.p19-demo .cluster-taskbar__left,.p19-demo .cluster-taskbar__utilities{display:flex!important;gap:6px!important;align-items:center!important;white-space:nowrap!important}
.p19-demo .td5-workspace{max-width:1440px;width:100%;margin:0}
.p19-header{display:flex;align-items:start;justify-content:space-between;gap:12px;margin-bottom:22px}.p19-header h1{font-size:26px;margin:0;letter-spacing:-.04em}.p19-header p{font-size:12px;color:var(--td-muted);margin:5px 0 0}.p19-stamp{font-size:11px;padding:8px 10px;border:1px solid var(--td-border);border-radius:9px;color:var(--td-muted);white-space:nowrap}
.p19-columns{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(270px,.8fr);gap:15px;align-items:start}.p19-stack{min-width:0;display:grid;gap:13px}.p19-panel{min-width:0;background:var(--td-panel);border:1px solid var(--td-border);border-radius:12px;padding:15px;box-shadow:0 9px 24px #0000000b}.p19-panel h3{font-size:13px;margin:0 0 12px}.p19-note{font-size:11px;color:var(--td-muted);line-height:1.55}.p19-fact{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid var(--td-border);font-size:11px;padding:10px 0}.p19-fact:last-child{border:0}.p19-fact span{color:var(--td-muted)}
.p19-panel .cluster-field-v425{background:var(--td-panel-2);border:1px solid var(--td-border);border-radius:10px;overflow:hidden;margin:9px 0}
.p19-panel .cluster-field-v425>summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 13px;background:var(--td-panel-2);color:var(--td-text)}
.p19-panel .cluster-field-v425>summary>span:first-child{display:grid;gap:3px;min-width:0}.p19-panel .cluster-field-v425>summary strong{font-size:12px}.p19-panel .cluster-field-v425>summary small{font-size:10px;color:var(--td-muted)}
.p19-panel .cluster-field-v425>div{padding:10px 13px}.p19-panel .cluster-disclosure-chevron-v546{width:11px;height:11px;border:solid var(--td-muted);border-width:0 1.7px 1.7px 0;transform:rotate(-45deg);display:block;flex-shrink:0}.p19-panel details[open] .cluster-disclosure-chevron-v546{transform:rotate(45deg)}
.p19-pill{display:inline-flex;align-items:center;gap:5px;font-size:10px;border:1px solid var(--td-border);background:var(--td-panel-2);padding:6px 8px;border-radius:8px;color:var(--td-text)}.p19-actions{display:flex;gap:6px;flex-wrap:wrap}.p19-actions button{border:1px solid var(--td-border);background:var(--td-panel-2);color:var(--td-text);font-size:11px;border-radius:8px;padding:8px 11px}.p19-actions .primary{background:color-mix(in srgb,var(--td-accent) 23%,var(--td-panel))}
.p19-projects-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 0}.p19-search{padding:9px 10px;border:1px solid var(--td-border);border-radius:8px;min-width:200px;flex:1;background:var(--td-panel-2);font-size:11px;color:var(--td-muted)}
.p19-projects-controls .cluster-filter-popover-trigger-v547{color:var(--td-text);background:var(--td-panel-2);border-color:var(--td-border);min-height:36px}
.p19-floating-panel{position:fixed!important;left:auto!important;right:14vw!important;top:192px!important;z-index:200!important;visibility:visible!important;color:var(--td-text)!important;background:var(--td-panel)!important;border:1px solid var(--td-border)!important;box-shadow:0 20px 70px #00000052!important;padding:15px!important;width:440px!important;max-width:calc(100vw - 18px)!important}
.p19-filter-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.p19-filter-fields label{display:grid;gap:6px;font-size:11px;color:var(--td-muted)}.p19-filter-fields select{width:100%;min-width:0;padding:10px 6px;border:1px solid var(--td-border);border-radius:7px;background:var(--td-panel-2);color:var(--td-text);font:inherit}
.p19-footer{margin:24px 0;font-size:10px;color:var(--td-muted)}
@media(max-width:900px){.p19-demo.app-shell.shell-unified-v3430{display:block!important}.p19-sidebar.shell-sidebar-v3430{display:none!important}.p19-demo .content-shell{width:100%!important;height:100dvh!important}.p19-demo .cluster-taskbar__tabs{display:none!important}.p19-demo .cluster-taskbar__utilities .td5-pill{display:none!important}.p19-columns{grid-template-columns:1fr}.p19-header h1{font-size:21px}.p19-stamp{display:none}}
@media(max-width:640px){.p19-demo .taskbar-unified-v3430{padding:6px!important;gap:2px!important}.p19-demo .cluster-taskbar__left .td5-hide-phone,.p19-demo .cluster-taskbar__utilities .td5-hide-phone{display:none!important}.p19-demo .td5-workspace{padding:17px 12px}.p19-panel{padding:10px}.p19-filter-fields{grid-template-columns:1fr}.p19-floating-panel{left:8px!important;right:8px!important;top:auto!important;bottom:8px!important;width:calc(100vw - 16px)!important}.p19-search{min-width:0}.p19-pill{font-size:9px}}
'''
def facts(data):return ''.join(f'<div class="p19-fact"><strong>{escape(str(a))}</strong><span>{escape(str(b))}</span></div>' for a,b in data)
def group(title,sub,body,tail='',opened=True):
 return f'<details class="cluster-field-v425 admin-consolidated-details-v15" {"open" if opened else ""}><summary><span><strong>{escape(title)}</strong><small>{escape(sub)}</small></span><span class="p19-pill">{escape(tail)}</span><i class="cluster-disclosure-chevron-v546" aria-hidden="true"></i></summary><div>{body}</div></details>'
def panel(title,inside):return f'<section class="p19-panel"><h3>{title}</h3>{inside}</section>'
def page(kind):
 if kind=='projects':
  heading='Projects';desc='Portfolio, delivery and production context';
  filters='<div class="p19-projects-controls"><div class="p19-search">⌕ &nbsp; Search projects</div><div class="p19-pill">● Active</div><div class="cluster-filter-popover-v547 projects-more-filters-v57"><button class="cluster-filter-popover-trigger-v547" aria-expanded="true">More filters <span class="cluster-filter-count-v547">2</span>⌄</button></div></div>'
  left=panel('Portfolio overview',filters+facts([('Project Orion','Production · Needs review'),('Project Atlas','Active · On track'),('Studio Website','On hold · Design')]))+panel('Data tools',group('Saved views & analytics','Filters, aggregates, flexible columns',facts([('Active view','Portfolio by status'),('Analytics','4 saved projections')]),'2 views'))
  right=panel('Project inspector',facts([('Owner','Development'),('Build readiness','84%'),('Upcoming gate','Release review'),('Status','At risk')]))
  float_html='''<div role="dialog" aria-label="More filters controls" class="cluster-floating-surface-v504 cluster-filter-popover-panel-v547 projects-more-filters-panel-v547 p19-floating-panel" data-cluster-floating="true"><strong style="display:block;font-size:13px;margin-bottom:13px">Refine projects</strong><div class="p19-filter-fields"><label>Source<select><option>Git</option></select></label><label>Schedule<select><option>Due soon</option></select></label><label>Priority<select><option>All</option></select></label></div><div class="cluster-filter-popover-actions-v547"><button>Close filters</button></div></div>'''
 elif kind=='admin':
  heading='Operations';desc='Systems, maintenance and operational evidence';float_html=''
  left=panel('Systems & work',group('Runtime & background work','Queues, workers, scheduler state, recovery evidence',facts([('Runtime','Online'),('Queued jobs','2'),('Last recovery','All checks passed')]),'Healthy')+group('Maintenance tools','Integrity, cleanup, repair and one-off jobs',facts([('Integrity scan','Available'),('Background queues','4 active')]),'Admin')+group('Persistence & recovery','Storage readiness, recovery and repair evidence',facts([('Database','Connected'),('Storage providers','3 mounted')]),'Ready'))
  right=panel('Administration',facts([('Security center','Protected'),('Pending approvals','4'),('Audit events','52 today')])+group('Import & migration tools','Preview and import structured data',facts([('Latest import','No failures')]),'Available'))
 elif kind=='people':
  heading='People';desc='People, teams, skills and allocation context';float_html=''
  left=panel('Team & expertise context',group('Team & expertise context','Allocation, working hours and searchable expertise',facts([('Studio teams','5'),('Working hours','18/22 profiles'),('Allocated capacity','496 hours'),('Expertise','14 areas')]),'5 teams · 1 overallocated')+group('Permission bundles (3)','Studio, team and individual permissions',facts([('Studio Contributor','Active'),('Production Member','Active'),('Project Review','Inherited')]),'Admin'))
  right=panel('Selected person','<div style="display:flex;align-items:center;gap:13px;margin-bottom:16px"><span class="cluster-presence-avatar-v227" data-presence="available" style="--user-avatar-accent:#829bd6;width:47px;height:47px;display:inline-grid;place-items:center;position:relative;flex-shrink:0;border-radius:12px;background:#445d87;color:#f4f7ff"><span class="cluster-presence-avatar-fallback-v227">AL</span><span class="cluster-presence-indicator-v227 available" aria-label="Available"></span></span><div><strong style="font-size:16px">Alex Lin</strong><div class="p19-note">Creative Director · Design</div><span class="p19-pill">● Available</span></div></div>'+facts([('Name','Alex Lin'),('Role','Creative Director'),('Presence','● Available'),('Identity color','Slate blue')])+group('Allocation & activity','Current team assignments',facts([('Orion team','75%'),('Atlas team','25%')]),'2 teams'))
 else:
  heading='Studio Settings';desc='Project Types, appearance and studio defaults';float_html=''
  left=panel('Project Type editor',facts([('Selected type','Unreal Engine'),('Enabled','Yes'),('Default lead','Project Lead')])+group('Advanced behavior','Creation, delivery, metadata and approvals',facts([('Closeout workflow','Required'),('Build strategy','Branch-aware'),('Project identity','Internal / External')]),'Expanded'))
  right=panel('Appearance preferences',facts([('Sidebar','Floating / Docked'),('Taskbar','Floating / Full width'),('Surface depth','Soft'),('Texture','Fine grain'),('Icon scale','Standard')]))
 content=f'<div class="p19-header"><div><h1>{heading}</h1><p>{desc}</p></div><span class="p19-stamp">v0.546 · TD3 Pass 19</span></div><div class="p19-columns"><div class="p19-stack">{left}</div><div class="p19-stack">{right}</div></div><p class="p19-footer">Production CSS + representative Cluster content. NOT a running React or Qt screenshot.</p>'
 return content,float_html
records=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for theme in ('dark','light'):
  for kind in ('projects','admin','people','settings'):
   for width,height in [(1440,900),(390,844)]:
    context=browser.new_context(viewport={'width':width,'height':height});pageobj=context.new_page()
    pageobj.set_content(base,wait_until='domcontentloaded');pageobj.add_style_tag(content=STYLE)
    body,popover=page(kind)
    metric=pageobj.evaluate('''({kind,theme,body,popover})=>{
     document.documentElement.dataset.theme=theme;
     const frame=document.querySelector('.td5-demo');frame.classList.add('p19-demo');
     document.querySelector('.td5-sidebar').classList.add('p19-sidebar');
     const stage=document.querySelector('.td5-workspace');stage.innerHTML=body;
     document.querySelectorAll('.td5-nav-item').forEach(nav=>nav.classList.toggle('active',nav.textContent.trim().toLowerCase()===({projects:'projects',admin:'operations',people:'people',settings:'settings'}[kind])));
     document.querySelectorAll('.td5-nav-item').forEach(nav=>{if(nav.textContent.trim().toLowerCase()!=='library')nav.classList.remove('td7-nav-item')});
     if(popover)document.body.insertAdjacentHTML('beforeend',popover);
     return {overflow:document.documentElement.scrollWidth>innerWidth,utilMissing:['My Work','Tickets','Transfer Center'].filter(x=>!document.querySelector('[aria-label="'+x+'"]')).length,groups:stage.querySelectorAll('details').length,filter:!!document.querySelector('.p19-floating-panel')}
    }''',{'kind':kind,'theme':theme,'body':body,'popover':popover})
    filename=f'Cluster-TD3-Pass19-{kind}-{theme}-{width}.png'
    pageobj.screenshot(path=str(OUT/filename),full_page=False)
    records.append({'file':filename,'theme':theme,'page':kind,'width':width,**metric})
    context.close()
 browser.close()
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17)
for theme in ('dark','light'):
 board=Image.new('RGB',(1500,1040),(20,26,34) if theme=='dark' else (226,232,240));draw=ImageDraw.Draw(board)
 for i,kind in enumerate(('projects','admin','people','settings')):
  shot=Image.open(OUT/f'Cluster-TD3-Pass19-{kind}-{theme}-1440.png').convert('RGB');shot.thumbnail((730,455))
  x=14+(i%2)*752;y=12+(i//2)*512
  draw.text((x+4,y),f'{kind.title()} · {theme}',font=font,fill=(238,240,248) if theme=='dark' else (30,38,53))
  board.paste(shot,(x,y+27))
 board.save(OUT/f'Cluster-TD3-Pass19-{theme}-Review-Board.png')
(OUT/'preview-manifest.json').write_text(json.dumps(records,indent=2)+'\n')
print('CAPTURES',len(records),'OVERFLOW',sum(v['overflow'] for v in records),'MISSING_UTILITIES',sum(v['utilMissing'] for v in records))
