/**
 * Disposable PostgreSQL 18 invitation migration and concurrency certification.
 * Uses the actual SQL migration inside an isolated random schema. No real
 * Cluster accounts, tokens or installation are accessed.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";

const url=process.env.ACCOUNT_INVITATION_CERT_DATABASE_URL || "";
if (process.env.ACCOUNT_INVITATION_CERT_DISPOSABLE !== "I_UNDERSTAND" ||
    !/^postgres(?:ql)?:\/\//.test(url)) {
  console.error("BLOCKED: set ACCOUNT_INVITATION_CERT_DISPOSABLE=I_UNDERSTAND and a disposable PostgreSQL URL.");
  process.exit(2);
}

const schema=`invitation_cert_${randomBytes(8).toString("hex")}`;
const clients=[new Client({connectionString:url}),new Client({connectionString:url})];
let schemaCreated=false, passed=0;
async function check(name,fn){await fn();passed++;console.log("PASS",name);}
try {
  await Promise.all(clients.map(c=>c.connect()));
  const [a,b]=clients;
  const version=await a.query("SHOW server_version_num");
  assert.equal(Math.floor(Number(version.rows[0].server_version_num)/10000),18);
  await a.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated=true;
  await Promise.all(clients.map(async c=>{
    await c.query(`SET search_path TO "${schema}"`);
    await c.query("SET statement_timeout='15000ms'");
    await c.query("SET lock_timeout='10000ms'");
  }));

  await a.query('CREATE TABLE "Workspace" ("id" TEXT PRIMARY KEY)');
  await a.query('CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "accountState" TEXT NOT NULL, "authenticationGeneration" INTEGER NOT NULL, "passwordHash" TEXT, "passwordChangedAt" TIMESTAMP(3), "archived" BOOLEAN NOT NULL DEFAULT FALSE, "accessExpiresAt" TIMESTAMP(3))');
  const sql=await readFile("apps/server/prisma/migrations/20261116000000_v11_account_activation_invitations/migration.sql","utf8");
  await a.query(sql);

  await a.query('INSERT INTO "Workspace" ("id") VALUES ($1)',["studio-a"]);
  await a.query('INSERT INTO "User" ("id","accountState","authenticationGeneration") VALUES ($1,$2,$3),($4,$5,$6)',
    ["owner","ACTIVE",3,"pending","PASSWORD_CHANGE_REQUIRED",2]);

  await check("Migration has unique hash, FK, and account-scoped lifecycle indexes",async()=>{
    const idx=await a.query("SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND tablename='StudioAccountInvitation'",[schema]);
    const names=idx.rows.map(x=>x.indexname).join(";");
    assert.match(names,/tokenHash_key/);
    assert.match(names,/userId_consumedAt_revokedAt_expiresAt_idx/);
    const fks=await a.query("SELECT COUNT(*)::int AS n FROM pg_constraint WHERE conrelid=$1::regclass AND contype='f'",[`${schema}."StudioAccountInvitation"`]);
    assert.equal(fks.rows[0].n,4);
  });

  const insert=async(id,digest,expiry="NOW() + interval '1 hour'")=>
    a.query(`INSERT INTO "StudioAccountInvitation" ("id","workspaceId","userId","issuedById","tokenHash","authGeneration","expiresAt")
      VALUES ($1,'studio-a','pending','owner',$2,2,${expiry})`,[id,digest]);

  await insert("ticket-1","digest-1");
  await check("Hash-only storage enforces ticket digest uniqueness",async()=>{
    await assert.rejects(insert("ticket-duplicate","digest-1"),/duplicate key|unique constraint/i);
    const rows=await a.query('SELECT "tokenHash" FROM "StudioAccountInvitation"');
    assert.deepEqual(rows.rows.map(x=>x.tokenHash),["digest-1"]);
  });

  await check("Concurrent redemption of one token can only succeed once",async()=>{
    const redeem=(client)=>client.query(
      'UPDATE "StudioAccountInvitation" SET "consumedAt"=NOW() WHERE "id"=$1 AND "consumedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt">NOW() RETURNING "id"',
      ["ticket-1"]);
    const results=await Promise.all([redeem(a),redeem(b)]);
    assert.deepEqual(results.map(x=>x.rowCount).sort(),[0,1]);
  });

  await check("Account generation CAS blocks stale parallel activation/issuance",async()=>{
    const mutate=(client)=>client.query(
      'UPDATE "User" SET "authenticationGeneration"="authenticationGeneration"+1 WHERE "id"=$1 AND "authenticationGeneration"=$2 AND "accountState"=$3 AND "passwordChangedAt" IS NULL RETURNING "authenticationGeneration"',
      ["pending",2,"PASSWORD_CHANGE_REQUIRED"]);
    const changes=await Promise.all([mutate(a),mutate(b)]);
    assert.deepEqual(changes.map(x=>x.rowCount).sort(),[0,1]);
    assert.equal((await a.query('SELECT "authenticationGeneration" FROM "User" WHERE "id"=$1',["pending"])).rows[0].authenticationGeneration,3);
  });

  await insert("ticket-expired","digest-expired","NOW() - interval '1 minute'");
  await insert("ticket-revoked","digest-revoked");
  await a.query('UPDATE "StudioAccountInvitation" SET "revokedAt"=NOW() WHERE "id"=$1',["ticket-revoked"]);
  await check("Expired, consumed, and revoked tickets all refuse replay",async()=>{
    const ids=["ticket-1","ticket-expired","ticket-revoked"];
    for(const id of ids){
      const res=await a.query('UPDATE "StudioAccountInvitation" SET "consumedAt"=NOW() WHERE "id"=$1 AND "consumedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt">NOW() RETURNING "id"',[id]);
      assert.equal(res.rowCount,0,id);
    }
  });

  await insert("ticket-rollback","digest-rollback");
  await check("A rejected account mutation must roll back token consumption",async()=>{
    await a.query("BEGIN");
    try {
      const claim=await a.query('UPDATE "StudioAccountInvitation" SET "consumedAt"=NOW() WHERE "id"=$1 AND "consumedAt" IS NULL RETURNING "id"',["ticket-rollback"]);
      assert.equal(claim.rowCount,1);
      const badUser=await a.query('UPDATE "User" SET "passwordHash"=$1 WHERE "id"=$2 AND "authenticationGeneration"=$3 RETURNING "id"',["hash","pending",2]);
      assert.equal(badUser.rowCount,0);
      await a.query("ROLLBACK");
    } catch(error) {await a.query("ROLLBACK");throw error;}
    const row=await a.query('SELECT "consumedAt" FROM "StudioAccountInvitation" WHERE "id"=$1',["ticket-rollback"]);
    assert.equal(row.rows[0].consumedAt,null);
  });

  await check("FK constraints reject invitation records for absent users",async()=>{
    await assert.rejects(a.query(
      'INSERT INTO "StudioAccountInvitation" ("id","workspaceId","userId","issuedById","tokenHash","authGeneration","expiresAt") VALUES ($1,$2,$3,$4,$5,$6,NOW())',
      ["orphan","studio-a","not-existing","owner","other-digest",1]),/foreign key constraint/i);
  });
  console.log(`Disposable PostgreSQL invitation certification: ${passed} checks passed.`);
} finally {
  if(schemaCreated){
    const cleanup=new Client({connectionString:url});
    try {await cleanup.connect();await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}
    finally{await cleanup.end();}
  }
  await Promise.all(clients.map(c=>c.end().catch(()=>{})));
}
