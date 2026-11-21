# Cluster 2.0.0 — interface refinement

**Status:** source version only. No installer, signed feed or GitHub release has been published for 2.0.0.

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

Server launchers built before this change only recognise 1.x release identities, so an installed 1.x Server will not offer 2.0.0 as an update. Install 2.0.0 with the manual installer once it is published; later 2.x updates then flow normally. Add a `publish-cluster-2-0-0-*.yml` publisher when 2.0.0 is ready to release.

The native Qt Desktop keeps its independent version (1.2.2).
