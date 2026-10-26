"""TD3 P20 source-CSS previews, representative markup only, NOT mounted React or Qt."""
from pathlib import Path
import json,re
from playwright.sync_api import sync_playwright
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'.td3-pass20-previews';OUT.mkdir(exist_ok=True)
fixture=ROOT/'tools/fixtures/td3-pass7-workspace.html'
seen=set()
def stylesheet(path):
 path=path.resolve()
 if path in seen:return ''
 seen.add(path)
 raw=path.read_text()
 return re.sub(r'@import\s+["\']([^"\'\n]+)["\']\s*;',lambda m:stylesheet(path.parent/m.group(1)),raw)
fixture_text=fixture.read_text().replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+stylesheet(ROOT/'packages/renderer/src/styles.css').replace('</style>','')+'</style>')
css='''
.td5-demo.app-shell.shell-unified-v3430{display:grid!important;grid-template-columns:236px minmax(0,1fr)!important;min-height:100dvh!important}
.td5-demo .content-shell{height:100dvh!important;width:auto!important;overflow-y:auto!important}
.td5-demo .taskbar-unified-v3430{display:grid!important;grid-template-columns:auto minmax(0,1fr) auto!important;min-height:58px!important;align-items:center!important}
.td5-demo .td5-workspace{max-width:1440px;padding:22px 30px}
.td5-demo .td5-workspace .p20-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(270px,.66fr);gap:13px;align-items:start}
.p20-stack{display:grid;gap:14px}.p20-card{background:var(--td-panel);border:1px solid var(--td-border);border-radius:13px;padding:15px;min-width:0;box-shadow:0 7px 22px #0000000b}
.p20-card h3{margin:0 0 12px;font-size:14px}.p20-note{color:var(--td-muted);font-size:11px;line-height:1.5}
.p20-field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.p20-field-grid label{display:grid;gap:6px;color:var(--td-muted);font-size:11px}.p20-field-grid input,.p20-field-grid select{min-width:0;width:100%;padding:9px 10px;background:var(--td-panel-2);color:var(--td-text);border:1px solid var(--td-border);border-radius:8px}
.p20-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 0;border-bottom:1px solid var(--td-border);font-size:11px}.p20-row:last-child{border:0}.p20-row span{color:var(--td-muted)}
.p20-chip{display:inline-block;padding:5px 8px;background:var(--td-panel-2);border:1px solid var(--td-border);border-radius:7px;font-size:10px;color:var(--td-text)}.p20-footer{font-size:10px;color:var(--td-muted);margin-top:15px}
.p20-card details.cluster-field-v425{margin:0;background:var(--td-panel-2);border:1px solid var(--td-border);border-radius:10px}.p20-card details.cluster-field-v425>summary{padding:12px;display:flex;gap:10px;justify-content:space-between;align-items:center;list-style:none}.p20-card details.cluster-field-v425>summary strong{font-size:12px}.p20-card details.cluster-field-v425>div{padding:12px}
.p20-card .qa-filter-actions-v118{display:flex;gap:6px;flex-wrap:wrap}.p20-card .qa-filter-actions-v118 button{font-size:10px!important;min-height:34px!important;padding:7px!important}
.p20-resource-trigger{display:flex;align-items:center;gap:8px;margin:16px 0;padding:8px;border:1px solid var(--td-border);border-radius:10px;background:var(--td-panel-2)}.p20-resource-trigger select{flex:1;min-width:0;padding:8px 7px;color:var(--td-text);background:var(--td-panel);border:1px solid var(--td-border);border-radius:7px}.p20-resource-trigger button{padding:8px 9px;border:1px solid var(--td-border);border-radius:7px;background:var(--td-panel);color:var(--td-text)}
.p20-portal{position:fixed!important;top:166px!important;right:7%!important;left:auto!important;width:min(420px,calc(100vw - 16px))!important;z-index:250!important;background:var(--td-panel)!important;border:1px solid var(--td-border)!important;box-shadow:0 22px 65px #00000055!important;max-height:70vh!important;overflow:auto!important;padding:8px!important;visibility:visible!important}.p20-portal>div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;align-items:center;padding:7px;border-radius:7px}.p20-portal>div.current{background:color-mix(in srgb,#86aaff 11%,var(--td-panel))}.p20-portal button{font-size:11px;padding:8px;min-width:0;border-radius:7px;text-align:left;color:var(--td-text);background:var(--td-panel-2);border:1px solid var(--td-border)}.p20-portal button:first-child{display:grid;gap:3px}.p20-portal button em{font-size:9px;color:var(--td-muted);font-style:normal}.p20-portal .p20-menu-title{font-size:10px;color:var(--td-muted);padding:7px}
@media(max-width:900px){.td5-demo.app-shell.shell-unified-v3430{display:block!important}.td5-demo .content-shell{height:100dvh!important;width:100%!important}.td5-demo .td5-workspace{padding:16px 12px}.td5-demo .td5-workspace .p20-grid{grid-template-columns:1fr}.td5-demo .cluster-taskbar__tabs{display:none!important}.p20-portal{top:auto!important;bottom:8px!important;left:8px!important;right:8px!important;max-height:65vh!important;width:calc(100vw - 16px)!important}.p20-field-grid{grid-template-columns:1fr}.p20-card{padding:10px}}
'''
def field(label,choices):return f'<label>{label}<select><option>{choices}</option></select></label>'
qa=f'''<div class="td5-breadcrumb">Studio › Projects › Quality assurance</div><div class="td5-heading"><div><h1>Quality assurance</h1><p>Investigate, reproduce and track issues in the release queue.</p></div><div class="td5-buttons"><button class="primary">+ Create QA card</button></div></div><div class="p20-grid"><div class="p20-stack"><section class="p20-card"><h3>QA overview</h3><div class="p20-row"><strong>Blocking issues</strong><span class="p20-chip">4 urgent</span></div><div class="p20-row"><strong>Ready for verification</strong><span>11 items</span></div><div class="p20-row"><strong>Regression run</strong><span>In progress</span></div></section><section class="p20-card"><details class="cluster-field-v425 panel qa-control-panel-v085 filter-menu-v0102 qa-filter-panel-v118" open><summary><span><strong>QA filters</strong><small>18 matching</small></span><span class="cluster-disclosure-chevron-v546">⌄</span></summary><div><div class="qa-filter-grid-v085 qa-filter-grid-v118 p20-field-grid">{field('Search QA','Crash, build, project...')}{field('Project','All projects')}{field('Queue','Open')}{field('Severity','All severities')}</div><div class="qa-filter-actions-v118" style="margin-top:12px"><button class="active">All severities</button><button>Urgent 4</button><button>High 7</button><button>Medium 12</button></div></div></details></section><section class="p20-card"><h3>Active tickets</h3><div class="p20-row"><strong>GPU crash while loading assets</strong><span>Urgent</span></div><div class="p20-row"><strong>Controller focus issue</strong><span>High</span></div><div class="p20-row"><strong>Build export warnings</strong><span>Medium</span></div></section></div><div class="p20-stack"><section class="p20-card"><h3>Release readiness</h3>{'<div class="p20-row"><strong>Open issue lanes</strong><span>QA · RC · Launch</span></div>'}<div class="p20-row"><strong>Release blockers</strong><span>4</span></div><div class="p20-row"><strong>Test evidence</strong><span>Linked</span></div></section></div></div><p class="p20-footer">Cluster production CSS fixture with representative QA content, not a mounted application screenshot.</p>'''
board=f'''<div class="td5-breadcrumb">Studio › Project Orion › Boards</div><div class="td5-heading"><div><h1>Boards</h1><p>Switch between project boards and optional separate windows.</p></div><div class="td5-buttons"><button class="primary">+ New board</button></div></div><div class="p20-grid"><div class="p20-stack"><section class="p20-card"><h3>Board workspace</h3><div class="p20-resource-trigger project-resource-switcher-v489"><select><option>Production roadmap</option></select><button>Window</button><button aria-haspopup="menu" aria-expanded="true">Browse ▾</button></div><div class="p20-row"><strong>Ready for review</strong><span>8 cards</span></div><div class="p20-row"><strong>In progress</strong><span>17 cards</span></div><div class="p20-row"><strong>Blocked</strong><span>3 cards</span></div></section><section class="p20-card"><h3>Production roadmap</h3><div class="p20-row"><strong>Character systems</strong><span class="p20-chip">Working</span></div><div class="p20-row"><strong>Asset pipeline</strong><span>In review</span></div><div class="p20-row"><strong>UI milestone</strong><span>Ready</span></div></section></div><div class="p20-stack"><section class="p20-card"><h3>Current selection</h3><div class="p20-row"><strong>Board</strong><span>Production roadmap</span></div><div class="p20-row"><strong>Project</strong><span>Orion</span></div></section></div></div><p class="p20-footer">Cluster production CSS fixture showing body-portaled resource browser, not mounted React.</p>'''
portal='''<div role="menu" data-cluster-floating="true" class="cluster-floating-surface-v504 project-resource-browser-menu-v489 p20-portal" aria-label="Browse boards"><div class="p20-menu-title" style="display:block">BOARDS IN YOUR PROJECTS</div><div class="current"><button role="menuitem">Production roadmap<em>Orion · Active</em></button><button role="menuitem">Window</button></div><div><button role="menuitem">Content pipeline<em>Orion · Assets</em></button><button role="menuitem">Window</button></div><div><button role="menuitem">Release planning<em>Atlas · Milestones</em></button><button role="menuitem">Window</button></div></div>'''
manifest=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 for kind,content in [('qa',qa),('board-resource-browser',board)]:
  for theme in ['dark','light']:
   for width,height in [(1440,900),(390,844)]:
    page=b.new_page(viewport={'width':width,'height':height})
    page.set_content(fixture_text,wait_until='domcontentloaded');page.add_style_tag(content=css)
    page.evaluate('''({theme,content,kind,portal})=>{
      document.documentElement.dataset.theme=theme;
      const stage=document.querySelector('.td5-workspace');stage.innerHTML=content;
      document.querySelectorAll('.td5-nav-item').forEach(x=>x.classList.toggle('active',x.textContent.toLowerCase().includes(kind==='qa'?'projects':'projects')));
      if(kind!=='qa')document.body.insertAdjacentHTML('beforeend',portal);
    }''',{'theme':theme,'content':content,'kind':kind,'portal':portal})
    page.wait_for_timeout(100)
    data=page.evaluate('''() => ({overflow:document.documentElement.scrollWidth>innerWidth,utilityNames:['My Work','Tickets','Transfer Center'].filter(v=>!!document.querySelector('[aria-label="'+v+'"]')),panelVisible:!!document.querySelector('.qa-filter-panel-v118') || !!document.querySelector('.p20-portal')})''')
    path=OUT/f'Cluster-TD3-Pass20-{kind}-{theme}-{width}.png';page.screenshot(path=str(path))
    manifest.append({'file':path.name,'kind':kind,'theme':theme,'width':width,**data})
    page.close()
 b.close()
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17)
for theme in ['dark','light']:
 out=Image.new('RGB',(1480,530),(18,23,31) if theme=='dark' else (231,234,240));d=ImageDraw.Draw(out)
 for index,kind in enumerate(['qa','board-resource-browser']):
  im=Image.open(OUT/f'Cluster-TD3-Pass20-{kind}-{theme}-1440.png').convert('RGB');im.thumbnail((726,482))
  x=8+742*index;d.text((x,4),('QA filters' if kind=='qa' else 'Board resource switcher')+' · '+theme,font=font,fill=(235,238,244) if theme=='dark' else (28,34,46))
  out.paste(im,(x,34))
 out.save(OUT/f'Cluster-TD3-Pass20-{theme}-Review-Board.png')
(OUT/'preview-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('CAPTURES',len(manifest),'OVERFLOW',sum(x['overflow'] for x in manifest),'UTILITIES',all(len(x['utilityNames'])==3 for x in manifest))
