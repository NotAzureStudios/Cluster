import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLibraryFolderPath,
  libraryDisplayTitle,
  libraryFacetCounts,
  libraryFileExtension,
  libraryMimeGroup,
  libraryPreviewKind,
  librarySort,
  makeLibraryPreviewText,
  normalizeLibraryMetadata,
  parseLibraryMetadata,
  wouldCreateLibraryCycle
} from "../../../apps/server/src/core/library.js";

test("Library MIME groups and preview kinds classify browser-friendly files", () => {
  assert.equal(libraryMimeGroup("image/png"), "image");
  assert.equal(libraryMimeGroup("video/mp4"), "video");
  assert.equal(libraryMimeGroup("audio/ogg"), "audio");
  assert.equal(libraryMimeGroup("application/pdf"), "pdf");
  assert.equal(libraryMimeGroup("application/json"), "text");
  assert.equal(libraryMimeGroup("application/zip"), "archive");
  assert.equal(libraryMimeGroup("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "office");
  assert.equal(libraryPreviewKind({ type: "folder" }), "folder");
  assert.equal(libraryPreviewKind({ mimeType: "image/webp" }), "image");
  assert.equal(libraryPreviewKind({ mimeType: "application/octet-stream", previewText: "fallback" }), "text");
  assert.equal(libraryPreviewKind({ externalUrl: "https://example.com" }), "external");
  assert.equal(libraryPreviewKind({}), "document");
});

test("Library metadata accepts bounded scalar values and discards unsafe shapes", () => {
  const metadata = normalizeLibraryMetadata({
    engine: "Unreal 5.7",
    build: 42,
    approved: true,
    note: null,
    nested: { nope: true },
    list: ["nope"],
    infinite: Number.POSITIVE_INFINITY,
    "  normalized  ": "value"
  });
  assert.deepEqual(metadata, {
    engine: "Unreal 5.7",
    build: 42,
    approved: true,
    note: null,
    normalized: "value"
  });
  assert.deepEqual(parseLibraryMetadata(JSON.stringify(metadata)), metadata);
  assert.deepEqual(parseLibraryMetadata("not-json"), {});
});

test("Library file names produce stable titles and extensions", () => {
  assert.equal(libraryFileExtension("Environment.Reference.V003.PDF"), "pdf");
  assert.equal(libraryFileExtension("README"), null);
  assert.equal(libraryDisplayTitle("Environment.Reference.V003.PDF"), "Environment.Reference.V003");
  assert.equal(libraryDisplayTitle(""), "Untitled file");
});

test("Library text previews reject binary and oversized files", () => {
  assert.equal(makeLibraryPreviewText(Buffer.from("hello\u0000 world"), "text/plain"), "hello world");
  assert.equal(makeLibraryPreviewText(Buffer.from("binary"), "application/octet-stream"), null);
  assert.equal(makeLibraryPreviewText(Buffer.alloc(20), "text/plain", 10), null);
});

test("Library folder paths and cycle detection survive malformed trees", () => {
  const folders = [
    { id: "root-a", parentId: null, title: "Art" },
    { id: "child-b", parentId: "root-a", title: "Characters" },
    { id: "child-c", parentId: "child-b", title: "Hero" }
  ];
  assert.deepEqual(buildLibraryFolderPath(folders, "child-c"), [
    { id: "root-a", title: "Art" },
    { id: "child-b", title: "Characters" },
    { id: "child-c", title: "Hero" }
  ]);
  assert.equal(wouldCreateLibraryCycle(folders, "root-a", "child-c"), true);
  assert.equal(wouldCreateLibraryCycle(folders, "child-c", "root-a"), false);
  assert.equal(wouldCreateLibraryCycle(folders, "child-b", "child-b"), true);
});

test("Library facets and sorting expose useful browser controls", () => {
  const facets = libraryFacetCounts([
    { type: "file", status: "active", mimeType: "image/png", pinned: true, projectId: "p1" },
    { type: "file", status: "active", mimeType: "application/pdf", pinned: false, projectId: null },
    { type: "folder", status: "archived", mimeType: null, pinned: false, projectId: null }
  ]);
  assert.equal(facets.total, 3);
  assert.equal(facets.pinned, 1);
  assert.equal(facets.projectLinked, 1);
  assert.deepEqual(facets.byType, { file: 2, folder: 1 });
  assert.deepEqual(facets.byMimeGroup, { image: 1, pdf: 1, other: 1 });
  assert.deepEqual(librarySort("title-asc"), [{ title: "asc" }, { id: "asc" }]);
  assert.deepEqual(librarySort("anything-else"), [{ updatedAt: "desc" }, { id: "desc" }]);
});
