/** Backoff shared by visible workspace and active-job polls. */
export declare function refreshRetryDelayMs(intervalMs: number, consecutiveFailures: number, error: unknown, entropy?: number): number;
