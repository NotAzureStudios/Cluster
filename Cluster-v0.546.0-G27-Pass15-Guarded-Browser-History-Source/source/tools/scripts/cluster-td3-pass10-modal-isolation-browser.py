"""Exercise actual production modal sibling-isolation helper in Chromium, without React mounting."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import subprocess
root=Path(__file__).resolve().parents[2]
code=(root/'packages/renderer/src/components/AccessibilityManager.tsx').read_text()
source=code[code.index('function isolateModal(dialog: HTMLElement) {'):code.index('/** The background floating stack')]
script=subprocess.run(['node','-e', '''const fs=require('fs'),ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');process.stdout.write(ts.transpileModule(fs.readFileSync(0,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)'''],input=source,text=True,capture_output=True,check=True).stdout
checks=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page()
 page.set_content('''<div id="app"><button id="opener">Open</button><aside id="cluster-sidebar" role="dialog" aria-modal="true"><button id="close">Close</button></aside><div id="backdrop" data-cluster-backdrop-for="cluster-sidebar" aria-hidden="true" role="presentation"></div><main id="main"><button>Background</button></main><div id="existing" inert aria-hidden="false"></div></div>''')
 page.evaluate('''code => { (new Function(code + '; window.isolateModal = isolateModal'))() }''',script)
 def check(title,expression):
  value=page.evaluate(expression)
  assert value, f'{title}: {value}'
  checks.append(title);print('PASS',title,flush=True)
 page.evaluate('''() => window.isolation = isolateModal(document.querySelector('#cluster-sidebar'))''')
 check('main content becomes inert','''() => document.querySelector('#main').inert''')
 check('launcher becomes inert while drawer is open','''() => document.querySelector('#opener').inert''')
 check('matching pointer backdrop remains usable','''() => !document.querySelector('#backdrop').inert && document.querySelector('#backdrop').getAttribute('aria-hidden') === 'true' ''')
 check('existing aria and inert preserved during isolation','''() => document.querySelector('#existing').inert && document.querySelector('#existing').getAttribute('aria-hidden') === 'true' ''')
 page.evaluate('''() => {let late=document.createElement('div');late.id='late-panel';late.innerHTML='<button>Late action</button>';document.querySelector('#app').appendChild(late);isolation.sync()}''')
 check('late mounted background cannot bypass modality','''() => document.querySelector('#late-panel').inert && document.querySelector('#late-panel').getAttribute('aria-hidden') === 'true' ''')
 page.evaluate('''() => {const child=document.createElement('div');child.id='late-nested';document.querySelector('#app').appendChild(child);isolation.sync();isolation.sync()}''')
 check('repeated isolation sync is idempotent','''() => document.querySelector('#late-nested').inert''')
 page.evaluate('''() => isolation.dispose()''')
 check('original launcher and background restored','''() => !document.querySelector('#opener').inert && !document.querySelector('#main').inert && document.querySelector('#main').getAttribute('aria-hidden') === null''')
 check('pre-existing inert state restored','''() => document.querySelector('#existing').inert && document.querySelector('#existing').getAttribute('aria-hidden') === 'false' ''')
 check('late-mounted content restored','''() => !document.querySelector('#late-panel').inert && document.querySelector('#late-panel').getAttribute('aria-hidden') === null''')
 b.close()
print(f'{len(checks)}/{len(checks)} production modal isolation browser cases passed')
