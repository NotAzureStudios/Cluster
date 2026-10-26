import { useEffect, useRef } from "react";
import { api } from "../../core/api";
import type { ClusterKioskPolicy } from "./kiosk-policy";
import type { NativeKioskSessionMode } from "./use-native-kiosk-session";

export function useServerKioskSession(input: {
  active: boolean;
  sessionMode: NativeKioskSessionMode;
  policy: ClusterKioskPolicy;
  userId?: string | null;
}) {
  const previousActive = useRef(input.active);
  const startedProfileRef = useRef<string | null>(null);

  useEffect(() => {
    if (!input.active || input.sessionMode !== "signed-in" || !input.userId || !input.policy.profileId) return;
    if (startedProfileRef.current === input.policy.profileId) return;
    let cancelled = false;
    void api<{ ok: true }>("/api/kiosk/session/start", {
      method: "POST",
      body: JSON.stringify({ profileId: input.policy.profileId }),
      skipCacheInvalidation: true,
    }).then(() => {
      if (!cancelled) startedProfileRef.current = input.policy.profileId;
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [input.active, input.sessionMode, input.userId, input.policy.profileId]);

  useEffect(() => {
    const wasActive = previousActive.current;
    previousActive.current = input.active;
    if (input.active || !wasActive || input.sessionMode !== "signed-in" || !input.userId) return;
    startedProfileRef.current = null;
    void api("/api/kiosk/session/recover", {
      method: "POST",
      body: JSON.stringify({ reason: "native_inactive" }),
      skipCacheInvalidation: true,
    }).catch(() => undefined);
  }, [input.active, input.sessionMode, input.userId]);
}
