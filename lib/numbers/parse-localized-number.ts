export function parseLocalizedNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value !== "string") return fallback;

  const negativeByParentheses = /^\s*\(.*\)\s*$/.test(value);
  let normalized = value
    .trim()
    .replace(/[\s'’\u00a0]/g, "")
    .replace(/[^0-9,.-]/g, "");

  if (!/[0-9]/.test(normalized)) return fallback;

  const lastComma = normalized.lastIndexOf(",");
  const lastDot = normalized.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? "." : ",";
    normalized = normalized.replaceAll(groupingSeparator, "").replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    normalized = normalized.replaceAll(".", "").replace(",", ".");
  } else if ((normalized.match(/\./g) ?? []).length > 1 && /^-?\d{1,3}(\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replaceAll(".", "");
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return fallback;
  return negativeByParentheses ? -Math.abs(parsed) : parsed;
}
