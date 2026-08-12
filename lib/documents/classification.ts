export const DOCUMENT_DESTINATIONS = [
  { value: "dokumentacja", label: "Dokumentacja", module: "Dokumentacja" },
  { value: "kosztorys", label: "Kosztorys / przedmiar", module: "Kosztorys" },
  { value: "harmonogram", label: "Harmonogram", module: "Harmonogram" },
  { value: "protokol", label: "Protokół / odbiór", module: "Protokoły" },
  { value: "wniosek", label: "Wniosek materiałowy", module: "Wnioski" },
  { value: "umowa", label: "Umowa / kontrakt / aneks", module: "Dokumentacja" },
  { value: "korespondencja", label: "Korespondencja / uzgodnienia", module: "Dokumentacja" },
  { value: "do_weryfikacji", label: "Do weryfikacji", module: "Brain AI" }
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

function normalize(value: string) {
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

export function normalizeDocumentCategory(value: string | null | undefined): DocumentCategory | null {
  if (!value) return null;
  const normalized = value.trim().toLocaleLowerCase("pl");
  return CATEGORY_VALUES.has(normalized) ? normalized as DocumentCategory : null;
}

export function suggestDocumentClassification(fileName: string, mimeType = ""): DocumentClassification {
  const name = normalize(fileName);
  const mime = mimeType.toLowerCase();

  if (/(kosztorys|przedmiar|boq|wycena|zestawienie[-_ ]?koszt)/.test(name)) {
    return result("kosztorys", "wysoka", "Nazwa pliku wskazuje kosztorys, przedmiar albo wycenę.");
  }

  if (/(harmonogram|schedule|terminarz|kamienie[-_ ]?milowe)/.test(name)) {
    return result("harmonogram", "wysoka", "Nazwa pliku wskazuje harmonogram lub terminarz.");
  }

  if (/(protokol|odbior|proba|szczeln|cisnieni|zanik|plukan|dezynfek)/.test(name)) {
    return result("protokol", "wysoka", "Nazwa pliku wskazuje protokół, próbę albo odbiór.");
  }

  if (/(wniosek.*material|material.*wniosek|zatwierdzenie.*material|akceptacja.*material)/.test(name)) {
    return result("wniosek", "wysoka", "Nazwa pliku wskazuje wniosek lub akceptację materiałową.");
  }

  if (/(umowa|kontrakt|aneks|zlecenie)/.test(name)) {
    return result("umowa", "wysoka", "Nazwa pliku wskazuje dokument kontraktowy.");
  }

  if (/(korespondencja|uzgodnienie|notatka|rfi|zapytanie|odpowiedz)/.test(name)) {
    return result("korespondencja", "średnia", "Nazwa pliku wskazuje korespondencję albo uzgodnienie.");
  }

  if (/(projekt|dokumentacja|stwi|specyfik|opis[-_ ]?techn|rysunek|rzut|schemat|pzt|pw|pb)/.test(name)) {
    return result("dokumentacja", "wysoka", "Nazwa pliku wskazuje dokumentację projektową lub techniczną.");
  }

  const isSpreadsheet = mime.includes("spreadsheet") || /\.(xlsx?|csv)$/i.test(fileName);
  if (isSpreadsheet) {
    return result("do_weryfikacji", "niska", "Arkusz może być kosztorysem, harmonogramem albo zestawieniem — wymaga potwierdzenia.");
  }

  const isPdfOrWord = mime.includes("pdf") || mime.includes("word") || /\.(pdf|docx?|odt)$/i.test(fileName);
  if (isPdfOrWord) {
    return result("dokumentacja", "średnia", "Format pasuje do dokumentacji, ale nazwę warto zweryfikować.");
  }

  return result("do_weryfikacji", "niska", "Brak jednoznacznych sygnałów do automatycznego przypisania.");
}
