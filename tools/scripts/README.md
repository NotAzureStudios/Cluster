# Cluster developer and verification scripts

This directory contains release tooling, static checks, regression tests and native build helpers. Most filenames preserve their historical RC/TD/G numbers because they are referenced by root `package.json`, installer scripts and test chains.

Do **not** bulk-rename or move tests without checking every package script, relative import, Windows entry point and release verification path. Prefer adding new scripts with descriptive names. Consolidate truly obsolete test groups only once their dependencies and replacement coverage are understood.

## Source organization audit

Run `node tools/scripts/cluster-repository-inventory.mjs` inside a Git checkout to report tracked file counts by directory, large source files, byte-identical files and Windows-incompatible case collisions. It is read-only and does not scan runtime data directories. Treat duplicate results as **review candidates**, not proof that a file may be deleted.

## Memory and lifecycle regression

`node --experimental-strip-types tools/scripts/cluster-pdf-print-lifecycle-tests.mjs` covers print iframe teardown, blob URL revocation, timer cleanup, load failure and missing `load` events. Actual browser memory retention and GPU/Qt resource leaks still require a running-client soak test.
