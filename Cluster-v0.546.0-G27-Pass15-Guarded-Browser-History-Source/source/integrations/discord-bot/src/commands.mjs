export const CLUSTER_DISCORD_COMMANDS = [
  {
    name: "cluster",
    description: "Work with Cluster from this Discord server.",
    type: 1,
    dm_permission: false,
    default_member_permissions: null,
    options: [
      { type: 1, name: "status", description: "Show the Cluster Project status for this channel." },
      { type: 1, name: "help", description: "Show the Cluster Discord command surface." },
    ],
  },
  {
    name: "Create Cluster Ticket",
    type: 3,
    dm_permission: false,
    default_member_permissions: null,
  },
];
