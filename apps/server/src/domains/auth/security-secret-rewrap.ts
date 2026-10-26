import { decryptSecuritySecret, encryptSecuritySecret } from "../../core/setting-crypto.js";
import { clusterSecretFingerprint } from "../../core/crypto-service.js";

type RewrapSummary = { mfaSecrets: number; webhookSecrets: number; integrationSecrets: number };

export async function rewrapSecuritySecrets(prisma: any): Promise<RewrapSummary> {
  const summary: RewrapSummary = { mfaSecrets: 0, webhookSecrets: 0, integrationSecrets: 0 };
  const pageSize = 250;

  let mfaCursor: string | null = null;
  while (true) {
    const rows: Array<{ id: string; userId: string; encryptedSecret: string }> = await prisma.authenticator.findMany({
      where: { kind: "totp", encryptedSecret: { not: null } },
      orderBy: { id: "asc" },
      take: pageSize,
      ...(mfaCursor ? { cursor: { id: mfaCursor }, skip: 1 } : {}),
      select: { id: true, userId: true, encryptedSecret: true },
    });
    if (!rows.length) break;
    for (const row of rows) {
      const purpose = `authenticator:totp:${row.userId}`;
      const plain = decryptSecuritySecret(purpose, row.encryptedSecret);
      await prisma.authenticator.update({ where: { id: row.id }, data: { encryptedSecret: encryptSecuritySecret(purpose, plain) } });
      summary.mfaSecrets += 1;
    }
    mfaCursor = String(rows[rows.length - 1].id);
    if (rows.length < pageSize) break;
  }

  let credentialCursor: string | null = null;
  while (true) {
    const rows: Array<{ id: string; encryptedSecret: string }> = await prisma.serviceCredential.findMany({
      where: { credentialType: "webhook_signing", encryptedSecret: { not: null } },
      orderBy: { id: "asc" },
      take: pageSize,
      ...(credentialCursor ? { cursor: { id: credentialCursor }, skip: 1 } : {}),
      select: { id: true, encryptedSecret: true },
    });
    if (!rows.length) break;
    for (const row of rows) {
      const plain = decryptSecuritySecret("service-credential:webhook", row.encryptedSecret);
      await prisma.serviceCredential.update({ where: { id: row.id }, data: { encryptedSecret: encryptSecuritySecret("service-credential:webhook", plain), secretFingerprint: clusterSecretFingerprint(plain, "service-credential:webhook") } });
      summary.webhookSecrets += 1;
    }
    credentialCursor = String(rows[rows.length - 1].id);
    if (rows.length < pageSize) break;
  }

  let integrationCursor: string | null = null;
  while (true) {
    const rows: Array<{ id: string; connectionId: string; key: string; encryptedValue: string }> = await prisma.integrationConnectionSecret.findMany({
      orderBy: { id: "asc" },
      take: pageSize,
      ...(integrationCursor ? { cursor: { id: integrationCursor }, skip: 1 } : {}),
      select: { id: true, connectionId: true, key: true, encryptedValue: true },
    });
    if (!rows.length) break;
    for (const row of rows) {
      const purpose = `integration:${row.connectionId}:${row.key}`;
      const plain = decryptSecuritySecret(purpose, row.encryptedValue);
      await prisma.integrationConnectionSecret.update({ where: { id: row.id }, data: { encryptedValue: encryptSecuritySecret(purpose, plain), fingerprint: clusterSecretFingerprint(plain, purpose) } });
      summary.integrationSecrets += 1;
    }
    integrationCursor = String(rows[rows.length - 1].id);
    if (rows.length < pageSize) break;
  }

  return summary;
}
