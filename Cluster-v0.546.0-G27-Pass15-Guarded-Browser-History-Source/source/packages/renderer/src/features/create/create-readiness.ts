import type { QuickCreateMode } from "../application/application-models";

export type CreateReadinessInput = {
  mode: QuickCreateMode;
  title: string;
  hasProject: boolean;
  hasBoardList: boolean;
  projectLeadId: string;
  externalOwnerRequired: boolean;
  externalOwnerId: string;
  buildVersion: string;
  date: string;
  timelineStartTime: string;
  timelineEndDate: string;
  timelineEndTime: string;
  calendarStartsAt: string;
  calendarEndsAt: string;
  calendarAllDay: boolean;
  timeStartsAt: string;
  timeEndsAt: string;
  meetingEndDate: string;
  whiteboardWidth: string;
  whiteboardHeight: string;
  packetAudienceMode?: "all" | "include" | "exclude";
  packetAudienceTargetCount?: number;
  packetCompletionMode?: "none" | "read" | "acknowledge" | "form";
  packetCompletionFormId?: string;
};

function validDateTime(value: string) {
  if (!value.trim()) return false;
  return Number.isFinite(new Date(value).getTime());
}

export function createReadinessIssues(input: CreateReadinessInput) {
  const issues: string[] = [];
  if (!input.title.trim()) issues.push("Add a title.");

  if (input.mode === "project") {
    if (!input.projectLeadId) issues.push("Select a project lead.");
    if (input.externalOwnerRequired && !input.externalOwnerId) issues.push("Select the external project owner.");
  }

  if (input.mode === "card" && !input.hasBoardList) issues.push("Choose a board with at least one list.");

  if (input.mode === "build") {
    if (!input.hasProject) issues.push("Select a project.");
    if (!input.buildVersion.trim()) issues.push("Add the build version.");
  }

  if (input.mode === "timeline") {
    const start = new Date(`${input.date}T${input.timelineStartTime || "09:00"}:00`).getTime();
    const end = new Date(`${input.timelineEndDate || input.date}T${input.timelineEndTime || input.timelineStartTime || "10:00"}:00`).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) issues.push("Choose valid timeline dates and times.");
    else if (end < start) issues.push("Timeline end must be after the start.");
  }

  if (input.mode === "calendar") {
    if (!validDateTime(input.calendarStartsAt)) issues.push("Choose a valid event start.");
    if (!input.calendarAllDay) {
      if (!validDateTime(input.calendarEndsAt)) issues.push("Choose a valid event end.");
      else if (validDateTime(input.calendarStartsAt) && new Date(input.calendarEndsAt).getTime() < new Date(input.calendarStartsAt).getTime()) issues.push("Event end must be after the start.");
    }
  }

  if (input.mode === "scheduler") {
    if (!validDateTime(input.timeStartsAt) || !validDateTime(input.timeEndsAt)) issues.push("Choose valid schedule start and end times.");
    else if (new Date(input.timeEndsAt).getTime() < new Date(input.timeStartsAt).getTime()) issues.push("Schedule end must be after the start.");
  }

  if (input.mode === "meeting") {
    if (!input.hasProject) issues.push("Select a project.");
    if (!input.date || !input.meetingEndDate) issues.push("Choose meeting start and end dates.");
    else if (input.meetingEndDate < input.date) issues.push("Meeting end must be on or after the start date.");
  }

  if (input.mode === "whiteboard") {
    const width = Number(input.whiteboardWidth);
    const height = Number(input.whiteboardHeight);
    if (!Number.isFinite(width) || width < 640 || width > 8000) issues.push("Canvas width must be between 640 and 8000.");
    if (!Number.isFinite(height) || height < 480 || height > 8000) issues.push("Canvas height must be between 480 and 8000.");
  }

  if (input.mode === "packet") {
    if (input.packetAudienceMode && input.packetAudienceMode !== "all" && !(input.packetAudienceTargetCount || 0)) issues.push("Choose an audience or use Whole studio.");
    if (input.packetCompletionMode === "form" && !input.packetCompletionFormId) issues.push("Choose a completion form.");
  }

  return issues;
}
