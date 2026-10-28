import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendTransferTelemetry, EMPTY_TRANSFER_TELEMETRY, transferEtaSeconds, transferEtaLabel } from "../../packages/renderer/src/features/shell/transfer-telemetry.ts";
const root = resolve(import.meta.dirname, "../..");
const source = (p) => readFileSync(resolve(root, p), "utf8");
const cases = [];
const test = (name, callback) => cases.push([name, callback]);
const item = (bytes, state = "running", id = "alpha", direction = "download") => ({ id, direction, state, transferredBytes: bytes, totalBytes: 10000 });
test("Initial transfer snapshot is baseline, not fabricated throughput", () => {
  const t = appendTransferTelemetry(EMPTY_TRANSFER_TELEMETRY, [item(4000)], 1000);
  assert.equal(t.downBps, null);
  assert.deepEqual(t.points, []);
});
test("Subsecond pushes accumulate into one measured rate window", () => {
  let t = appendTransferTelemetry(EMPTY_TRANSFER_TELEMETRY, [item(1000)], 1000);
  for (let ms = 1100; ms <= 1900; ms += 100) t = appendTransferTelemetry(t, [item(1000 + (ms - 1000))], ms);
  assert.equal(t.downBps, 1000);
  assert.equal(t.perItemBps.alpha, 1000);
  assert.equal(t.points.length, 1);
});
test("Upload and download speeds are independent", () => {
  let t = appendTransferTelemetry(EMPTY_TRANSFER_TELEMETRY, [item(0), item(0, "running", "beta", "upload")], 1000);
  t = appendTransferTelemetry(t, [item(2000), item(1000, "running", "beta", "upload")], 2000);
  assert.equal(t.downBps, 2000); assert.equal(t.upBps, 1000);
});
test("Paused and completed transfers cannot manufacture speed", () => {
  let t = appendTransferTelemetry(EMPTY_TRANSFER_TELEMETRY, [item(1000)], 1000);
  t = appendTransferTelemetry(t, [item(6000, "paused")], 2000);
  assert.equal(t.downBps, 0);
  t = appendTransferTelemetry(t, [item(10000, "complete")], 3000);
  assert.equal(t.downBps, 0);
});
test("Unexpected resets and new jobs cannot count preexisting bytes", () => {
  let t = appendTransferTelemetry(EMPTY_TRANSFER_TELEMETRY, [item(9000)], 1000);
  t = appendTransferTelemetry(t, [item(20)], 2000);
  assert.equal(t.downBps, 0);
  t = appendTransferTelemetry(t, [item(9000, "running", "new")], 3000);
  assert.equal(t.downBps, null);
  assert.ok(t.points.length <= 1);
});
test("Long event-loop stalls do not become fake average throughput", () => {
  let t = appendTransferTelemetry(EMPTY_TRANSFER_TELEMETRY, [item(100)], 1000);
  t = appendTransferTelemetry(t, [item(5000)], 200000);
  assert.equal(t.downBps, null);
});
test("Graph is capped at ninety samples", () => {
  let t = appendTransferTelemetry(EMPTY_TRANSFER_TELEMETRY, [item(0)], 1000);
  for (let i = 1; i < 130; i++) t = appendTransferTelemetry(t, [item(i * 50)], 1000 + i * 1000);
  assert.equal(t.points.length, 90);
});
test("ETA is calculated only from real progress and positive speed", () => {
  assert.equal(transferEtaSeconds(1000, 200, 200), 4);
  assert.equal(transferEtaLabel(65), "2m remaining");
  assert.equal(transferEtaSeconds(1000, 200, undefined), null);
  assert.equal(transferEtaSeconds(0, 200, 20), null);
  assert.equal(transferEtaSeconds(1000, 1000, 20), null);
});
test("Transfer component uses native broker push events, not new polling", () => {
  const ui = source("packages/renderer/src/features/shell/TaskbarTransferCenter.tsx");
  assert.match(ui, /subscribeNativeTransfers/);
  assert.match(ui, /appendTransferTelemetry/);
  assert.match(ui, /<TransferRateChart samples=\{transferTelemetry\.points\}/);
  assert.match(ui, /Completed & browser handoffs/);
  assert.match(ui, /transferEtaSeconds/);
  assert.doesNotMatch(source("packages/renderer/src/components/TransferRateChart.tsx"), /fetch\(|setInterval\(/);
});
test("Client latency bars use real category p95 measurements", () => {
  const client = source("packages/renderer/src/features/operations/ClientPerformancePanel.tsx");
  assert.match(client, /<MetricComparisonBars/);
  assert.match(client, /metric\?\.p95Ms \?\? null/);
  const bar = source("packages/renderer/src/components/MetricComparisonBars.tsx");
  assert.match(bar, /aria-valuenow/);
  assert.match(bar, /Number\.isFinite/);
});
for (const [name, callback] of cases) { try { callback(); console.log("PASS", name); } catch (error) { console.error("FAIL", name, error); process.exitCode = 1; } }
console.log(`RC33 transfer / graph checks: ${cases.length} cases`);
