import { SYSTEM_ALERT_KEYS, validateAlertPolicy, type AlertRoutingPolicy } from "./operations-incident-alert-routing.js";

export type AlertPolicyMutation = AlertRoutingPolicy & { expectedRevision: number };

export class OperationsAlertPolicyConflict extends Error {
  constructor() { super("OPERATIONS_ALERT_POLICY_CONFLICT"); this.name = "OperationsAlertPolicyConflict"; }
}

/**
 * All policies in one Security-PIN-approved draft are written in one transaction.
 * The caller performs PIN authorization before entry. Any revision conflict
 * throws and rolls back the entire batch, not only the failing policy.
 */
export async function commitOperationsAlertPolicyBatch(prisma: any, policies: readonly AlertPolicyMutation[], actorId: string) {
  if (!policies.length || policies.length > SYSTEM_ALERT_KEYS.length ||
      new Set(policies.map((policy) => policy.key)).size !== policies.length ||
      policies.some((policy) => !validateAlertPolicy(policy) || !Number.isInteger(policy.expectedRevision) || policy.expectedRevision < 0)) {
    throw new Error("OPERATIONS_ALERT_POLICY_INVALID_BATCH");
  }
  return prisma.$transaction(async (tx: any) => {
    const result = [];
    for (const policy of policies) {
      const { key, expectedRevision, ...data } = policy;
      if (expectedRevision === 0) {
        result.push(await tx.operationsAlertPolicy.create({ data: { key, ...data, updatedById: actorId } }));
      } else {
        const claim = await tx.operationsAlertPolicy.updateMany({ where: { key, revision: expectedRevision }, data: {
          ...data, revision: { increment: 1 }, updatedById: actorId,
        } });
        if (claim.count !== 1) throw new OperationsAlertPolicyConflict();
        result.push(await tx.operationsAlertPolicy.findUnique({ where: { key } }));
      }
    }
    return result;
  });
}
