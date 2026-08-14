export type ModuleMetric = {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "positive" | "warning" | "danger";
};

export type ModuleCapability = {
  title: string;
  description: string;
  source: string;
};

export type ModuleWorkflow = {
  label: string;
  description: string;
  status: "Aktywne" | "Do zasilenia" | "Wymaga konfiguracji";
};

export type WorkspaceModuleDefinition = {
  eyebrow: string;
  title: string;
  description: string;
  status: string;
  metrics: ModuleMetric[];
  alerts: string[];
  aiSummary: string;
  capabilities: ModuleCapability[];
  workflows: ModuleWorkflow[];
};

export const WORKSPACE_MODULES: Record<string, WorkspaceModuleDefinition> = {
  finance: {
    eyebrow: "Centrum finansowe",
    title: "Finanse",
    description: "Cash flow, wynik inwestycji, zobowiązania i zaangażowanie środków w jednym modelu zarządczym.",
    status: "Model finansowy gotowy do zasilenia",
    metrics: [
      { label: "Środki dostępne", value: "—", detail: "Po podłączeniu rachunków" },
      { label: "Cash flow 13 tyg.", value: "—", detail: "Prognoza wpływów i wydatków", tone: "positive" },
      { label: "Należności", value: "0 PLN", detail: "Brak zaksięgowanych dokumentów", tone: "warning" },
      { label: "Zobowiązania", value: "0 PLN", detail: "Brak zaksięgowanych dokumentów" }
    ],
    alerts: [
      "Faktury bez przypisania do inwestycji lub kosztu wymagają dekretacji zarządczej.",
      "Przerób zaakceptowany, ale jeszcze niezafakturowany jest osobną warstwą wyniku.",
      "Koszt pracownika jest widoczny w projekcie bez ujawniania danych płacowych osobom technicznym."
    ],
    aiSummary: "AI łączy linie faktur, pobrania magazynowe, czas pracy i pozycje BOQ. Wynik pokazuje źródło każdej kwoty oraz oddziela budżet, zaangażowanie, koszt, fakturę i płatność.",
    capabilities: [
      { title: "Cash flow", description: "Widok dzienny, tygodniowy i 13-tygodniowy z trzema scenariuszami płynności.", source: "Faktury, płatności, harmonogramy" },
      { title: "Wynik inwestycji", description: "Przychód, koszt, marża, koszt do zakończenia i odchylenia od kosztorysu.", source: "BOQ, przerób, magazyn, kadry, flota" },
      { title: "Faktury i KSeF", description: "Skrzynka zakupowa, sprzedaż, korekty, UPO i kontrola duplikatów.", source: "KSeF 2.0 i PDF" },
      { title: "Rozrachunki", description: "Terminy, należności, zobowiązania, płatności częściowe i kompensaty.", source: "Kontrahenci i bank" }
    ],
    workflows: [
      { label: "KSeF inbound", description: "Pobieranie metadanych i faktur zakupowych.", status: "Wymaga konfiguracji" },
      { label: "Dekretacja zarządcza", description: "Przypisanie linii faktury do inwestycji, BOQ i kosztu.", status: "Do zasilenia" },
      { label: "Kontrola płynności", description: "Prognoza na podstawie terminów i harmonogramu.", status: "Do zasilenia" }
    ]
  },
  hr: {
    eyebrow: "Zasoby ludzkie",
    title: "Kadry",
    description: "Kartoteki pracowników, zatrudnienie, czas, urlopy, uprawnienia i koszt zaangażowania.",
    status: "Bezpieczny model danych HR",
    metrics: [
      { label: "Pracownicy aktywni", value: "0", detail: "Kartoteka oczekuje na import" },
      { label: "Badania do odnowienia", value: "0", detail: "Najbliższe 30 dni", tone: "warning" },
      { label: "Urlopy bieżące", value: "0", detail: "Wnioski zaakceptowane" },
      { label: "Obsada inwestycji", value: "0%", detail: "Na podstawie harmonogramów" }
    ],
    alerts: [
      "Dane płacowe i medyczne mają osobne role dostępu.",
      "System pilnuje badań, BHP, SEP, UDT, F-gazów i innych uprawnień.",
      "Koszt pracy trafia do wyniku projektu jako agregat okresu i miejsca pracy."
    ],
    aiSummary: "AI odczyta umowy, zaświadczenia i uprawnienia, zaproponuje terminy oraz ostrzeże o brakach. Nie zatwierdzi samodzielnie danych kadrowych ani wynagrodzeń.",
    capabilities: [
      { title: "Kartoteka pracownika", description: "Zatrudnienie, historia warunków, dane kontaktowe, przypisania i dokumenty.", source: "Umowy i akta" },
      { title: "Czas i obecność", description: "Ewidencja czasu, delegacje, nadgodziny i przypisanie do inwestycji.", source: "Karty czasu" },
      { title: "Urlopy", description: "Limity, wnioski, akceptacje, kalendarz nieobecności i zastępstwa.", source: "HR i pracownik" },
      { title: "Kompetencje", description: "Badania, BHP, SEP, UDT, F-gazy, szkolenia i alerty ważności.", source: "Dokumenty pracownika" }
    ],
    workflows: [
      { label: "Import pracowników", description: "Kontrolowany import podstawowych kartotek.", status: "Do zasilenia" },
      { label: "Obieg urlopowy", description: "Wniosek, przełożony, HR i aktualizacja limitu.", status: "Do zasilenia" },
      { label: "Terminy obowiązkowe", description: "Powiadomienia o badaniach i uprawnieniach.", status: "Aktywne" }
    ]
  },
  warehouse: {
    eyebrow: "Materiały i narzędzia",
    title: "Magazyn",
    description: "Rzeczywiste stany, ruchy PZ/WZ/RW/ZW/MM, rezerwacje oraz zużycie na inwestycjach.",
    status: "Ruch magazynowy jako źródło prawdy",
    metrics: [
      { label: "Wartość zapasu", value: "0 PLN", detail: "Według ostatniej ceny" },
      { label: "Rezerwacje", value: "0", detail: "Materiały dla inwestycji" },
      { label: "Braki krytyczne", value: "0", detail: "Poniżej minimum", tone: "positive" },
      { label: "Narzędzia wydane", value: "0", detail: "Pracownicy i budowy" }
    ],
    alerts: [
      "Stan magazynu zmienia wyłącznie zatwierdzony dokument ruchu.",
      "Każde wydanie na budowę wskazuje inwestycję oraz pozycję BOQ/WBS.",
      "Faktura zakupowa nie zwiększa stanu bez potwierdzonego przyjęcia PZ."
    ],
    aiSummary: "AI dopasuje pozycje faktur i WZ do kartotek materiałowych, wykryje różnice jednostek i zasugeruje powiązanie z kosztorysem. Magazynier zatwierdza ruch i ilości.",
    capabilities: [
      { title: "Kartoteki", description: "Materiały, urządzenia, numery seryjne, jednostki, minima i lokalizacje.", source: "Dokumenty i katalog firmowy" },
      { title: "Ruchy", description: "PZ, WZ, RW, ZW i MM z pełną historią i załącznikami.", source: "Magazynier" },
      { title: "Rezerwacje", description: "Planowane zapotrzebowanie z harmonogramu i wniosków materiałowych.", source: "BOQ/WBS" },
      { title: "Narzędzia", description: "Wydania, zwroty, przeglądy, kalibracje i odpowiedzialność.", source: "Pracownik i flota" }
    ],
    workflows: [
      { label: "Przyjęcie dostawy", description: "Faktura/WZ → kontrola → PZ → stan.", status: "Do zasilenia" },
      { label: "Wydanie na budowę", description: "Rezerwacja → RW → koszt inwestycji.", status: "Do zasilenia" },
      { label: "Inwentaryzacja", description: "Arkusz spisu, różnice i zatwierdzona korekta.", status: "Do zasilenia" }
    ]
  },
  reports: {
    eyebrow: "Kontrola i decyzje",
    title: "Raporty",
    description: "Powtarzalne raporty zarządcze, projektowe i zgodnościowe z utrwalonym snapshotem danych.",
    status: "Katalog raportów zaprojektowany",
    metrics: [
      { label: "Raporty cykliczne", value: "0", detail: "Harmonogram wysyłki" },
      { label: "Raporty inwestycji", value: "0", detail: "Tygodniowe i miesięczne" },
      { label: "Wyjątki krytyczne", value: "0", detail: "Braki i opóźnienia", tone: "positive" },
      { label: "Ostatnie zamknięcie", value: "—", detail: "Brak snapshotu" }
    ],
    alerts: [
      "Zamknięty raport zapisuje snapshot, aby późniejsza korekta nie zmieniała historii.",
      "Każdy komentarz AI prowadzi do konkretnego źródła i definicji KPI.",
      "Raporty można eksportować do PDF/XLSX i planować ich dystrybucję."
    ],
    aiSummary: "AI przygotuje krótkie wyjaśnienie zmian, ryzyk i wyjątków. Nie tworzy liczb — podsumowanie powstaje wyłącznie z obliczonych KPI i zatwierdzonych danych.",
    capabilities: [
      { title: "Zarząd", description: "Portfel inwestycji, cash flow, marża, ryzyka i decyzje.", source: "Wszystkie moduły" },
      { title: "Budowa", description: "Postęp, przerób, protokoły, materiały, braki i plan 3-tygodniowy.", source: "Inwestycje" },
      { title: "Zgodność", description: "Wygasające dokumenty, braki odbiorowe, uprawnienia i terminy.", source: "Dokumenty, HR, flota" },
      { title: "Kreator", description: "Filtry, kolumny, KPI, porównania, zapis definicji i harmonogram.", source: "Definicje raportów" }
    ],
    workflows: [
      { label: "Raport tygodniowy budowy", description: "Szkic z dowodami i zatwierdzeniem kierownika.", status: "Do zasilenia" },
      { label: "Zamknięcie miesiąca", description: "Walidacja, snapshot i eksport zarządczy.", status: "Do zasilenia" },
      { label: "Alerty terminów", description: "Lista wyjątków z całej firmy.", status: "Aktywne" }
    ]
  },
  fleet: {
    eyebrow: "Pojazdy i maszyny",
    title: "Flota",
    description: "Samochody, ciężarówki, przyczepy i maszyny wraz z terminami, kosztami i przypisaniem do robót.",
    status: "Kartoteka floty gotowa",
    metrics: [
      { label: "Pojazdy aktywne", value: "0", detail: "Kartoteka oczekuje na import" },
      { label: "Terminy 30 dni", value: "0", detail: "OC, badania, serwis", tone: "warning" },
      { label: "Koszt miesiąca", value: "0 PLN", detail: "Paliwo, leasing, serwis" },
      { label: "Przestoje", value: "0", detail: "Pojazdy niedostępne" }
    ],
    alerts: [
      "Koszt pojazdu można przypisać do inwestycji według trasy, czasu lub proporcji.",
      "System pilnuje OC/AC, badań, leasingu, tachografów, winiet i legalizacji.",
      "GPS i karty paliwowe są integracją późniejszą — najpierw kartoteka i koszty."
    ],
    aiSummary: "AI odczyta faktury paliwowe, serwisowe i dokumenty pojazdów, a następnie wykryje nietypowe spalanie lub ryzyko terminu. Ocena kierowcy wymaga zweryfikowanych danych.",
    capabilities: [
      { title: "Kartoteka", description: "VIN, rejestracja, leasing, dane techniczne, przebieg i dokumenty.", source: "Dowody i umowy" },
      { title: "Eksploatacja", description: "Paliwo, AdBlue, przebiegi, trasy, opłaty drogowe, myjnia i parking.", source: "Faktury i kierowcy" },
      { title: "Serwis", description: "Zlecenia, naprawy, opony, koszt, przestój i następny termin.", source: "Serwis i faktury" },
      { title: "Rozliczenie", description: "Koszt/km, koszt miesiąca oraz alokacja do inwestycji.", source: "Finanse i trasy" }
    ],
    workflows: [
      { label: "Wydanie pojazdu", description: "Kierowca, protokół, wyposażenie i stan.", status: "Do zasilenia" },
      { label: "Obsługa szkody", description: "Zgłoszenie, dokumenty, koszt i zamknięcie.", status: "Do zasilenia" },
      { label: "Kontrola terminów", description: "Alerty i lista działań dla floty.", status: "Aktywne" }
    ]
  },
  templates: {
    eyebrow: "Kontrolowana baza wiedzy",
    title: "Wzory",
    description: "Wersjonowane szablony dokumentów, reguły zastosowania i mapowanie danych do generatorów AI.",
    status: "Generator oparty na zatwierdzonych wzorach",
    metrics: [
      { label: "Wzory zatwierdzone", value: "0", detail: "Gotowe do generowania" },
      { label: "Szkice", value: "0", detail: "W trakcie konfiguracji" },
      { label: "Pola nierozpoznane", value: "0", detail: "Do mapowania", tone: "warning" },
      { label: "Dokumenty wygenerowane", value: "0", detail: "Historia wersji" }
    ],
    alerts: [
      "Wzór z internetu trafia do kwarantanny i wymaga zatwierdzenia właściciela.",
      "Każda wersja ma pola, źródła danych, reguły zastosowania i zestaw testowy.",
      "AI korzysta ze wzoru przy generowaniu; nie uczy się trwale na pojedynczym pliku."
    ],
    aiSummary: "Po dodaniu DOCX/XLSX AI wykryje pola i zaproponuje mapowanie do Project DNA, kosztorysu, faktur, magazynu i danych firmy. Użytkownik zatwierdzi reguły i wynik testowy.",
    capabilities: [
      { title: "Biblioteka", description: "Wnioski, protokoły, harmonogramy, przeroby, pisma, formularze HR i magazynu.", source: "Wzory firmowe" },
      { title: "Studio wzoru", description: "Rozpoznawanie pól, mapowanie źródeł, reguły i podgląd testowy.", source: "AI + właściciel wzoru" },
      { title: "Wersjonowanie", description: "Szkic, zatwierdzony, wycofany, zakres obowiązywania i historia.", source: "Kontrola dokumentu" },
      { title: "Generator", description: "DOCX/PDF z listą źródeł, ostrzeżeń, numeracją i archiwum.", source: "Project DNA i moduły" }
    ],
    workflows: [
      { label: "Dodanie wzoru", description: "Plik → pola → mapowanie → test → zatwierdzenie.", status: "Do zasilenia" },
      { label: "Kandydat z internetu", description: "Wyszukanie → kwarantanna → kontrola formalna.", status: "Wymaga konfiguracji" },
      { label: "Generowanie dokumentu", description: "Dane → walidacja → szkic → akceptacja → eksport.", status: "Do zasilenia" }
    ]
  },
  settings: {
    eyebrow: "Administracja",
    title: "Ustawienia",
    description: "Firma, role, integracje, słowniki, polityki dokumentów i parametry AI.",
    status: "Konfiguracja workspace",
    metrics: [
      { label: "Aktywna firma", value: "PureInvest", detail: "Workspace domyślny" },
      { label: "Użytkownicy", value: "1", detail: "Właściciel systemu" },
      { label: "Integracje", value: "3", detail: "Supabase, R2, Gemini" },
      { label: "Stan systemu", value: "Gotowy", detail: "Po zastosowaniu migracji", tone: "positive" }
    ],
    alerts: [
      "Role domenowe oddzielają dane techniczne, finansowe, kadrowe i administracyjne.",
      "Sekrety KSeF, banku i AI pozostają wyłącznie po stronie serwera.",
      "Słowniki kategorii, jednostek i kodów kosztowych są wspólne dla całej firmy."
    ],
    aiSummary: "Ustawienia AI obejmują dostawcę, model, limity kosztu, progi pewności i reguły zatwierdzania. Każda zmiana konfiguracji jest audytowana.",
    capabilities: [
      { title: "Firma", description: "Dane spółki, waluta, numery dokumentów i domyślne dane formalne.", source: "Administrator" },
      { title: "Role i dostępy", description: "Owner, zarząd, finanse, HR, kierownicy, magazyn, flota i audyt.", source: "RLS i role domenowe" },
      { title: "Integracje", description: "Supabase, Cloudflare R2, Gemini, KSeF, bank i system księgowy.", source: "Sekrety serwerowe" },
      { title: "Słowniki", description: "Kategorie dokumentów, jednostki, kody kosztów, statusy i retencja.", source: "Konfiguracja firmy" }
    ],
    workflows: [
      { label: "Kontrola środowiska", description: "Stan bazy, storage, AI i migracji.", status: "Aktywne" },
      { label: "Nadawanie roli", description: "Wniosek, akceptacja i zapis audytowy.", status: "Do zasilenia" },
      { label: "Polityka retencji", description: "Kosz, legal hold i bezpieczne usuwanie.", status: "Do zasilenia" }
    ]
  }
};
