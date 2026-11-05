import { useEffect, useRef, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterSettingsChoiceGroup, ClusterSettingsRow, ClusterSettingsSection } from "../../components/ClusterSettingsPrimitives";
import { downloadPerformanceReport, performanceSummary, startPerformanceFrameSampling, type PerformanceSummary } from "../../core/performance";
import { getRendererCapabilitiesSnapshot, subscribeRendererCapabilities } from "../../core/render-capabilities";
import {
  DEFAULT_DEVICE_PERFORMANCE_PREFERENCES,
  readDevicePerformancePreferences,
  writeDevicePerformancePreferences,
  type DevicePerformancePreferences,
  type DevicePerformanceProfile,
  type DeviceRendererQuality,
} from "../../core/device-performance";

/**
 * Performance preferences are browser/device-local, applied immediately,
 * and intentionally do not enter the account settings save/draft authority.
 */
export function DevicePerformanceSettingsSection() {
  const [preferences, setPreferences] = useState<DevicePerformancePreferences>(readDevicePerformancePreferences);
  const [capabilities, setCapabilities] = useState(getRendererCapabilitiesSnapshot);
  const [storageError, setStorageError] = useState(false);
  const [report, setReport] = useState<PerformanceSummary | null>(null);
  const [sampling, setSampling] = useState(false);
  const [samplingError, setSamplingError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeRendererCapabilities(() => setCapabilities(getRendererCapabilitiesSnapshot()));
    return () => { unsubscribe(); };
  }, []);

  function update(changes: Partial<DevicePerformancePreferences>) {
    const next = { ...preferences, ...changes };
    if (writeDevicePerformancePreferences(next)) {
      setPreferences(next);
      setStorageError(false);
    } else {
      setStorageError(true);
    }
  }

  function captureFrameSample() {
    setSamplingError(null);
    const started = startPerformanceFrameSampling(5_000, () => {
      if (!mountedRef.current) return;
      setSampling(false);
      setReport(performanceSummary());
    });
    if (!started) {
      setSamplingError("Frame sampling is unavailable while the window is hidden or a capture is already running.");
      return;
    }
    setSampling(true);
  }

  return <div className="settings-section-v092" id="account-performance-controls-v1">
    <div className="settings-panel-head-v092">
      <div>
        <p className="eyebrow">This device</p>
        <h2>Performance</h2>
        <p className="muted">Tune visual effects on this browser or Desktop renderer without changing server resource limits.</p>
      </div>
      <ClusterButton type="button" variant="secondary" onClick={() => update(DEFAULT_DEVICE_PERFORMANCE_PREFERENCES)}>
        Restore defaults
      </ClusterButton>
    </div>
    <div className="settings-card-v092">
      <ClusterSettingsSection
        title="Rendering profile"
        summary="Automatic uses detected hardware and OS accessibility settings. Other profiles override visual fidelity only."
      >
        <ClusterSettingsChoiceGroup<DevicePerformanceProfile>
          label="Rendering performance profile"
          value={preferences.profile}
          onChange={(profile) => update({ profile })}
          options={[
            { value: "automatic", label: "Automatic", description: "Choose an effect budget based on device capabilities." },
            { value: "efficient", label: "Efficient", description: "Minimize decorative rendering effects." },
            { value: "balanced", label: "Balanced", description: "Moderate visual effects and rendering overhead." },
            { value: "performance", label: "Performance", description: "Favor responsive interactions by reducing decorative effects." },
            { value: "custom", label: "Custom", description: "Choose the rendering quality budget directly." },
          ]}
        />
        {preferences.profile === "custom" && <ClusterSettingsRow
          label="Effect quality"
          description="Controls the existing shared renderer-effects budget. It does not force WebGL or a frame rate."
          controlId="cluster-device-effect-quality"
        >
          <select
            id="cluster-device-effect-quality"
            className="input"
            value={preferences.customQuality}
            onChange={(event) => update({ customQuality: event.target.value as DeviceRendererQuality })}
          >
            <option value="reduced">Reduced</option>
            <option value="balanced">Balanced</option>
            <option value="full">Full</option>
          </select>
        </ClusterSettingsRow>}
        <p className="muted">Effective rendering tier: <strong>{capabilities.qualityTier}</strong>. Reduced transparency, forced colors, and unavailable backdrop effects always take priority.</p>
        {storageError && <p role="alert">This device blocked preference storage. No change was applied; check browser storage permissions.</p>}
      </ClusterSettingsSection>
    </div>
    <div className="settings-card-v092">
      <ClusterSettingsSection
        title="Performance diagnostics"
        summary="Read existing in-session telemetry on demand. No extra polling or continuous profiler is started."
        actions={<>
          <ClusterButton type="button" variant="secondary" disabled={sampling} onClick={captureFrameSample}>{sampling ? "Capturing…" : "Capture 5s frame sample"}</ClusterButton>
          <ClusterButton type="button" variant="secondary" onClick={() => setReport(performanceSummary())}>Refresh measurements</ClusterButton>
          <ClusterButton type="button" variant="secondary" onClick={downloadPerformanceReport}>Export report</ClusterButton>
        </>}
      >
        {report ? <>
          <p>Runtime health: <strong>{report.health.status}</strong> · Samples: <strong>{report.count}</strong></p>
          <p className="muted">API requests: {report.health.requestRatePerMinute}/min · Main-thread long tasks: {report.health.longTasksPerMinute}/min · Cache hit rate: {report.cache.hitRate}%</p>
          <p className="muted">INP: {report.webVitals.inpMs == null ? "Unavailable" : report.webVitals.inpMs + " ms"} · JS heap: {report.memory.usedBytes == null ? "Unavailable" : (report.memory.usedBytes / 1048576).toFixed(1) + " MiB"}</p>
          <p className="muted">Frame sample: {report.frameSample ? `${report.frameSample.missedPercent}% estimated missed frames across ${report.frameSample.samples} sampled frame intervals` : "Not captured"}</p>
        </> : <p className="muted">Select Refresh measurements to inspect the current session. Metrics are unavailable until the browser records them.</p>}
        {samplingError && <p role="alert">{samplingError}</p>}
        <p className="muted">Frame sampling is opt-in, lasts up to five seconds, and does not run continuously while idle. Exported reports stay on your device but may include resource filenames and timing metadata.</p>
      </ClusterSettingsSection>
    </div>
    <p className="muted">Stored locally on this device and applied immediately. Server CPU/RAM limits, background workers, and transfer scheduling remain under Server Configuration.</p>
  </div>;
}
