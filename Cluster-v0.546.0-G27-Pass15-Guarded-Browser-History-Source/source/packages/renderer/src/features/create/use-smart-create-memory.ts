import { useCallback } from "react";
import { useServerState } from "../../core/server-state";
import { type SmartCreateMemory } from "../../core/smart-interface";

export function useSmartCreateMemory(_userId: string) {
  const [byMode, setByMode, state] = useServerState<Record<string, SmartCreateMemory>>("user", "smart.create-memory", {});

  const read = useCallback((mode: string) => byMode[mode], [byMode]);

  const save = useCallback((mode: string, memory: SmartCreateMemory) => {
    setByMode((current) => ({ ...current, [mode]: memory }));
  }, [setByMode]);

  return { read, save, hydrated: state.hydrated };
}
