export const DOCUMENT_SOURCE_MODULES = ["warehouse", "hr", "fleet"] as const;

export type DocumentSourceModule = (typeof DOCUMENT_SOURCE_MODULES)[number];
export type SourcePreferredCategory = "warehouse" | "hr" | "fleet";

export function normalizeDocumentSourceModule(value: unknown): DocumentSourceModule | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "warehouse" || normalized === "hr" || normalized === "fleet" ? normalized : null;
}

export function preferredCategoryForSourceModule(sourceModule: DocumentSourceModule | null): SourcePreferredCategory | null {
  if (sourceModule === "warehouse") return "warehouse";
  if (sourceModule === "hr") return "hr";
  if (sourceModule === "fleet") return "fleet";
  return null;
}

export function sourceModuleLabel(sourceModule: DocumentSourceModule): string {
  if (sourceModule === "warehouse") return "Magazyn";
  if (sourceModule === "hr") return "Kadry";
  return "Flota";
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

  if (sourceModule === "fleet") {
    return [
      "Dokument lub materiał został przekazany przez Wrzutnię uruchomioną z modułu Flota.",
      "Traktuj ten kontekst jako silną podpowiedź routingu, a nie twardą blokadę kategorii.",
      "Jeśli treść dotyczy pojazdu, maszyny, VIN, numeru rejestracyjnego, polisy OC/AC, przeglądu, UDT, leasingu, serwisu, naprawy, opon, szkody, tankowania, paliwa, przebiegu, motogodzin, telematyki, GPS, OBD/CAN, kodów DTC, ładowania EV, e-TOLL, tachografu, SENT/PUESC, ADR albo kosztów eksploatacji, preferuj category=\"fleet\".",
      "Dla dokumentów Floty wydobądź możliwie dokładnie: registrationNumber, vin, documentType, documentNumber, validFrom, validUntil, issueDate, providerName, amount, currency, mileage, engineHours, fuelLiters, fuelType, serviceType, workshopName, claimNumber, kody diagnostyczne oraz identyfikatory zgodności, jeśli faktycznie znajdują się w źródle.",
      "Jeżeli sztywny schemat odpowiedzi nie ma osobnego pola dla danych Floty, zapisz je w facts z jednoznacznym label i type, aby moduł Flota mógł je bezpiecznie odczytać.",
      "Jeśli materiał przedstawia oględziny pojazdu, walkaround, kontrolę przy wydaniu/zwrocie, zdjęcia albo film inspekcyjny, ustaw subcategory zawierającą słowo walkaround lub inspection i opisz widoczne nieprawidłowości w risks. impactArea powinien wskazywać możliwie konkretny obszar pojazdu, a confidence poziom pewności obserwacji.",
      "Nie nazywaj uszkodzenia NOWYM i nie przypisuj momentu jego powstania, jeśli nie masz porównywalnego materiału bazowego lub jednoznacznego dowodu. Nie orzekaj winy kierowcy ani odpowiedzialności prawnej na podstawie samych zdjęć, filmu lub telematyki.",
      "Nie zakładaj nowego pojazdu na podstawie niepewnego dokumentu. Gdy identyfikacja pojazdu, przebiegu, kosztu, zdarzenia lub typu dokumentu nie jest jednoznaczna, pozostaw informację do potwierdzenia przez użytkownika.",
      "W danych e-TOLL, tachografu i SENT odczytuj wyłącznie fakty widoczne w źródle; nie zakładaj, że pojazd podlega konkretnemu obowiązkowi prawnemu bez danych pozwalających to potwierdzić.",
      "Jeżeli treść jednoznacznie dotyczy innego obszaru, zignoruj podpowiedź Floty i sklasyfikuj dokument zgodnie z jego rzeczywistą treścią."
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
