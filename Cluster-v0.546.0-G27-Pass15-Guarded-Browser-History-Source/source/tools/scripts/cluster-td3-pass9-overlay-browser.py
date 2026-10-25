"""Chromium execution of transpiled production DOM helpers, NOT a React mount."""
from pathlib import Path
import subprocess,json,os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'.td3-pass9-preview-output';OUT.mkdir(exist_ok=True)
focus=(ROOT/'packages/renderer/src/core/dialog-focus.ts').read_text()
manager=(ROOT/'packages/renderer/src/components/AccessibilityManager.tsx').read_text()
subset=manager[manager.index('function createFloatingLayerIsolation()'):manager.index('function syncSystemAccessibilityPreferences()')]
# Transpile the actual pure source helpers, rather than implementing copies in the tests.
compiler='''const fs=require('fs'), ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript'); const source=fs.readFileSync(0,'utf8');process.stdout.write(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);'''
def transpile(src):
 result=subprocess.run(['node','-e',compiler],input=src,text=True,capture_output=True,check=True)
 return result.stdout
helpers=transpile(focus).replace('"use strict";', '"use strict";')
isolation=transpile(subset)
html='''<!doctype html><html><head><style>
body{margin:0;font-family:system-ui;background:#191c24;color:#eee}.shell{padding:20px}.button{padding:10px;border-radius:8px}
[aria-modal="true"]{position:relative;padding:22px;width:440px;border:2px solid #6872ac;background:#333a50}
[data-cluster-floating="true"]{position:relative;width:220px;padding:12px;background:#343d52;border:1px solid #7d85a0;margin:12px}
[data-cluster-modal-suspended="true"]{visibility:hidden!important;pointer-events:none!important}
</style></head><body><div class="shell"><button class="button" id="background-control">Background</button></div></body></html>'''
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1120,'height':760})
 page.set_content(html)
 page.evaluate('''code=>{const exports={};(new Function('exports',code))(exports);window.clusterHelpers=exports}''',helpers)
 page.evaluate('''code=>{(new Function(code+';window.createFloatingLayerIsolation=createFloatingLayerIsolation'))()}''',isolation)
 def check(name,func):
  outcome=page.evaluate(func)
  assert outcome,name+' '+str(outcome)
  print('PASS',name,flush=True)
 check('owner resolution works through direct modal ancestry', '''()=>{const d=document.createElement('section');d.id='modalA';d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');d.innerHTML='<button id="modal-btn">Open</button>';document.body.appendChild(d);return clusterHelpers.resolveClusterModalOwner(d.querySelector('button'))===d}''')
 check('nested portaled anchor inherits modal owner', '''()=>{const a=document.createElement('div');a.dataset.clusterFloating='true';a.dataset.clusterModalOwner='modalA';a.innerHTML='<button id="nested-btn">Nested</button>';document.body.appendChild(a);return clusterHelpers.resolveClusterModalOwner(a.firstElementChild)?.id==='modalA'}''')
 check('invalid modal IDs cannot be forged', '''()=>{const a=document.createElement('div');a.dataset.clusterFloating='true';a.dataset.clusterModalOwner='missing';a.innerHTML='<button>Unknown</button>';document.body.appendChild(a);return clusterHelpers.resolveClusterModalOwner(a.firstElementChild)===null}''')
 check('modal floating layer is the active topmost owned surface', '''()=>clusterHelpers.topFloatingForClusterDialog(document.getElementById('modalA'))?.querySelector('button')?.id==='nested-btn' ''')
 check('background layer suspends on modal opening', '''()=>{const b=document.createElement('div');b.dataset.clusterFloating='true';b.id='oldmenu';b.setAttribute('aria-hidden','false');b.innerHTML='<button>Old action</button>';document.body.appendChild(b);window.layer=window.createFloatingLayerIsolation();layer.sync(document.getElementById('modalA'));return b.hasAttribute('inert')&&b.dataset.clusterModalSuspended==='true'&&b.getAttribute('aria-hidden')==='true'}''')
 check('active-owned layer remains focusable', '''()=>!document.querySelector('[data-cluster-modal-owner="modalA"]').hasAttribute('inert')''')
 check('background layer absent from active Escape stack', '''()=>!clusterHelpers.visibleClusterFloatingSurfaces().some(x=>x.id==='oldmenu')''')
 check('in-modal dropdown inserted late remains available', '''()=>{const menu=document.createElement('div');menu.dataset.clusterFloating='true';menu.dataset.clusterModalOwner='modalA';menu.id='late';menu.innerHTML='<button>Choose</button>';document.body.appendChild(menu);layer.sync(document.getElementById('modalA'));return !menu.hasAttribute('inert')&&clusterHelpers.topFloatingForClusterDialog(document.getElementById('modalA'))===menu}''')
 check('new background floating layer also suspends', '''()=>{const b=document.createElement('div');b.dataset.clusterFloating='true';b.id='late-background';document.body.appendChild(b);layer.sync(document.getElementById('modalA'));return b.hasAttribute('inert')&&b.dataset.clusterModalSuspended==='true'}''')
 check('next modal owns only its own popup', '''()=>{const d=document.createElement('section');d.id='modalB';d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');d.innerHTML='<button>New dialog</button>';document.body.appendChild(d);const menu=document.createElement('div');menu.dataset.clusterFloating='true';menu.dataset.clusterModalOwner='modalB';menu.id='B-popup';menu.innerHTML='<button>B action</button>';document.body.appendChild(menu);layer.sync(d);return menu.hasAttribute('inert')===false&&document.getElementById('late').hasAttribute('inert')}''')
 check('original aria-hidden is restored after closing dialog', '''()=>{document.getElementById('modalA').remove();document.getElementById('modalB').remove();layer.sync(null);const m=document.getElementById('oldmenu');return !m.hasAttribute('inert')&&m.getAttribute('aria-hidden')==='false'&&!m.hasAttribute('data-cluster-modal-suspended')}''')
 check('previously inert layer stays inert after release', '''()=>{const a=document.createElement('div');a.id='already-inert';a.dataset.clusterFloating='true';a.setAttribute('inert','');document.body.appendChild(a);const d=document.createElement('section');d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');d.id='modalC';document.body.appendChild(d);layer.sync(d);layer.sync(null);return a.hasAttribute('inert')}''')
 check('cleanup reverts suspended surface', '''()=>{layer.sync(document.getElementById('modalC'));layer.dispose();return !document.getElementById('oldmenu').hasAttribute('inert')&&!document.getElementById('oldmenu').hasAttribute('data-cluster-modal-suspended')}''')
 check('Tab trap wraps within active owned floating surface', '''()=>{document.getElementById('modalC').remove();const d=document.createElement('section');d.id='modalD';d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');document.body.appendChild(d);const f=document.createElement('div');f.dataset.clusterFloating='true';f.dataset.clusterModalOwner='modalD';f.innerHTML='<button id="tab1">First</button><button id="tab2">Second</button>';document.body.appendChild(f);document.getElementById('tab2').focus();const e=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});clusterHelpers.trapFocusInTopClusterDialog(e);return e.defaultPrevented&&document.activeElement.id==='tab1'}''')
 check('reverse Tab wraps to last', '''()=>{document.getElementById('tab1').focus();const e=new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true});clusterHelpers.trapFocusInTopClusterDialog(e);return e.defaultPrevented&&document.activeElement.id==='tab2'}''')
 browser.close()
print('15/15 production DOM helper browser scenarios passed')
