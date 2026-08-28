export function isIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function isYearMonth(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 1 && month >= 1 && month <= 12;
}

export function assertDateOrder(from: string | null, to: string | null, message: string) {
  if (from && to && to < from) throw new Error(message);
}

export function assertTimesheetHours(hours: number, overtime: number) {
  if (!Number.isFinite(hours) || !Number.isFinite(overtime) || hours <= 0 || overtime < 0 || hours + overtime > 24) {
    throw new Error("Godziny podstawowe i nadgodziny muszą łącznie mieścić się w zakresie 0–24 h, a godziny podstawowe muszą być większe od zera.");
  }
}
