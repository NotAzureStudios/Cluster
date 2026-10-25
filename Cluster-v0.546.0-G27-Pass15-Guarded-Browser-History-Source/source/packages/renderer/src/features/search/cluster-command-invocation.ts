/** Invokes a command during the original user gesture and keeps one command
 * active until its async result settles. A returned `false` is an explicit
 * failure (clipboard/native bridges use it), not a successful command. */
export function createClusterCommandInvocation() {
  let active = false;
  return {
    isExecuting: () => active,
    run(action: () => void | boolean | Promise<void | boolean>): Promise<boolean> | null {
      if (active) return null;
      active = true;
      let result: void | boolean | Promise<void | boolean>;
      try {
        // Do not put this behind Promise.resolve().then(): clipboard and native
        // popups require the initiating pointer/keyboard activation.
        result = action();
      } catch {
        active = false;
        return Promise.resolve(false);
      }
      return Promise.resolve(result).then((value) => value !== false, () => false).finally(() => {
        active = false;
      });
    },
  };
}
