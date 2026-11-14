/** Parse a complete numeric cell, never a cleaned-up fragment of arbitrary text. */
export function parseDocumentNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let text = value.normalize("NFKC").replace(/[\u2212\uFE63\uFF0D]/g, "-").trim();
  const currency = "(?:PLN|EUR|USD|GBP|zł|[$€£])";
  text = text.replace(new RegExp(`^${currency}\\s*`, "i"), "").replace(new RegExp(`\\s*${currency}$`, "i"), "").trim();
  const accounting = text.startsWith("(") && text.endsWith(")");
  if (accounting) text = text.slice(1, -1).trim();
  const sign = /^[+-]/.exec(text)?.[0] ?? "";
  if (accounting && sign) return null;
  if (sign) text = text.slice(1).trim();
  const exponent = /[eE][+-]?\d+$/.exec(text)?.[0] ?? "";
  if (exponent) text = text.slice(0, -exponent.length);
  if (!/^[\d., \u00a0\u202f]+$/.test(text)) return null;
  text = text.replace(/[\u00a0\u202f]/g, " ");
  const dots = text.split(".").length - 1, commas = text.split(",").length - 1;
  let decimal = "", grouping = "";
  if (dots && commas) {
    decimal = text.lastIndexOf(".") > text.lastIndexOf(",") ? "." : ",";
    grouping = decimal === "." ? "," : ".";
    if ((decimal === "." ? dots : commas) !== 1) return null;
  } else if (dots + commas > 1) grouping = dots ? "." : ",";
  else if (dots + commas === 1) decimal = dots ? "." : ",";
  const [integer, fraction] = decimal ? text.split(decimal) : [text, undefined];
  if (fraction !== undefined && !/^\d+$/.test(fraction)) return null;
  let whole = integer;
  if (grouping) {
    const separator = grouping === "." ? "\\." : ",";
    if (!new RegExp(`^\\d{1,3}(?:${separator}\\d{3})+$`).test(whole)) return null;
    whole = whole.split(grouping).join("");
  } else if (whole.includes(" ")) {
    if (!/^\d{1,3}(?: \d{3})+$/.test(whole)) return null;
    whole = whole.replaceAll(" ", "");
  }
  if (!/^\d+$/.test(whole) && !(whole === "" && fraction !== undefined)) return null;
  const parsed = Number(`${accounting ? "-" : sign}${whole || "0"}${fraction !== undefined ? `.${fraction}` : ""}${exponent}`);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Allow floating-point representation noise, never an absolute zero tolerance. */
export function equalDocumentNumbers(a: number, b: number) {
  return Number.isFinite(a) && Number.isFinite(b)
    && (a === b || Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * Number.EPSILON * 8);
}

export function numberInSourceQuote(value: number, quote: string) {
  const text = quote.normalize("NFKC").replace(/[\u2212\uFE63\uFF0D]/g, "-");
  // Consume entire decimal/grouped/exponent spans; exclude dates and identifiers.
  const tokens = text.matchAll(/(?<![\p{L}\p{N}_/.,-])(?:\(\s*)?[+-]?\s*(?:\d+(?:[.,]\d+|[ \u00a0\u202f]\d{3})*|[.,]\d+)(?:[eE][+-]?\d+)?(?:\s*\))?(?![\p{L}\p{N}_/.,-])/gu);
  for (const match of tokens) {
    const parsed = parseDocumentNumber(match[0]);
    if (parsed !== null && equalDocumentNumbers(value, parsed)) return true;
  }
  return false;
}
