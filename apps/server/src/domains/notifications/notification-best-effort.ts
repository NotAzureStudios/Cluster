/** A post-commit notification side effect must never change the result of
 * the authoritative database mutation. Both synchronous errors and rejected
 * promises are captured; even a broken logger cannot reject the caller.
 */
export function runNotificationSideEffect(
  work: () => unknown | Promise<unknown>,
  onError?: (error: unknown) => void,
): void {
  const report = (error: unknown) => {
    try { onError?.(error); } catch { /* Logging is not mutation authority. */ }
  };
  try { void Promise.resolve(work()).catch(report); }
  catch (error) { report(error); }
}
