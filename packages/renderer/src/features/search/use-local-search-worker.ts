import { useEffect, useMemo, useRef, useState } from "react";
import { recordPerformanceMetric } from "../../core/performance";

export type LocalSearchWorkerDocument = {
  key: string;
  title: string;
  detail: string;
  text?: string;
  kind: string;
  updatedAt?: string | null;
};

type LocalSearchState = {
  scores: Map<string, number>;
  elapsedMs: number;
  candidateCount: number;
  workerReady: boolean;
};

export function useLocalSearchWorker(documents: LocalSearchWorkerDocument[], query: string, limit = 80, enabled = true): LocalSearchState {
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  const versionRef = useRef(0);
  const queryRef = useRef(query);
  const limitRef = useRef(limit);
  const [state, setState] = useState<LocalSearchState>({ scores: new Map(), elapsedMs: 0, candidateCount: documents.length, workerReady: false });
  const stableDocuments = useMemo(() => documents, [documents]);
  queryRef.current = query;
  limitRef.current = limit;

  useEffect(() => {
    if (!enabled || typeof Worker === "undefined") return;
    const worker = new Worker(new URL("./search-worker.ts", import.meta.url), { type: "module", name: "cluster-search-index" });
    workerRef.current = worker;
    const postCurrentSearch = () => {
      requestRef.current += 1;
      worker.postMessage({ type: "search", requestId: requestRef.current, version: versionRef.current, query: queryRef.current, limit: limitRef.current });
    };
    worker.onmessage = (event: MessageEvent<any>) => {
      const message = event.data || {};
      if (message.type === "indexed") {
        if (Number(message.version || 0) !== versionRef.current) return;
        setState((current) => ({ ...current, workerReady: true, candidateCount: Number(message.count || 0) }));
        postCurrentSearch();
        return;
      }
      if (message.type === "stale") {
        if (message.requestId === requestRef.current) postCurrentSearch();
        return;
      }
      if (message.type !== "results" || message.requestId !== requestRef.current || Number(message.version || 0) !== versionRef.current) return;
      const elapsedMs = Number(message.elapsedMs || 0);
      const candidateCount = Number(message.candidateCount || 0);
      setState({
        scores: new Map((message.scores || []).map((row: { key: string; score: number }) => [row.key, row.score])),
        elapsedMs,
        candidateCount,
        workerReady: true,
      });
      recordPerformanceMetric({
        name: "local search worker",
        category: "search",
        durationMs: elapsedMs,
        startedAt: Date.now() - elapsedMs,
        detail: { candidateCount, resultCount: Number(message.scores?.length || 0) },
      });
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    versionRef.current += 1;
    worker.postMessage({ type: "index", version: versionRef.current, documents: stableDocuments });
  }, [stableDocuments]);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    requestRef.current += 1;
    worker.postMessage({ type: "search", requestId: requestRef.current, version: versionRef.current, query, limit });
  }, [query, limit, stableDocuments]);

  return state;
}
