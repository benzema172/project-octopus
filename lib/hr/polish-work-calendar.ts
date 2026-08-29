import { isIsoDate } from "./validation";

function addDays(dateValue: string, days: number) {
  const value = new Date(`${dateValue}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function polishPublicHolidays(year: number) {
  const easter = easterSunday(year);
  const fixed = [
    "01-01",
    "01-06",
    "05-01",
    "05-03",
    "08-15",
    "11-01",
    "11-11",
    "12-25",
    "12-26"
  ].map((day) => `${year}-${day}`);

  // Wigilia jest ustawowo wolna od pracy w Polsce od 2025 r.
  if (year >= 2025) fixed.push(`${year}-12-24`);

  return new Set([
    ...fixed,
    easter,
    addDays(easter, 1),
    addDays(easter, 49),
    addDays(easter, 60)
  ]);
}

export function isPolishWorkingDay(date: string) {
  if (!isIsoDate(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  const weekday = parsed.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !polishPublicHolidays(parsed.getUTCFullYear()).has(date);
}

export function previousPolishWorkingDay(referenceDate: string) {
  if (!isIsoDate(referenceDate)) throw new Error("Nieprawidłowa data referencyjna.");
  let candidate = addDays(referenceDate, -1);
  for (let guard = 0; guard < 31; guard += 1) {
    if (isPolishWorkingDay(candidate)) return candidate;
    candidate = addDays(candidate, -1);
  }
  throw new Error("Nie udało się wyznaczyć poprzedniego dnia roboczego.");
}

export function countPolishWorkingDays(from: string, to: string) {
  if (!isIsoDate(from) || !isIsoDate(to)) throw new Error("Nieprawidłowy zakres dat.");
  if (from > to) throw new Error("Początek zakresu nie może być po jego końcu.");
  let cursor = from;
  let count = 0;
  while (cursor <= to) {
    if (isPolishWorkingDay(cursor)) count += 1;
    cursor = addDays(cursor, 1);
  }
  return count;
}

export function countPolishWorkingDaysInYear(from: string, to: string, year: number) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const clippedFrom = from > yearStart ? from : yearStart;
  const clippedTo = to < yearEnd ? to : yearEnd;
  if (clippedFrom > clippedTo) return 0;
  return countPolishWorkingDays(clippedFrom, clippedTo);
}

export function daysBetween(from: string, to: string) {
  if (!isIsoDate(from) || !isIsoDate(to)) return null;
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}
