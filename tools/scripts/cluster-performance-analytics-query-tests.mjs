// Performance regression: identical authorized analytics with fewer PostgreSQL queries.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const sourcePath = "apps/server/src/core/data-query-analytics.ts";
const source = fs.readFileSync(path.join(root, sourcePath), "utf8");
const compiled = ts.transpileModule(source, {
  fileName: sourcePath,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const module = { exports: {} };
new Function("require", "module", "exports", compiled.outputText)(name => {
  assert.equal(name, "@cluster/shared");
  return {
    compileClusterDataDerivedLinearExpressions: () => ({ expressions: new Map() }),
    evaluateClusterDataLinearAggregate: () => { throw Error("Unexpected derived expression"); },
  };
}, module, module.exports);
const { runPrismaScalarAnalytics, runPrismaGroupedProjections } = module.exports;

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log("PASS " + name);
}
const original = [
  { team: "A", state: "open", owner: "one", hours: 2 },
  { team: "A", state: "open", owner: "one", hours: 3 },
  { team: "A", state: "closed", owner: "two", hours: 4 },
  { team: "B", state: "open", owner: "three", hours: 1 },
  { team: "B", state: "open", owner: null, hours: 6 },
];
function createModel(sourceRows = original) {
  const calls = [];
  const model = {
    calls,
    async groupBy(options) {
      calls.push({ operation: "groupBy", options });
      const groups = new Map();
      for (const record of sourceRows) {
        const key = JSON.stringify(options.by.map(field => record[field] ?? null));
        let group = groups.get(key);
        if (!group) {
          group = Object.fromEntries(options.by.map(field => [field, record[field] ?? null]));
          group._count = { _all: 0 };
          group._sum = {};
          group._avg = {};
          group._min = {};
          group._max = {};
          group.__records = [];
          groups.set(key, group);
        }
        group._count._all++;
        group.__records.push(record);
      }
      return [...groups.values()].map(group => {
        for (const [kind, fields] of Object.entries(options)) {
          if (!["_sum", "_avg", "_min", "_max", "_count"].includes(kind) || !fields) continue;
          for (const field of Object.keys(fields)) {
            if (field === "_all") continue;
            const valid = group.__records.map(row => row[field]).filter(value => value != null);
            group[kind][field] = kind === "_sum" ? valid.reduce((sum, n) => sum + n, 0)
              : kind === "_avg" ? (valid.length ? valid.reduce((sum, n) => sum + n, 0) / valid.length : null)
              : kind === "_min" ? Math.min(...valid)
              : kind === "_max" ? Math.max(...valid)
              : valid.length;
          }
        }
        const { __records, ...value } = group;
        return value;
      });
    },
    async count() { calls.push({ operation: "count" }); return sourceRows.length; },
    async aggregate() { calls.push({ operation: "aggregate" }); return {}; },
  };
  return model;
}
const dimensions = new Map([["team", "team"], ["state", "state"], ["owner", "owner"]]);
const numericFields = new Map([["hours", "hours"]]);
const wholeCount = [
  { id: "items", kind: "count", label: "Items" },
  { id: "same_total_other_label", kind: "count", label: "Total" },
];
await check("count matrix uses one grouped query; totals remain exact", async () => {
  const model = createModel();
  const rows = await runPrismaGroupedProjections({
    model, where: { visibleTo: "user-A" }, dimensionFields: dimensions,
    projections: [{ id: "matrix", kind: "matrix", dimensions: ["team", "state"], measures: wholeCount, limit: 2 }],
  });
  assert.equal(model.calls.length, 1, "no row/column/scalar query fan-out");
  assert.equal(model.calls[0].options.where.visibleTo, "user-A");
  assert.equal(rows[0].rows.length, 2);
  assert.equal(rows[0].truncated, true);
  assert.deepEqual(JSON.parse(JSON.stringify(rows[0].rowTotals)), [
    { keys: ["A"], count: 3, values: { items: 3, same_total_other_label: 3 } },
    { keys: ["B"], count: 2, values: { items: 2, same_total_other_label: 2 } },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(rows[0].columnTotals)), [
    { keys: ["open"], count: 4, values: { items: 4, same_total_other_label: 4 } },
    { keys: ["closed"], count: 1, values: { items: 1, same_total_other_label: 1 } },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(rows[0].grandTotal)),
    { keys: [], count: 5, values: { items: 5, same_total_other_label: 5 } });
});
await check("matrix rollups include all authorized groups but cap exposed totals", async () => {
  const sourceRows = Array.from({ length: 251 }, (_, i) => ({ team: "T" + String(i).padStart(3, "0"), state: "active" }));
  const model = createModel(sourceRows);
  const [projection] = await runPrismaGroupedProjections({
    model, where: { allow: true }, dimensionFields: dimensions,
    projections: [{ id: "matrix", kind: "matrix", dimensions: ["team", "state"], measures: [wholeCount[0]], limit: 3 }],
  });
  assert.equal(model.calls.length, 1);
  assert.equal(projection.rows.length, 3);
  assert.equal(projection.truncated, true);
  assert.equal(projection.rowTotals.length, 200, "match existing rollup limit");
  assert.equal(projection.columnTotals.length, 1);
  assert.equal(projection.grandTotal.count, 251, "not derived from sliced preview");
});
await check("non-additive matrix continues to use independently grouped totals", async () => {
  const model = createModel();
  const [projection] = await runPrismaGroupedProjections({
    model, where: { visibleTo: "user-A" }, dimensionFields: dimensions, numericFields,
    projections: [{ id: "matrix", kind: "matrix", dimensions: ["team", "state"],
      measures: [{ id: "sum_hours", kind: "sum", fieldId: "hours", label: "Hours" }], limit: 2 }],
  });
  assert.equal(model.calls.filter(call => call.operation === "groupBy").length, 3);
  assert.equal(model.calls.filter(call => call.operation === "count").length, 1);
  assert.equal(model.calls.filter(call => call.operation === "aggregate").length, 1);
  assert.equal(projection.rowTotals[0].count, 3);
  assert.equal(projection.grandTotal.count, 5);
});
await check("duplicate distinct measures share one query per underlying field within projection", async () => {
  const model = createModel();
  const [projection] = await runPrismaGroupedProjections({
    model, where: { restricted: true }, dimensionFields: dimensions, numericFields,
    projections: [{ id: "owners", kind: "grouped", dimensions: ["team"], measures: [
      { id: "unique_owners", kind: "count_distinct", fieldId: "owner", label: "Owners" },
      { id: "owners_repeated", kind: "count_distinct", fieldId: "owner", label: "Duplicate measure" },
    ] }],
  });
  assert.equal(model.calls.filter(call => call.operation === "groupBy").length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(projection.rows.map(row => row.values))),
    [{ unique_owners: 2, owners_repeated: 2 }, { unique_owners: 1, owners_repeated: 1 }]);
  assert.ok(model.calls.every(call => call.options.where.restricted === true));
});
await check("scalar duplicate distinct measures share a single grouping query", async () => {
  const model = createModel();
  const result = await runPrismaScalarAnalytics({
    model, where: { restricted: true }, facets: [], facetFields: new Map(), numericFields: new Map([["owner", "owner"]]),
    aggregations: [
      { id: "one", kind: "count_distinct", fieldId: "owner", label: "Owners" },
      { id: "two", kind: "count_distinct", fieldId: "owner", label: "Same owners" },
    ],
  });
  assert.equal(model.calls.filter(call => call.operation === "groupBy").length, 1);
  assert.equal(model.calls.filter(call => call.operation === "count").length, 1);
  assert.equal(result.aggregations.one, 3);
  assert.equal(result.aggregations.two, 3);
});
console.log(checks + "/" + checks + " analytics query budget regression tests passed");
