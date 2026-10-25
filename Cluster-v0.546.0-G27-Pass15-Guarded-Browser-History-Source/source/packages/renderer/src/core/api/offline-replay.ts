export function retryDelay(attempts: number) {
  const base = Math.min(5 * 60_000, 1_000 * 2 ** Math.min(Math.max(0, attempts), 8));
  return base + Math.floor(Math.random() * Math.max(250, base * 0.25));
}
