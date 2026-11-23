// Uploads running right now in this window. Queued/failed uploads live in the
// offline store; this covers the online path so the Transfer Center can show
// progress while bytes are moving.
export type LiveUpload = { id: string; fileName: string; totalBytes: number; receivedBytes: number; phase: "staging" | "verifying" | "finalizing"; startedAt: number };

let uploads: LiveUpload[] = [];
const listeners = new Set<() => void>();
const publish = () => { for (const listener of listeners) listener(); };

export function getLiveUploads() { return uploads; }
export function subscribeLiveUploads(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function startLiveUpload(fileName: string, totalBytes: number) {
  const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  uploads = [...uploads, { id, fileName, totalBytes, receivedBytes: 0, phase: "staging", startedAt: Date.now() }];
  publish();
  let lastPublish = 0;
  return {
    update(receivedBytes: number, phase: LiveUpload["phase"]) {
      const now = Date.now();
      uploads = uploads.map((upload) => upload.id === id ? { ...upload, receivedBytes, phase } : upload);
      // Progress events can be very frequent; repaint at most ~8 times a second.
      if (now - lastPublish > 120 || phase !== "staging") { lastPublish = now; publish(); }
    },
    end() {
      uploads = uploads.filter((upload) => upload.id !== id);
      publish();
    },
  };
}
