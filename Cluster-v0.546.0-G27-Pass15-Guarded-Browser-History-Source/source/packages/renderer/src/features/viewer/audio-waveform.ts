import { DEFAULT_RESOURCE_BUDGETS, type ViewableResource, type WaveformData } from "@cluster/shared";
import { useEffect, useMemo, useState } from "react";
import { absoluteViewerResourceUrl, fetchViewerResourceResponse } from "./viewer-resource-loader";

export type AudioWaveformLoadState = {
  state: "idle" | "loading" | "ready" | "error" | "unavailable";
  data: WaveformData | null;
  error: unknown;
  derivativeId: string | null;
};

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function validateWaveform(value: unknown): WaveformData {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Waveform artifact is not a valid object.");
  const input = value as Record<string, unknown>;
  if (Number(input.version) !== 1) throw new Error("Unsupported waveform artifact version.");
  const durationSeconds = Math.max(0, finite(input.durationSeconds));
  const sampleRateHz = Math.max(0, finite(input.sampleRateHz));
  const binsPerSecond = Math.max(0, finite(input.binsPerSecond));
  const sourceChannels = Array.isArray(input.channels) ? input.channels.slice(0, 16) : [];
  if (!sourceChannels.length) throw new Error("Waveform artifact has no channels.");
  let totalBins = 0;
  const channels = sourceChannels.map((channel, index) => {
    const item = channel && typeof channel === "object" && !Array.isArray(channel) ? channel as Record<string, unknown> : {};
    const raw = Array.isArray(item.samples) ? item.samples : [];
    totalBins += raw.length;
    if (raw.length > DEFAULT_RESOURCE_BUDGETS.maxWaveformBins || totalBins > DEFAULT_RESOURCE_BUDGETS.maxWaveformBins * 16) throw new Error("Waveform artifact exceeds the configured bin budget.");
    const samples = raw.map((sample) => Math.max(0, Math.min(1, finite(sample))));
    return {
      id: String(item.id || `channel:${index}`),
      label: typeof item.label === "string" ? item.label.slice(0, 120) : null,
      samples,
      peak: item.peak == null ? null : Math.max(0, Math.min(1, finite(item.peak))),
      rms: item.rms == null ? null : Math.max(0, Math.min(1, finite(item.rms))),
    };
  });
  return { version: 1, durationSeconds, sampleRateHz, binsPerSecond, channels };
}

export function useAudioWaveform(resource: ViewableResource): AudioWaveformLoadState {
  const derivative = useMemo(() => resource.derivatives.find((item) => item.kind === "waveform" && item.variantKey === "mix") || resource.derivatives.find((item) => item.kind === "waveform") || null, [resource]);
  const [state, setState] = useState<AudioWaveformLoadState>(() => derivative ? { state: "loading", data: null, error: null, derivativeId: derivative.id } : { state: "unavailable", data: null, error: null, derivativeId: null });

  useEffect(() => {
    const controller = new AbortController();
    if (!derivative?.url) {
      setState({ state: "unavailable", data: null, error: null, derivativeId: derivative?.id || null });
      return () => controller.abort();
    }
    if (Number(derivative.sizeBytes || 0) > 16 * 1024 * 1024) {
      setState({ state: "error", data: null, error: new Error("Waveform artifact exceeds the viewer byte budget."), derivativeId: derivative.id });
      return () => controller.abort();
    }
    setState({ state: "loading", data: null, error: null, derivativeId: derivative.id });
    void fetchViewerResourceResponse(absoluteViewerResourceUrl(derivative.url), { signal: controller.signal, headers: { Accept: "application/vnd.cluster.waveform+json, application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Waveform request failed (${response.status}).`);
        return validateWaveform(await response.json());
      })
      .then((data) => { if (!controller.signal.aborted) setState({ state: "ready", data, error: null, derivativeId: derivative.id }); })
      .catch((error) => { if (!controller.signal.aborted) setState({ state: "error", data: null, error, derivativeId: derivative.id }); });
    return () => controller.abort();
  }, [derivative?.id, derivative?.url, derivative?.sizeBytes]);

  return state;
}
