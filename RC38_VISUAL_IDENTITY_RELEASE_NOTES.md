# Cluster RC37 → Visual Identity Pass 1 (RC38 source checkpoint)

**Status:** Development source only. Not an installable Windows release.

## Implemented
- A single `Project.iconId` persistence field, explicit additive PostgreSQL migration, revision-protected updates, Project permission checks and no icon-specific list-query fanout.
- Shared `ResourceIdentityMark` renderer and `ResourceIconPicker` (search, accessible icon tiles, change/reset).
- Project Plan → Identity and health now supports selecting a semantic glyph, selecting platform/service **badges**, using the supplied Azure Studios Git mark, and uploading a PNG/JPG/WebP icon with a 256px client-side square crop.
- The exact Azure Studios Git PNG supplied by the studio is optimized into an offline 256px WebP asset at `/brand/as-git.webp` (transparency preserved, 9.7 KB).
- Project browser gallery, details inspector, Project header and taskbar tabs share the selected icon. Type subtitles and header description duplicated elsewhere have been removed.
- Uploaded Project icons are only retrievable by authorized viewers while assigned to that Project. The route checks the current `iconId` and doesn't expose underlying asset folders or original Library files.

## Deliberate limits
- The **Discord, Steam, Epic, Unreal, Blender, CurseForge and Minecraft** options currently display labeled abbreviation badges, **not official marks**. Official trademark artwork must be reviewed and bundled locally before calling those logos.
- Custom uploaded assets use authenticated Project-scope storage and conservative body limits. A storage cleanup lifecycle for replaced, unreferenced icons remains to be certified; no unsafe automatic deletion was added.
- Icons for Boards, Whiteboards, Teams and Inventory remain subsequent work; the shared component can be reused there.
- No full TypeScript dependency-backed build, PostgreSQL migration execution, running Windows UI or multiuser access validation has been performed here.

## Test status
- 13/13 new visual-identity assertions passed.
- Inherited RC37 source regression groups passed (12/12 + Discord checks).
- RC8 PostgreSQL migration admission fixture passed 12/12 with the new latest migration.
- TypeScript/TSX syntax scanning passed on 1,192 files. Running `tsc` without installed React/Fastify/Prisma dependencies produces missing-module/JSX diagnostics and is **not** a passing full build.

## Windows acceptance
1. Provision dependencies and run Prisma generate/migrate; confirm the `Project.iconId` column and startup admission.
2. Change icon in Project → Plan → Identity and health; save and verify the same mark in browser, detail, inspector and taskbar.
3. Upload a test raster icon; test direct icon URL while authenticated, after revoking access, and after switching server/account.
4. Confirm reset returns to semantic Project Type default and the current file stops being served.
5. Check browser speed, no icon-specific request N+1 except permitted raster-image fetches, light/dark and 100/125/150% Windows scaling.
