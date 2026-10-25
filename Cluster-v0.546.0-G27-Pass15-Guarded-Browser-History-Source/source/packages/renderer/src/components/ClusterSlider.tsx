import "./cluster-slider.css";
import { forwardRef, type CSSProperties, type InputHTMLAttributes } from "react";

export type ClusterSliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  tone?: "accent" | "neutral" | "danger";
};

export const ClusterSlider = forwardRef<HTMLInputElement, ClusterSliderProps>(function ClusterSlider({
  className = "", min = 0, max = 100, value, defaultValue, tone = "accent", style, ...props
}, ref) {
  const minNumber = Number(min);
  const maxNumber = Number(max);
  const valueNumber = Number(value ?? defaultValue ?? minNumber);
  const span = Math.max(0.000001, maxNumber - minNumber);
  const progress = Math.max(0, Math.min(100, ((valueNumber - minNumber) / span) * 100));
  return <input {...props} ref={ref} type="range" min={min} max={max} value={value} defaultValue={defaultValue}
    data-tone={tone} className={`cluster-slider-v533 ${className}`.trim()}
    style={{ ...style, "--cluster-slider-progress": `${progress}%` } as CSSProperties} />;
});
