import type { ModuleMetric } from "@/lib/product/modules";

export type ProjectModuleDefinition = {
  eyebrow: string;
  title: string;
  description: string;
  primaryAction: string;
  metrics: ModuleMetric[];
  aiNote: string;
  areas: Array<{ title: string; description: string; source: string }>;
  queue: Array<{ title: string; context: string; state: string }>;
};

export const PROJECT_MODULES: Record<string, ProjectModuleDefinition> = {
  estimate: {
    eyebrow: "BOQ / WBS",
    title: "Kosztorys",
    description: "Wersjonowany kosztorys stanowi operacyjną oś harmonogramu, przerobu, protokołów, materiałów i finansów.",
    primaryAction: "Importuj kosztorys",
    metrics: [
      { label: "Wartość BOQ", value: "—", detail: "Po zatwierdzeniu wersji bazowej" },
      { label: "Pozycje", value: "0", detail: "Preferowany import XLSX" },
      { label: "Powiązane WBS", value: "0%", detail: "Etapy i zakres robót", tone: "warning" },
      { label: "Odchylenia", value: "0", detail: "Rewizje i braki", tone: "positive" }
    ],
    aiNote: "AI rozpoznaje działy, pozycje, ilości, jednostki, ceny i rodzaje robót, a następnie proponuje WBS oraz wymagane protokoły. Wersja bazowa wymaga zatwierdzenia użytkownika.",
    areas: [
      { title: "Import i uzgodnienie", description: "XLSX zachowuje strukturę arkusza; PDF trafia do ekranu kontroli tabel.", source: "Kosztorys ofertowy" },
      { title: "Wersje BOQ", description: "Baseline, rewizje, roboty dodatkowe i historia zmian bez nadpisywania.", source: "Zatwierdzone rewizje" },
      { title: "Struktura WBS", description: "Branża, instalacja, strefa, etap i pakiet robót z zależnościami.", source: "Dokumentacja + BOQ" },
      { title: "Powiązania", description: "Każda pozycja wskazuje harmonogram, protokoły, wnioski, magazyn, faktury i postęp.", source: "Model inwestycji" }
    ],
    queue: [
      { title: "Wgraj kosztorys XLSX", context: "Wrzutnia automatycznie rozpozna typ dokumentu.", state: "Oczekuje" },
      { title: "Zatwierdź mapowanie WBS", context: "Pozycje zaczną zasilać pozostałe moduły.", state: "Zablokowane" }
    ]
  },
  applications: {
    eyebrow: "Akceptacja materiałów",
    title: "Wnioski materiałowe",
    description: "Dokumenty dla inspektora tworzone z dokumentacji, kosztorysu, faktur i ruchów magazynowych według firmowych wzorów.",
    primaryAction: "Utwórz wniosek",
    metrics: [
      { label: "Do przygotowania", value: "0", detail: "Wymagania z BOQ/WBS" },
      { label: "Szkice AI", value: "0", detail: "Wymagają weryfikacji" },
      { label: "W akceptacji", value: "0", detail: "U inspektora" },
      { label: "Zatwierdzone", value: "0", detail: "Dopuszczone do użycia", tone: "positive" }
    ],
    aiNote: "AI tworzy dossier produktu: producent, typ, parametry, deklaracje, karty techniczne i zgodność z projektem/STWiOR. Brak parametru jest ostrzeżeniem, nigdy wymyśloną wartością.",
    areas: [
      { title: "Matryca materiałów", description: "Lista wymaganych wniosków wynikająca z BOQ, projektu i STWiOR.", source: "Project DNA" },
      { title: "Dossier produktu", description: "Karta techniczna, deklaracja, atest, certyfikat, gwarancja i porównanie parametrów.", source: "Dokumenty i faktury" },
      { title: "Generator", description: "Wzór, automatyczne pola, załączniki, numer i podgląd przed zatwierdzeniem.", source: "Biblioteka Wzorów" },
      { title: "Obieg", description: "Szkic, weryfikacja techniczna, wysłany, uwagi, zatwierdzony lub odrzucony.", source: "Kierownik / inspektor" }
    ],
    queue: [
      { title: "Dodaj firmowy wzór wniosku", context: "AI rozpozna pola i zaproponuje mapowanie.", state: "Oczekuje" },
      { title: "Zatwierdź kosztorys", context: "Na jego podstawie powstanie matryca materiałów.", state: "Zablokowane" }
    ]
  },
  protocols: {
    eyebrow: "Jakość i odbiory",
    title: "Protokoły",
    description: "Matryca wymaganych prób, robót zanikowych i odbiorów wynikająca z faktycznego zakresu budowy.",
    primaryAction: "Utwórz protokół",
    metrics: [
      { label: "Wymagane", value: "0", detail: "Z BOQ, projektu i STWiOR" },
      { label: "Do wykonania", value: "0", detail: "Według harmonogramu", tone: "warning" },
      { label: "W akceptacji", value: "0", detail: "Oczekują na podpis" },
      { label: "Zamknięte", value: "0", detail: "Z kompletem dowodów", tone: "positive" }
    ],
    aiNote: "Jeżeli zakres obejmuje kanalizację sanitarną, AI proponuje m.in. protokół robót zanikowych i odpowiednie próby. Typ, metoda i parametry muszą wynikać z zatwierdzonych źródeł.",
    areas: [
      { title: "Matryca wymagań", description: "Rodzaj robót, moment wykonania, dowody, osoby i podstawa formalna.", source: "BOQ + dokumentacja" },
      { title: "Próby i pomiary", description: "Szczelność, ciśnienie, wydajność, regulacja, płukanie i dezynfekcja.", source: "STWiOR i normy wskazane w projekcie" },
      { title: "Roboty zanikowe", description: "Zakres, lokalizacja, zdjęcia, materiały, gotowość do zakrycia i podpisy.", source: "Harmonogram i budowa" },
      { title: "Odbiory", description: "Częściowe, branżowe, końcowe, usterki, załączniki i podpis elektroniczny.", source: "Kontrakt i wzory" }
    ],
    queue: [
      { title: "Dodaj wzory protokołów", context: "Wersja zatwierdzona zasili generator.", state: "Oczekuje" },
      { title: "Rozpoznaj wymagania", context: "Wymaga Project DNA i WBS.", state: "Zablokowane" }
    ]
  },
  schedule: {
    eyebrow: "Plan realizacji",
    title: "Harmonogram",
    description: "Baseline kontraktowy, harmonogram bieżący i prognoza AI połączone z BOQ/WBS oraz wymaganymi odbiorami.",
    primaryAction: "Utwórz baseline",
    metrics: [
      { label: "Postęp planowany", value: "0%", detail: "Według baseline" },
      { label: "Postęp rzeczywisty", value: "0%", detail: "Na podstawie odbioru" },
      { label: "Opóźnienie", value: "0 dni", detail: "Prognoza terminu", tone: "positive" },
      { label: "Plan 3 tygodni", value: "0", detail: "Zadania gotowe" }
    ],
    aiNote: "AI proponuje czasy i zależności na podstawie ilości, zakresu oraz terminu kontraktowego. Baseline zatwierdza kierownik; prognoza pokazuje założenia i źródła.",
    areas: [
      { title: "Baseline", description: "Wersja kontraktowa, kamienie milowe, kalendarz i ścieżka krytyczna.", source: "Umowa + BOQ/WBS" },
      { title: "Plan bieżący", description: "Aktualne daty, zależności, zasoby, gotowość materiałów i front robót.", source: "Kierownik budowy" },
      { title: "Lookahead", description: "Plan 3-tygodniowy z przeszkodami, odbiorami i dostawami.", source: "Postęp + magazyn" },
      { title: "Prognoza", description: "Ryzyko terminu, scenariusze nadrobienia oraz wpływ zmian zakresu.", source: "Octopus Brain" }
    ],
    queue: [
      { title: "Ustal okres realizacji", context: "Daty są pobierane z karty inwestycji.", state: "Do sprawdzenia" },
      { title: "Zatwierdź WBS", context: "Pakiety robót zasilą zadania harmonogramu.", state: "Zablokowane" }
    ]
  },
  progress: {
    eyebrow: "Wykonanie i rozliczenie",
    title: "Przerób",
    description: "Ilościowe i wartościowe wykonanie robót z kontrolą materiałów, odbioru, fakturowania i płatności.",
    primaryAction: "Otwórz okres przerobu",
    metrics: [
      { label: "Wykonane", value: "0%", detail: "Ilość zgłoszona" },
      { label: "Odebrane", value: "0%", detail: "Potwierdzone protokołem" },
      { label: "Zafakturowane", value: "0 PLN", detail: "Sprzedaż projektu" },
      { label: "Pozostało", value: "—", detail: "Po zatwierdzeniu BOQ" }
    ],
    aiNote: "System rozdziela postęp planowany, wykonany, odebrany, zafakturowany i zapłacony. AI sygnalizuje niespójność między ilością robót, materiałami, protokołami i wartością.",
    areas: [
      { title: "Okres rozliczeniowy", description: "Miesiąc, wersja BOQ, zakres, zgłoszone i zaakceptowane ilości.", source: "Kierownik / inspektor" },
      { title: "Kontrola materiałowa", description: "Zużycie magazynowe i faktury porównane z wykonanymi pozycjami.", source: "Magazyn i finanse" },
      { title: "Dowody", description: "Protokoły, zdjęcia, pomiary, odbiory i uwagi do każdej pozycji.", source: "Dokumentacja budowy" },
      { title: "Prognoza końcowa", description: "Koszt do zakończenia, przewidywana marża i ryzyko przekroczenia.", source: "Finanse projektu" }
    ],
    queue: [
      { title: "Zatwierdź kosztorys bazowy", context: "Przerób rozlicza się na pozycjach BOQ.", state: "Zablokowane" },
      { title: "Utwórz pierwszy okres", context: "Po rozpoczęciu rejestracji postępu.", state: "Oczekuje" }
    ]
  },
  finance: {
    eyebrow: "Wynik inwestycji",
    title: "Finanse projektu",
    description: "Budżet, zaangażowanie, koszt, przychód, płatność i marża powiązane bezpośrednio z BOQ/WBS.",
    primaryAction: "Otwórz budżet",
    metrics: [
      { label: "Wartość kontraktu", value: "—", detail: "Z karty inwestycji" },
      { label: "Koszt poniesiony", value: "0 PLN", detail: "Faktury, magazyn, ludzie, flota" },
      { label: "Zaangażowanie", value: "0 PLN", detail: "Zamówienia i rezerwacje" },
      { label: "Marża prognozowana", value: "—", detail: "Po zatwierdzeniu budżetu" }
    ],
    aiNote: "Każda kwota zachowuje źródło i przypisanie. AI pomaga dekretować, wykrywać duplikaty i prognozować, lecz płatności i dokumenty finansowe zatwierdza uprawniony użytkownik.",
    areas: [
      { title: "Budżet", description: "Wartość sprzedaży i planowane koszty według kodów oraz WBS.", source: "BOQ i kontrakt" },
      { title: "Koszty rzeczywiste", description: "Faktury, magazyn, czas pracy, flota, podwykonawcy i koszty pośrednie.", source: "Moduły firmowe" },
      { title: "Sprzedaż", description: "Przerób, protokół, faktura, należność i płatność.", source: "Przerób + KSeF" },
      { title: "Forecast", description: "Koszt do zakończenia, marża końcowa i scenariusze ryzyka.", source: "Dane zatwierdzone + AI" }
    ],
    queue: [
      { title: "Zatwierdź budżet bazowy", context: "Rozdziel sprzedaż i koszt wykonania.", state: "Oczekuje" },
      { title: "Przypisz faktury", context: "Centralna skrzynka finansowa nie ma jeszcze dokumentów.", state: "Oczekuje" }
    ]
  },
  team: {
    eyebrow: "Zespół inwestycji",
    title: "Zespół",
    description: "Obsada, role, odpowiedzialność, czas pracy, uprawnienia i dostęp do danych konkretnej budowy.",
    primaryAction: "Przypisz pracownika",
    metrics: [
      { label: "Zespół aktywny", value: "0", detail: "Osoby przypisane" },
      { label: "Czas w miesiącu", value: "0 h", detail: "Ewidencja projektu" },
      { label: "Braki uprawnień", value: "0", detail: "Kontrola przed pracą", tone: "positive" },
      { label: "Koszt okresu", value: "0 PLN", detail: "Agregat dla kierownika" }
    ],
    aiNote: "AI kontroluje zgodność kwalifikacji z planowanymi zadaniami i prognozuje zapotrzebowanie na zasoby. Dane osobowe i płacowe są filtrowane zgodnie z rolą.",
    areas: [
      { title: "Obsada", description: "Kierownicy, brygady, podwykonawcy, zakres odpowiedzialności i okres.", source: "Kadry" },
      { title: "Czas pracy", description: "Godziny, nadgodziny, delegacje i przypisanie do WBS.", source: "Pracownik / kierownik" },
      { title: "Uprawnienia", description: "Sprawdzenie badań, BHP i kwalifikacji wymaganych do robót.", source: "Kartoteka HR" },
      { title: "Dostęp", description: "Role projektowe, zakres danych, zatwierdzenia i historia zmian.", source: "Administrator" }
    ],
    queue: [
      { title: "Zaimportuj kartoteki HR", context: "Dane są wspólne dla firmy, przypisania dotyczą projektu.", state: "Oczekuje" },
      { title: "Zdefiniuj obsadę", context: "Po uruchomieniu harmonogramu.", state: "Zablokowane" }
    ]
  },
  warehouse: {
    eyebrow: "Materiały inwestycji",
    title: "Magazyn projektu",
    description: "Rezerwacje, dostawy, wydania, zwroty i zużycie materiałów rozliczone z kosztorysem oraz postępem.",
    primaryAction: "Zgłoś zapotrzebowanie",
    metrics: [
      { label: "Rezerwacje", value: "0", detail: "Dla najbliższych robót" },
      { label: "Na budowie", value: "0 PLN", detail: "Wartość wydań" },
      { label: "Zużyte", value: "0 PLN", detail: "Rozliczone z postępem" },
      { label: "Braki", value: "0", detail: "Ryzyko harmonogramu", tone: "positive" }
    ],
    aiNote: "AI porównuje zapotrzebowanie z BOQ, zatwierdzonymi wnioskami, stanem i dostawami. Każda zmiana stanu wymaga zatwierdzonego dokumentu magazynowego.",
    areas: [
      { title: "Zapotrzebowanie", description: "Materiały potrzebne według WBS i najbliższych zadań.", source: "Kosztorys + harmonogram" },
      { title: "Rezerwacje", description: "Blokada dostępnego stanu lub plan zamówienia.", source: "Magazyn centralny" },
      { title: "Dostawy", description: "WZ/PZ, kontrola ilości, dokumenty jakościowe i przypisanie do wniosku.", source: "Dostawca" },
      { title: "Zużycie", description: "RW/ZW, pozycja BOQ, wykonanie i analiza odchyleń.", source: "Budowa" }
    ],
    queue: [
      { title: "Zatwierdź matrycę materiałów", context: "Powstaje z kosztorysu i dokumentacji.", state: "Zablokowane" },
      { title: "Uruchom rezerwacje", context: "Wymaga kartotek i stanów magazynu firmy.", state: "Oczekuje" }
    ]
  },
  reports: {
    eyebrow: "Raportowanie projektu",
    title: "Raporty inwestycji",
    description: "Tygodniowe i miesięczne podsumowania zakresu, terminu, kosztu, jakości, materiałów i ryzyk.",
    primaryAction: "Utwórz raport",
    metrics: [
      { label: "Raport tygodniowy", value: "—", detail: "Nie wygenerowano" },
      { label: "Postęp", value: "0%", detail: "Wykonany i odebrany" },
      { label: "Ryzyka", value: "0", detail: "Otwarte wyjątki", tone: "positive" },
      { label: "Kompletność", value: "0%", detail: "Dokumenty i odbiory" }
    ],
    aiNote: "AI opisuje wyłącznie zatwierdzone wskaźniki, zmiany i wyjątki, a każdy wniosek prowadzi do dokumentu, pozycji BOQ lub zdarzenia źródłowego.",
    areas: [
      { title: "Raport tygodniowy", description: "Wykonanie, plan, przeszkody, dostawy, odbiory, zdjęcia i decyzje.", source: "Wszystkie moduły projektu" },
      { title: "Raport miesięczny", description: "Przerób, wynik, cash flow, postęp, jakość, zmiany i prognoza.", source: "Snapshot okresu" },
      { title: "Kompletność", description: "Brakujące wnioski, protokoły, dokumenty i terminy formalne.", source: "Project DNA" },
      { title: "Eksport", description: "PDF/XLSX, definicja KPI, wersja i archiwum wysyłek.", source: "Generator raportów" }
    ],
    queue: [
      { title: "Zasil moduły projektu", context: "Raport nie tworzy danych, tylko je zamyka i objaśnia.", state: "Oczekuje" },
      { title: "Zapisz pierwszy snapshot", context: "Po zamknięciu okresu przerobu.", state: "Zablokowane" }
    ]
  }
};
