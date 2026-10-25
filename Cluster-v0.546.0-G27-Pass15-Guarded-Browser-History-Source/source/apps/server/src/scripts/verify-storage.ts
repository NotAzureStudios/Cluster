import "dotenv/config";
import { verifyStorageSchema, inspectStorageSchema } from "../core/storage-migrations.js";
import { createPrismaClient } from "../core/prisma-client.js";

const prisma = createPrismaClient();
try {
  const verification = await verifyStorageSchema(prisma as any, {
    info: (payload, message) => console.log(message || "Storage verification", payload),
    warn: (payload, message) => console.warn(message || "Storage verification", payload),
  });
  const storage = await inspectStorageSchema(prisma as any);
  console.log(JSON.stringify({ ok: storage.ok, verification, storage }, null, 2));
  if (!storage.ok) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
