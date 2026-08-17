export const DOCUMENT_DESTINATIONS = [
  { value: "project", label: "Dokumentacja projektowa", module: "Dokumentacja" },
  { value: "specification", label: "STWiOR / specyfikacja", module: "Dokumentacja" },
  { value: "estimate", label: "Kosztorys / przedmiar", module: "Kosztorys" },
  { value: "schedule", label: "Harmonogram", module: "Harmonogram" },
  { value: "protocol", label: "Protokół / odbiór", module: "Protokoły" },
  { value: "application", label: "Wniosek materiałowy", module: "Wnioski" },
  { value: "invoice", label: "Faktura", module: "Finanse" },
  { value: "warehouse", label: "WZ / PZ / magazyn", module: "Magazyn" },
  { value: "template", label: "Wzór firmowy", module: "Centrum AI" },
  { value: "hr", label: "Dokument kadrowy", module: "Kadry" },
  { value: "fleet", label: "Dokument floty", module: "Flota" },
  { value: "report", label: "Raport", module: "Raporty" },
  { value: "contract", label: "Umowa / kontrakt / aneks", module: "Dokumentacja" },
  { value: "correspondence", label: "Korespondencja / uzgodnienia", module: "Dokumentacja" },
  { value: "pdf", label: "PDF do klasyfikacji", module: "Dokumentacja" },
  { value: "document", label: "Dokument do klasyfikacji", module: "Dokumentacja" },
  { value: "package", label: "Paczka dokumentów", module: "Dokumentacja" },
  { value: "other", label: "Inny dokument", module: "Dokumentacja" },
  { value: "review", label: "Do weryfikacji", module: "Brain AI" }
] as const;

export type DocumentCategory = (typeof DOCUMENT_DESTINATIONS)[number]["value"];

export type DocumentClassification = {
  category: DocumentCategory;
  label: string;
  module: string;
  confidence: "wysoka" | "średnia" | "niska";
  reason: string;
};

const CATEGORY_VALUES = new Set<string>(DOCUMENT_DESTINATIONS.map((item) => item.value));

const LEGACY_CATEGORY_ALIASES: Record<string, DocumentCategory> = {
  dokumentacja: "project",
  dokument: "document",
  kosztorys: "estimate",
  harmonogram: "schedule",
  protokol: "protocol",
  "protokół": "protocol",
  wniosek: "application",
  umowa: "contract",
  korespondencja: "correspondence",
  paczka: "package",
  inne: "other",
  do_weryfikacji: "review"
};

function normalizeSearchValue(value: string) {
  return value
    .toLocaleLowerCase("pl")
    .replaceAll("ł", "l")
    .replaceAll("ó", "o")
    .replaceAll("ą", "a")
    .replaceAll("ę", "e")
    .replaceAll("ś", "s")
    .replaceAll("ć", "c")
    .replaceAll("ń", "n")
    .replaceAll("ż", "z")
    .replaceAll("ź", "z");
}

function result(category: DocumentCategory, confidence: DocumentClassification["confidence"], reason: string): DocumentClassification {
  const destination = DOCUMENT_DESTINATIONS.find((item) => item.value === category) ?? DOCUMENT_DESTINATIONS.at(-1)!;
  return { category, label: destination.label, module: destination.module, confidence, reason };
}

/** Converts identifiers from older releases and current AI into one canonical taxonomy. */
export function normalizeDocumentCategory(value: string | null | undefined): DocumentCategory | null {
  if (!value) return null;
  const normalized = value.trim().toLocaleLowerCase("pl");
  if (CATEGORY_VALUES.has(normalized)) return normalized as DocumentCategory;
  return LEGACY_CATEGORY_ALIASES[normalized] ?? null;
}

export function documentCategoryMatches(value: string | null | undefined, accepted: string[]) {
  const category = normalizeDocumentCategory(value);
  return Boolean(category && accepted.some((item) => normalizeDocumentCategory(item) === category));
}

export function documentCategoryLabel(value: string | null | undefined) {
  const category = normalizeDocumentCategory(value);
  return DOCUMENT_DESTINATIONS.find((item) => item.value === category)?.label ?? "Do klasyfikacji";
}

export function suggestDocumentClassification(fileName: string, mimeType = ""): DocumentClassification {
  const name = normalizeSearchValue(fileName);
  const mime = mimeType.toLowerCase();

  if (/(kosztorys|przedmiar|boq|wycena|zestawienie[-_ ]?koszt)/.test(name)) return result("estimate", "wysoka", "Nazwa pliku wskazuje kosztorys, przedmiar albo wycenę.");
  if (/(harmonogram|schedule|terminarz|kamienie[-_ ]?milowe)/.test(name)) return result("schedule", "wysoka", "Nazwa pliku wskazuje harmonogram lub terminarz.");
  if (/(protokol|odbior|proba|szczeln|cisnieni|zanik|plukan|dezynfek)/.test(name)) return result("protocol", "wysoka", "Nazwa pliku wskazuje protokół, próbę albo odbiór.");
  if (/(wniosek.*material|material.*wniosek|zatwierdzenie.*material|akceptacja.*material)/.test(name)) return result("application", "wysoka", "Nazwa pliku wskazuje wniosek lub akceptację materiałową.");
  if (/(faktur|invoice|ksef)/.test(name)) return result("invoice", "wysoka", "Nazwa pliku wskazuje fakturę lub dokument KSeF.");
  if (/(wz|pz|wydanie|przyjecie|dostaw)/.test(name)) return result("warehouse", "średnia", "Nazwa pliku wskazuje dokument magazynowy lub dostawę.");
  if (/(wzor|szablon|template)/.test(name)) return result("template", "wysoka", "Nazwa pliku wskazuje wzór firmowy.");
  if (/(umowa|kontrakt|aneks|zlecenie)/.test(name)) return result("contract", "wysoka", "Nazwa pliku wskazuje dokument kontraktowy.");
  if (/(korespondencja|uzgodnienie|notatka|rfi|zapytanie|odpowiedz)/.test(name)) return result("correspondence", "średnia", "Nazwa pliku wskazuje korespondencję albo uzgodnienie.");
  if (/(stwi|specyfik|opis[-_ ]?technic)/.test(name)) return result("specification", "wysoka", "Nazwa pliku wskazuje specyfikację techniczną.");
  if (/(projekt|dokumentacja|rysunek|rzut|schemat|pzt|pw|pb)/.test(name)) return result("project", "wysoka", "Nazwa pliku wskazuje dokumentację projektową lub techniczną.");

  const isSpreadsheet = mime.includes("spreadsheet") || /\.(xlsx?|csv)$/i.test(fileName);
  if (isSpreadsheet) return result("review", "niska", "Arkusz może być kosztorysem, harmonogramem albo zestawieniem — wymaga potwierdzenia.");
  const isPdfOrWord = mime.includes("pdf") || mime.includes("word") || /\.(pdf|docx?|odt)$/i.test(fileName);
  if (isPdfOrWord) return result("project", "średnia", "Format pasuje do dokumentacji, ale nazwę warto zweryfikować.");
  return result("review", "niska", "Brak jednoznacznych sygnałów do automatycznego przypisania.");
}
