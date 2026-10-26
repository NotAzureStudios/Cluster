import "dotenv/config";
import { normalizeAuthUsername } from "../core/auth.js";
import { createPrismaClient } from "../core/prisma-client.js";
import { issueAdministratorRecoveryCredential } from "../core/instance-setup.js";

const prisma = createPrismaClient();

async function main() {
  const rawUsername = process.argv[2];
  if (!rawUsername) throw new Error("Usage: npm run auth:bootstrap-owner -w @cluster/server -- <username>");
  const username = normalizeAuthUsername(rawUsername);
  const user = await prisma.user.findUnique({ where: { username }, include: { memberships: true } }) as any;
  if (!user) throw new Error(`No Cluster account exists for ${username}.`);
  if (!user.memberships.some((membership: any) => ["owner", "admin"].includes(String(membership.role)))) {
    throw new Error("Password recovery from this command is limited to owner or admin accounts.");
  }
  const credential = await issueAdministratorRecoveryCredential(prisma, { userId: user.id });
  console.log("Local administrator recovery (temporary sign-in password)");
  console.log(`Username: ${credential.username}`);
  console.log(`Temporary password: ${credential.temporaryPassword}`);
  console.log("Sign in normally. Cluster will require a new permanent password immediately.");
  console.log("All existing sessions for this account were revoked.");
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
