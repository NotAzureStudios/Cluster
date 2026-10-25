import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { runtimeStyle } from "../core/runtime-style";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterTextInput } from "./ClusterTextInput";
import { ClusterButton } from "./ClusterButton";
import { ClusterFloatingSurface } from "./ClusterFloatingSurface";
import { ClusterSlider } from "./ClusterSlider";

const DEFAULT_SWATCHES = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#475569"];
const VALID_HEX = /^#[0-9a-f]{6}$/i;
const RECENT_KEY = "cluster.recent-colors";

type HslColor = { h: number; s: number; l: number };

function normalizeHex(value: string, fallback = "#2563eb") {
  return VALID_HEX.test(value) ? value.toLowerCase() : fallback;
}

function hexToHsl(hex: string): HslColor {
  const normalized = normalizeHex(hex).slice(1);
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex({ h, s, l }: HslColor) {
  const hue = ((h % 360) + 360) % 360;
  const saturation = Math.max(0, Math.min(100, s)) / 100;
  const lightness = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const channel = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function hexRgb(hex: string) {
  const normalized = normalizeHex(hex).slice(1);
  return [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16));
}

function relativeLuminance(hex: string) {
  const channels = hexRgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a: string, b: string) {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function readRecentColors() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter((value) => VALID_HEX.test(value)).slice(0, 8) : [];
  } catch {
    return [];
  }
}

function rememberColor(value: string) {
  const color = normalizeHex(value);
  try {
    const next = [color, ...readRecentColors().filter((entry) => entry.toLowerCase() !== color)].slice(0, 8);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

function studioColor() {
  if (typeof window === "undefined") return "#2563eb";
  const value = getComputedStyle(document.documentElement).getPropertyValue("--studio-primary").trim();
  return normalizeHex(value, "#2563eb");
}

function ColorPickerPanel({ value, onChange, swatches, label, onDone }: { value: string; onChange: (value: string) => void; swatches: string[]; label: string; onDone: () => void }) {
  const safeValue = normalizeHex(value);
  const [draft, setDraft] = useState(safeValue.toUpperCase());
  const [hsl, setHsl] = useState<HslColor>(() => hexToHsl(safeValue));
  const [recent, setRecent] = useState<string[]>(() => readRecentColors());
  const [view, setView] = useState<"palette" | "custom">("palette");
  const planeRef = useRef<HTMLDivElement | null>(null);
  const palette = useMemo(() => Array.from(new Set(swatches.map((color) => normalizeHex(color)))), [swatches]);
  const studio = studioColor();
  const whiteContrast = contrastRatio(safeValue, "#ffffff");
  const blackContrast = contrastRatio(safeValue, "#000000");
  const bestText = whiteContrast >= blackContrast ? "#ffffff" : "#000000";
  const bestContrast = Math.max(whiteContrast, blackContrast);

  useEffect(() => {
    setDraft(safeValue.toUpperCase());
    setHsl(hexToHsl(safeValue));
  }, [safeValue]);

  function apply(next: string, remember = false) {
    const normalized = normalizeHex(next, safeValue);
    onChange(normalized);
    setDraft(normalized.toUpperCase());
    setHsl(hexToHsl(normalized));
    if (remember) {
      rememberColor(normalized);
      setRecent(readRecentColors());
    }
  }

  function applyHsl(next: HslColor) {
    const normalized = { h: Math.max(0, Math.min(359, next.h)), s: Math.max(0, Math.min(100, next.s)), l: Math.max(4, Math.min(96, next.l)) };
    setHsl(normalized);
    const hex = hslToHex(normalized);
    setDraft(hex.toUpperCase());
    onChange(hex);
  }

  function commitDraft() {
    if (VALID_HEX.test(draft)) apply(draft, true);
    else setDraft(safeValue.toUpperCase());
  }

  function updatePlane(clientX: number, clientY: number) {
    const bounds = planeRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const saturation = Math.round(Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)) * 100);
    const lightness = Math.round((1 - Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height))) * 92 + 4);
    applyHsl({ ...hsl, s: saturation, l: lightness });
  }

  function onPlanePointer(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    updatePlane(event.clientX, event.clientY);
  }

  function onPlaneKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    const amount = event.shiftKey ? 10 : 2;
    if (event.key === "ArrowLeft") applyHsl({ ...hsl, s: hsl.s - amount });
    else if (event.key === "ArrowRight") applyHsl({ ...hsl, s: hsl.s + amount });
    else if (event.key === "ArrowUp") applyHsl({ ...hsl, l: hsl.l + amount });
    else if (event.key === "ArrowDown") applyHsl({ ...hsl, l: hsl.l - amount });
    else return;
    event.preventDefault();
  }

  const swatchButton = (color: string, recentColor = false) => {
    const active = safeValue === color;
    return <ClusterButton unstyled key={`${recentColor ? "recent" : "palette"}-${color}`} type="button" className={active ? "active" : ""} style={runtimeStyle({ "--cluster-swatch": color })} onClick={() => apply(color, true)} aria-label={`Use ${recentColor ? "recent " : ""}color ${color}`} aria-pressed={active}><span aria-hidden="true" />{active ? <ClusterIcon name="check" /> : null}</ClusterButton>;
  };

  return <div className="cluster-color-popover-v455 cluster-color-popover-v457 cluster-color-popover-v458 cluster-color-popover-v467">
    <header className="cluster-color-preview-v455 cluster-color-preview-v457 cluster-color-preview-v458 cluster-color-preview-v467">
      <span className="cluster-color-preview-swatch-v455" style={runtimeStyle({ "--cluster-swatch": safeValue })} aria-hidden="true" />
      <span className="cluster-color-preview-copy-v458"><strong>{label}</strong><code>{safeValue.toUpperCase()}</code></span>
      <ClusterButton type="button" className="" onClick={() => { rememberColor(safeValue); onDone(); }} variant="quiet" size="compact">Done</ClusterButton>
    </header>

    <div className="cluster-color-mode-v458" role="tablist" aria-label="Color picker mode">
      <ClusterButton unstyled type="button" role="tab" aria-selected={view === "palette"} className={view === "palette" ? "active" : ""} onClick={() => setView("palette")}><ClusterIcon name="palette" />Palette</ClusterButton>
      <ClusterButton unstyled type="button" role="tab" aria-selected={view === "custom"} className={view === "custom" ? "active" : ""} onClick={() => setView("custom")}><ClusterIcon name="settings" />Custom</ClusterButton>
    </div>

    {view === "palette" ? <div className="cluster-color-palette-view-v458">
      <ClusterButton unstyled type="button" className={`cluster-color-studio-v457 cluster-color-studio-v458 cluster-color-studio-v467 ${safeValue === studio ? "active" : ""}`} onClick={() => apply(studio, true)} aria-pressed={safeValue === studio}>
        <span style={runtimeStyle({ "--cluster-swatch": studio })} aria-hidden="true" /><span><strong>Studio color</strong><small>Workspace accent</small></span><code>{studio.toUpperCase()}</code>{safeValue === studio ? <ClusterIcon name="check" /> : null}
      </ClusterButton>
      <section className="cluster-color-section-v455 cluster-color-section-v458" aria-label="Suggested colors">
        <span className="cluster-color-section-label-v455">Palette</span>
        <div className="cluster-color-grid-v455 cluster-color-grid-v458">{palette.map((color) => swatchButton(color))}</div>
      </section>
      {recent.length > 0 ? <section className="cluster-color-section-v455 cluster-color-section-v458" aria-label="Recent colors">
        <span className="cluster-color-section-label-v455">Recent</span>
        <div className="cluster-color-grid-v455 cluster-color-grid-v458 compact">{recent.map((color) => swatchButton(color, true))}</div>
      </section> : null}
    </div> : <div className="cluster-color-custom-view-v458">
      <div className="cluster-color-workbench-v457 cluster-color-workbench-v458">
        <div ref={planeRef} className="cluster-color-plane-v457 cluster-color-plane-v458" style={runtimeStyle({ "--cluster-picker-hue": `hsl(${hsl.h} 100% 50%)`, "--cluster-picker-x": `${hsl.s}%`, "--cluster-picker-y": `${100 - ((hsl.l - 4) / 92) * 100}%` })} role="slider" tabIndex={0} aria-label="Saturation and lightness" aria-valuetext={`${hsl.s}% saturation, ${hsl.l}% lightness`} onPointerDown={onPlanePointer} onPointerMove={(event) => { if (event.buttons) updatePlane(event.clientX, event.clientY); }} onKeyDown={onPlaneKeyboard}>
          <span className="cluster-color-plane-thumb-v457" aria-hidden="true" />
        </div>
        <label className="cluster-color-slider-v455 hue cluster-color-hue-v457"><span>Hue</span><ClusterSlider min="0" max="359" value={hsl.h} onChange={(event) => applyHsl({ ...hsl, h: Number(event.target.value) })} aria-label="Hue" /><output>{hsl.h}°</output></label>
      </div>
      <label className="cluster-color-hex-v455 cluster-color-hex-v458"><span>Hex</span><ClusterTextInput value={draft} onChange={(event) => /^#[0-9a-f]{0,6}$/i.test(event.target.value) && setDraft(event.target.value.toUpperCase())} onBlur={commitDraft} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitDraft(); } }} maxLength={7} spellCheck={false} aria-label="Color hex value" /></label>
      <div className="cluster-color-custom-meta-v458">
        <span>H {hsl.h}°</span><span>S {hsl.s}%</span><span>L {hsl.l}%</span>
      </div>
    </div>}

    <footer className="cluster-color-contrast-row-v458">
      <span className="cluster-color-contrast-chip-v458" style={runtimeStyle({ "--cluster-preview-bg": safeValue, "--cluster-preview-text": bestText })}>Aa</span>
      <span><strong>{bestContrast.toFixed(1)}:1 contrast</strong><small>{bestContrast >= 4.5 ? "Readable text pairing" : "Low contrast for text"}</small></span>
      {view === "custom" ? <ClusterButton type="button" className="" onClick={() => { apply(studio, true); setView("palette"); }} variant="quiet" size="compact">Use Studio</ClusterButton> : null}
    </footer>
  </div>;
}

export function ColorField({ value, onChange, label = "Color", swatches = DEFAULT_SWATCHES }: { value: string; onChange: (value: string) => void; label?: string; swatches?: string[] }) {
  const safeValue = normalizeHex(value);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return <fieldset className="cluster-color-field-v227 cluster-color-field-v455">
    <legend>{label}</legend>
    <ClusterButton ref={triggerRef} unstyled type="button" className="cluster-color-trigger-v455" onClick={() => setOpen((current) => !current)} aria-haspopup="dialog" aria-expanded={open}>
      <span className="cluster-color-trigger-swatch-v455" style={runtimeStyle({ "--cluster-swatch": safeValue })} aria-hidden="true" />
      <span><strong>{label}</strong><code>{safeValue.toUpperCase()}</code></span>
      <ClusterIcon name="chevron-down" />
    </ClusterButton>
    <ClusterFloatingSurface open={open} anchorRef={triggerRef} label={`${label} picker`} role="dialog" placement="bottom-start" mobileMode="sheet" autoFocus="first" onDismiss={() => setOpen(false)} className="cluster-color-floating-v504">
      <ColorPickerPanel value={safeValue} onChange={onChange} swatches={swatches} label={label} onDone={() => setOpen(false)} />
    </ClusterFloatingSurface>
  </fieldset>;
}

export function CompactColorField({ value, onChange, label = "Color", disabled = false, showValue = true, showLabel = true, ariaLabel }: { value: string; onChange: (value: string) => void; label?: string; disabled?: boolean; showValue?: boolean; showLabel?: boolean; ariaLabel?: string }) {
  const safeValue = normalizeHex(value);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return <div className={`cluster-compact-color ${showLabel ? "" : "label-hidden"} ${disabled ? "is-disabled" : ""}`}>
    {showLabel ? <span className="cluster-compact-color-label">{label}</span> : null}
    <ClusterButton ref={triggerRef} unstyled type="button" className="cluster-compact-color-control" style={runtimeStyle({ "--cluster-swatch": safeValue })} onClick={() => !disabled && setOpen((current) => !current)} aria-label={ariaLabel || `${label} color`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled}>
      <i aria-hidden="true" />{showValue ? <code>{safeValue.toUpperCase()}</code> : null}<ClusterIcon name="chevron-down" />
    </ClusterButton>
    <ClusterFloatingSurface open={open && !disabled} anchorRef={triggerRef} label={`${label} picker`} role="dialog" placement="bottom-end" mobileMode="sheet" autoFocus="first" onDismiss={() => setOpen(false)} className="cluster-color-floating-v504 compact">
      <ColorPickerPanel value={safeValue} onChange={onChange} swatches={DEFAULT_SWATCHES} label={label} onDone={() => setOpen(false)} />
    </ClusterFloatingSurface>
  </div>;
}
