"""Source-CSS UI fixtures for the TD3 admin action pass. NOT mounted React."""
from pathlib import Path
import re,json
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont
root=Path(__file__).resolve().parents[2]
out=root/'.td3-pass24-previews';out.mkdir(exist_ok=True)
visited=set()
def css(p):
 p=p.resolve()
 if p in visited or not p.exists():return ''
 visited.add(p)
 text=p.read_text(encoding='utf8')
 return re.sub(r'@import\s+["\']([^"\'\n]+)["\']\s*;',lambda m:css(p.parent/m.group(1)),text)
html=(root/'tools/fixtures/td3-pass7-workspace.html').read_text()
html=html.replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+css(root/'packages/renderer/src/styles.css').replace('</style','')+'</style>')
html=html.replace('</head>','<style>'+css(root/'packages/renderer/src/features/admin/admin-workflows.css').replace('</style','')+'</style></head>')
local='''
.td5-demo.app-shell.shell-unified-v3430{display:grid!important;grid-template-columns:236px minmax(0,1fr)!important;min-height:100dvh!important}
.td5-demo .content-shell{height:100dvh!important;overflow-y:auto!important;overflow-x:hidden!important}
.td5-demo .td5-workspace{max-width:1460px!important;padding:23px 28px!important}
.p24-shell{display:grid;gap:16px;margin-top:15px;color:var(--td-text)}.p24-overline{font-size:10px;letter-spacing:.09em;color:var(--td-muted);font-weight:700;text-transform:uppercase}
.p24-head{display:flex;justify-content:space-between;align-items:start;gap:14px}.p24-head h1{font-size:26px;margin:6px 0 6px;font-weight:680}.p24-head p{color:var(--td-muted);font-size:12px;line-height:1.65;margin:0;max-width:650px}
.p24-actions{display:flex;gap:9px;flex-wrap:wrap}.p24-actions button,.p24-button{font-size:12px;border:1px solid var(--td-border);color:var(--td-text);background:var(--td-panel-2);padding:10px 14px;border-radius:9px}
.p24-button.primary{background:#628aff;color:#fff;border-color:#628aff}.p24-button:disabled{opacity:.6;cursor:wait}
.p24-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px}.p24-metrics>article{border:1px solid var(--td-border);border-radius:13px;padding:14px;background:var(--td-panel);box-shadow:0 3px 15px #0001}.p24-metrics strong{font-size:24px;display:block;margin-top:8px}.p24-metrics small{font-size:10px;color:var(--td-muted)}
.p24-grid{display:grid;grid-template-columns:1.12fr .88fr;gap:13px;min-width:0}.p24-card{border:1px solid var(--td-border);border-radius:14px;background:var(--td-panel);padding:16px;min-width:0;box-shadow:0 6px 25px #0001}.p24-card h2{font-size:15px;margin:0 0 6px}.p24-card p{font-size:11px;line-height:1.5;color:var(--td-muted);margin:0 0 13px}
.p24-incident{padding:11px;border-radius:9px;border:1px solid var(--td-border);background:var(--td-panel-2);margin-top:8px;display:grid;gap:6px}.p24-incident.active{border-color:#7aa3ec}.p24-incident strong{font-size:12px}.p24-incident small{color:var(--td-muted);font-size:10px}
.p24-badge{display:inline-flex;align-items:center;gap:6px;color:#8bd9b1;font-size:11px;font-weight:650}.p24-badge:before{content:'';width:7px;height:7px;border-radius:100%;background:currentColor}
.p24-field{display:grid;gap:6px;min-width:0;font-size:11px;color:var(--td-muted);margin:9px 0}.p24-field input,.p24-field textarea,.p24-field select{min-width:0;width:100%;padding:10px 12px;background:var(--td-panel-2);border:1px solid var(--td-border);border-radius:8px;color:var(--td-text);font:inherit;font-size:12px}.p24-field textarea{min-height:65px}
.p24-feedback{border:1px solid color-mix(in srgb,#8bd9b1 40%,var(--td-border));background:color-mix(in srgb,#8bd9b1 10%,var(--td-panel));padding:12px 14px;border-radius:10px;font-size:12px;color:var(--td-text)}
.p24-checks{display:grid;gap:8px}.p24-check{display:flex;justify-content:space-between;align-items:center;gap:12px;border:1px solid var(--td-border);border-radius:10px;background:var(--td-panel-2);padding:12px}.p24-check b{font-size:12px}.p24-check small{display:block;margin-top:4px;color:var(--td-muted);font-size:10px}
.p24-preview-list{display:grid;gap:9px}.p24-diff{display:flex;justify-content:space-between;align-items:center;gap:8px;border-bottom:1px solid var(--td-border);padding:8px 0;font-size:12px}.p24-diff small{color:var(--td-muted);font-size:11px}
.p24-details{color:var(--td-muted);font-size:11px;line-height:1.6}
@media(max-width:900px){.td5-demo.app-shell.shell-unified-v3430{display:block!important}.td5-demo .content-shell{height:100dvh!important;width:100%!important}.td5-demo .td5-workspace{padding:18px!important}.p24-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.p24-grid{grid-template-columns:minmax(0,1fr)}.p24-head h1{font-size:23px}}
@media(max-width:500px){.p24-head{display:grid}.p24-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.p24-card{padding:13px}}
'''
incident='''<section class="p24-shell operations-incidents-v510"><header class="p24-head"><div><div class="p24-overline">Operations 2.0 / Incident center</div><h1>Incidents &amp; health</h1><p>Review operational events, investigate affected resources, and record durable incident evidence.</p></div><button class="p24-button">Refresh</button></header><div class="p24-metrics"><article><small>System health</small><strong>Healthy</strong></article><article><small>Open incidents</small><strong>3</strong></article><article><small>Critical</small><strong>1</strong></article><article><small>Health checks</small><strong>18</strong></article></div><div class="p24-grid"><section class="p24-card"><h2>Incident queue</h2><p>All active issues and recent investigation activity</p><article class="p24-incident active"><span class="p24-badge" style="color:#f0b582">High severity</span><strong>Build artifacts failing verification</strong><small>Investigating · Owner Alex Lin · 12 minutes ago</small></article><article class="p24-incident"><strong>Storage provider responding slowly</strong><small>Monitoring · Owner Morgan Chen</small></article><article class="p24-incident"><strong>Worker reconnect failures</strong><small>Open · Owner Riley Shaw</small></article></section><section class="p24-card"><h2>Investigation</h2><p>Build artifacts failing verification · Investigating</p><div class="p24-incident"><strong>Evidence</strong><small>Build #421 checksum mismatch in project Orion</small></div><label class="p24-field">Investigation note<textarea>Verified hashes. Re-running integrity checks.</textarea></label><div class="p24-actions"><button class="p24-button primary" disabled aria-busy="true">Saving note…</button><button class="p24-button" disabled>Resolve</button></div></section></div><p class="p24-feedback" role="status">Incident status updated. Changes saved to the investigation timeline.</p></section>'''
setup='''<section class="p24-shell admin-setup-checklist-v506"><header class="p24-head"><div><div class="p24-overline">Studio settings / Setup</div><h1>Studio setup</h1><p>Review required configuration and import only safe studio defaults. Server and security settings remain separate.</p></div><button class="p24-button">Refresh</button></header><div class="p24-metrics"><article><small>Configured</small><strong>5 / 7</strong></article><article><small>Recommended</small><strong>2</strong></article><article><small>Server status</small><strong>Ready</strong></article><article><small>Configuration</small><strong>Rev 24</strong></article></div><div class="p24-grid"><section class="p24-card"><h2>Setup checklist</h2><p>Live server status rather than manually checked boxes</p><div class="p24-checks"><div class="p24-check"><span><b>Studio identity</b><small>Configured</small></span><span class="p24-badge">Ready</span></div><div class="p24-check"><span><b>Administrator security</b><small>Configured</small></span><span class="p24-badge">Ready</span></div><div class="p24-check"><span><b>Second administrator</b><small>Recommended</small></span><button class="p24-button">Configure</button></div><div class="p24-check"><span><b>Backup destination</b><small>Recommended</small></span><button class="p24-button">Configure</button></div></div></section><section class="p24-card admin-config-import-v506"><h2>Import studio defaults</h2><p>Server-validated change preview. A configuration cannot be applied twice while its request is pending.</p><div class="p24-preview-list"><div class="p24-diff"><strong>Studio timezone</strong><small>UTC → America/New_York</small></div><div class="p24-diff"><strong>Starter Board</strong><small>Off → On</small></div><div class="p24-diff"><strong>Starter Library folder</strong><small>Off → On</small></div></div><p class="p24-details" style="margin-top:14px">Only listed settings will change. Changes made by another administrator invalidate the preview.</p><div class="p24-actions"><button class="p24-button">Preview changes</button><button class="p24-button primary" disabled aria-busy="true">Applying…</button></div></section></div><p class="p24-feedback" role="status">Changes are reviewed before applying. A new action cannot begin while another is pending.</p></section>'''
manifest=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 for theme in ('dark','light'):
  for view,markup in (('operations',incident),('setup',setup)):
   for w,h in ((1440,900),(390,844)):
    page=browser.new_page(viewport={'width':w,'height':h},device_scale_factor=1)
    page.set_content(html,wait_until='domcontentloaded')
    page.add_style_tag(content=local)
    page.evaluate('''({theme,view,markup})=>{document.documentElement.dataset.theme=theme;document.querySelector('.td5-workspace').innerHTML='<div class="td5-breadcrumb">Studio › '+(view==='operations'?'Operations':'Admin › Setup')+'</div>'+markup;document.querySelectorAll('.td7-menu').forEach(x=>x.remove());}''',{'theme':theme,'view':view,'markup':markup})
    page.wait_for_timeout(90)
    checks=page.evaluate('''()=>({overflow:document.documentElement.scrollWidth>innerWidth,visibleActions:!!document.querySelector('[aria-busy="true"]'),shellUtilities:['My Work','Tickets','Transfer Center'].every(s=>!!document.querySelector('[aria-label="'+s+'"]'))})''')
    if not checks['visibleActions'] or checks['overflow'] or not checks['shellUtilities']:raise RuntimeError((theme,view,w,checks))
    name=f'Cluster-TD3-Pass24-{view}-{theme}-{w}.png';page.screenshot(path=str(out/name));manifest.append({'name':name,'theme':theme,'view':view,'width':w,**checks});page.close()
 browser.close()
try:font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',19)
except:font=ImageFont.load_default()
for theme in ('dark','light'):
 board=Image.new('RGB',(1570,1840),(23,28,37) if theme=='dark' else (234,238,244));draw=ImageDraw.Draw(board)
 draw.text((18,12),f'CLUSTER · TD3 Pass 24 · Operations / Setup · {theme.title()} theme · illustrative fixture',font=font,fill='#e8edf6' if theme=='dark' else '#273447')
 for i,view in enumerate(('operations','setup')):
  wide=Image.open(out/f'Cluster-TD3-Pass24-{view}-{theme}-1440.png').convert('RGB');wide.thumbnail((1140,840))
  phone=Image.open(out/f'Cluster-TD3-Pass24-{view}-{theme}-390.png').convert('RGB');phone.thumbnail((350,840))
  y=56+i*890;board.paste(wide,(5,y));board.paste(phone,(1180,y))
 board.save(out/f'Cluster-TD3-Pass24-{theme}-Preview-Board.png')
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('TD3 P24 UI fixture layouts',len(manifest),'checked')
