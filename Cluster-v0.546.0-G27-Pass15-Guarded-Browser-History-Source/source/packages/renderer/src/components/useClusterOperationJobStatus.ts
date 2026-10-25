import { useEffect, useState } from "react";
import { api } from "../core/api";

const TERMINAL_STATES = new Set(["SUCCEEDED", "FAILED", "DEAD_LETTER", "CANCELLED"]);

type JobStatus = { status?: string | null };
type JobSnapshot<T> = { jobId: string; status: T | null; error: string };

/**
 * Job-ID scoped status. Never render a completed job's download controls for a
 * newly selected job, even during the render before React runs effects.
 * Idle/hidden tabs stop polling until visible again.
 */
export function useClusterOperationJobStatus<T extends JobStatus>(jobId: string | null | undefined, endpoint: string, fallbackError: string) {
  const [snapshot, setSnapshot] = useState<JobSnapshot<T>>({ jobId: "", status: null, error: "" });
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let pending = false;
    let terminal = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (active && !terminal && !document.hidden) timer = setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (!active || pending || terminal || document.hidden) return;
      pending = true;
      try {
        const next = await api<T>(`${endpoint}/${encodeURIComponent(jobId)}`);
        if (!active) return;
        terminal = TERMINAL_STATES.has(String(next.status || "").toUpperCase());
        setSnapshot({ jobId, status: next, error: "" });
        if (!terminal) schedule(1400);
      } catch (error) {
        if (!active) return;
        setSnapshot((prior) => ({ jobId, status: prior.jobId === jobId ? prior.status : null, error: error instanceof Error ? error.message : fallbackError }));
        schedule(2500);
      } finally { pending = false; }
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
      } else if (!terminal && !pending) {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void poll();
    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [jobId, endpoint, fallbackError]);
  return {
    status: jobId && snapshot.jobId === jobId ? snapshot.status : null,
    requestError: jobId && snapshot.jobId === jobId ? snapshot.error : "",
  };
}
