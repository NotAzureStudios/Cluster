export type ClusterDialogTone = "default" | "danger";

type ClusterDialogBase = {
  id: number;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: ClusterDialogTone;
};

export type ClusterConfirmDialogRequest = ClusterDialogBase & {
  kind: "confirm";
};

export type ClusterPromptDialogRequest = ClusterDialogBase & {
  kind: "prompt";
  label: string;
  initialValue: string;
  placeholder: string;
  expectedValue?: string;
};

export type ClusterDialogRequest = ClusterConfirmDialogRequest | ClusterPromptDialogRequest;

type PendingDialog = {
  request: ClusterDialogRequest;
  resolve: (value: boolean | string | null) => void;
};

type Listener = (request: ClusterDialogRequest | null) => void;

let nextDialogId = 1;
const queue: PendingDialog[] = [];
const listeners = new Set<Listener>();

function publish() {
  const request = queue[0]?.request ?? null;
  for (const listener of listeners) listener(request);
}

type ClusterDialogInput = Omit<ClusterConfirmDialogRequest, "id"> | Omit<ClusterPromptDialogRequest, "id">;

function enqueue<T extends boolean | string | null>(request: ClusterDialogInput): Promise<T> {
  return new Promise<T>((resolve) => {
    queue.push({
      request: { ...request, id: nextDialogId++ } as ClusterDialogRequest,
      resolve: (value) => resolve(value as T),
    });
    publish();
  });
}

export function subscribeClusterDialogs(listener: Listener) {
  listeners.add(listener);
  listener(queue[0]?.request ?? null);
  return () => { listeners.delete(listener); };
}

export function settleClusterDialog(id: number, value: boolean | string | null) {
  const pending = queue[0];
  if (!pending || pending.request.id !== id) return;
  queue.shift();
  pending.resolve(value);
  publish();
}

export function confirmCluster(options: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ClusterDialogTone;
}) {
  return enqueue<boolean>({
    kind: "confirm",
    title: options.title,
    message: options.message,
    confirmLabel: options.confirmLabel ?? "Confirm",
    cancelLabel: options.cancelLabel ?? "Cancel",
    tone: options.tone ?? "default",
  });
}

export function promptCluster(options: {
  title: string;
  message: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  expectedValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ClusterDialogTone;
}) {
  return enqueue<string | null>({
    kind: "prompt",
    title: options.title,
    message: options.message,
    label: options.label ?? "Value",
    initialValue: options.initialValue ?? "",
    placeholder: options.placeholder ?? "",
    expectedValue: options.expectedValue,
    confirmLabel: options.confirmLabel ?? "Continue",
    cancelLabel: options.cancelLabel ?? "Cancel",
    tone: options.tone ?? "default",
  });
}
