# Cluster 2.0.0 — interface refinement

**Status:** source version. The publisher (`publish-cluster-2-0-0-manual.yml`) runs when this reaches `main`.

## What changed

Cluster 2 is the refinement release of the whole studio interface: one shell, one page header, one menu skin and quieter copy everywhere.

- **Shell:** thinner sidebar, full-width server status with icons for what is degraded, Info (book) in the project tab bar and account menu.
- **Library:** a real file manager — click to select, Ctrl/Shift ranges, double-click to open, right-click menus, rename, download, drag to move between folders, drop files from the desktop into a folder, sortable list columns, tree drop targets.
- **Media and 3D viewers:** hosted inside their pages without a nested window, one transport row, one 3D control row.
- **Boards and whiteboards:** Trello-style boards; whiteboards with a tool rail, sticky notes, shapes, charts and comments.
- **Timeline, Tickets, Calendar, Scheduler, Packets, Inventory, Vault:** one-line headers, compact maps and lists, review-attention markers on the timeline.
- **People and profiles:** one header, always-visible search, an inspector with a rounded-square identity, a single fact list, and a full-page profile; admin Users open the same profile with Back to Users.
- **Menus:** action menus, context menus and select lists share size, type and shadow; descriptions became tooltips.
- **Sign-in and setup:** one centred card; setup is four short steps (Studio, Owner, Access, Review).

## Release sequence

Stable 1.x sequences are unchanged. Major 2 and later start at `major × 100000000` (2.0.0 = **200000000**), above every 1.x sequence and within a signed 32-bit integer. The Node release tools and the Windows Server launcher apply the same rule.

## Upgrading

Server launchers up to 1.2.3 only recognise 1.x release identities, so they will not offer 2.0.0. Server **1.2.4** (branch `release/1.2.4-bridge`) is the bridge: it is 1.2.3 with Cluster 2's launcher rule. Release order:

1. Merge `release/1.2.4-bridge` into `main`; `publish-cluster-1-2-4-manual.yml` publishes v1.2.4 once the Windows build and release CI pass.
2. Let installations reach 1.2.4 (signed channel or manual installer).
3. Merge `development` into `main`; `publish-cluster-2-0-0-manual.yml` publishes v2.0.0 the same way.

The manual 2.0.0 installer also works directly on any 1.x installation.

The native Qt Desktop keeps its independent version (1.2.2).
