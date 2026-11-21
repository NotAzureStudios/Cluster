/** Only published Cluster 1.0+ GitHub releases belong in the in-product history.
 * This catalog is intentionally offline/static: no background GitHub polling.
 * Do not include unpublished candidates or reconstructed pre-1.0 filler.
 * When publishing a release, add a sourced, user-facing summary here.
 */
export interface ClusterChangelogRelease {
  version: string;
  title: string;
  publishedOn: string;
  sourceUrl: string;
  changes: readonly string[];
}

export const CLUSTER_CHANGELOG: readonly ClusterChangelogRelease[] = [
  {
    version: "v1.2.3",
    title: "Installer progress",
    publishedOn: "2026-11-12",
    sourceUrl: "https://github.com/NotAzureStudios/Cluster/releases/tag/v1.2.3",
    changes: [
      "The Windows installer no longer looks frozen while unpacking: it reports file count, elapsed time and verification progress.",
      "Disk space is checked before unpacking; every original verification and rollback check still runs.",
      "Desktop 1.2.2 is carried forward unchanged.",
    ],
  },
  {
    version: "v1.2.2",
    title: "Server and native Desktop",
    publishedOn: "2026-11-12",
    sourceUrl: "https://github.com/NotAzureStudios/Cluster/releases/tag/v1.2.2",
    changes: [
      "First freshly compiled native Qt Desktop (1.2.2) with installer, portable ZIP and verified build receipt.",
      "Includes the 1.2.1 Server, update broker and signed update path.",
    ],
  },
  {
    version: "v1.2.1",
    title: "Signed update channel",
    publishedOn: "2026-11-12",
    sourceUrl: "https://github.com/NotAzureStudios/Cluster/releases/tag/v1.2.1",
    changes: [
      "Adds the ClusterStudioUpdateBroker Windows service and a PIN-authorized, publisher-signed update request path.",
      "The signed server-main feed now publishes from a dedicated branch.",
    ],
  },
  {
    version: "v1.2.0",
    title: "Operations and settings",
    publishedOn: "2026-11-10",
    sourceUrl: "https://github.com/NotAzureStudios/Cluster/releases/tag/v1.2.0",
    changes: [
      "Server Manager gains a GPU utilization meter.",
      "Server Configuration can check for and download verified signed updates.",
      "Operations has a visual Jobs page; Studio and Server settings share consolidated navigation with fewer background requests.",
    ],
  },
  {
    version: "v1.1.2",
    title: "Update key rotation",
    publishedOn: "2026-11-05",
    sourceUrl: "https://github.com/NotAzureStudios/Cluster/releases/tag/v1.1.2",
    changes: [
      "Embeds the new Ed25519 key for signed Server updates. Install once manually after verifying backups.",
    ],
  },
  {
    version: "v1.1.1",
    title: "Project data hotfix",
    publishedOn: "2026-11-05",
    sourceUrl: "https://github.com/NotAzureStudios/Cluster/releases/tag/v1.1.1",
    changes: [
      "Fixes a Project data-loss issue found in 1.1.0.",
    ],
  },
  {
    version: "v1.1.0",
    title: "Dedicated signed updater",
    publishedOn: "2026-11-05",
    sourceUrl: "https://github.com/NotAzureStudios/Cluster/releases/tag/v1.1.0",
    changes: [
      "Server 1.1 with a dedicated signed updater, released as a verified manual Windows installer.",
    ],
  },
  {
    version: "v1.0.5",
    title: "Windows Server release",
    publishedOn: "2026-11-04",
    sourceUrl: "https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.5",
    changes: [
      "Published the 1.0.5 Windows Server installer and standalone Server Manager with build receipts.",
      "The native Desktop package remains separately versioned at 0.482.0.",
      "Clean-install smoke tests passed. In-place upgrade and populated-database rollback are not yet fully certified.",
    ],
  },
  {
    version: "v1.0.4",
    title: "Windows Server packaging",
    publishedOn: "2026-11-03",
    sourceUrl: "https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.4",
    changes: [
      "Published the 1.0.4 Windows Server package and its build receipt.",
      "Clarified installed Server Manager entry points and the backup requirement before upgrading an existing installation.",
    ],
  },
  {
    version: "v1.0.2",
    title: "Installer and managed database fixes",
    publishedOn: "2026-11-03",
    sourceUrl: "https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.2",
    changes: [
      "Fixed a Windows drive-root permission failure involving the optional Server launcher.",
      "Corrected managed PostgreSQL environment lookup during startup.",
      "Added installer execution checks to Windows build validation.",
    ],
  },
  {
    version: "v1.0.1",
    title: "Initial installation repair",
    publishedOn: "2026-11-03",
    sourceUrl: "https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.1",
    changes: [
      "Fixed Server installation checks that mistakenly required source-only files absent from the distributed installer.",
      "Kept Server/Web build identity consistent for 1.0.1.",
    ],
  },
  {
    version: "v1.0.0",
    title: "First studio release",
    publishedOn: "2026-11-03",
    sourceUrl: "https://github.com/NotAzureStudios/Cluster/releases/tag/v1.0.0",
    changes: [
      "Introduced the first private Cluster 1.0 suite for Azure Studios.",
      "Brought together Projects, Boards, Whiteboards, Tickets, Calendar, Library, Packets, QA and Builds, People/Admin, Web, Server Manager and native Desktop.",
    ],
  },
];
