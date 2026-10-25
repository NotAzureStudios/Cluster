import assert from "node:assert/strict";
import test from "node:test";
import { registerIdempotencyHooks } from "../../../apps/server/src/core/idempotency.js";

type Receipt = {
  id: string;
  userId: string;
  method: string;
  path: string;
  idempotencyKey: string;
  requestFingerprint: string;
  state: string;
  statusCode?: number | null;
  responsePayload?: string | null;
  requestId?: string | null;
  failureReason?: string | null;
  completedAt?: Date | null;
  updatedAt: Date;
};

function fakePrisma() {
  const receipts: Receipt[] = [];
  let sequence = 0;
  const matches = (row: Receipt, where: any) => Object.entries(where || {}).every(([key, value]) => {
    if (key === "updatedAt" || key === "completedAt") return true;
    if (key === "state" && value && typeof value === "object" && "in" in value) return (value as any).in.includes(row.state);
    return (row as any)[key] === value;
  });
  return {
    receipts,
    apiMutationReceipt: {
      async create(args: any) {
        const data = args.data;
        if (receipts.some((row) => row.userId === data.userId && row.method === data.method && row.path === data.path && row.idempotencyKey === data.idempotencyKey)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        const row: Receipt = { id: `r${++sequence}`, updatedAt: new Date(), ...data };
        receipts.push(row);
        return row;
      },
      async findFirst(args: any) {
        return receipts.find((row) => matches(row, args.where)) || null;
      },
      async updateMany(args: any) {
        let count = 0;
        for (const row of receipts) {
          if (!matches(row, args.where)) continue;
          Object.assign(row, args.data, { updatedAt: new Date() });
          count += 1;
        }
        return { count };
      },
      async deleteMany(args: any) {
        if (args?.where?.state || args?.where?.completedAt) return { count: 0 };
        return { count: 0 };
      },
    },
  };
}

function harness() {
  const hooks = new Map<string, Function[]>();
  const prisma = fakePrisma();
  const app: any = {
    log: { warn() {}, error() {} },
    addHook(name: string, fn: Function) {
      const list = hooks.get(name) || [];
      list.push(fn);
      hooks.set(name, list);
    },
  };
  registerIdempotencyHooks(app, prisma as any);
  return { hooks, prisma };
}

function request(key: string, body: unknown = { name: "Cluster" }, url = "/api/projects?b=2&a=1") {
  return {
    method: "POST",
    url,
    body,
    id: crypto.randomUUID(),
    headers: { "x-cluster-idempotency-key": key },
    clusterUser: { id: "user-1" },
    log: { error() {}, warn() {} },
  } as any;
}

function reply() {
  const headers = new Map<string, unknown>();
  return {
    sent: false,
    statusCode: 200,
    body: undefined as unknown,
    code(status: number) { this.statusCode = status; return this; },
    header(name: string, value: unknown) { headers.set(name.toLowerCase(), value); return this; },
    getHeader(name: string) { return headers.get(name.toLowerCase()); },
    send(body: unknown) { this.sent = true; this.body = body; return this; },
  } as any;
}

async function pre(h: ReturnType<typeof harness>, req: any, rep: any) {
  for (const fn of h.hooks.get("preHandler") || []) await fn(req, rep);
}

async function send(h: ReturnType<typeof harness>, req: any, rep: any, payload: unknown) {
  let current = payload;
  for (const fn of h.hooks.get("onSend") || []) current = await fn(req, rep, current);
  return current;
}

async function fail(h: ReturnType<typeof harness>, req: any, rep: any, error: Error) {
  for (const fn of h.hooks.get("onError") || []) await fn(req, rep, error);
}

test("durable preclaim prevents concurrent duplicate execution and replays the completed result", async () => {
  const h = harness();
  const first = request("mutation-key-0001");
  const firstReply = reply();
  await pre(h, first, firstReply);
  assert.equal(firstReply.sent, false);
  assert.equal(h.prisma.receipts.length, 1);
  assert.equal(h.prisma.receipts[0].state, "processing");

  const concurrent = request("mutation-key-0001");
  const concurrentReply = reply();
  await pre(h, concurrent, concurrentReply);
  assert.equal(concurrentReply.statusCode, 409);
  assert.equal((concurrentReply.body as any).code, "IDEMPOTENCY_IN_PROGRESS");
  assert.equal(h.prisma.receipts.length, 1);

  firstReply.statusCode = 201;
  await send(h, first, firstReply, JSON.stringify({ ok: true, id: "project-1" }));
  assert.equal(h.prisma.receipts[0].state, "complete");

  const retry = request("mutation-key-0001");
  const retryReply = reply();
  await pre(h, retry, retryReply);
  assert.equal(retryReply.statusCode, 201);
  assert.deepEqual(retryReply.body, { ok: true, id: "project-1" });
  assert.equal(retryReply.getHeader("X-Cluster-Idempotency-Replayed"), "true");
});

test("same idempotency key cannot be reused for different request content", async () => {
  const h = harness();
  const first = request("mutation-key-0002", { name: "A" });
  await pre(h, first, reply());

  const changed = request("mutation-key-0002", { name: "B" });
  const changedReply = reply();
  await pre(h, changed, changedReply);
  assert.equal(changedReply.statusCode, 409);
  assert.equal((changedReply.body as any).code, "IDEMPOTENCY_KEY_REUSED");
});

test("a failed or abandoned execution becomes uncertain instead of being executed again", async () => {
  const h = harness();
  const first = request("mutation-key-0003");
  const firstReply = reply();
  await pre(h, first, firstReply);
  await fail(h, first, firstReply, new Error("connection vanished after write"));
  assert.equal(h.prisma.receipts[0].state, "uncertain");

  const retry = request("mutation-key-0003");
  const retryReply = reply();
  await pre(h, retry, retryReply);
  assert.equal(retryReply.statusCode, 409);
  assert.equal((retryReply.body as any).code, "IDEMPOTENCY_RESULT_UNKNOWN");
});

test("query ordering is canonical but query value changes are not treated as the same mutation", async () => {
  const h = harness();
  const first = request("mutation-key-0004", { value: 1 }, "/api/items?b=2&a=1");
  await pre(h, first, reply());

  const reordered = request("mutation-key-0004", { value: 1 }, "/api/items?a=1&b=2");
  const reorderedReply = reply();
  await pre(h, reordered, reorderedReply);
  assert.equal((reorderedReply.body as any).code, "IDEMPOTENCY_IN_PROGRESS");

  const changed = request("mutation-key-0004", { value: 1 }, "/api/items?a=1&b=3");
  const changedReply = reply();
  await pre(h, changed, changedReply);
  assert.equal((changedReply.body as any).code, "IDEMPOTENCY_KEY_REUSED");
});

test("malformed supplied mutation keys fail closed before route execution", async () => {
  const h = harness();
  const req = request("bad key");
  const rep = reply();
  await pre(h, req, rep);
  assert.equal(rep.statusCode, 400);
  assert.equal((rep.body as any).code, "IDEMPOTENCY_KEY_INVALID");
  assert.equal(h.prisma.receipts.length, 0);
});
