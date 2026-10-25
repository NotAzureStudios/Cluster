/**
 * Acquire PostgreSQL transaction-scoped advisory locks without asking Prisma to
 * deserialize PostgreSQL's native `void` return type. The explicit text cast is
 * intentional: `$queryRaw` cannot decode `void` on current Prisma/PostgreSQL.
 */
export async function acquireTransactionAdvisoryLock(transaction: any, key: string) {
  await transaction.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "lock"',
    key,
  );
}

export async function acquireTransactionAdvisoryLockPair(transaction: any, keyA: number, keyB: number) {
  await transaction.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock($1::integer, $2::integer)::text AS "lock"',
    keyA,
    keyB,
  );
}
