#!/usr/bin/env python3
"""Reproduce Create Search geometry in both stylesheets orders; development CSS fixture only."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[2]
r=root/'packages/renderer/src'
production=(r/'styles/design-system/production-ui.css').read_text()
create=(r/'features/create/shared-create-drawer.css').read_text()
results=[]
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width,expected in ((1200,44),(700,46)):
  for label,css in (('production-to-create',production+'\n'+create),('create-to-production',create+'\n'+production)):
   page=browser.new_page(viewport={'width':width,'height':780})
   page.set_content('<style>'+css+'</style><main class="shared-create-picker-v455 shared-create-picker-v466"><div class="shared-create-search-v457 shared-create-search-v466"><svg></svg><input type="search" aria-label="Search item types" /></div></main>')
   metrics=page.locator('.shared-create-search-v457').evaluate('''el => ({ height: Number.parseFloat(getComputedStyle(el).height), minHeight:Number.parseFloat(getComputedStyle(el).minHeight), inputHeight:Number.parseFloat(getComputedStyle(el.querySelector('input')).height) })''')
   passed=metrics['height']>=expected and metrics['minHeight']>=expected and metrics['inputHeight']>=42
   results.append({'width':width,'order':label,'expectedMinimum':expected,'metrics':metrics,'passed':passed})
   page.close()
 browser.close()
(root/'TD3_R29_CREATE_SEARCH_CASCADE_EVIDENCE.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps({'scenarios':len(results),'passed':sum(row['passed'] for row in results)}))
if not all(row['passed'] for row in results):raise SystemExit(1)
