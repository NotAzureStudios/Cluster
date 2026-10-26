import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { ClusterButton } from "./ClusterButton";

export type ClusterSegmentedOption<T extends string = string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
};

export function ClusterSegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
  className = "",
  size = "compact",
}: {
  value: T;
  options: readonly ClusterSegmentedOption<T>[];
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
  className?: string;
  size?: "default" | "compact";
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const enabled = options.map((option, optionIndex) => (!disabled && !option.disabled ? optionIndex : -1)).filter((optionIndex) => optionIndex >= 0);
    if (!enabled.length) return;
    const position = enabled.indexOf(index);
    let next = enabled[0];
    if (event.key === "End") next = enabled[enabled.length - 1];
    else if (event.key === "Home") next = enabled[0];
    else {
      const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      next = enabled[(Math.max(0, position) + direction + enabled.length) % enabled.length];
    }
    refs.current[next]?.focus();
  }

  return (
    <div className={`cluster-segmented-v391 ${className}`.trim()} role="radiogroup" aria-label={label}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <ClusterButton
            key={option.value}
            ref={(node) => { refs.current[index] = node; }}
            type="button"
            size={size}
            className={selected ? "active" : ""}
            selected={selected}
            disabled={disabled || option.disabled}
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (!options.some((candidate) => candidate.value === value) && index === 0) ? 0 : -1}
            title={option.title}
            onKeyDown={(event) => moveFocus(event, index)}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </ClusterButton>
        );
      })}
    </div>
  );
}
