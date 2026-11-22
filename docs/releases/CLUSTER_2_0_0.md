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

Launchers from 1.x only recognise 1.x release identities, so existing installations do not get 2.0.0 as an in-app update. Upgrade them with the manual 2.0.0 installer; from 2.0.0 on, updates are offered normally.

Release: merge `development` into `main`; `publish-cluster-2-0-0-manual.yml` publishes v2.0.0 once the Windows build and release CI pass.

The native Qt Desktop keeps its independent version (1.2.2).
