import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const qml = readFileSync(new URL("../../apps/desktop-qt/qml/pages/SharedRendererPage.qml", import.meta.url), "utf8");
assert.match(qml, /property int nativeCapabilityPollInterval: 100/);
assert.match(qml, /property int emptyCapabilityPollCount: 0/);
assert.match(qml, /if \(requests\.length\)/);
assert.match(qml, /root\.emptyCapabilityPollCount >= 6/);
assert.match(qml, /root\.nativeCapabilityPollInterval = 300/);
assert.match(qml, /interval: Qt\.application\.state === Qt\.ApplicationActive \? root\.nativeCapabilityPollInterval : 1000/);
assert.match(qml, /interval: Qt\.application\.state === Qt\.ApplicationActive \? 10000 : 30000/);
assert.match(qml, /running: root\.rendererReady/);
assert.match(qml, /clusterApp\.nativeCapabilities\.processRequestJson/);
assert.match(qml, /clusterApp\.isAllowedRendererUrl/);
assert.match(qml, /if \(requestJson\.length <= 16384\)/);
assert.match(qml, /root\.nativeCapabilityPollInterval = 100/);
assert.doesNotMatch(qml, /Timer\s*\{\s*interval: 100\s*repeat: true\s*running: root\.rendererReady/);
console.log("Qt native bridge performance: idle/backstage cadence and native request safety contracts passed.");
