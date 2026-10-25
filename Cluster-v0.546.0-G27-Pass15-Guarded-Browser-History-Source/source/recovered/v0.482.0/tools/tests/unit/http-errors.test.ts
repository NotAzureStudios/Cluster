import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { normalizeHttpError } from "../../../apps/server/src/core/http-errors";

test("HTTP errors expose validation detail without exposing internal failures", () => {
  const validation = normalizeHttpError(z.object({ name: z.string().min(2) }).safeParse({ name: "" }).error, "req-1");
  assert.equal(validation.statusCode, 400);
  assert.equal(validation.body.code, "VALIDATION_ERROR");
  assert.equal(validation.body.requestId, "req-1");
  assert.equal(validation.body.issues?.[0]?.path, "name");

  const internal = normalizeHttpError(new Error("database password appeared here"), "req-2");
  assert.equal(internal.statusCode, 500);
  assert.equal(internal.body.error, "The server could not complete this request.");
  assert.doesNotMatch(JSON.stringify(internal.body), /database password/);
});

test("common persistence conflicts map to stable API responses", () => {
  assert.equal(normalizeHttpError({ code: "P2025" }).statusCode, 404);
  assert.equal(normalizeHttpError({ code: "P2002" }).statusCode, 409);
  assert.equal(normalizeHttpError({ code: "FST_ERR_CTP_BODY_TOO_LARGE" }).statusCode, 413);
});
