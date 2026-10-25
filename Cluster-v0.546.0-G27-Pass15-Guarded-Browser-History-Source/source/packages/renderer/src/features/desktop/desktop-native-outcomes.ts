/** Native broker replies must not be mistaken for success just because the promise resolved. */
export function requireNativeActionConfirmed(value: boolean, message: string): void {
  if (value !== true) throw new Error(message);
}

export function requireNativeOpenConfirmed(value: unknown, message: string): void {
  if (value === null || typeof value !== "object" || !("opened" in value) || value.opened !== true) {
    throw new Error(message);
  }
}
