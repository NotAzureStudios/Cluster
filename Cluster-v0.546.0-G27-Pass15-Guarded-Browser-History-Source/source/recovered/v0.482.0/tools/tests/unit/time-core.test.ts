import assert from "node:assert/strict";
import test from "node:test";
import {
  breakMinutes,
  deductibleBreakMinutes,
  mondayWeekStart,
  netEntryMinutes,
  summarizeTime,
  timeExceptions,
  validateTimeRange,
  weekKey
} from "../../../apps/server/src/core/time";

test("time weeks begin on Monday", () => {
  const start = mondayWeekStart(new Date("2026-07-19T12:00:00"));
  assert.equal(start.getDay(), 1);
  assert.equal(weekKey(new Date("2026-07-19T12:00:00")), "2026-07-13");
});

test("net time subtracts running and completed breaks", () => {
  const now = new Date("2026-07-13T12:00:00Z");
  const entry = {
    userId: "user-1",
    startedAt: "2026-07-13T08:00:00Z",
    endedAt: "2026-07-13T12:00:00Z",
    breaks: [
      { startedAt: "2026-07-13T09:00:00Z", endedAt: "2026-07-13T09:15:00Z" },
      { startedAt: "2026-07-13T11:30:00Z", endedAt: null }
    ]
  };
  assert.equal(breakMinutes(entry.breaks, now), 45);
  assert.equal(netEntryMinutes(entry, now), 195);
});



test("paid breaks remain part of tracked time while unpaid breaks are deducted", () => {
  const entry = {
    userId: "user-1",
    startedAt: "2026-07-13T08:00:00Z",
    endedAt: "2026-07-13T12:00:00Z",
    breaks: [
      { type: "paid", startedAt: "2026-07-13T09:00:00Z", endedAt: "2026-07-13T09:15:00Z" },
      { type: "meal", startedAt: "2026-07-13T10:00:00Z", endedAt: "2026-07-13T10:30:00Z" }
    ]
  };
  assert.equal(breakMinutes(entry.breaks), 45);
  assert.equal(deductibleBreakMinutes(entry.breaks), 30);
  assert.equal(netEntryMinutes(entry), 210);
});

test("summary separates tracked, scheduled, billable, capacity, and overtime", () => {
  const summary = summarizeTime([
    { userId: "u1", projectId: "p1", startedAt: "2026-07-13T08:00:00Z", endedAt: "2026-07-13T12:00:00Z", billable: true, breaks: [] },
    { userId: "u1", projectId: "p2", startedAt: "2026-07-14T08:00:00Z", endedAt: "2026-07-14T10:00:00Z", billable: false, breaks: [] }
  ], [
    { userId: "u1", startsAt: "2026-07-13T08:00:00Z", endsAt: "2026-07-13T12:00:00Z", type: "work" },
    { userId: "u1", startsAt: "2026-07-14T08:00:00Z", endsAt: "2026-07-14T09:00:00Z", type: "time-off" }
  ], {
    rangeStart: "2026-07-13T00:00:00Z",
    rangeEnd: "2026-07-20T00:00:00Z",
    capacityHours: 5,
    now: new Date("2026-07-15T00:00:00Z")
  });
  assert.equal(summary.trackedMinutes, 360);
  assert.equal(summary.billableMinutes, 240);
  assert.equal(summary.scheduledMinutes, 240);
  assert.equal(summary.capacityMinutes, 300);
  assert.equal(summary.overtimeMinutes, 60);
  assert.equal(summary.byProject.length, 2);
});

test("time exceptions detect long shifts, missing breaks, and unassigned project work", () => {
  const exceptions = timeExceptions([
    { id: "entry-1", userId: "u1", startedAt: "2026-07-13T00:00:00Z", endedAt: "2026-07-13T17:00:00Z", breaks: [] }
  ], [], new Date("2026-07-13T18:00:00Z"));
  assert.ok(exceptions.some((item) => item.code === "LONG_SHIFT"));
  assert.ok(exceptions.some((item) => item.code === "MISSING_BREAK"));
  assert.ok(exceptions.some((item) => item.code === "UNASSIGNED_PROJECT"));
});

test("invalid and excessively long time ranges are rejected", () => {
  assert.throws(() => validateTimeRange("2026-07-13T10:00:00Z", "2026-07-13T09:00:00Z"), /after start/);
  assert.throws(() => validateTimeRange("2026-07-13T00:00:00Z", "2026-07-15T00:00:00Z", 1440), /cannot exceed/);
});
