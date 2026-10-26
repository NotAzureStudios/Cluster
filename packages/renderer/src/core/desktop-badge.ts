/**
 * Desktop's badge is a process-global output, not component-local Inbox state.
 * Serialize bridge calls and drop superseded counts, including late lazy
 * imports, so a slow older response cannot overwrite the latest account's
 * authoritative summary. No native Desktop code is imported at startup.
 */
export function createLatestSerializedWriter<T>() {
  let revision = 0;
  let tail: Promise<void> = Promise.resolve();
  return (value: T, write: (next: T) => void | Promise<void>): Promise<void> => {
    const mine = ++revision;
    tail = tail.catch(() => undefined).then(async () => {
      if (mine === revision) await write(value);
    });
    return tail;
  };
}

const submitBadge = createLatestSerializedWriter<number>();
export function setAuthoritativeDesktopBadge(raw: unknown): Promise<void> {
  const value = Number(raw);
  const count = Number.isFinite(value) ? Math.max(0, Math.min(100000, Math.floor(value))) : 0;
  return submitBadge(count, async (next) => {
    const { setDesktopBadge } = await import("./desktop");
    await setDesktopBadge(next);
  }).catch(() => undefined);
}
