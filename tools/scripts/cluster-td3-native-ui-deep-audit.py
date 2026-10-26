#!/usr/bin/env python3
"""Source-contract audit for the QML native shell. No Qt runtime claim."""
from pathlib import Path
import re
ROOT = Path(__file__).resolve().parents[2]
QML = ROOT / 'apps/desktop-qt/qml'
CMAKE = ROOT / 'apps/desktop-qt/CMakeLists.txt'
TESTS = []

def check(label, condition):
    TESTS.append((label, bool(condition)))
    print(('PASS' if condition else 'FAIL'), label)

files = list(QML.rglob('*.qml'))
cmake = CMAKE.read_text()
registered = set(re.findall(r'\b(qml/[\w/-]+\.qml)\b', cmake))
project_components = {file.stem: file for file in files if file.name.startswith('Cluster') or file.name in {'Surface.qml', 'UpdateDialog.qml'}}
# Ensure the relevant component definitions are actually part of the compiled Qt module.
for name, file in sorted(project_components.items()):
    check(f'Native component {name} declared in CMake', file.relative_to(QML.parent).as_posix() in registered)
# Check all project component constructor calls, including property: CustomControl { ... }.
for file in files:
    source = file.read_text()
    for name in re.findall(r'\b(Cluster\w+)\s*\{', source):
        check(f'{file.name} references an existing {name}', name in project_components)
check('Unregistered old glyph removed', not any(re.search(r'\bClusterGlyph\b', file.read_text()) for file in files))
check('Shared chevron tracks the actual native popup', 'expanded: control.popup.visible' in (QML/'components/ClusterComboBox.qml').read_text())
check('Native chevron honors reduced motion', '!Theme.reducedMotion && !Theme.noMotion' in (QML/'components/ClusterChevron.qml').read_text())
for file in files:
    if file.name in {'Theme.qml', 'ThemeTokens.qml'}:
        continue
    source = file.read_text()
    bad = [m.group(1).strip() for m in re.finditer(r'font\.pixelSize:\s*([^\n;]+)', source) if not m.group(1).strip().startswith('Theme.scaledFont(')]
    check(f'{file.name} uses shared scaled font only', not bad)
theme=(QML/'Theme.qml').read_text()
check('Native typography has a >=12px floor', bool(re.search(r'function scaledFont\(baseSize\)[\s\S]*?Math\.round\(Math\.max\(12, Number\(baseSize\)\) \* textScale\)',theme)))
surface=(QML/'components/Surface.qml').read_text()
check('High contrast uses opaque native surface', 'Theme.highContrast || Theme.reducedTransparency' in surface and 'Theme.opaqueSurface' in surface)
check('High contrast suppresses native surface gradients', 'Theme.reducedTransparency || Theme.highContrast ? null : surfaceGradient' in surface)
drop=(QML/'pages/SharedRendererPage.qml').read_text()
check('Native mobile drop hint wraps within its surface', 'width: Math.max(0, parent.width - 32)' in drop and 'wrapMode: Text.WordWrap' in drop)
# Preserve previously implemented web-shell and native capability boundaries.
qt=(QML/'pages/SharedRendererPage.qml').read_text()
check('WebView still gates native commands to approved origins', 'clusterApp.isAllowedRendererUrl' in qt)
check('Native capability pump still limits request batches', 'index < requests.length && index < 8' in qt)
# All QML files should keep balanced delimiters (after stripping plain quoted source).
for file in files:
    s=file.read_text()
    # A conservative scan, handling QML/JS comments and strings without running Qt.
    s=re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', '""',s)
    s=re.sub(r'//[^\n]*|/\*[\s\S]*?\*/','',s)
    check(f'{file.name} braces balanced', s.count('{')==s.count('}'))
print(f'\n{sum(ok for _,ok in TESTS)}/{len(TESTS)} native source contracts passed')
if not all(ok for _,ok in TESTS):
    raise SystemExit(1)
