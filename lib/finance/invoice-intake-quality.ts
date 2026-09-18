export const INVOICE_INTAKE_QUALITY_VERSION = 1;

export type InvoiceReadinessLine = {
  description?: string | null;
  quantity?: number | string | null;
  netAmount?: number | string | null;
  grossAmount?: number | string | null;
};

export type InvoiceReadinessInput = {
  invoiceNumber?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  counterpartyName?: string | null;
  netAmount?: number | string | null;
  taxAmount?: number | string | null;
  grossAmount?: number | string | null;
  lines: InvoiceReadinessLine[];
};

export type InvoiceReadinessResult = {
  score: number;
  requiresReview: boolean;
  critical: string[];
  warnings: string[];
  lineCount: number;
  duplicateLineGroups: number;
  netLinesDelta: number | null;
  grossLinesDelta: number | null;
  headerBalanceDelta: number | null;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || text(value) === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function day(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function moneyTolerance(value: number | null) {
  return Math.max(0.05, Math.abs(value ?? 0) * 0.003);
}

function normalizedLineKey(line: InvoiceReadinessLine) {
  const description = text(line.description)
    .toLocaleLowerCase("pl")
    .replace(/\s+/g, " ")
    .trim();
  if (!description) return "";
  const quantity = numberOrNull(line.quantity);
  const net = numberOrNull(line.netAmount);
  return [description, quantity ?? "", net ?? ""].join("|");
}

export function evaluateInvoiceReadiness(input: InvoiceReadinessInput): InvoiceReadinessResult {
  const critical: string[] = [];
  const warnings: string[] = [];
  const lines = Array.isArray(input.lines) ? input.lines : [];

  const net = numberOrNull(input.netAmount);
  const tax = numberOrNull(input.taxAmount);
  const gross = numberOrNull(input.grossAmount);

  if (!text(input.invoiceNumber)) critical.push("Brak numeru faktury.");
  if (!text(input.issueDate)) critical.push("Brak daty wystawienia.");
  if (!text(input.counterpartyName)) critical.push("Nie rozpoznano kontrahenta.");
  if (!lines.length) critical.push("Nie odczytano żadnej pozycji faktury.");
  if (net === null && gross === null) critical.push("Nie odczytano wartości netto ani brutto.");
  if (!text(input.dueDate)) warnings.push("Brak terminu płatności.");

  const issueDay = day(input.issueDate);
  const dueDay = day(input.dueDate);
  if (issueDay && dueDay && dueDay.getTime() < issueDay.getTime()) {
    warnings.push("Termin płatności jest wcześniejszy niż data wystawienia.");
  }

  let headerBalanceDelta: number | null = null;
  if (net !== null && tax !== null && gross !== null) {
    headerBalanceDelta = Math.abs(net + tax - gross);
    if (headerBalanceDelta > moneyTolerance(gross)) {
      critical.push(`Suma netto + VAT nie zgadza się z brutto (różnica ${headerBalanceDelta.toFixed(2)} zł).`);
    }
  }

  const lineNetValues = lines.map((line) => numberOrNull(line.netAmount)).filter((value): value is number => value !== null);
  const lineGrossValues = lines.map((line) => numberOrNull(line.grossAmount)).filter((value): value is number => value !== null);
  const lineNetSum = lineNetValues.reduce((sum, value) => sum + value, 0);
  const lineGrossSum = lineGrossValues.reduce((sum, value) => sum + value, 0);

  let netLinesDelta: number | null = null;
  if (net !== null && lineNetValues.length === lines.length && lines.length > 0) {
    netLinesDelta = Math.abs(lineNetSum - net);
    if (netLinesDelta > moneyTolerance(net)) {
      critical.push(`Suma pozycji netto nie zgadza się z nagłówkiem (różnica ${netLinesDelta.toFixed(2)} zł).`);
    }
  } else if (lines.length && lineNetValues.length < lines.length) {
    warnings.push("Część pozycji nie ma kompletnej wartości netto.");
  }

  let grossLinesDelta: number | null = null;
  if (gross !== null && lineGrossValues.length === lines.length && lines.length > 0) {
    grossLinesDelta = Math.abs(lineGrossSum - gross);
    if (grossLinesDelta > moneyTolerance(gross)) {
      critical.push(`Suma pozycji brutto nie zgadza się z nagłówkiem (różnica ${grossLinesDelta.toFixed(2)} zł).`);
    }
  } else if (lines.length && lineGrossValues.length > 0 && lineGrossValues.length < lines.length) {
    warnings.push("Część pozycji nie ma kompletnej wartości brutto.");
  }

  const missingDescriptions = lines.filter((line) => !text(line.description)).length;
  if (missingDescriptions) {
    warnings.push(`${missingDescriptions} ${missingDescriptions === 1 ? "pozycja nie ma" : "pozycje nie mają"} opisu.`);
  }

  const duplicates = new Map<string, number>();
  for (const line of lines) {
    const key = normalizedLineKey(line);
    if (!key) continue;
    duplicates.set(key, (duplicates.get(key) ?? 0) + 1);
  }
  const duplicateLineGroups = [...duplicates.values()].filter((count) => count > 1).length;
  if (duplicateLineGroups) {
    warnings.push("Wykryto identycznie wyglądające pozycje — sprawdź, czy nie są wynikiem podwójnego odczytu OCR.");
  }

  const score = Math.max(0, Math.min(1, 1 - critical.length * 0.16 - warnings.length * 0.05));
  return {
    score,
    requiresReview: critical.length > 0 || score < 0.85,
    critical,
    warnings,
    lineCount: lines.length,
    duplicateLineGroups,
    netLinesDelta,
    grossLinesDelta,
    headerBalanceDelta
  };
}
