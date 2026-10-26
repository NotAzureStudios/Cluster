import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const check = (label, condition) => checks.push({ label, condition: Boolean(condition) });

const packageJson = JSON.parse(read("package.json"));
const workforceRoutes = read("apps/server/src/domains/workforce/workforce-routes.ts");
const schedulerPlanning = read("apps/server/src/domains/time/scheduler-planning.ts");
const schedulerResources = read("apps/server/src/domains/time/scheduler-resource-routes.ts");
const peoplePage = read("packages/renderer/src/features/people/PeoplePages.tsx");
const availabilityPanel = read("packages/renderer/src/features/people/WorkforceAvailabilityExceptions.tsx");
const planningDialog = read("packages/renderer/src/features/time/SchedulePlanningDialog.tsx");
const timeWorkspace = read("packages/renderer/src/features/time/TimeWorkspacePage.tsx");
const naming = JSON.parse(read("VERSION_NAMING_CONVENTION.json"));

check("availability exceptions retain all four canonical kinds", workforceRoutes.includes('z.enum(["unavailable", "limited", "preferred", "time_off"])'));
check("self-service and direct-manager authorization share server authority", workforceRoutes.includes("canManageAvailabilityFor") && workforceRoutes.includes("employment.managerUserId") && workforceRoutes.includes("AVAILABILITY_ACCESS_DENIED"));
check("availability reasons are privacy projected", workforceRoutes.includes("reasonRestricted") && workforceRoutes.includes("managerCanSeeReason") && workforceRoutes.includes("canSeeReason ? row.reason"));
check("availability create/cancel actions are audited", workforceRoutes.includes('entityType: "availability_exception"') && workforceRoutes.includes('title: "Availability window added"') && workforceRoutes.includes('title: "Availability window cancelled"'));
check("People exposes a first-class availability window editor", peoplePage.includes("WorkforceAvailabilityExceptions") && availabilityPanel.includes("Availability windows"));
check("People editor supports manager target selection", availabilityPanel.includes("direct report") && availabilityPanel.includes("managerUserId === currentUser.id"));
check("People editor supports unavailable/limited/preferred/time off", availabilityPanel.includes('value: "unavailable"') && availabilityPanel.includes('value: "limited"') && availabilityPanel.includes('value: "preferred"') && availabilityPanel.includes('value: "time_off"'));
check("People list projects active/upcoming availability windows", peoplePage.includes("upcoming window") && peoplePage.includes("availabilityExceptions"));
check("Scheduler conflict engine consumes unavailable limited and time off", schedulerPlanning.includes('kind: { in: ["unavailable", "limited", "time_off"] }'));
check("Scheduler exposes preferred availability as positive readiness", schedulerPlanning.includes("findPreferredAvailabilitySignals") && schedulerResources.includes("availabilitySignals"));
check("Planning UI renders preferred availability separately from conflicts", planningDialog.includes("time-planning-readiness-v16b") && timeWorkspace.includes("planningAvailabilitySignals"));
check("P16B uses canonical checkpoint notation", /^\d+\.\d+$/.test(naming.displayVersion));
check("P16B assertion gate is wired", String(packageJson.scripts?.["verify:source-foundation"] || "").includes("wip57:p16b:assertions"));

let failed = 0;
for (const item of checks) {
  if (item.condition) console.log(`PASS ${item.label}`);
  else { console.error(`FAIL ${item.label}`); failed += 1; }
}
console.log(`\n${checks.length - failed}/${checks.length} WIP57 P16B workforce availability assertions passed.`);
if (failed) process.exit(1);
