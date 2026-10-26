from pathlib import Path
from playwright.sync_api import sync_playwright
r=Path(__file__).resolve().parents[2]
css=(r/'packages/renderer/src/features/application/styles/home-dashboard.css').read_text()+'\n'+(r/'packages/renderer/src/features/people/people.css').read_text()
h='''<html><head><style>*{box-sizing:border-box}body{margin:0;background:#181b22;color:white;font:12px sans-serif}:root{--cluster-amber-500:#d6a958;--cluster-slate-400:#8d9aaa;--cluster-compact-muted:#99a2b1;--border:#475060;--panel:#202934;--surface:#273546;--muted:#9caaba;--text:#fff;--accent:#729afa}</style><style>'''+css+'''</style></head><body><div class="command-brief-v141"><div class="command-brief-main-v141"><h2>Studio overview</h2><p>Attention items</p></div><div class="command-brief-stats-v141"><button>Jobs</button><button>Updates</button><button>People</button><button>Deadlines</button></div><div class="command-brief-actions-v141"><button>Go to work</button></div></div><div style="width:100%;max-width:420px;"><div class="people-detail-tabs-v244"><button>Overview</button><button>Work</button><button>Calendar</button><button>Access</button><button>Records</button><button>Activity</button><button>Full profile</button></div></div></body></html>'''
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 for w,expected in [(390,1),(800,1),(1060,2),(1440,3)]:
  page=browser.new_page(viewport={'width':w,'height':850});page.set_content(h)
  v=page.evaluate('''()=>({columns:getComputedStyle(document.querySelector('.command-brief-v141')).gridTemplateColumns.split(' ').length,scroll:document.documentElement.scrollWidth,tabFlex:getComputedStyle(document.querySelector('.people-detail-tabs-v244')).flexWrap,tabScroll:document.querySelector('.people-detail-tabs-v244').scrollWidth,tabClient:document.querySelector('.people-detail-tabs-v244').clientWidth})''')
  assert v['columns']==expected,(w,v,expected)
  assert v['scroll']<=w+1,(w,v)
  if w<=760: assert v['tabFlex']=='nowrap' and v['tabScroll']>=v['tabClient'],(w,v)
  print('PASS',w,'px',v)
  page.close()
 browser.close()
