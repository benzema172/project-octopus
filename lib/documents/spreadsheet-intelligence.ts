import "server-only";

import { createRequire } from "node:module";
import type { DocumentAnalysis } from "@/lib/ai/gemini-document";

const requireNode = createRequire(import.meta.url);
const XLSX = requireNode("xlsx") as typeof import("xlsx");

type SpecialistResult = Pick<DocumentAnalysis,
  "boqItems" | "materialRequirements" | "scheduleItems" | "progressItems"
> & { warnings: string[] };

type ColumnKind =
  | "itemNumber" | "description" | "quantity" | "unit" | "unitPrice" | "totalPrice" | "wbsCode"
  | "title" | "plannedStart" | "plannedFinish" | "durationDays" | "predecessors" | "critical"
  | "quantityExecuted" | "quantityAccepted" | "period"
  | "installation" | "manufacturer" | "model" | "specification" | "standards" | "requiredDocuments";

const ALIASES: Record<ColumnKind, string[]> = {
  itemNumber: ["lp", "l p", "nr", "numer", "pozycja", "item", "item no", "item number"],
  description: ["opis", "opis pozycji", "nazwa", "nazwa pozycji", "roboty", "element", "description"],
  quantity: ["ilość", "ilosc", "obmiar", "qty", "quantity"],
  unit: ["j m", "jm", "jednostka", "unit"],
  unitPrice: ["cena jednostkowa", "cena jedn", "cena", "unit price"],
  totalPrice: ["wartość", "wartosc", "razem", "suma", "total", "total price"],
  wbsCode: ["wbs", "kod wbs", "kod kosztu", "cost code", "etap"],
  title: ["zadanie", "czynność", "czynnosc", "aktywność", "aktywnosc", "nazwa zadania", "task", "activity"],
  plannedStart: ["start", "data start", "początek", "poczatek", "planowany start", "planned start"],
  plannedFinish: ["koniec", "data koniec", "zakończenie", "zakonczenie", "planowany koniec", "planned finish", "finish"],
  durationDays: ["czas", "czas trwania", "dni", "duration", "duration days"],
  predecessors: ["poprzednik", "poprzedniki", "zależności", "zaleznosci", "predecessors"],
  critical: ["krytyczne", "krytyczny", "critical"],
  quantityExecuted: ["wykonano", "ilość wykonana", "ilosc wykonana", "wykonanie", "quantity executed"],
  quantityAccepted: ["odebrano", "ilość odebrana", "ilosc odebrana", "zaakceptowano", "quantity accepted"],
  period: ["okres", "miesiąc", "miesiac", "data przerobu", "period"],
  installation: ["instalacja", "branża", "branza", "system"],
  manufacturer: ["producent", "manufacturer"],
  model: ["model", "typ", "symbol"],
  specification: ["specyfikacja", "parametry", "wymagania", "description technical"],
  standards: ["norma", "normy", "standard", "standards"],
  requiredDocuments: ["dokumenty", "załączniki", "zalaczniki", "certyfikaty", "required documents"]
};

const MAX_SHEETS = 100;
const MAX_ROWS_PER_SHEET = 20_000;
const MAX_OUTPUT_ROWS = 10_000;

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("pl")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function text(value: unknown) {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const candidate = text(value).replace(/\s/g, "").replace(/,(?=\d{1,4}$)/, ".").replace(/[^0-9.-]/g, "");
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value: unknown) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 20_000 && value < 100_000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const raw = text(value);
  const direct = /^\d{4}-\d{2}-\d{2}/.exec(raw)?.[0];
  if (direct) return direct;
  const polish = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(raw);
  if (polish) return `${polish[3]}-${polish[2].padStart(2, "0")}-${polish[1].padStart(2, "0")}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function splitList(value: unknown) {
  return text(value).split(/[;,|\n]+/).map((item) => item.trim()).filter(Boolean).slice(0, 50);
}

function findHeader(rows: unknown[][]) {
  let best: { row: number; mapping: Partial<Record<ColumnKind, number>>; score: number } | null = null;
  for (let rowIndex = 0; rowIndex < Math.min(60, rows.length); rowIndex += 1) {
    const mapping: Partial<Record<ColumnKind, number>> = {};
    rows[rowIndex].forEach((cell, columnIndex) => {
      const key = normalize(cell);
      if (!key) return;
      for (const [kind, aliases] of Object.entries(ALIASES) as Array<[ColumnKind, string[]]>) {
        if (mapping[kind] === undefined && aliases.some((alias) => key === normalize(alias) || key.includes(normalize(alias)))) mapping[kind] = columnIndex;
      }
    });
    const score = Object.keys(mapping).length;
    if (!best || score > best.score) best = { row: rowIndex, mapping, score };
  }
  return best && best.score >= 2 ? best : null;
}

function value(row: unknown[], mapping: Partial<Record<ColumnKind, number>>, key: ColumnKind) {
  const index = mapping[key];
  return index === undefined ? undefined : row[index];
}

function rowQuote(row: unknown[]) {
  return row.map(text).filter(Boolean).slice(0, 10).join(" | ").slice(0, 1000);
}

export function extractSpreadsheetIntelligence(buffer: Buffer): SpecialistResult {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, sheetRows: MAX_ROWS_PER_SHEET });
  const result: SpecialistResult = { boqItems: [], materialRequirements: [], scheduleItems: [], progressItems: [], warnings: [] };

  for (const sheetName of workbook.SheetNames.slice(0, MAX_SHEETS)) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "", blankrows: false }) as unknown[][];
    const header = findHeader(rows);
    if (!header) continue;
    const mapping = header.mapping;
    const hasBoq = mapping.description !== undefined && (mapping.quantity !== undefined || mapping.unitPrice !== undefined || mapping.totalPrice !== undefined);
    const hasSchedule = (mapping.title !== undefined || mapping.description !== undefined) && (mapping.plannedStart !== undefined || mapping.plannedFinish !== undefined || mapping.durationDays !== undefined);
    const hasProgress = (mapping.description !== undefined || mapping.itemNumber !== undefined) && (mapping.quantityExecuted !== undefined || mapping.quantityAccepted !== undefined);
    const hasMaterials = (mapping.description !== undefined || mapping.title !== undefined) && (mapping.manufacturer !== undefined || mapping.model !== undefined || mapping.specification !== undefined || mapping.installation !== undefined);

    for (let rowIndex = header.row + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const description = text(value(row, mapping, "description") ?? value(row, mapping, "title"));
      if (!description || /^razem|^suma|^podsumowanie/i.test(description)) continue;
      const locator = `Arkusz: ${sheetName}, wiersz ${rowIndex + 1}`;
      const quote = rowQuote(row);

      if (hasBoq && result.boqItems.length < MAX_OUTPUT_ROWS) {
        const quantity = numeric(value(row, mapping, "quantity"));
        const unitPrice = numeric(value(row, mapping, "unitPrice"));
        const reportedTotal = numeric(value(row, mapping, "totalPrice"));
        result.boqItems.push({
          itemNumber: text(value(row, mapping, "itemNumber")) || String(rowIndex - header.row),
          description,
          quantity,
          unit: text(value(row, mapping, "unit")),
          unitPrice,
          totalPrice: reportedTotal || quantity * unitPrice,
          wbsCode: text(value(row, mapping, "wbsCode")) || "00",
          confidence: 0.96,
          locator,
          quote
        });
      }

      if (hasSchedule && result.scheduleItems.length < MAX_OUTPUT_ROWS) {
        result.scheduleItems.push({
          code: text(value(row, mapping, "itemNumber")) || `S-${rowIndex - header.row}`,
          title: description,
          wbsCode: text(value(row, mapping, "wbsCode")),
          plannedStart: isoDate(value(row, mapping, "plannedStart")),
          plannedFinish: isoDate(value(row, mapping, "plannedFinish")),
          durationDays: Math.max(0, numeric(value(row, mapping, "durationDays"))),
          predecessors: splitList(value(row, mapping, "predecessors")),
          milestone: /kamien|milestone/i.test(description),
          critical: /^(1|tak|yes|true|x)$/i.test(text(value(row, mapping, "critical"))),
          constraint: "",
          confidence: 0.96,
          locator,
          quote
        });
      }

      if (hasProgress && result.progressItems.length < MAX_OUTPUT_ROWS) {
        const quantityExecuted = Math.max(0, numeric(value(row, mapping, "quantityExecuted")));
        const quantityAccepted = Math.max(0, numeric(value(row, mapping, "quantityAccepted")));
        if (quantityExecuted || quantityAccepted) result.progressItems.push({
          boqItemNumber: text(value(row, mapping, "itemNumber")),
          wbsCode: text(value(row, mapping, "wbsCode")),
          description,
          quantityExecuted,
          quantityAccepted,
          unit: text(value(row, mapping, "unit")),
          period: isoDate(value(row, mapping, "period")) || text(value(row, mapping, "period")),
          confidence: 0.95,
          locator,
          quote
        });
      }

      if (hasMaterials && result.materialRequirements.length < MAX_OUTPUT_ROWS) result.materialRequirements.push({
        name: description,
        installation: text(value(row, mapping, "installation")),
        manufacturer: text(value(row, mapping, "manufacturer")),
        model: text(value(row, mapping, "model")),
        specification: text(value(row, mapping, "specification")),
        quantity: numeric(value(row, mapping, "quantity")),
        unit: text(value(row, mapping, "unit")),
        standards: splitList(value(row, mapping, "standards")),
        requiredDocuments: splitList(value(row, mapping, "requiredDocuments")),
        alternativesAllowed: false,
        confidence: 0.94,
        locator,
        quote
      });
    }
  }

  if (workbook.SheetNames.length > MAX_SHEETS) result.warnings.push(`Pominięto arkusze powyżej limitu ${MAX_SHEETS}.`);
  for (const key of ["boqItems", "scheduleItems", "progressItems", "materialRequirements"] as const) {
    if (result[key].length >= MAX_OUTPUT_ROWS) result.warnings.push(`${key}: osiągnięto limit ${MAX_OUTPUT_ROWS} wierszy.`);
  }
  return result;
}
