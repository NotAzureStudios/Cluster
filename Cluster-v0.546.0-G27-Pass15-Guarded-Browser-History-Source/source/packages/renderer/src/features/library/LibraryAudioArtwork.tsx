import { useMemo } from "react";
import { runtimeStyle } from "../../core/runtime-style";
import { LibraryIcon } from "./LibraryIcons";
import type { LibraryItem } from "./library-types";

function metadataString(item: LibraryItem, keys: string[]) {
  for (const key of keys) {
    const value = item.metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function fallbackWaveform(seed: string, count: number) {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const noise = ((state >>> 0) % 1000) / 1000;
    const envelope = 0.38 + Math.sin((index / count) * Math.PI) * 0.54;
    values.push(Math.max(0.08, Math.min(1, (0.2 + noise * 0.8) * envelope)));
  }
  return values;
}

export function LibraryAudioArtwork({ item, compact = false }: { item: LibraryItem; compact?: boolean }) {
  const artwork = metadataString(item, ["albumArtUrl", "coverArtUrl", "artworkUrl", "coverUrl", "thumbnailUrl"]);
  const bars = useMemo(() => fallbackWaveform(item.checksumSha256 || item.id || item.title, compact ? 28 : 44), [compact, item.checksumSha256, item.id, item.title]);
  if (artwork) return <div className={`library-audio-artwork-v219${compact ? " compact" : ""}`}><img src={artwork} alt={`Album art for ${item.title}`} loading="lazy" /></div>;
  return <div className={`library-audio-artwork-v219 waveform${compact ? " compact" : ""}`} aria-label={`Waveform artwork for ${item.title}`}>
    <div>{bars.map((value, index) => <i key={index} style={runtimeStyle({ height: `${Math.round(16 + value * 74)}%` })} />)}</div>
    {!compact && <><LibraryIcon name="audio" size={30} /><strong>{item.title}</strong></>}
  </div>;
}
