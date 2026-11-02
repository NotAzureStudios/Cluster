# Cluster RC41 Windows Test Guide

1. Stop any ongoing install; back up all important PostgreSQL data before modifying your live managed installation. Do not delete or rename existing Cluster directories.
2. Place `Cluster-Installer-RC41-TEST.exe` beside the managed `Cluster/` directory (normally `D:\Cluster-Server\`). Double-click it. The installer should use `Cluster/` adjacent to itself and *not* overwrite the parent directory.
3. Review `Cluster\installer.log` immediately after running. Failure to compile Node/Prisma/Web/Go or to provision the private runtime is **not** success. The installer should preserve the previous managed revision on failure.
4. In the browser check Projects (card/list/table, filter, load-more), Inventory (types/status/paging, select/assign), Home (project coverage, QA/review/library/admin widgets), Operations graphs, and Discord Admin bot controls.
5. Test desktop scaling 100%, 125% and 150%; compact density; keyboard/tab and touch; dark/light; blank, partial and errored datasets; and permission-scoped records. Specifically check Project icon upload/visibility only works with access.
6. For Discord, test an approved test guild, unapproved guild, revocation, command timeouts, notification delivery and Windows worker reconnection. Keep tokens private.
7. Confirm server log rate / 429 behavior after navigating rapidly and after leaving tabs idle. Charts added in RC41 must not trigger new network reads.

This is a **test candidate** with a compiled Windows installer stub that builds its server payload on target. The full dependency-backed application build and Windows runtime have not been certified in this environment.
