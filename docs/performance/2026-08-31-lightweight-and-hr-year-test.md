# Project Octopus — Lightweight Core + Kadry year lifecycle test

Data rozpoczęcia: 2026-08-31

## Cel

Odchudzić aplikację bez usuwania funkcji biznesowych oraz zasymulować pełny rok pracy 10 robotników w module Kadry. Każda zmiana ma przechodzić test produkcyjny przed publikacją.

## Audyt bazowy

- Produkcyjna baza jest obecnie mała; największe tabele domenowe mają dziesiątki–setki rekordów. `timesheets` miały podczas audytu ok. 142 rekordy, `audit_events` ok. 488. Wąskim gardłem nie jest obecnie rozmiar danych, tylko ilość kodu i pracy wykonywanej przy wejściu w moduły.
- Indeksy najważniejszych tabel operacyjnych są poprawne: istnieją indeksy m.in. po `workspace_id`, pracowniku, inwestycji, statusie i datach dla kart czasu, przypisań, urlopów, faktur, dokumentów i magazynu.
- `get_company_action_center_v2` po rozgrzaniu wykonuje się na aktualnej firmie w ok. 24 ms. Historyczne średnie z `pg_stat_statements` były wyższe, ale bieżący `EXPLAIN ANALYZE` nie potwierdził trwałego problemu SQL wymagającego przebudowy.

## Wykryte problemy i decyzje

### P1 — wszystkie sekcje Kadr w jednym początkowym bundle
Status: poprawione.

`HrWorkspaceCore300` statycznie importował komponenty wszystkich zakładek. Zmieniono je na `next/dynamic`; ekran startowy nie musi pobierać kodu formularza pracownika, dokumentów, zespołów, urlopów, czasu pracy i compliance zanim użytkownik otworzy te zakładki.

### P2 — silnik problemów wielokrotnie skanuje te same tablice
Status: poprawione.

`buildHrEmployeeIssues` filtrował globalne tablice osobno dla każdego pracownika. Dodano indeksy w pamięci `Map<employeeId, rows[]>` dla dokumentów, badań, BHP, kwalifikacji, urlopów, kart czasu i przypisań. Koszt analizy rośnie teraz bliżej liniowo wraz z liczbą rekordów.

### P3 — wrapper HR skanuje DOM po praktycznie każdym kliknięciu
Status: poprawione.

Wstrzykiwanie miejscowości do podglądu dokumentów wykonywało `querySelectorAll('small')` po każdym kliknięciu w module. Ograniczono to wyłącznie do akcji dokumentowych: PDF, druk, podgląd i generowanie.

### P4 — importy ikon w wielu ekranach
Status: poprawione.

Dodano `experimental.optimizePackageImports: ['lucide-react']`, aby Next.js/Vercel mógł optymalizować szeroko używany pakiet ikon.

### P5 — loader Kadr pobiera dodatkowo snapshoty czasu i metadane zatrudnienia
Status: otwarte do dalszej optymalizacji.

`getHrWorkspace141Data` po bazowym loaderze wykonuje dodatkowe odczyty `timesheets` i `employments`. To jest bezpieczne funkcjonalnie, ale przy wieloletniej historii będzie zbędnym kosztem transferu. Docelowo snapshoty kosztowe i model rozliczenia powinny być pobierane w tym samym odczycie co rekord bazowy albo przez jeden dedykowany RPC.

## Symulacja roczna — scenariusz

Test `tests/hr-year-lifecycle-10-workers.test.ts` tworzy deterministycznie:

- 10 robotników na pełnym etacie,
- 4 nakładające się inwestycje realizowane przez cały 2026 rok,
- wpis czasu każdego robotnika na każdy polski dzień roboczy, chyba że ma zatwierdzoną nieobecność,
- przypisanie każdego dnia pracy do konkretnej inwestycji,
- 8 h pracy podstawowej i kontrolowane nadgodziny,
- snapshot stawki i kosztu pracy przy każdym wpisie,
- urlopy wypoczynkowe, urlop na żądanie i chorobowe,
- jeden celowy przypadek przekroczenia limitu urlopowego,
- umowę w aktach każdego pracownika,
- badania medyczne, w tym czasową niezdolność do pracy i późniejsze odzyskanie zdolności,
- BHP z terminem wymagającym odnowienia,
- SEP/UDT/F-Gazy z terminem odnowienia,
- miesięczne przypisania do inwestycji na poziomie 100%.

## Inwarianty testu

1. Każdy polski dzień roboczy każdego aktywnego pracownika musi mieć dokładnie jeden stan: praca albo zatwierdzona nieobecność.
2. Nie wolno zapisać czasu pracy na dniu urlopu/chorobowego.
3. Każdy wpis czasu musi wskazywać istniejącą inwestycję.
4. Dzienny czas pracy w scenariuszu nie może przekroczyć 12 h.
5. Każdy wpis kosztowy musi mieć snapshot stawki i koszt zgodny z godzinami.
6. Nie może powstać duplikat wpisu pracownik+dzień w tym scenariuszu.
7. Silnik musi wykryć wygasające SEP/BHP oraz czasową niezdolność do pracy.
8. Po odnowieniu dokumentów alert krytyczny ma zniknąć.
9. Na koniec roku nie mogą zostać zaległe karty czasu, braki zatrudnienia ani braki umów.
10. Celowe przekroczenie limitu urlopu jednego robotnika musi zostać wykryte.
11. Dwanaście miesięcznych przebiegów centrum problemów ma zmieścić się w budżecie 1 s na maszynie CI.

## Następne decyzje po uruchomieniu testu

Ta sekcja zostanie uzupełniona po wyniku produkcyjnej bramki jakości i builda Vercel.
