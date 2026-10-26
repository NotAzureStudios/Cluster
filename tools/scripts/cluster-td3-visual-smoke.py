from pathlib import Path
import re,json,os
from playwright.sync_api import sync_playwright
# Optional visual fixture runner; requires Python Playwright and a locally installed Chromium.
root=Path(__file__).resolve().parents[2]
output=Path(os.environ.get('CLUSTER_VISUAL_OUTPUT_DIR', str(root / '.td3-visual-output')))
output.mkdir(parents=True,exist_ok=True)
imports=[]
def flatten(p,depth=0):
 if depth>16: raise RuntimeError('CSS import recursion')
 css=p.read_text()
 def replace(match):
  file=match.group(1)
  if '://' in file:return '/* external stylesheet suppressed */'
  ref=(p.parent/file).resolve()
  if not ref.is_relative_to(root) or not ref.is_file():raise RuntimeError(f'Invalid CSS import {file} in {p}')
  imports.append(ref.relative_to(root).as_posix())
  return '\n'+flatten(ref,depth+1)+'\n'
 css=re.sub(r'@import\s+(?:url\()?\s*["\']([^"\']+)["\']\)?\s*;',replace,css)
 css=re.sub(r'@import\s+url\(["\']?https?://[^;]+;', '/* remote stylesheet unavailable offline */',css)
 return css
css=flatten(root/'packages/renderer/src/styles.css')+'\n'+flatten(root/'packages/renderer/src/styles/visual-system.css')
source=(root/'tools/fixtures/td3-controls-visual-smoke.html').read_text()
html=re.sub(r'<link rel="stylesheet"[^>]+/>',lambda _:'<style>'+css.replace('</style>','')+'</style>',source)
reports=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 for label,mode,width,height in [('dark-desktop','dark',1440,1000),('light-desktop','light',1440,1000),('dark-mobile','dark',390,1080),('light-mobile','light',390,1080)]:
  page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
  page.set_content(html,wait_until='domcontentloaded')
  page.evaluate('(mode) => document.documentElement.dataset.theme = mode',mode)
  page.wait_for_timeout(85)
  result=page.evaluate('''() => {
    const css=(selector)=>getComputedStyle(document.querySelector(selector));
    const rect=(selector)=>document.querySelector(selector).getBoundingClientRect();
    const px=value=>parseFloat(value);
    return {
      bodyScrollWidth:document.body.scrollWidth,viewportWidth:innerWidth,
      buttonFontPx:px(css('#primary-action').fontSize),
      buttonHeightPx:rect('#primary-action').height,
      menuNameFontPx:px(css('.cluster-action-menu-entry-v428 strong').fontSize),
      menuDescriptionFontPx:px(css('.cluster-action-menu-entry-v428 small').fontSize),
      optionFontPx:px(css('.cluster-select-option-v370').fontSize),
      optionHeightPx:rect('.cluster-select-option-v370').height,
      selectMetadataWidthPx:rect('.cluster-select-trigger-v227 > em').width,
      focusedRingColor:css('#primary-action').outlineColor,
      computedBackground:css('.fixture-card').backgroundColor,
      surfaceTexture:css('.fixture-card').backgroundImage,
      surfaceElevation:css('.fixture-card').boxShadow
    };
  }''')
  assert 'gradient' in result['surfaceTexture'], f'{label}: missing outlined surface material: {result}'
  assert result['surfaceElevation']!='none', f'{label}: missing material elevation: {result}'
  assert result['bodyScrollWidth']<=width,f'{label}: horizontal overflow: {result}'
  assert result['buttonFontPx']>=13,f'{label}: unreadably small button: {result}'
  assert result['menuNameFontPx']>=13 and result['optionFontPx']>=13,f'{label}: small menu primary text: {result}'
  assert result['menuDescriptionFontPx']>=12,f'{label}: small description: {result}'
  assert result['optionHeightPx']>=39.5,f'{label}: small option hit target: {result}'
  assert result['selectMetadataWidthPx']>=15,f'{label}: clipped metadata: {result}'
  page.keyboard.press('Tab')
  # Browsers can move focus to a heading/other link depending on active order; explicitly use keyboard :focus-visible.
  page.focus('#primary-action')
  visible=page.evaluate("() => document.querySelector('#primary-action').matches(':focus-visible')")
  if visible:
   outline=page.evaluate("() => parseFloat(getComputedStyle(document.querySelector('#primary-action')).outlineWidth)")
   assert outline>=2, f'{label}: insufficient focus outline {outline}px'
   result["focusOutlinePx"]=outline
  filename=f'Cluster-v0.546-TD3-Pass2-Controls-{label}-visual-smoke.png'
  page.screenshot(path=str(output/filename),full_page=True)
  result.update({'fixtureOnly':True,'mode':mode,'viewport':f'{width}x{height}','keyboardFocusVisible':visible,'screenshot':filename})
  reports.append(result)
  print(label,result,flush=True)
  page.close()
 browser.close()
report={'fixture':'tools/fixtures/td3-controls-visual-smoke.html','sourceStylesheet':'packages/renderer/src/styles.css','engine':'system Chromium headless','importedStylesheets':len(imports),'desktopAndMobile':reports,'note':'Static HTML fixture using production CSS, not an application render or interaction-runtime certification. External fonts disabled.'}
(root/'TD3_PASS2_CHROMIUM_VISUAL_METRICS.json').write_text(json.dumps(report,indent=2)+'\n')
