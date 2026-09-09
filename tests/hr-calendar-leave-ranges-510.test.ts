import { describe, expect, it } from "vitest";
import {
  HR_CALENDAR_LEAVE_POLICY,
  calendarLeaveNeighbors,
  mergedCalendarLeaveBounds,
  nextPolishWorkingDay,
  planCalendarLeaveRemoval,
  type CalendarLeaveRange
} from "../lib/hr/calendar-leave-ranges";

describe("HR calendar leave range automation 5.1", () => {
  it("keeps one approved annual request for adjacent working days", () => {
    expect(HR_CALENDAR_LEAVE_POLICY).toMatchObject({
      source: "calendar",
      leaveType: "annual",
      status: "approved",
      coalesceAdjacentWorkingDays: true,
      preserveSingleRequestForContinuousLeave: true
    });

    const previous: CalendarLeaveRange = { id: "leave-1", date_from: "2026-09-04", date_to: "2026-09-04" };
    const neighbors = calendarLeaveNeighbors("2026-09-07", [previous]);
    expect(neighbors.previous?.id).toBe("leave-1");
    expect(neighbors.previousDate).toBe("2026-09-04");
    expect(neighbors.nextDate).toBe("2026-09-08");

    expect(mergedCalendarLeaveBounds("2026-09-07", neighbors.previous, neighbors.next)).toEqual({
      dateFrom: "2026-09-04",
      dateTo: "2026-09-07",
      days: 2
    });
  });

  it("bridges two adjacent calendar requests into one request", () => {
    const previous: CalendarLeaveRange = { id: "left", date_from: "2026-09-07", date_to: "2026-09-07" };
    const next: CalendarLeaveRange = { id: "right", date_from: "2026-09-09", date_to: "2026-09-11" };
    const neighbors = calendarLeaveNeighbors("2026-09-08", [previous, next]);
    expect(neighbors.previous?.id).toBe("left");
    expect(neighbors.next?.id).toBe("right");
    expect(mergedCalendarLeaveBounds("2026-09-08", neighbors.previous, neighbors.next)).toEqual({
      dateFrom: "2026-09-07",
      dateTo: "2026-09-11",
      days: 5
    });
  });

  it("supports a continuous monthly vacation as one request with working-day count", () => {
    const previous: CalendarLeaveRange = { id: "monthly", date_from: "2026-09-01", date_to: "2026-09-29" };
    const neighbors = calendarLeaveNeighbors("2026-09-30", [previous]);
    expect(mergedCalendarLeaveBounds("2026-09-30", neighbors.previous, neighbors.next)).toEqual({
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      days: 22
    });
  });

  it("splits one request when a working day is removed from the middle", () => {
    const range: CalendarLeaveRange = { id: "leave", date_from: "2026-09-07", date_to: "2026-09-11" };
    expect(planCalendarLeaveRemoval(range, "2026-09-09")).toEqual({
      kind: "split",
      left: { dateFrom: "2026-09-07", dateTo: "2026-09-08", days: 2 },
      right: { dateFrom: "2026-09-10", dateTo: "2026-09-11", days: 2 }
    });
  });

  it("shrinks a request over a weekend without creating weekend leave days", () => {
    const range: CalendarLeaveRange = { id: "leave", date_from: "2026-09-04", date_to: "2026-09-07" };
    expect(planCalendarLeaveRemoval(range, "2026-09-04")).toEqual({
      kind: "shrink_start",
      dateFrom: "2026-09-07",
      dateTo: "2026-09-07",
      days: 1
    });
    expect(nextPolishWorkingDay("2026-09-04")).toBe("2026-09-07");
  });
});
