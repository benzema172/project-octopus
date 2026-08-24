export const DOCUMENT_DESTINATIONS = [
  { value: "technical", label: "Dokumentacja techniczna", module: "Dokumentacja" },
  { value: "specification", label: "STWiOR / specyfikacja", module: "Dokumentacja" },
  { value: "estimate", label: "Kosztorys / przedmiar", module: "Kosztorys" },
  { value: "schedule", label: "Harmonogram", module: "Harmonogram" },
  { value: "protocol", label: "Protokół / odbiór", module: "Protokoły" },
  { value: "application", label: "Wniosek materiałowy", module: "Wnioski" },
  { value: "contract", label: "Umowa / kontrakt / aneks", module: "Dokumentacja" },
  { value: "correspondence", label: "Korespondencja / uzgodnienia", module: "Dokumentacja" },
  { value: "invoice", label: "Faktura / korekta", module: "Finanse" },
  { value: "warehouse", label: "WZ / PZ / dostawa", module: "Magazyn" },
  { value: "hr", label: "Dokument kadrowy", module: "Kadry" },
  { value: "fleet", label: "Dokument floty", module: "Flota" },
  { value: "template", label: "Wzór dokumentu", module: "Wzory" },
  { value: "report", label: "Raport / zestawienie", module: "Raporty" },
  { value: "other", label: "Inny / do weryfikacji", module: "Skrzynka AI" }
] as const;

export type DocumentCategory = (typeof DOCUMENT_DESTINATIONS)[number]["value"];

export type DocumentClassification = {
  category: DocumentCategory;
  label: string;
  module: string;
  confidence: "wysoka" | "średnia" | "niska";
  reason: string;
};

const CATEGORY_ALIASES: Record<string, DocumentCategory> = {
  technical: "technical",
  project: "technical",
  dokumentacja: "technical",
  dokument: "technical",
  document: "technical",
  pdf: "technical",
  specification: "specification",
  specyfikacja: "specification",
  stwior: "specification",
  estimate: "estimate",
  kosztorys: "estimate",
  przedmiar: "estimate",
  schedule: "schedule",
  harmonogram: "schedule",
  protocol: "protocol",
  protokol: "protocol",
  application: "application",
  wniosek: "application",
  contract: "contract",
  umowa: "contract",
  correspondence: "correspondence",
  korespondencja: "correspondence",
  invoice: "invoice",
  faktura: "invoice",
  warehouse: "warehouse",
  magazyn: "warehouse",
  hr: "hr",
  kadry: "hr",
  fleet: "fleet",
  flota: "fleet",
  template: "template",
  wzor: "template",
  report: "report",
  raport: "report",
  other: "other",
  inne: "other",
  package: "other",
  paczka: "other",
  do_weryfikacji: "other"
};

function normalizedKey(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("pl")
    .replaceAll("ł", "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_");
}

function searchable(value: string) {
  return normalizedKey(value).replaceAll("_", " ");
}

function result(category: DocumentCategory, confidence: DocumentClassification["confidence"], reason: string): DocumentClassification {
  const destination = DOCUMENT_DESTINATIONS.find((item) => item.value === category) ?? DOCUMENT_DESTINATIONS.at(-1)!;
  return { category, label: destination.label, module: destination.module, confidence, reason };
}

export function normalizeDocumentCategory(value: string | null | undefined): DocumentCategory | null {
  if (!value) return null;
  return CATEGORY_ALIASES[normalizedKey(value)] ?? null;
}

export function documentCategoryLabel(value: string | null | undefined) {
  const category = normalizeDocumentCategory(value);
  return DOCUMENT_DESTINATIONS.find((item) => item.value === category)?.label ?? "Do klasyfikacji";
}

export function expandDocumentCategoryAliases(categories: string[]) {
  const requested = new Set(categories.map(normalizeDocumentCategory).filter((value): value is DocumentCategory => Boolean(value)));
  const aliases = Object.entries(CATEGORY_ALIASES)
    .filter(([, category]) => requested.has(category))
    .map(([alias]) => alias);
  return Array.from(new Set([...requested, ...aliases]));
}

export function suggestDocumentClassification(fileName: string, mimeType = ""): DocumentClassification {
  const name = searchable(fileName);
  const mime = mimeType.toLowerCase();

  if (/(kosztorys|przedmiar|boq|wycena|zestawienie koszt)/.test(name)) {
    return result("estimate", "wysoka", "Nazwa pliku wskazuje kosztorys, przedmiar albo wycenę.");
  }
  if (/(harmonogram|schedule|terminarz|kamienie milowe)/.test(name)) {
    return result("schedule", "wysoka", "Nazwa pliku wskazuje harmonogram lub terminarz.");
  }
  if (/(protokol|odbior|proba|szczeln|cisnieni|zanik|plukan|dezynfek)/.test(name)) {
    return result("protocol", "wysoka", "Nazwa pliku wskazuje protokół, próbę albo odbiór.");
  }
  if (/(wniosek.*material|material.*wniosek|zatwierdzenie.*material|akceptacja.*material)/.test(name)) {
    return result("application", "wysoka", "Nazwa pliku wskazuje wniosek lub akceptację materiałową.");
  }
  if (/(faktur|invoice|ksef|korekta)/.test(name)) {
    return result("invoice", "wysoka", "Nazwa pliku wskazuje fakturę lub korektę.");
  }
  if (/(^| )(wz|pz)( |$)|dostaw|wydanie zewnetrzne|przyjecie zewnetrzne/.test(name)) {
    return result("warehouse", "wysoka", "Nazwa pliku wskazuje dokument magazynowy lub dostawę.");
  }
  if (/(umowa.*prac|akta osob|badani|bhp|urlop|pracownik|lista plac)/.test(name)) {
    return result("hr", "wysoka", "Nazwa pliku wskazuje dokument kadrowy.");
  }
  if (/(pojazd|samoch|flota|paliw|serwis|przebieg)/.test(name)) {
    return result("fleet", "średnia", "Nazwa pliku wskazuje dokument floty.");
  }
  if (/(umowa|kontrakt|aneks|zlecenie)/.test(name)) {
    return result("contract", "wysoka", "Nazwa pliku wskazuje dokument kontraktowy.");
  }
  if (/(korespondencja|uzgodnienie|notatka|rfi|zapytanie|odpowiedz)/.test(name)) {
    return result("correspondence", "średnia", "Nazwa pliku wskazuje korespondencję albo uzgodnienie.");
  }
  if (/(stwior|specyfik|warunki techniczne)/.test(name)) {
    return result("specification", "wysoka", "Nazwa pliku wskazuje specyfikację techniczną.");
  }
  if (/(projekt|dokumentacja|opis techn|rysunek|rzut|schemat|pzt|pw|pb)/.test(name)) {
    return result("technical", "wysoka", "Nazwa pliku wskazuje dokumentację projektową lub techniczną.");
  }
  if (/(raport|zestawienie|podsumowanie)/.test(name)) {
    return result("report", "średnia", "Nazwa pliku wskazuje raport lub zestawienie.");
  }

  const isSpreadsheet = mime.includes("spreadsheet") || /\.(xlsx?|csv)$/i.test(fileName);
  if (isSpreadsheet) {
    return result("other", "niska", "Arkusz może być kosztorysem, harmonogramem albo zestawieniem i wymaga analizy treści.");
  }
  const isPdfOrWord = mime.includes("pdf") || mime.includes("word") || /\.(pdf|docx?|odt)$/i.test(fileName);
  if (isPdfOrWord) {
    return result("technical", "średnia", "Format pasuje do dokumentacji, ale właściwy moduł potwierdzi analiza treści.");
  }
  return result("other", "niska", "Brak jednoznacznych sygnałów przed analizą zawartości.");
}
