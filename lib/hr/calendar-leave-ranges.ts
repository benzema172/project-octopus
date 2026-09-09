import { countPolishWorkingDays, isPolishWorkingDay, previousPolishWorkingDay } from "./polish-work-calendar";
import { isIsoDate } from "./validation";

export type CalendarLeaveRange = {
  id: string;
  date_from: string;
  date_to: string;
};

export const HR_CALENDAR_LEAVE_POLICY = Object.freeze({
  source: "calendar",
  leaveType: "annual",
  status: "approved",
  coalesceAdjacentWorkingDays: true,
  preserveSingleRequestForContinuousLeave: true,
  splitWhenMiddleWorkingDayIsRemoved: true
});

function addDays(dateValue: string, days: number) {
  const value = new Date(`${dateValue}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function nextPolishWorkingDay(referenceDate: string) {
  if (!isIsoDate(referenceDate)) throw new Error("Nieprawidłowa data referencyjna.");
  let candidate = addDays(referenceDate, 1);
  for (let guard = 0; guard < 31; guard += 1) {
    if (isPolishWorkingDay(candidate)) return candidate;
    candidate = addDays(candidate, 1);
  }
  throw new Error("Nie udało się wyznaczyć następnego dnia roboczego.");
}

export function calendarLeaveNeighbors(workDate: string, ranges: CalendarLeaveRange[]) {
  if (!isIsoDate(workDate)) throw new Error("Nieprawidłowa data urlopu.");
  const previousDate = previousPolishWorkingDay(workDate);
  const nextDate = nextPolishWorkingDay(workDate);
  return {
    previous: ranges.find((row) => row.date_to === previousDate) ?? null,
    next: ranges.find((row) => row.date_from === nextDate) ?? null,
    previousDate,
    nextDate
  };
}

export function mergedCalendarLeaveBounds(
  workDate: string,
  previous: CalendarLeaveRange | null,
  next: CalendarLeaveRange | null
) {
  const dateFrom = previous?.date_from ?? workDate;
  const dateTo = next?.date_to ?? workDate;
  return {
    dateFrom,
    dateTo,
    days: countPolishWorkingDays(dateFrom, dateTo)
  };
}

export type CalendarLeaveRemovalPlan =
  | { kind: "delete" }
  | { kind: "shrink_start"; dateFrom: string; dateTo: string; days: number }
  | { kind: "shrink_end"; dateFrom: string; dateTo: string; days: number }
  | {
      kind: "split";
      left: { dateFrom: string; dateTo: string; days: number };
      right: { dateFrom: string; dateTo: string; days: number };
    };

export function planCalendarLeaveRemoval(range: CalendarLeaveRange, workDate: string): CalendarLeaveRemovalPlan {
  if (!isIsoDate(workDate) || workDate < range.date_from || workDate > range.date_to) {
    throw new Error("Usuwany dzień nie należy do wskazanego zakresu urlopu.");
  }
  if (!isPolishWorkingDay(workDate)) throw new Error("Urlop można zmieniać tylko dla dnia roboczego.");

  if (range.date_from === workDate && range.date_to === workDate) return { kind: "delete" };

  if (range.date_from === workDate) {
    const dateFrom = nextPolishWorkingDay(workDate);
    return {
      kind: "shrink_start",
      dateFrom,
      dateTo: range.date_to,
      days: countPolishWorkingDays(dateFrom, range.date_to)
    };
  }

  if (range.date_to === workDate) {
    const dateTo = previousPolishWorkingDay(workDate);
    return {
      kind: "shrink_end",
      dateFrom: range.date_from,
      dateTo,
      days: countPolishWorkingDays(range.date_from, dateTo)
    };
  }

  const leftTo = previousPolishWorkingDay(workDate);
  const rightFrom = nextPolishWorkingDay(workDate);
  return {
    kind: "split",
    left: {
      dateFrom: range.date_from,
      dateTo: leftTo,
      days: countPolishWorkingDays(range.date_from, leftTo)
    },
    right: {
      dateFrom: rightFrom,
      dateTo: range.date_to,
      days: countPolishWorkingDays(rightFrom, range.date_to)
    }
  };
}
