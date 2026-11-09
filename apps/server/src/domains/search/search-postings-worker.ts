import { parentPort } from "node:worker_threads";
import { buildPostings } from "./search-index-builder.js";
import type { SearchIndexItem } from "./search-index-types.js";

type PostingRequest = { id: number; tokenRows: string[][] };

// The worker receives only normalized posting tokens. It never receives raw
// Projects, files, users, authorization rules, sessions, or a database handle.
parentPort?.on("message", (request: PostingRequest) => {
  try {
    if (!Number.isSafeInteger(request?.id) || !Array.isArray(request?.tokenRows) || request.tokenRows.length > 20_000) {
      throw new Error("Invalid search posting batch.");
    }
    const items = request.tokenRows.map((tokens) => ({ tokens })) as SearchIndexItem[];
    const postings = buildPostings(items);
    parentPort?.postMessage({ id: request.id, postings });
  } catch {
    // Do not expose indexed text or worker details across the worker boundary.
    parentPort?.postMessage({ id: request?.id, error: "SEARCH_POSTINGS_WORKER_FAILED" });
  }
});
