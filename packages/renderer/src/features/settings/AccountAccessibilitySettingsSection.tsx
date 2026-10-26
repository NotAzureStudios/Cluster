import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";
import type { Settings } from "../application/application-models";

type SettingsPatch = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

export function AccountAccessibilitySettingsSection({ settings, patch, onReset }: { settings: Settings; patch: SettingsPatch; onReset: () => void }) {
  return (
    <div className="settings-section-v092 user-settings-accessibility-v371">
      <div className="settings-panel-head-v092">
        <p className="eyebrow">User</p>
        <h2>Accessibility & comfort</h2>
        <p className="muted tight">These preferences roam with your Cluster account. System modes respect browser/OS accessibility preferences when the platform exposes them.</p>
      </div>
      <div className="accessibility-settings-summary-v371" role="status" aria-live="polite">
        <strong>Personal accessibility profile</strong>
        <span>{settings.userTextScale === "largest" ? "150% text" : settings.userTextScale === "larger" ? "125% text" : settings.userTextScale === "large" ? "112% text" : "100% text"}</span>
        <span>{settings.userMotionPreference || "system"} motion</span>
        <span>{settings.userContrastPreference || "system"} contrast</span>
      </div>
      <div className="settings-card-grid-v092">
        <div className="settings-card-v092">
          <div className="settings-card-head-v092"><h3>Motion</h3><span>{settings.userMotionPreference || "system"}</span></div>
          <div className="field">
            <label htmlFor="accessibility-motion">Animation and motion</label>
            <ClusterNativeSelect id="accessibility-motion" value={settings.userMotionPreference || "system"} onChange={(event) => patch("userMotionPreference", event.target.value as Settings["userMotionPreference"])}>
              <option value="system">Follow operating system</option><option value="full">Full motion</option><option value="reduced">Reduced motion</option><option value="none">No non-essential motion</option>
            </ClusterNativeSelect>
          </div>
          <p className="muted tight">System reduced-motion remains a safety floor even if an older appearance preset requests full animation.</p>
        </div>
        <div className="settings-card-v092">
          <div className="settings-card-head-v092"><h3>Contrast</h3><span>{settings.userContrastPreference || "system"}</span></div>
          <div className="field">
            <label htmlFor="accessibility-contrast">Interface contrast</label>
            <ClusterNativeSelect id="accessibility-contrast" value={settings.userContrastPreference || "system"} onChange={(event) => patch("userContrastPreference", event.target.value as Settings["userContrastPreference"])}>
              <option value="system">Follow operating system</option><option value="standard">Standard</option><option value="high">High contrast</option>
            </ClusterNativeSelect>
          </div>
          <p className="muted tight">High contrast strengthens borders, muted text, selection states, and focus treatment without relying on color alone.</p>
        </div>
        <div className="settings-card-v092">
          <div className="settings-card-head-v092"><h3>Transparency</h3><span>{settings.userTransparencyPreference || "system"}</span></div>
          <div className="field">
            <label htmlFor="accessibility-transparency">Glass and transparency</label>
            <ClusterNativeSelect id="accessibility-transparency" value={settings.userTransparencyPreference || "system"} onChange={(event) => patch("userTransparencyPreference", event.target.value as Settings["userTransparencyPreference"])}>
              <option value="system">Follow operating system</option><option value="full">Full glass effects</option><option value="reduced">Reduced transparency</option><option value="off">Disable transparency and blur</option>
            </ClusterNativeSelect>
          </div>
        </div>
        <div className="settings-card-v092">
          <div className="settings-card-head-v092"><h3>Text & scale</h3><span>{settings.userTextScale || "default"}</span></div>
          <div className="field"><label htmlFor="accessibility-text-scale">Text size</label><ClusterNativeSelect id="accessibility-text-scale" value={settings.userTextScale || "default"} onChange={(event) => patch("userTextScale", event.target.value as Settings["userTextScale"])}><option value="default">100% · Default</option><option value="large">112% · Large</option><option value="larger">125% · Larger</option><option value="largest">150% · Largest</option></ClusterNativeSelect></div>
          <div className="field"><label htmlFor="accessibility-density">Interface density</label><ClusterNativeSelect id="accessibility-density" value={settings.interfaceDensity || "compact"} onChange={(event) => patch("interfaceDensity", event.target.value as Settings["interfaceDensity"])}><option value="dense">Dense</option><option value="compact">Compact</option><option value="comfortable">Comfortable</option></ClusterNativeSelect></div>
        </div>
        <div className="settings-card-v092">
          <div className="settings-card-head-v092"><h3>Focus & targets</h3><span>Keyboard / pointer</span></div>
          <div className="field"><label htmlFor="accessibility-focus-indicator">Focus indicator</label><ClusterNativeSelect id="accessibility-focus-indicator" value={settings.userFocusIndicator || "auto"} onChange={(event) => patch("userFocusIndicator", event.target.value as Settings["userFocusIndicator"])}><option value="auto">Standard focus ring</option><option value="strong">Strong focus ring</option><option value="always">Always show focus</option></ClusterNativeSelect></div>
          <div className="toggle-grid compact-toggle-grid-v092">
            <label className="tool-check"><ClusterInput type="checkbox" checked={settings.userLargeClickTargets ?? false} onChange={(event) => patch("userLargeClickTargets", event.target.checked)} /> Use larger interaction targets</label>
            <label className="tool-check"><ClusterInput type="checkbox" checked={settings.userShowHelpText ?? false} onChange={(event) => patch("userShowHelpText", event.target.checked)} /> Show helper text</label>
            <label className="tool-check"><ClusterInput type="checkbox" checked={settings.userFocusModeDefault ?? false} onChange={(event) => patch("userFocusModeDefault", event.target.checked)} /> Start with focus-mode hints</label>
          </div>
        </div>
        <div className="settings-card-v092">
          <div className="settings-card-head-v092"><h3>Status colors</h3><span>{settings.userStatusPalette || "default"}</span></div>
          <div className="field"><label htmlFor="accessibility-status-palette">Status color palette</label><ClusterNativeSelect id="accessibility-status-palette" value={settings.userStatusPalette || "default"} onChange={(event) => patch("userStatusPalette", event.target.value as Settings["userStatusPalette"])}><option value="default">Default</option><option value="color-vision-safe">Color-vision safe</option><option value="monochrome">Monochrome + text/state</option></ClusterNativeSelect></div>
          <div className="accessibility-status-preview-v371" data-palette={settings.userStatusPalette || "default"} aria-label="Status palette preview"><span className="good">Ready</span><span className="warn">Needs review</span><span className="bad">Blocked</span><span className="info">Info</span></div>
        </div>
        <div className="settings-card-v092 span-2 accessibility-reset-v371">
          <div><strong>Reset accessibility preferences</strong><span>Returns accessibility-specific controls to system-aware defaults. It does not reset your theme, project settings, or notification choices.</span></div>
          <ClusterButton variant="secondary" type="button" onClick={onReset}>Reset accessibility</ClusterButton>
        </div>
      </div>
    </div>
  );
}
