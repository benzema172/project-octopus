# Project Octopus — kierunek produktu i plan profesjonalnej rozbudowy

- Data analizy: 22.08.2026
- Punkt odniesienia: `origin/main` / `1018c20` z 20.08.2026
- Zakres: cała aplikacja, ze szczególnym naciskiem na moduł Inwestycje

## 1. Diagnoza

Project Octopus ma już mocny fundament domenowy. To nie jest makieta: pełny łańcuch 81 migracji tworzy model dokumentów, BOQ/WBS, harmonogramu, przerobu, protokołów, materiałów, finansów, magazynu, HR, floty, raportów, uprawnień, audytu i AI. Krytyczne operacje finansowe i magazynowe mają ścieżki atomowe, a dokumenty przechodzą przez R2, kwarantannę, Gemini i Brain.

Największym ograniczeniem nie jest dziś brak tabel ani liczby funkcji. Jest nim sposób ich podania użytkownikowi:

- funkcje powstawały w kolejnych warstwach i część z nich jest trudna do odkrycia,
- podobne informacje występują równolegle na Pulpicie, w Autopilocie, Control 360 i modułach,
- 10 tys. linii CSS w wielu arkuszach utrudnia utrzymanie jednolitego rytmu i gęstości,
- część modułów pokazuje możliwości systemu zamiast prowadzić użytkownika do następnej decyzji,
- istniejący model `tasks` nie był dotąd pełnoprawnym narzędziem codziennej pracy,
- wersjonowanie BOQ i harmonogram są silne w danych, ale potrzebują lepszych narzędzi edycji i kontroli zmian,
- moduły firmy są funkcjonalne, lecz nie wszystkie domykają pełny obieg od zdarzenia do zatwierdzenia i rozliczenia.

Wniosek: kolejny etap powinien rozwijać Octopusa jako **system decyzji i obiegów**, nie jako zbiór kolejnych ekranów.

## 2. Zasady docelowego produktu

1. **Najpierw działanie, potem dane.** Pulpity pokazują wyjątki, terminy, odpowiedzialność i następny krok. Pełne rejestry pozostają poziom niżej.
2. **Jedno źródło prawdy.** Dokument, BOQ, zadanie, faktura, ruch magazynowy lub protokół istnieje raz i może mieć wiele kontrolowanych powiązań.
3. **Funkcje pracują w tle.** Dopasowanie, alerty, przeliczenia, kontrola kompletności i przygotowanie szkiców nie wymagają osobnych ekranów, dopóki wynik nie wymaga decyzji.
4. **AI proponuje, człowiek odpowiada.** AI może klasyfikować, wykrywać, porównywać i przygotowywać szkice. Nie może potwierdzić wykonania, wyniku próby, podpisu, płatności ani formalnej akceptacji.
5. **Stopniowe ujawnianie szczegółów.** Widok podstawowy pozostaje krótki. Formularze, historia, źródła i ustawienia są rozwijane dopiero na żądanie.
6. **Każda decyzja ma kontekst.** Użytkownik widzi źródło, wpływ, termin, właściciela i ślad audytowy.
7. **Jedna terminologia.** Te same statusy, priorytety, filtry, przyciski i układ list obowiązują we wszystkich modułach.

## 3. Docelowa konstrukcja aplikacji

| Poziom | Widoczne dla użytkownika | Praca w tle |
|---|---|---|
| Firma | kolejka działań, portfel, KPI zarządcze | agregacja wyjątków ze wszystkich domen |
| Inwestycja | stan kontraktu, Plan działań, wykonanie, koszt, termin, jakość | Autopilot, reconciliation, prognoza, kompletność źródeł |
| Moduł | krótka lista robocza i operacje właściwe dla roli | walidacje, powiązania, audyt, powiadomienia |
| Rekord | dane, historia, źródła, załączniki i decyzje | wersjonowanie, reguły statusów, kontrola uprawnień |
| OctopusAI | jedna Skrzynka decyzji i wyszukiwanie wiedzy | klasyfikacja, ekstrakcja, rekomendacje, monitoring jakości |

## 4. Inwestycje — docelowy model pracy

### Pulpit

Pulpit inwestycji powinien odpowiadać na sześć pytań:

1. Czy termin jest zagrożony?
2. Co należy zrobić teraz i kto za to odpowiada?
3. Jaki jest postęp względem BOQ i harmonogramu?
4. Jaki jest koszt końcowy i prognozowana marża?
5. Jakie zmiany, braki dowodowe lub decyzje blokują pracę?
6. Czy inwestycja jest gotowa do odbioru i zamknięcia?

Nie należy dodawać kolejnych kart informacyjnych. Nowe dane powinny zasilać jedną z powyższych odpowiedzi.

### Nawigacja

Obecny kierunek grupowania jest właściwy. Docelowa struktura:

| Grupa | Zawartość |
|---|---|
| Pulpit | stan i najbliższe decyzje |
| Projekt | dane kontraktowe, dokumentacja, Brain |
| Realizacja | Plan działań, BOQ/WBS, harmonogram, budowa, przerób, WM, protokoły |
| Zasoby | zespół, magazyn, później flota i sprzęt inwestycji |
| Finanse | budżet, koszty, zobowiązania, zmiany kontraktowe, forecast |
| Kontrola | Control 360, raporty, korespondencja i rejestr zmian |
| Zamknięcie | checklista closeout, paczki wynikowe i archiwum |

### Plan działań

Plan działań jest brakującym łącznikiem pomiędzy analizą a wykonaniem. Powinien łączyć:

- zadania wpisane ręcznie,
- misje Autopilota zaakceptowane przez użytkownika,
- terminy wynikające z harmonogramu, protokołów, WM i dokumentów,
- decyzje ze Skrzynki AI,
- działania wynikające z anomalii finansowych lub magazynowych,
- odpowiedzialność osoby lub roli,
- status `do zrobienia / w toku / zablokowane / zakończone`,
- priorytet, termin, źródło i ślad audytowy.

Pierwsza wersja została wdrożona w ramach tej analizy: tworzenie, rozpoczęcie, zakończenie i ponowne otwarcie działania; filtrowanie; kolejność według ryzyka; podgląd na Pulpicie; sygnały w portfelu; integracja z kolejką firmy.

### BOQ i WBS

Następny profesjonalny krok:

- edycja pozycji w tabeli z walidacją ilości, jednostki, ceny i wartości,
- wersje `draft / baseline / revision / superseded`,
- porównanie dwóch wersji i lista skutków zmiany,
- drzewo WBS z przeciąganiem pozycji do pakietów robót,
- masowe mapowanie pozycji do instalacji, strefy, etapu i kodu kosztowego,
- bezpośrednie powiązania z harmonogramem, przerobem, WM, protokołem, zakupem i fakturą,
- blokada zmiany zatwierdzonego baseline bez kontrolowanego Change Order.

### Harmonogram

- wizualny Gantt z zależnościami i kamieniami milowymi,
- baseline kontraktowy oraz bieżąca prognoza bez nadpisywania historii,
- trzytygodniowy lookahead z gotowością frontu, materiału, dokumentacji i odbioru,
- ścieżka krytyczna oraz wpływ zmiany zakresu,
- aktualizacja postępu z przerobu i zdarzeń budowy,
- tworzenie działań dla opóźnionych lub zablokowanych aktywności.

### Budowa i kontrola jakości

- mobilny dziennik zdarzeń: zdjęcie, głos, lokalizacja, zakres WBS i uczestnicy,
- RFI / pytania techniczne i korespondencja z terminem odpowiedzi,
- rejestr usterek i niezgodności z właścicielem oraz terminem usunięcia,
- checklista robót zanikowych przed zakryciem,
- dowody powiązane z BOQ/WBS, a nie tylko z całą inwestycją,
- protokół generowany z rzeczywistych danych, z kontrolowanym podpisem i wersją.

### Koszt, kontrakt i rozliczenie

- budżet bazowy według kodów kosztowych i WBS,
- koszt rzeczywisty, zobowiązany i prognozowany w jednym ledgerze,
- rejestr zmian i roszczeń: przyczyna, podstawa, wpływ czasu i pieniędzy, korespondencja, decyzja,
- 13-tygodniowy cash flow z wpływem opóźnień i zmian,
- przerób ilościowy, odebrany, zafakturowany i zapłacony na jednej osi,
- prognoza EAC/ETC z jawnymi założeniami i wersją.

### Zamknięcie

- automatyczna matryca braków oparta o kontrakt, BOQ, protokoły, WM i dokumenty,
- odbiory, usterki, gwarancje, DTR i szkolenia,
- wersjonowana paczka przekazania z manifestem źródeł,
- formalna bramka zamknięcia: techniczna, finansowa, magazynowa i dokumentowa,
- lessons learned zatwierdzane do wiedzy firmy.

## 5. Rozwój pozostałych modułów

| Moduł | Co już działa | Profesjonalne rozszerzenie | Priorytet |
|---|---|---|---|
| Finanse | faktury, płatności, zobowiązania, alokacje, księgowanie, matching, forecast | KSeF, bank, plan płatności, approval matrix, budżet vs EAC, rozrachunki kontrahenta, eksport księgowy | P1 |
| Magazyn | kartoteki, PZ/WZ/RW/ZW/MM, rezerwacje, stany, warstwy kosztowe | skan kodów, mobilne wydanie, dostawy do WM/PO, minima i propozycje zakupu, inwentaryzacja różnicowa | P1 |
| Kadry | pracownicy, badania, uprawnienia, urlopy, czas pracy, przypisania | plan załóg, mobilna obecność, akceptacja czasu, koszt roboczogodziny, eksport płacowy, dokumenty pracownicze | P2 |
| Flota | pojazdy, paliwo, trasy, serwis, szkody, dokumenty | przypisanie do budowy, koszt/km i koszt projektu, import kart paliwowych/GPS, plan serwisów i wykorzystanie | P2 |
| Dokumenty | prywatne R2, wersje, klasyfikacja, ekstrakcja, bezpieczne ZIP, kwarantanna, segmenty dużych plików, radar rewizji, macierz kompletności, workflow akceptacji, retencja, legal hold i data room | certyfikowany dostawca antymalware/podpisu oraz portal odbiorcy zewnętrznego | P0/P1 |
| OctopusAI | Brain, źródła, fakty, Skrzynka AI, jakość, Autopilot | kolejka decyzji według wpływu, progi autonomii per proces, koszt/latencja/jakość, reprocessing wybranego ekstraktora | P1 |
| Raporty | definicje, uruchomienia, snapshoty, CSV/JSON | role dashboardów, drill-down do źródła, PDF/XLSX, harmonogram dostaw, komentarz zarządczy AI zatwierdzany przez człowieka | P2 |
| Ustawienia | role domenowe, zakres projektu, integracje, reguły alertów | słowniki firmy, macierz zatwierdzeń, numeracje, SLA, retencja, limity AI, dziennik konfiguracji | P1 |

## 6. Automatyzacje w tle

| Zdarzenie | Automatyczna praca | Bramka człowieka |
|---|---|---|
| nowy dokument | klasyfikacja, ekstrakcja, dopasowanie projektu, aktualizacja Brain | akceptacja niepewnych faktów i skutków zmiany |
| nowa rewizja | diff, Change Radar, lista modułów dotkniętych zmianą | zatwierdzenie wpływu na BOQ, termin i kontrakt |
| zatwierdzony WM | propozycja zamówienia i rezerwacji | wysłanie zamówienia / zatwierdzenie wydania |
| faktura lub PZ | 3-way match i propozycja alokacji | akceptacja odchylenia i księgowania |
| postęp robót | przeliczenie harmonogramu, EAC i gotowości odbiorowej | zatwierdzenie ilości odebranej |
| zbliżający się termin | utworzenie sygnału lub działania | przypisanie odpowiedzialności i decyzja |
| brak dowodu | checklista i przypomnienie | dostarczenie rzeczywistego dowodu |
| zamknięcie etapu | przygotowanie protokołu i paczki źródeł | wynik, podpis i formalna akceptacja |

Automatyzacja powinna być idempotentna: ponowne uruchomienie nie może tworzyć duplikatów ani nadpisywać zatwierdzonych danych.

## 7. Kolejność wdrożenia

### Etap A — spójna praca operacyjna

- Plan działań inwestycji i sygnały portfela — wdrożone w tej gałęzi,
- przypisywanie działań do użytkowników i ról,
- konwersja zaakceptowanej misji Autopilota do trwałego działania,
- powiadomienia i widok „Moje działania”,
- ujednolicenie statusów i priorytetów.

### Etap B — rdzeń realizacji

- edytowalny BOQ/WBS z wersjami i diffem,
- Gantt oraz lookahead,
- RFI, niezgodności i mobilny dziennik budowy,
- połączenie zadania z WBS, dokumentem, protokołem i kosztem.

### Etap C — kontrola kontraktu i kosztu

- pełny rejestr zmian/roszczeń,
- cost ledger według WBS/kodu kosztu,
- EAC/ETC i cash flow scenariuszowy,
- kontrola przerób → faktura → płatność.

### Etap D — operacje firmy

- KSeF/bank/księgowość,
- mobilny magazyn i łańcuch zakupowy,
- planowanie załóg i koszt czasu,
- integracje floty.

### Etap E — skala i certyfikacja

- podłączenie certyfikowanego dostawcy antymalware do gotowego adaptera i włączenie fail-closed,
- testy backup/restore oraz zatwierdzenie wdrożonych polityk retencji i legal hold,
- testy obciążenia dużych inwestycji,
- obserwowalność kosztu i jakości AI,
- stopniowe usuwanie historycznych warstw CSS po przeniesieniu ekranów do wspólnych wzorców.

## 8. Reguły techniczne wdrożeń

- Nowy ekran nie może być tylko prezentacją obietnic; musi mieć działający odczyt, zapis, uprawnienia, stan pusty, błąd i test.
- Krytyczne operacje wielotabelowe trafiają do atomowego RPC PostgreSQL.
- Każdy zapis serwerowy ponownie sprawdza firmę, inwestycję i poziom uprawnienia; identyfikator z klienta nie stanowi podstawy autoryzacji.
- Każda formalna decyzja i zmiana statusu tworzy `audit_event`.
- Serwerowe strony pobierają niezależne dane równolegle i przekazują do klienta tylko potrzebny zakres.
- Listy powyżej kilkuset rekordów mają paginację, wyszukiwanie serwerowe i stabilne indeksy.
- CSS jest porządkowany przy okazji zmian funkcjonalnych: wspólny komponent i wspólna reguła zastępują kolejną warstwę override.
- Widok mobilny dla budowy jest testowany jako osobny workflow, nie tylko jako zwężony desktop.

## 9. Kryteria odbioru produktu

Rozszerzenie jest gotowe dopiero, gdy:

- użytkownik potrafi wykonać cały proces bez ręcznego obchodzenia modułów,
- uprawnienie `read` nie pozwala wykonać zapisu, a zakres projektu nie przecieka do innej inwestycji,
- błędna lub powtórzona operacja nie pozostawia częściowego zapisu,
- alert prowadzi do konkretnego rekordu i możliwej czynności,
- AI pokazuje źródło i nie zapisuje formalnej decyzji jako faktu,
- desktop i mobile nie mają nachodzenia, uciętych kontrolek ani ukrytej głównej akcji,
- test jednostkowy/kontraktowy, TypeScript, lint, migracje i build są zielone,
- krytyczny przepływ przechodzi live E2E na produkcyjnych integracjach.

## 10. Zmiany wykonane podczas analizy

- utworzono dedykowany Plan działań inwestycji,
- dodano tworzenie, rozpoczęcie, zakończenie i ponowne otwarcie działania,
- każda operacja sprawdza dostęp do rzeczywistej inwestycji i zapisuje audyt,
- dodano filtrowanie, wyszukiwanie, priorytety i terminy,
- Pulpit inwestycji pokazuje najbliższe działania,
- portfel pokazuje inwestycje wymagające uwagi oraz liczbę działań po terminie,
- zadania są włączone do wspólnej kolejki pracy firmy,
- dodano trasę `Inwestycje → Realizacja → Plan działań`,
- wyrównano metadane paczki do oficjalnej wersji `1.1.0`,
- zaktualizowano kontrakty testowe po zmianach UI z 20.08.,
- wdrożono wspólny wielokanałowy intake i idempotentne API integracyjne,
- dodano bezpieczną obsługę ZIP, skan malware i kwarantannę,
- duże dokumenty są segmentowane z lokalizatorami źródła i możliwością wznowienia,
- dodano radar zmian wersji z wpływem zakresowym, finansowym i terminowym,
- matcher inwestycji uczy się aliasów z korekt i raportuje jakość na decyzjach człowieka,
- Skrzynka AI ma właściciela, SLA, eskalacje i automatyczne alerty,
- dokumentacja inwestycji ma macierz kompletności oraz własne wymagania,
- finanse pokazują uzgodnienie BOQ → zamówienie → PZ → faktura,
- dodano wielostopniowe akceptacje i podpis integralnościowy,
- dodano retencję, legal hold i kontrolowany data room z manifestem oraz dziennikiem pobrań.

Następnym najlepszym pakietem wdrożeniowym jest **BOQ/WBS + wersjonowanie + Change Order**, ponieważ ten obszar zasila harmonogram, przerób, materiały, finanse i Control 360 jednocześnie.
