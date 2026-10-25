#!/usr/bin/env python3
"""Source CSS cascade check without a running Cluster server.

Uses a self-contained fixture because running-app / Windows tests belong to the
separate release roadmap. No stock screenshots or external network assets.
"""
from __future__ import annotations
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print('UNAVAILABLE: Playwright is not installed; CSS browser smoke not run.')
    sys.exit(2)


def flatten(path: Path, seen: set[Path] | None = None) -> str:
    if seen is None:
        seen = set()
    path = path.resolve()
    if path in seen:
        return ''
    seen.add(path)
    data = path.read_text('utf8')
    return re.sub(r'@import\s+["\']([^"\']+)["\'];', lambda m: flatten(path.parent / m.group(1), seen), data)


STYLES = '\n'.join((
    flatten(ROOT / 'packages/renderer/src/styles.css'),
    flatten(ROOT / 'packages/renderer/src/features/application/styles/application-shell.css'),
    flatten(ROOT / 'packages/renderer/src/features/application/styles/application-controls.css'),
))

HTML = '''<!doctype html><html data-theme="dark" data-background="clean" data-card-style="glass">
<head><meta charset="utf-8"><style>''' + STYLES + '''</style></head>
<body><div id="root" class="visual-overhaul-v139 shell-unified-v3430">
<main class="content-shell" style="padding:36px;max-width:1100px;min-height:700px;margin:auto">
<section class="page" style="display:grid;gap:20px">
<h1 style="margin:0">Cluster · Appearance background</h1>
<p class="muted">Source CSS fixture · background mode is a user preference</p>
<section class="panel" style="padding:28px;max-width:700px">
<h2>Workspace surfaces</h2><p>Existing panel styles remain visible over the chosen background.</p>
<button class="cluster-button-v425 secondary" type="button">Open project</button>
<button class="cluster-button-v425 primary" type="button">Create</button>
</section></section></main></div></body></html>'''


def main():
    exe = next((p for p in ['/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser'] if Path(p).exists()), None)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=exe, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1200, 'height': 820}, device_scale_factor=1)
        page.set_content(HTML)
        results = {}
        output = ROOT / '.td3-deep-cascade-previews'
        output.mkdir(exist_ok=True)
        for theme in ['light', 'dark']:
            for mode in ['clean', 'grid', 'aurora', 'midnight']:
                page.evaluate('''([theme, mode]) => {
                    document.documentElement.dataset.theme = theme;
                    document.documentElement.dataset.background = mode;
                }''', [theme, mode])
                computed = page.evaluate('''() => ({
                    root: getComputedStyle(document.documentElement).backgroundImage,
                    body: getComputedStyle(document.body).backgroundImage,
                    workspace: getComputedStyle(document.querySelector('.content-shell')).backgroundImage,
                    panel: getComputedStyle(document.querySelector('.panel')).backgroundColor,
                })''')
                results[f'{theme}/{mode}'] = computed
                assert computed['root'] != 'none', f'{theme}/{mode} lost its background'
                assert computed['panel'] != 'rgba(0, 0, 0, 0)', f'{theme}/{mode} lost panel surface'
                if mode in ('clean', 'grid'):
                    page.screenshot(path=str(output / f'Cluster-TD3-Deep-Cascade-{theme}-{mode}.png'), full_page=True)
            # The old light-mode rule produced one identical grid for every mode.
            assert len({results[f'{theme}/{mode}']['root'] for mode in ['clean','grid','aurora','midnight']}) == 4, f'{theme} background choices collapsed'
        # The exact dark/light workspace material stays transparent by design,
        # letting the selected canvas show through the floating shell.
        assert len(results) == 8
        print(json.dumps({'scenarios': len(results), 'backgrounds_distinct': True, 'screenshots': 4}, indent=2))
        browser.close()


if __name__ == '__main__':
    main()
