import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeDataUrl,
  detectedMimeType,
  isExecutablePayload,
  isPotentiallyActiveContent,
  isSafeInlineUploadMime,
  mimePatternAllowed,
  resolvedUploadMime,
  safeFileName,
  safePathSegment
} from "../../../apps/server/src/core/uploads.js";

test("upload names cannot escape their storage directory", () => {
  assert.equal(safeFileName("../../release notes?.pdf"), "_.._release_notes_.pdf");
  assert.equal(safePathSegment("../project:alpha"), "project_alpha");
  assert.ok(safeFileName("a".repeat(200)).length <= 120);
  assert.ok(safePathSegment("a".repeat(200)).length <= 96);
});

test("base64 data URLs decode with their declared MIME type", () => {
  const decoded = decodeDataUrl("data:text/plain;base64,SGVsbG8=");
  assert.equal(decoded.buffer.toString("utf8"), "Hello");
  assert.equal(decoded.declaredMime, "text/plain");
  assert.throws(() => decodeDataUrl("data:text/plain,Hello"), /base64 data URL/);
  assert.throws(() => decodeDataUrl("data:text/plain;base64,"), /empty|valid base64/);
  assert.throws(() => decodeDataUrl("data:text/plain;base64,SGVsbG8=garbage"), /valid base64/);
  assert.throws(() => decodeDataUrl("data:text/plain;base64,SGVsbG8=", 4), /limit/);
});

test("file signature detection recognizes supported production formats", () => {
  assert.equal(detectedMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(detectedMimeType(Buffer.from("%PDF-1.7")), "application/pdf");
  assert.equal(detectedMimeType(Buffer.from([0x50, 0x4b, 0x03, 0x04])), "application/zip");
  assert.equal(detectedMimeType(Buffer.from("plain text")), "application/octet-stream");
  assert.equal(detectedMimeType(Buffer.from("<!doctype html><html></html>")), "text/html");
  assert.equal(detectedMimeType(Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")), "image/svg+xml");
});

test("server-derived MIME prevents active-content spoofing", () => {
  assert.equal(resolvedUploadMime(Buffer.from("<!doctype html><html></html>"), "photo.png", "image/png"), "text/html");
  assert.equal(resolvedUploadMime(Buffer.from("ordinary notes"), "notes.html", "text/html"), "text/plain");
  assert.equal(resolvedUploadMime(Buffer.from([0, 1, 2, 3]), "payload.html", "text/html"), "application/octet-stream");
  assert.equal(isPotentiallyActiveContent("text/html", "report.html"), true);
  assert.equal(isSafeInlineUploadMime("text/html", "report.html"), false);
  assert.equal(isSafeInlineUploadMime("image/png", "photo.png"), true);
});

test("executable uploads are detected by extension and file signature", () => {
  assert.equal(isExecutablePayload(Buffer.from("plain"), "installer.exe"), true);
  assert.equal(isExecutablePayload(Buffer.from("MZstub"), "photo.jpg"), true);
  assert.equal(isExecutablePayload(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0]), "notes.txt"), true);
  assert.equal(isExecutablePayload(Buffer.from("hello"), "notes.txt"), false);
  assert.equal(isExecutablePayload(Buffer.from("WScript.Echo 1"), "script.vbs"), true);
  assert.equal(isExecutablePayload(Buffer.from("#!/usr/bin/env bash\necho hi"), "notes.txt"), true);
  assert.equal(safeFileName("CON"), "_CON");
});

test("MIME allowlists support exact and wildcard matches", () => {
  assert.equal(mimePatternAllowed("image/png", "image/*,application/pdf"), true);
  assert.equal(mimePatternAllowed("application/pdf", "image/*,application/pdf"), true);
  assert.equal(mimePatternAllowed("text/html", "image/*,application/pdf"), false);
});
