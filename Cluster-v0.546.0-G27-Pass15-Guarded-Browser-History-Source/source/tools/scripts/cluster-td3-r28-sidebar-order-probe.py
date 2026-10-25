#!/usr/bin/env python3
"""Prove sidebar touch-target sizing is independent of CSS chunk import order.
Source Chromium fixture, not authenticated app or Windows certification.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[2]
p=root/'packages/renderer/src/features/shell'
sidebar=(p/'sidebar.css').read_text()
shell=(p/'shell.css').read_text()
results=[]
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width,expected in ((1200,'38px'),(700,'44px')):
  for ordering,css in (('sidebar-then-shell',sidebar+'\n'+shell),('shell-then-sidebar',shell+'\n'+sidebar)):
   page=browser.new_page(viewport={'width':width,'height':800})
   page.set_content('<style>'+css+'</style><aside id="cluster-sidebar" class="cluster-sidebar"><nav class="cluster-sidebar__nav"><button class="cluster-sidebar__link">Projects</button></nav></aside>')
   actual=page.locator('.cluster-sidebar__link').evaluate('(e)=>getComputedStyle(e).minHeight')
   results.append({'viewportWidth':width,'importOrder':ordering,'minHeight':actual,'expected':expected,'passed':actual==expected})
   page.close()
 browser.close()
assert all(x['passed'] for x in results),results
(root/'TD3_R28_SIDEBAR_CSS_EVIDENCE.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps({'scenarios':len(results),'passed':sum(x['passed'] for x in results),'desktopMinimum':'38px','mobileMinimum':'44px'}))
