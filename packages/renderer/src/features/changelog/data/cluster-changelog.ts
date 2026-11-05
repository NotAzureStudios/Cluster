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
