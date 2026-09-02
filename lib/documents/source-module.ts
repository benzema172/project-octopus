export const DOCUMENT_SOURCE_MODULES = ["warehouse", "hr"] as const;

export type DocumentSourceModule = (typeof DOCUMENT_SOURCE_MODULES)[number];
export type SourcePreferredCategory = "warehouse" | "hr";

export function normalizeDocumentSourceModule(value: unknown): DocumentSourceModule | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "warehouse" || normalized === "hr" ? normalized : null;
}

export function preferredCategoryForSourceModule(sourceModule: DocumentSourceModule | null): SourcePreferredCategory | null {
  if (sourceModule === "warehouse") return "warehouse";
  if (sourceModule === "hr") return "hr";
  return null;
}

export function sourceModuleLabel(sourceModule: DocumentSourceModule): string {
  return sourceModule === "warehouse" ? "Magazyn" : "Kadry";
}

export function sourceModulePromptHint(sourceModule: DocumentSourceModule | null): string | undefined {
  if (sourceModule === "warehouse") {
    return [
      "Dokument został wrzucony przez Wrzutnię uruchomioną z modułu Magazyn.",
      "Traktuj ten kontekst jako silną podpowiedź routingu, a nie twardą blokadę kategorii.",
      "Jeśli treść dotyczy materiałów, urządzeń, dostaw, PZ/WZ/RW/ZW/MM, faktur zakupu towarów, stanów, cen, dostawców lub gospodarki magazynowej, preferuj category=\"warehouse\" i wyodrębnij dane biznesowe potrzebne Magazynowi.",
      "Jeżeli treść dokumentu jednoznacznie dotyczy innego obszaru (np. kadr, floty lub dokumentacji inwestycji), zignoruj podpowiedź modułu i sklasyfikuj dokument zgodnie z jego rzeczywistą treścią."
    ].join(" ");
  }

  if (sourceModule === "hr") {
    return [
      "Dokument został wrzucony przez Wrzutnię uruchomioną z modułu Kadry.",
      "Traktuj ten kontekst jako silną podpowiedź routingu, a nie twardą blokadę kategorii.",
      "Jeśli treść dotyczy pracownika, umowy o pracę lub zlecenia, urlopu, czasu pracy, badań lekarskich, BHP, uprawnień, wynagrodzeń albo innych danych kadrowych, preferuj category=\"hr\".",
      "Jeżeli treść dokumentu jednoznacznie dotyczy innego obszaru (np. magazynu, floty lub dokumentacji inwestycji), zignoruj podpowiedź modułu i sklasyfikuj dokument zgodnie z jego rzeczywistą treścią."
    ].join(" ");
  }

  return undefined;
}

export function sourceModuleMetadata(sourceModule: DocumentSourceModule) {
  return {
    sourceModule,
    routingHint: "strong" as const,
    preferredCategory: preferredCategoryForSourceModule(sourceModule)
  };
}
