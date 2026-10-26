import type { BuildPlatformField, BuildPlatformLane, BuildPlatformProfile } from "../application/application-models";

export const GENERIC_BUILD_LANES: BuildPlatformLane[] = [
  { id: "internal", label: "Internal", hint: "team-only package" },
  { id: "playtest", label: "Playtest", hint: "testable build" },
  { id: "qa", label: "QA", hint: "verification pass" },
  { id: "rc", label: "RC", hint: "release candidate" },
  { id: "launch", label: "Launch", hint: "published/shipped" },
];

export const CURSEFORGE_FIELDS: BuildPlatformField[] = [
  {
    id: "curseforgeProjectId",
    label: "CurseForge project ID",
    placeholder: "Project ID / slug",
  },
  {
    id: "fileDisplayName",
    label: "File display name",
    placeholder: "MyMod-1.20.1-0.4.2.jar",
  },
  {
    id: "gameVersions",
    label: "Game versions",
    placeholder: "1.20.1, ASA 1.0, server/client versions",
  },
  {
    id: "releaseType",
    label: "Release type",
    placeholder: "alpha, beta, release",
  },
  {
    id: "dependencies",
    label: "Dependencies",
    placeholder: "Fabric API, Forge, required DLC, map assets",
  },
  {
    id: "changelogUrl",
    label: "Changelog / release page",
    placeholder: "CurseForge file page, markdown, notes URL",
    span: 2,
  },
];

export const BUILD_PLATFORM_PROFILES: BuildPlatformProfile[] = [
  {
    key: "unreal",
    label: "Unreal Engine",
    summary: "Track engine version, cook/package target, branch, platform package, QA handoff, and release candidate state.",
    artifactLabel: "Packaged build",
    versionLabel: "Build version",
    defaultPlatform: "Windows",
    platforms: ["Windows", "Linux", "Android", "iOS", "Console", "Editor-only"],
    lanes: GENERIC_BUILD_LANES,
    fields: [
      {
        id: "engineVersion",
        label: "Engine version",
        placeholder: "UE 5.4 / UE 5.5",
      },
      {
        id: "targetConfiguration",
        label: "Configuration",
        placeholder: "Development, Test, Shipping",
      },
      {
        id: "cookProfile",
        label: "Cook/profile",
        placeholder: "Pak, IoStore, Dedicated Server",
      },
      {
        id: "mapOrTarget",
        label: "Map / target",
        placeholder: "Startup map, target platform, server target",
      },
      {
        id: "automationCommand",
        label: "Automation command",
        placeholder: "BuildCookRun args or CI job URL",
        span: 2,
      },
    ],
    gates: [
      {
        key: "engineVersion",
        label: "Engine version set",
        detail: "Record which UE version produced the package.",
      },
      {
        key: "targetConfiguration",
        label: "Build configuration set",
        detail: "Development/Test/Shipping is known.",
      },
      {
        key: "cookProfile",
        label: "Cook/package path noted",
        detail: "Packaging method is recorded.",
      },
    ],
    tips: ["Use Shipping for public candidates.", "Keep branch and commit filled so QA can reproduce the package.", "Attach crash logs or packaged output links as artifacts."],
  },
  {
    key: "blender",
    label: "Blender Export",
    summary: "Track source .blend, export format, render/output folder, scale, texture packing, and handoff readiness.",
    artifactLabel: "Export package",
    versionLabel: "Asset version",
    defaultPlatform: "glTF / GLB",
    platforms: ["glTF / GLB", "FBX", "OBJ", "USD", "Alembic", "Render sequence", "Blend source"],
    lanes: [
      { id: "internal", label: "Source", hint: ".blend cleanup" },
      { id: "playtest", label: "Export", hint: "asset export" },
      { id: "qa", label: "Review", hint: "import/visual QA" },
      { id: "rc", label: "Handoff", hint: "ready for integration" },
      { id: "launch", label: "Delivered", hint: "final asset shipped" },
    ],
    fields: [
      {
        id: "blendFile",
        label: "Blend source",
        placeholder: "Source .blend file/path",
      },
      {
        id: "exportFormat",
        label: "Export format",
        placeholder: "GLB, FBX, OBJ, USD",
      },
      {
        id: "scaleUnits",
        label: "Scale / units",
        placeholder: "Metric, Unreal centimeters, Minecraft blocks",
      },
      {
        id: "texturePolicy",
        label: "Textures",
        placeholder: "Packed, external, atlased, compressed",
      },
      {
        id: "validationTarget",
        label: "Import target",
        placeholder: "Unreal, UEFN, Minecraft toolchain, engine viewer",
      },
      {
        id: "renderPreview",
        label: "Preview / turntable",
        placeholder: "Render/video review link",
        span: 2,
      },
    ],
    gates: [
      {
        key: "exportFormat",
        label: "Export format set",
        detail: "The consuming project knows what file type to expect.",
      },
      {
        key: "texturePolicy",
        label: "Texture policy set",
        detail: "Packed/external texture handling is clear.",
      },
      {
        key: "validationTarget",
        label: "Import target checked",
        detail: "Asset was tested in the destination pipeline.",
      },
    ],
    tips: ["Keep source .blend and exported files as separate artifacts.", "Record scale and axis assumptions before engine import.", "Attach a preview render for review before integration."],
  },
  {
    key: "fortnite_island",
    label: "Fortnite Island / UEFN",
    summary: "Track island code, private version, memory/test state, moderation/submission status, and creator portal handoff.",
    artifactLabel: "Island submission",
    versionLabel: "Island version",
    defaultPlatform: "UEFN",
    platforms: ["UEFN", "Fortnite Creative", "Private version", "Public island"],
    lanes: [
      { id: "internal", label: "Private", hint: "internal version" },
      { id: "playtest", label: "Playtest", hint: "session ready" },
      { id: "qa", label: "Compliance", hint: "memory/rules check" },
      { id: "rc", label: "Submission", hint: "creator portal" },
      { id: "launch", label: "Published", hint: "island live" },
    ],
    fields: [
      {
        id: "islandCode",
        label: "Island code",
        placeholder: "Public island code",
      },
      {
        id: "privateVersion",
        label: "Private version",
        placeholder: "Private upload/version code",
      },
      {
        id: "memoryUsage",
        label: "Memory usage",
        placeholder: "Memory result / budget",
      },
      {
        id: "creatorPortalStatus",
        label: "Creator Portal status",
        placeholder: "Draft, submitted, approved, rejected",
      },
      {
        id: "submissionNotes",
        label: "Submission notes",
        placeholder: "Ratings, thumbnails, attributions, moderation risks",
        span: 2,
      },
    ],
    gates: [
      {
        key: "privateVersion",
        label: "Private version created",
        detail: "A playable private build exists.",
      },
      {
        key: "memoryUsage",
        label: "Memory checked",
        detail: "Memory/test result is recorded.",
      },
      {
        key: "creatorPortalStatus",
        label: "Submission state set",
        detail: "Creator Portal status is known.",
      },
    ],
    tips: ["Keep playtest links and private versions separate from public island codes.", "Use the submission lane for moderation and metadata review.", "Record rejection reasons so the next submission is not archaeology."],
  },
  {
    key: "ark_mod",
    label: "ARK Mod / CurseForge",
    summary: "Track cooked mod output, supported ARK build, dependencies, file metadata, and CurseForge publishing status.",
    artifactLabel: "Cooked mod file",
    versionLabel: "Mod version",
    defaultPlatform: "CurseForge",
    platforms: ["CurseForge", "Steam test", "Local dev kit", "Dedicated server"],
    lanes: [
      { id: "internal", label: "Cook", hint: "local cook" },
      { id: "playtest", label: "Server test", hint: "server/client check" },
      { id: "qa", label: "Compatibility", hint: "game version check" },
      { id: "rc", label: "CurseForge draft", hint: "file metadata" },
      { id: "launch", label: "Published", hint: "live file" },
    ],
    fields: CURSEFORGE_FIELDS,
    gates: [
      {
        key: "curseforgeProjectId",
        label: "CurseForge project linked",
        detail: "Project ID/slug is recorded.",
      },
      {
        key: "gameVersions",
        label: "Game versions set",
        detail: "Supported ARK version info is listed.",
      },
      {
        key: "releaseType",
        label: "Release type set",
        detail: "Alpha/beta/release state is known.",
      },
    ],
    tips: ["Record server test results before marking a file public.", "Keep dependencies explicit for mod stacks.", "Attach cooked output and changelog together."],
  },
  {
    key: "ark_map",
    label: "ARK Map / CurseForge",
    summary: "Track cooked map packages, spawn/gameplay test notes, supported ARK version, dependencies, and CurseForge publish metadata.",
    artifactLabel: "Cooked map package",
    versionLabel: "Map version",
    defaultPlatform: "CurseForge",
    platforms: ["CurseForge", "Steam test", "Local dev kit", "Dedicated server"],
    lanes: [
      { id: "internal", label: "Cook", hint: "map cook" },
      { id: "playtest", label: "Traversal", hint: "spawn/biome test" },
      { id: "qa", label: "Server test", hint: "dedicated validation" },
      { id: "rc", label: "CurseForge draft", hint: "file metadata" },
      { id: "launch", label: "Published", hint: "live file" },
    ],
    fields: CURSEFORGE_FIELDS,
    gates: [
      {
        key: "curseforgeProjectId",
        label: "CurseForge project linked",
        detail: "Project ID/slug is recorded.",
      },
      {
        key: "gameVersions",
        label: "Game versions set",
        detail: "Supported ARK version info is listed.",
      },
      {
        key: "dependencies",
        label: "Map dependencies noted",
        detail: "Required assets/mods are listed.",
      },
    ],
    tips: ["Track spawn, traversal, world partition, and server boot checks.", "Separate map package output from screenshots/trailer assets.", "Keep CurseForge file metadata ready before publish day."],
  },
  {
    key: "minecraft_map",
    label: "Minecraft Map / CurseForge",
    summary: "Track world zip, Minecraft version, datapack/resourcepack requirements, screenshots, and CurseForge file metadata.",
    artifactLabel: "World package",
    versionLabel: "Map version",
    defaultPlatform: "CurseForge",
    platforms: ["CurseForge", "Java Edition", "Bedrock", "Datapack", "Resource pack"],
    lanes: [
      { id: "internal", label: "World build", hint: "map work" },
      { id: "playtest", label: "Playtest", hint: "spawn/progression" },
      { id: "qa", label: "Compatibility", hint: "MC version check" },
      { id: "rc", label: "CurseForge draft", hint: "metadata ready" },
      { id: "launch", label: "Published", hint: "file live" },
    ],
    fields: CURSEFORGE_FIELDS,
    gates: [
      {
        key: "curseforgeProjectId",
        label: "CurseForge project linked",
        detail: "Project ID/slug is recorded.",
      },
      {
        key: "gameVersions",
        label: "Minecraft versions set",
        detail: "Compatible game versions are listed.",
      },
      {
        key: "fileDisplayName",
        label: "World file named",
        detail: "Upload filename/display name is known.",
      },
    ],
    tips: ["Include screenshots, spawn instructions, and resourcepack notes.", "Record whether this is Java, Bedrock, datapack, or resource-pack assisted.", "Keep install instructions in the changelog field."],
  },
  {
    key: "minecraft_mod",
    label: "Minecraft Mod / CurseForge",
    summary: "Track loader, Minecraft versions, dependencies, jar output, changelog, and CurseForge publish status.",
    artifactLabel: "Mod jar",
    versionLabel: "Mod version",
    defaultPlatform: "CurseForge",
    platforms: ["CurseForge", "Forge", "Fabric", "NeoForge", "Quilt", "Modrinth mirror"],
    lanes: [
      { id: "internal", label: "Dev jar", hint: "local build" },
      { id: "playtest", label: "Pack test", hint: "modpack run" },
      { id: "qa", label: "Compatibility", hint: "loader/version QA" },
      { id: "rc", label: "CurseForge draft", hint: "metadata ready" },
      { id: "launch", label: "Published", hint: "file live" },
    ],
    fields: [
      ...CURSEFORGE_FIELDS,
      {
        id: "loader",
        label: "Loader",
        placeholder: "Forge, Fabric, NeoForge, Quilt",
      },
      {
        id: "javaVersion",
        label: "Java version",
        placeholder: "Java 17 / Java 21",
      },
    ],
    gates: [
      {
        key: "curseforgeProjectId",
        label: "CurseForge project linked",
        detail: "Project ID/slug is recorded.",
      },
      {
        key: "gameVersions",
        label: "Minecraft versions set",
        detail: "Compatible game versions are listed.",
      },
      {
        key: "loader",
        label: "Loader set",
        detail: "Forge/Fabric/etc. is recorded.",
      },
      {
        key: "dependencies",
        label: "Dependencies listed",
        detail: "Required libraries/mods are known.",
      },
    ],
    tips: ["Record loader and Java version every time. Future-you is forgetful, despite all evidence being on fire.", "Keep dependencies and incompatibilities in the artifact notes.", "Use RC for files ready to upload but not yet approved/live."],
  },
  {
    key: "generic",
    label: "Generic Release",
    summary: "Track project artifacts, release beats, QA state, and release notes without platform-specific metadata.",
    artifactLabel: "Artifact",
    versionLabel: "Version",
    defaultPlatform: "General",
    platforms: ["General", "Web", "Desktop", "Mobile", "Server", "Document"],
    lanes: GENERIC_BUILD_LANES,
    fields: [
      {
        id: "deliveryTarget",
        label: "Delivery target",
        placeholder: "Internal, client, store, server",
      },
      {
        id: "publishUrl",
        label: "Publish URL",
        placeholder: "Release page or delivery folder",
        span: 2,
      },
    ],
    gates: [
      {
        key: "deliveryTarget",
        label: "Delivery target set",
        detail: "Destination is recorded.",
      },
    ],
    tips: ["Use the artifact URL as the source of truth for the package.", "Generate notes before sending the build anywhere important."],
  },
];
