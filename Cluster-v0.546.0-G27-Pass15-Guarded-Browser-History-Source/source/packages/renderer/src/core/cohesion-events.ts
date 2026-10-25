const CHANNEL_NAME = "cluster-cohesion";
let channel: BroadcastChannel | null = null;

function cohesionChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

export function emitClusterCohesionEvent<T>(name: string, detail: T) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<T>(name, { detail }));
  try { cohesionChannel()?.postMessage({ name, detail }); } catch { /* local event still delivered */ }
}

export function subscribeClusterCohesionEvent<T>(name: string, handler: (detail: T) => void) {
  const local = (event: Event) => handler((event as CustomEvent<T>).detail);
  const remote = (event: MessageEvent) => {
    const payload = event.data as { name?: string; detail?: T } | null;
    if (payload?.name === name) handler(payload.detail as T);
  };
  window.addEventListener(name, local);
  const broadcast = cohesionChannel();
  broadcast?.addEventListener("message", remote);
  return () => {
    window.removeEventListener(name, local);
    broadcast?.removeEventListener("message", remote);
  };
}
