import type { AudioOutputMode } from "@cluster/shared";
import { useEffect, useRef, useState } from "react";
import { AudioMonitoringGraph } from "./audio-monitoring-graph";

export type AudioMeterSnapshot = { supported: boolean; rms: number; peak: number; error: string | null };

export function useAudioMeter(element: HTMLMediaElement | null, outputMode: AudioOutputMode): AudioMeterSnapshot {
  const graphRef = useRef<AudioMonitoringGraph | null>(null);
  const [snapshot, setSnapshot] = useState<AudioMeterSnapshot>({ supported: true, rms: 0, peak: 0, error: null });

  useEffect(() => {
    let active = true;
    let frame = 0;
    if (!element || typeof window === "undefined" || (!window.AudioContext && !(window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)) {
      setSnapshot({ supported: false, rms: 0, peak: 0, error: element ? "Web Audio is unavailable." : null });
      return () => undefined;
    }
    try {
      const graph = new AudioMonitoringGraph(element);
      graphRef.current = graph;
      graph.setOutputMode(outputMode);
      let lastSampleAt = 0;
      const cancelFrame = () => { if (frame) window.cancelAnimationFrame(frame); frame = 0; };
      const schedule = () => {
        if (!active || frame || document.visibilityState !== "visible" || element.paused || element.ended) return;
        frame = window.requestAnimationFrame(sample);
      };
      const sample = (now: number) => {
        frame = 0;
        if (!active || document.visibilityState !== "visible" || element.paused || element.ended) return;
        if (now - lastSampleAt >= 33) {
          lastSampleAt = now;
          const value = graph.meter();
          setSnapshot({ supported: true, rms: value.rms, peak: value.peak, error: null });
        }
        schedule();
      };
      const onPlaybackState = () => {
        if (element.paused || element.ended) {
          cancelFrame();
          setSnapshot((current) => current.rms || current.peak ? { ...current, rms: 0, peak: 0 } : current);
          return;
        }
        schedule();
      };
      const onVisibility = () => {
        if (document.visibilityState !== "visible") cancelFrame();
        else schedule();
      };
      for (const event of ["play", "playing", "pause", "ended", "emptied"] as const) element.addEventListener(event, onPlaybackState);
      document.addEventListener("visibilitychange", onVisibility);
      schedule();
      return () => {
        active = false;
        cancelFrame();
        for (const event of ["play", "playing", "pause", "ended", "emptied"] as const) element.removeEventListener(event, onPlaybackState);
        document.removeEventListener("visibilitychange", onVisibility);
        const currentGraph = graphRef.current;
        graphRef.current = null;
        if (currentGraph) void currentGraph.dispose();
      };
    } catch (error) {
      setSnapshot({ supported: false, rms: 0, peak: 0, error: error instanceof Error ? error.message : "Audio metering is unavailable." });
    }
    return () => {
      active = false;
      if (frame) window.cancelAnimationFrame(frame);
      const graph = graphRef.current;
      graphRef.current = null;
      if (graph) void graph.dispose();
    };
  }, [element]);

  useEffect(() => { graphRef.current?.setOutputMode(outputMode); }, [outputMode]);
  return snapshot;
}
