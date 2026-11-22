import { useMemo } from "react";
import { TIMEZONE_OPTIONS, optionsWithCurrent } from "../core/options";
import { ClusterSelect, type ClusterSelectOption } from "./ClusterSelect";

function utcOffset(timeZone: string) {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value || "";
    return name.replace("GMT", "UTC").replace("-", "−") || undefined;
  } catch {
    return undefined;
  }
}

function deviceTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
}

// Curated zones, plus this device's zone and the saved value when they aren't listed.
export function ClusterTimezoneSelect({ value, onChange, ariaLabel = "Timezone", unsetLabel, disabled, className }: { value: string; onChange: (value: string) => void; ariaLabel?: string; unsetLabel?: string; disabled?: boolean; className?: string }) {
  const options = useMemo<ClusterSelectOption[]>(() => {
    const device = deviceTimeZone();
    const base = optionsWithCurrent(TIMEZONE_OPTIONS, device, `This device (${device})`);
    const zones = optionsWithCurrent(base, value).map((option) => ({ ...option, meta: utcOffset(option.value) }));
    return unsetLabel ? [{ value: "", label: unsetLabel }, ...zones] : zones;
  }, [value, unsetLabel]);
  return <ClusterSelect ariaLabel={ariaLabel} value={value} options={options} onChange={onChange} disabled={disabled} className={className} placeholder="Choose a timezone" />;
}
