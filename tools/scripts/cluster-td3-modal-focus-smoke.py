"""Executable DOM keyboard behavior for the pure dialog-focus helper.
Does not mount React; dialog + body-portaled menu mirror the production contract.
"""
from pathlib import Path
import subprocess, tempfile
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory() as directory:
    source=root/'packages/renderer/src/core/dialog-focus.ts'
    cmd=['tsc','--strict','--target','es2022','--module','esnext','--lib','es2022,dom','--outDir',directory,str(source)]
    subprocess.run(cmd,check=True,capture_output=True,text=True)
    generated=Path(directory)/'dialog-focus.js'
    assert generated.is_file()
    js=generated.read_text().replace('export ', '')
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        page=browser.new_page()
        page.set_content('''<html><body><button id="origin">Origin</button>
            <section id="owner" role="dialog" aria-modal="true" aria-label="Edit"><button id="first">First</button><button id="last">Last</button></section>
            <div data-cluster-floating="true" data-cluster-modal-owner="owner" role="menu" aria-label="Actions"><button id="popup-first">Open</button><button id="popup-last">Delete</button></div>
            </body></html>''')
        page.add_script_tag(content=js+'\ndocument.addEventListener("keydown",trapFocusInTopClusterDialog);')
        assert page.evaluate('topVisibleClusterDialog().id')=='owner'
        assert page.evaluate('topFloatingForClusterDialog(document.querySelector("#owner")).getAttribute("role")')=='menu'
        page.focus('#popup-last');page.keyboard.press('Tab')
        assert page.evaluate('document.activeElement.id')=='popup-first','Tab must loop inside modal-owned popup'
        page.keyboard.press('Shift+Tab')
        assert page.evaluate('document.activeElement.id')=='popup-last','reverse Tab must loop inside modal-owned popup'
        # A popup attached to another dialog is not part of this dialog's focus scope.
        page.evaluate('document.querySelector("[data-cluster-floating]").dataset.clusterModalOwner="different"')
        page.focus('#last');page.keyboard.press('Tab')
        assert page.evaluate('document.activeElement.id')=='first','Tab must loop in modal when popup owner is different'
        page.keyboard.press('Shift+Tab')
        assert page.evaluate('document.activeElement.id')=='last','reverse Tab must loop in modal'
        page.evaluate('document.querySelector("[data-cluster-floating]").remove()')
        assert page.evaluate('topFloatingForClusterDialog(document.querySelector("#owner"))') is None
        print('PASS 6/6 executable DOM modal/floating keyboard scenarios')
        browser.close()
