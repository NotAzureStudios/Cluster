import { localId } from "../../../core/storage";
import { minutesToHuman } from "../../../core/date-time";
import type { AttentionSeverity, ScheduleBlock, ShiftRuleSettings, TimeCorrectionIssueType, TimeCorrectionRequest, TimeEntry } from "../../application/application-models";

/** Time correction and shift-rule helpers. Kept apart from the admin panels so
 * Home and the shell can use them without loading the admin workspace. */
export const TIME_CORRECTION_ISSUE_OPTIONS: Array<{
  value: TimeCorrectionIssueType;
  label: string;
  hint: string;
}> = [
  {
    value: "forgot-clock-out",
    label: "Forgot clock-out",
    hint: "Suggest an end time from the schedule.",
  },
  {
    value: "wrong-project",
    label: "Wrong project",
    hint: "Move the log to the correct project/card.",
  },
  {
    value: "wrong-duration",
    label: "Wrong duration",
    hint: "Fix start/end or direct duration.",
  },
  {
    value: "break-missing",
    label: "Break missing",
    hint: "Add or split paid/unpaid break time.",
  },
  {
    value: "duplicate-entry",
    label: "Duplicate entry",
    hint: "Flag a duplicate log for removal.",
  },
  {
    value: "other",
    label: "Other",
    hint: "Describe the correction and include any supporting details.",
  },
];

export const DEFAULT_SHIFT_RULES: ShiftRuleSettings = {
  enabled: true,
  paidBreakMinutes: 15,
  unpaidBreakMinutes: 30,
  requireBreakAfterHours: 6,
  autoBreakReminderMinutes: 240,
  maxShiftHours: 10,
  overtimeAfterHours: 8,
  lateClockOutMinutes: 30,
  expectedStart: "09:00",
  expectedEnd: "17:00",
  compareSchedule: true,
};

export function normalizeCorrectionRequest(request: TimeCorrectionRequest): TimeCorrectionRequest {
  return {
    ...request,
    issueType: request.issueType || "other",
    status: request.status || "open",
    suggestedValue: request.suggestedValue || suggestCorrectionValue(request.issueType || "other", request.requestedDate, request.requestedValue),
    comments: request.comments || [],
    history: request.history || [
      {
        id: localId("hist"),
        status: request.status || "open",
        actor: request.userName || "Requester",
        note: request.reason,
        createdAt: request.createdAt || new Date().toISOString(),
      },
    ],
  };
}

export function suggestCorrectionValue(issueType: TimeCorrectionIssueType, requestedDate: string, requestedValue: string) {
  if (requestedValue.trim()) return requestedValue.trim();
  if (issueType === "forgot-clock-out") return `${requestedDate} ${DEFAULT_SHIFT_RULES.expectedEnd}`;
  if (issueType === "break-missing") return `${DEFAULT_SHIFT_RULES.unpaidBreakMinutes}m unpaid break`;
  if (issueType === "duplicate-entry") return "Remove duplicate entry";
  if (issueType === "wrong-project") return "Move to selected project";
  if (issueType === "wrong-duration") return "Recalculate from corrected start/end";
  return "Admin review needed";
}

export function timeCorrectionIssueLabel(value?: TimeCorrectionIssueType) {
  return TIME_CORRECTION_ISSUE_OPTIONS.find((item) => item.value === value)?.label || "Other";
}


export function readShiftRules(): ShiftRuleSettings {
  return { ...DEFAULT_SHIFT_RULES };
}

export function shiftMinutes(entry?: TimeEntry | null) {
  if (!entry) return 0;
  return Math.max(entry.computedDurationMinutes || 0, Math.round((Date.now() - new Date(entry.startedAt).getTime()) / 60000));
}

export function shiftRuleWarnings(rules: ShiftRuleSettings, activeEntry: TimeEntry | null, entries: TimeEntry[] = [], blocks: ScheduleBlock[] = []) {
  if (!rules.enabled)
    return [] as Array<{
      id: string;
      tone: AttentionSeverity;
      title: string;
      detail: string;
    }>;
  const warnings: Array<{
    id: string;
    tone: AttentionSeverity;
    title: string;
    detail: string;
  }> = [];
  const minutes = shiftMinutes(activeEntry);
  if (activeEntry && rules.autoBreakReminderMinutes > 0 && minutes >= rules.autoBreakReminderMinutes)
    warnings.push({
      id: "break-reminder",
      tone: minutes >= rules.requireBreakAfterHours * 60 ? "high" : "medium",
      title: "Break reminder",
      detail: `${minutesToHuman(minutes)} active. Review whether a break is required.`,
    });
  if (activeEntry && rules.overtimeAfterHours > 0 && minutes >= rules.overtimeAfterHours * 60)
    warnings.push({
      id: "overtime",
      tone: "high",
      title: "Overtime warning",
      detail: `${minutesToHuman(minutes)} active against ${rules.overtimeAfterHours}h overtime threshold.`,
    });
  if (activeEntry && rules.maxShiftHours > 0 && minutes >= rules.maxShiftHours * 60)
    warnings.push({
      id: "max-shift",
      tone: "critical",
      title: "Max shift warning",
      detail: `${minutesToHuman(minutes)} active against ${rules.maxShiftHours}h max shift.`,
    });
  const today = new Date().toDateString();
  const loggedToday = entries.filter((entry) => new Date(entry.startedAt).toDateString() === today).reduce((total, entry) => total + (entry.computedDurationMinutes || 0), 0);
  const scheduledToday = blocks.filter((block) => new Date(block.startsAt).toDateString() === today).reduce((total, block) => total + Math.max(0, Math.round((new Date(block.endsAt).getTime() - new Date(block.startsAt).getTime()) / 60000)), 0);
  if (rules.compareSchedule && scheduledToday > 0 && loggedToday > scheduledToday + rules.lateClockOutMinutes)
    warnings.push({
      id: "schedule-overrun",
      tone: "medium",
      title: "Late clock-out risk",
      detail: `${minutesToHuman(loggedToday)} logged vs ${minutesToHuman(scheduledToday)} scheduled today.`,
    });
  if (rules.compareSchedule && scheduledToday > 0 && loggedToday < Math.max(0, scheduledToday - 60) && new Date().getHours() >= 15)
    warnings.push({
      id: "schedule-under",
      tone: "low",
      title: "Schedule mismatch",
      detail: `${minutesToHuman(loggedToday)} logged against ${minutesToHuman(scheduledToday)} planned.`,
    });
  return warnings;
}
