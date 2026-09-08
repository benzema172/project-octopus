export type WarehousePriceObservation550 = Record<string, unknown>;

export type WarehousePriceComparison550 = {
  latest: WarehousePriceObservation550;
  previous: WarehousePriceObservation550;
  latestDate: string;
  previousDate: string;
  ageDays: number;
  gapDays: number;
  changePct: number;
};

const DAY_MS = 86_400_000;

function dateOnly(row: WarehousePriceObservation550) {
  const raw = String(row.observed_at ?? row.created_at ?? "").trim();
  if (!raw) return "";
  const candidate = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : "";
}

function utcDay(value: string) {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / DAY_MS) : null;
}

function chronological(rows: WarehousePriceObservation550[]) {
  return [...rows].sort((a, b) => {
    const date = dateOnly(b).localeCompare(dateOnly(a));
    if (date) return date;
    return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  });
}

/**
 * Zwraca porównanie wyłącznie wtedy, gdy ma sens jako bieżący sygnał zakupowy.
 * Pełna historia pozostaje bez limitu, ale alert nie powstaje gdy:
 * - najnowszy zakup jest starszy niż okno monitoringu,
 * - poprzedni zakup jest zbyt odległy od najnowszego,
 * - brakuje poprawnych dat/cen.
 * Kolejność uploadu nie ma znaczenia: bazujemy na observed_at (dacie zakupu/faktury).
 */
export function recentWarehousePriceComparison550(
  history: WarehousePriceObservation550[],
  referenceDate: string,
  windowDays = 90
): WarehousePriceComparison550 | null {
  if (!Number.isFinite(windowDays) || windowDays <= 0 || history.length < 2) return null;
  const sorted = chronological(history);
  const latest = sorted[0];
  const previous = sorted[1];
  const latestDate = dateOnly(latest);
  const previousDate = dateOnly(previous);
  const referenceDay = utcDay(referenceDate);
  const latestDay = utcDay(latestDate);
  const previousDay = utcDay(previousDate);
  if (referenceDay === null || latestDay === null || previousDay === null) return null;

  const ageDays = referenceDay - latestDay;
  const gapDays = latestDay - previousDay;
  if (ageDays < 0 || ageDays > windowDays || gapDays < 0 || gapDays > windowDays) return null;

  const latestPrice = Number(latest.unit_price_net ?? 0);
  const previousPrice = Number(previous.unit_price_net ?? 0);
  if (!Number.isFinite(latestPrice) || !Number.isFinite(previousPrice) || latestPrice <= 0 || previousPrice <= 0) return null;

  return {
    latest,
    previous,
    latestDate,
    previousDate,
    ageDays,
    gapDays,
    changePct: ((latestPrice - previousPrice) / previousPrice) * 100
  };
}

export function isWarehousePriceAlert550(comparison: WarehousePriceComparison550 | null, thresholdPct = 10) {
  return Boolean(comparison && Math.abs(comparison.changePct) >= thresholdPct);
}
