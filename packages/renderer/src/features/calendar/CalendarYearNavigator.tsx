import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { calendarDateInputValue } from "./calendar-date-navigation";
import { calendarYearMonths } from "./calendar-year-projection";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

type CalendarYearNavigatorProps = {
  year: number;
  selectedDate: Date;
  onOpenMonth: (month: number) => void;
  onOpenDay: (day: Date) => void;
};

export function CalendarYearNavigator({ year, selectedDate, onOpenMonth, onOpenDay }: CalendarYearNavigatorProps) {
  const months = useMemo(() => calendarYearMonths(year), [year]);
  const [focusDayKey, setFocusDayKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedKey = calendarDateInputValue(selectedDate);
  const todayKey = calendarDateInputValue(new Date());

  function moveGridFocus(event: KeyboardEvent<HTMLButtonElement>, day: Date) {
    let next: Date | null = null;
    if (event.key === "ArrowRight") next = new Date(year, day.getMonth(), day.getDate() + 1);
    else if (event.key === "ArrowLeft") next = new Date(year, day.getMonth(), day.getDate() - 1);
    else if (event.key === "ArrowDown") next = new Date(year, day.getMonth(), day.getDate() + 7);
    else if (event.key === "ArrowUp") next = new Date(year, day.getMonth(), day.getDate() - 7);
    else if (event.key === "Home") next = new Date(year, day.getMonth(), day.getDate() - day.getDay());
    else if (event.key === "End") next = new Date(year, day.getMonth(), day.getDate() + 6 - day.getDay());
    else if (event.key === "PageDown") next = new Date(year, day.getMonth() + 1, Math.min(day.getDate(), new Date(year, day.getMonth() + 2, 0).getDate()));
    else if (event.key === "PageUp") next = new Date(year, day.getMonth() - 1, Math.min(day.getDate(), new Date(year, day.getMonth(), 0).getDate()));
    else return;
    // The year navigator never silently leaves its currently displayed year.
    if (next.getFullYear() !== year) return;
    event.preventDefault();
    const nextKey = calendarDateInputValue(next);
    setFocusDayKey(nextKey);
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-calendar-year-date="${nextKey}"]`)
      ?.focus({ preventScroll: false });
  }

  return (
    <div ref={rootRef} className="calendar-year-navigator-v11">
      <p className="calendar-year-intro-v11">
        Year overview is a date navigator. Select a month or a day to open its authorized schedule.
        Event counts are not shown for dates outside the currently loaded window.
      </p>
      <div className="calendar-year-months-v11">
        {months.map((month) => (
          <section key={month.month} className="calendar-year-month-v11" aria-label={`${month.title} ${year}`}>
            <header>
              <ClusterButton variant="quiet" size="compact" className="calendar-year-month-open-v11"
                onClick={() => onOpenMonth(month.month)}
                aria-label={`Open ${month.title} ${year} monthly schedule`}>
                {month.title}
              </ClusterButton>
            </header>
            <div className="calendar-year-weekdays-v11" aria-hidden="true">
              {WEEKDAYS.map((label) => <span key={label}>{label.slice(0, 1)}</span>)}
            </div>
            <div className="calendar-year-days-v11" role="group" aria-label={`${month.title} ${year} days; use arrow keys to move and Enter to open`}>
              {month.days.map((day, index) => {
                if (!day) return <span key={`blank-${index}`} aria-hidden="true" className="calendar-year-blank-v11" />;
                const key = calendarDateInputValue(day);
                const isSelected = key === selectedKey;
                const isToday = key === todayKey;
                const isFocusedInMonth = focusDayKey?.slice(0, 7) === key.slice(0, 7);
                const tabbable = isFocusedInMonth ? focusDayKey === key
                  : selectedKey.slice(0, 7) === key.slice(0, 7) ? isSelected : day.getDate() === 1;
                return <ClusterButton key={key} unstyled type="button"
                  data-calendar-year-date={key}
                  className={`calendar-year-day-v11 ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}`}
                  tabIndex={tabbable ? 0 : -1}
                  aria-current={isToday ? "date" : undefined}
                  aria-label={`Open ${day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} schedule`}
                  onFocus={() => setFocusDayKey(key)}
                  onKeyDown={(event) => moveGridFocus(event, day)}
                  onClick={() => onOpenDay(day)}>{day.getDate()}</ClusterButton>;
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
