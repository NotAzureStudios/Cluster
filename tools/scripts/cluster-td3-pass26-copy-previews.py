"""Representative Cluster production-CSS fixture of copy feedback, NOT mounted React."""
from pathlib import Path
import re, json
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont
root = Path(__file__).resolve().parents[2]
out = root / '.td3-pass26-previews'; out.mkdir(exist_ok=True)
seen=set()
def css(file):
    file=file.resolve()
    if file in seen: return ''
    seen.add(file)
    return re.sub(r'@import\s+["\']([^"\'\n]+)["\']\s*;', lambda m: css(file.parent/m.group(1)),file.read_text())
html=(root/'tools/fixtures/td3-pass7-workspace.html').read_text().replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+css(root/'packages/renderer/src/styles.css').replace('</style','')+'</style>')
copycss=(root/'packages/renderer/src/components/cluster-copy-button.css').read_text()
extra='''
.td5-demo.app-shell.shell-unified-v3430{display:grid!important;grid-template-columns:232px minmax(0,1fr)!important;min-height:100dvh!important}
.td5-demo .content-shell{height:100dvh!important;overflow-y:auto!important}
.td5-demo .td5-workspace{max-width:1490px!important;padding:28px!important}
.td5-demo .taskbar-unified-v3430{display:grid!important;grid-template-columns:auto minmax(0,1fr) auto!important;align-items:center!important;min-height:58px!important}
.p26-header{margin:16px 0 28px;max-width:1000px}.p26-header h1{font-size:27px;margin:0 0 8px}.p26-header p{font-size:13px;margin:0;opacity:.75}
.p26-split{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,.95fr);gap:20px;max-width:1100px}
.p26-panel{background:var(--td-panel, var(--panel));color:var(--td-text,var(--text));border:1px solid var(--td-border,var(--border));border-radius:16px;padding:22px;box-shadow:0 9px 27px #0001;min-width:0}
.p26-panel h2{font-size:17px;margin:0 0 8px}.p26-panel p{font-size:12px;line-height:1.6;opacity:.75;margin:0 0 17px}
.p26-profile{display:flex;align-items:center;gap:15px;padding:17px;background:var(--td-panel-2,var(--surface));border-radius:12px;margin:0 0 18px}
.p26-avatar{height:56px;width:56px;border-radius:13px;border:3px solid #7a97db;display:grid;place-items:center;font-size:18px;font-weight:600;position:relative;background:var(--td-panel,var(--panel))}
.p26-avatar:after{content:'';height:10px;width:10px;border-radius:50%;background:#6fd29f;position:absolute;bottom:-4px;right:-4px;border:2px solid var(--td-panel,var(--panel))}
.p26-profile strong{display:block;font-size:17px}.p26-profile small{font-size:12px;opacity:.75}
.p26-field{display:grid;gap:7px;padding:12px 15px;border:1px solid var(--td-border,var(--border));border-radius:10px;background:var(--td-panel-2,var(--surface));margin-bottom:15px}
.p26-field code{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}.p26-field span{font-size:11px;opacity:.68}
.p26-actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.p26-actions .cluster-copy-control-v546{gap:8px}
.p26-actions .cluster-copy-feedback-v546{max-width:240px;opacity:1;font-weight:500}
.p26-banner{margin-top:20px;border:1px solid var(--td-border,var(--border));border-radius:12px;padding:15px 18px;background:var(--td-panel-2,var(--surface));font-size:12px;max-width:1100px}
@media(max-width:850px){.td5-demo.app-shell.shell-unified-v3430{display:block!important}.td5-demo .content-shell{width:100%!important}.td5-demo .td5-workspace{padding:12px!important}.p26-split{grid-template-columns:1fr}.p26-header h1{font-size:22px}}
''' + copycss
page_markup='''<div class="td5-breadcrumb">Studio › Interface › People &amp; Security</div>
<div class="p26-header"><h1>Copy actions &amp; identity</h1><p>Canonical action feedback preserves People identity styling and sensitive credential workflows.</p></div>
<div class="p26-split">
<section class="p26-panel"><h2>People · Profile quick card</h2><p>Account identity, separate presence indicator, and contact actions.</p>
<div class="p26-profile"><div class="p26-avatar">AL</div><div><strong>Alex Lin</strong><small>Creative Director · Design<br>Available</small></div></div>
<div class="p26-field"><span>Discord</span><strong>@alex-design</strong></div>
<div class="p26-actions"><span class="cluster-copy-control-v546"><button class="cluster-button-v425 secondary">Copy Discord</button><span class="cluster-copy-feedback-v546 copied" role="status">Discord copied</span></span></div></section>
<section class="p26-panel"><h2>Security · Recovery codes</h2><p>One-time codes must never produce false success feedback.</p>
<div class="p26-field"><span>Example placeholder codes, not real credentials</span><code>XXXX-XXXX-XXXX<br>YYYY-YYYY-YYYY</code></div>
<div class="p26-actions"><span class="cluster-copy-control-v546"><button class="cluster-button-v425 secondary">Copy recovery codes</button><span class="cluster-copy-feedback-v546 failed" role="alert">Couldn't copy. Select the value and copy it manually.</span></span></div></section></div>
<div class="p26-banner">Transfer Center · My Work · Tickets and floating/full-width taskbar layout remain separate from this shared control update.</div>'''
manifest=[]
with sync_playwright() as play:
    browser=play.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for theme in ('dark','light'):
        for width,height in ((1440,900),(390,844)):
            page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
            page.set_content(html,wait_until='domcontentloaded')
            page.add_style_tag(content=extra)
            page.evaluate('''({theme,markup})=>{document.documentElement.dataset.theme=theme;document.querySelector('.td5-workspace').innerHTML=markup;}''',{'theme':theme,'markup':page_markup})
            page.wait_for_timeout(100)
            checks=page.evaluate('''()=>({overflow:document.documentElement.scrollWidth>innerWidth, copies:document.querySelectorAll('.cluster-copy-control-v546').length, presence:!!document.querySelector('.p26-avatar'), error:!!document.querySelector('.cluster-copy-feedback-v546[role=alert]')})''')
            assert not checks['overflow'] and checks['copies']==2 and checks['presence'] and checks['error'], checks
            path=out/f'Cluster-TD3-Pass26-copy-{theme}-{width}.png';page.screenshot(path=str(path))
            manifest.append({'file':path.name,'theme':theme,'width':width,**checks})
            page.close()
    browser.close()
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',20)
for theme in ('dark','light'):
    canvas=Image.new('RGB',(1540,970),(24,27,35) if theme=='dark' else (233,237,242))
    desktop=Image.open(out/f'Cluster-TD3-Pass26-copy-{theme}-1440.png').convert('RGB');desktop.thumbnail((1140,880));canvas.paste(desktop,(10,50))
    phone=Image.open(out/f'Cluster-TD3-Pass26-copy-{theme}-390.png').convert('RGB');phone.thumbnail((335,860))
    canvas.paste(phone,(1194,80))
    ImageDraw.Draw(canvas).text((15,10),f'Cluster TD3 Pass 26 · Source-CSS fixture · {theme} · Not mounted React',font=font,fill='#eef2f8' if theme=='dark' else '#1e2632')
    canvas.save(out/f'Cluster-TD3-Pass26-{theme}-Preview-Board.png')
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('PASS26 preview scenarios',len(manifest))
