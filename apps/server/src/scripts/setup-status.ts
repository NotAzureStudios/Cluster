import "dotenv/config";
import { inspectInstanceSetup } from "../core/instance-setup.js";
import { createPrismaClient } from "../core/prisma-client.js";

const prisma = createPrismaClient();

async function main() {
  const status = await inspectInstanceSetup(prisma);
  const asJson = process.argv.includes("--json");
  if (asJson) {
    console.log(JSON.stringify(status, null, 2));
  } else if (status.setupRequired) {
    console.log(`Cluster setup is required: ${status.reason}.`);
    console.log(process.platform === "win32"
      ? "Run ClusterServer.exe --recover-owner to issue a fresh temporary owner password."
      : "For Docker, read the initial temporary owner password with: docker compose logs cluster");
  } else {
    console.log(`Cluster owner credentials are ready (${status.passwordReadyAdministratorCount} password-ready administrator account(s)).`);
  }
  if (status.setupRequired) process.exitCode = 10;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
