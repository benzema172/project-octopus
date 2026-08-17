# Project Octopus 1.0.0

Project Octopus 1.0.0 jest dużym wydaniem utwardzającym cały system od 0.9.1 do 1.0. Celem nie było dodanie kolejnych pustych zakładek, tylko doprowadzenie istniejących procesów do spójnego, transakcyjnego i mierzalnego systemu operacyjnego.

## 0.9.1 — Reliability & Data Integrity

- atomowy zapis przerobu wraz z aktualizacją wykonania/odbioru BOQ,
- atomowe wersjonowanie budżetu,
- atomowy zapis profilu inwestycji,
- atomowe przepisywanie faktury między inwestycjami,
- atomowe wydanie rezerwacji RW,
- atomowe przesunięcie MM z kontrolą stanu,
- atomowy odczyt przebiegu i aktualizacja pojazdu,
- pełny ledger magazynowy liczony w PostgreSQL z całej historii zatwierdzonych ruchów,
- trwała idempotencja Investment Autopilota przez `generated_source_key`,
- semantyczne rangowanie materiałów i urządzeń zamiast przypadkowej pierwszej listy,
- bezpieczny retry Brain: niezrealizowane pochodne wymagania dowodowe nie duplikują się,
- wspólna normalizacja statusów,
- weryfikacja magic bytes po uploadzie do R2 przed utworzeniem rekordu i zadania Brain.

## 0.9.2 — Performance & Search

- indeksy pod kolejkę AI, dokumenty, przerób, harmonogram, finanse, HR, magazyn i flotę,
- ograniczenie niepotrzebnie wielkich zbiorów wysyłanych do klienta,
- deduplikacja odczytu polityki domenowej w jednym request-cyklu,
- nowa wyszukiwarka firmy przez: inwestycje, dokumenty, faktury, pracowników, materiały, flotę i pozycje BOQ,
- naprawa istniejącego martwego linku `Wyszukiwarka` w menu firmy.

## 0.9.3 — Verification & E2E

- pełny walidator całego łańcucha migracji od MVP do 1.0 w PGlite,
- smoke test atomowego budżetu, ledgeru magazynowego, MM, zamówienia, wyszukiwania, Anomaly Engine i 13-tygodniowego Command Center,
- nowe kontrakty testowe dla architektury 1.0,
- staging E2E API+baza z rzeczywistą autoryzacją Supabase,
- scenariusz blokady roli, dwóch równoległych wersji budżetu, ruchu magazynowego, wyszukiwarki i Command Center,
- istniejący prawdziwy R2 upload E2E został włączony do osobnego staging workflow.

## 0.9.4 — Investment Cost & Material Graph

Nowy Reconciliation Graph łączy dane, które wcześniej żyły obok siebie:

`WM → zamówienie → pozycja zamówienia → zobowiązanie → materiał → BOQ/WBS → magazyn → koszt → wykonanie → odbiór`.

Dodano:

- zamówienia zakupowe i pozycje zamówień,
- atomowe utworzenie zamówienia wraz z pierwszą pozycją, zobowiązaniem finansowym, zdarzeniem łańcucha materiałowego i linkiem do BOQ,
- formularz zamówienia bezpośrednio w Control 360,
- semantyczne propozycje dopasowań faktura/materiał → BOQ,
- ręczne zatwierdzanie/odrzucanie tych powiązań,
- graf KPI plan BOQ / koszt rzeczywisty / zamówienia / odebrany przerób.

## 0.9.5 — AI Quality Layer

Brain przestaje być czarną skrzynką. System zapisuje:

- model,
- wersję promptu/schematu,
- kategorię,
- confidence,
- decyzję człowieka,
- odrzucenia i korekty,
- liczbę analiz, ostrzeżeń i błędów.

AI Center otrzymał panel jakości oraz dostępne jest polecenie `npm run report:ai-quality` z opcjonalnymi progami jakości.

## 1.0 — Project Command Center

Control 360 otrzymał pełny Command Center:

- Project Health Score 0–100,
- deterministyczny „następny krok” wynikający z realnego stanu inwestycji,
- 13-tygodniowy cash flow,
- aktualny koszt, zobowiązania, odebrany przerób, EAC i marża,
- Anomaly Engine,
- wykrywanie opóźnionych zadań krytycznych,
- wykrywanie przeterminowanych zobowiązań,
- wykrywanie brakujących dowodów i dokumentów AI w błędzie,
- workflow `Przyjmij` / `Rozwiąż` z zachowaniem potwierdzenia przez użytkownika,
- Resource Planner,
- rejestr korespondencji, RFI i rewizji,
- wiedza firmy z innych inwestycji,
- dzienne snapshoty Project Health.

## Bezpieczeństwo i spójność

- krytyczne RPC są wykonywalne tylko przez `service_role`; endpointy przed nimi sprawdzają sesję, workspace i domenę,
- BOQ pozostaje poprawnie projektowy; nie dodano sztucznego `workspace_id`, a izolacja firmy jest wyprowadzana przez `projects`,
- RLS nadal chroni odczyt danych domenowych,
- AI nie zatwierdza automatycznie zmian zakresu: propozycje przechodzą przez decyzję człowieka,
- upload po R2 sprawdza rzeczywisty nagłówek pliku. Pełny skaner antymalware nie jest jeszcze częścią 1.0 i nie jest udawany.

## Testy wydania

Przed scaleniem do `main` wymagane są jednocześnie:

1. TypeScript — zielony,
2. Vitest — zielony,
3. pełny migration contract — zielony,
4. ESLint — zielony,
5. Next.js build — zielony,
6. PR CI — zielony,
7. finalny CI na `main` — zielony.

Staging workflow z prawdziwym Supabase/R2 wymaga odpowiednich sekretów GitHub i jest osobną bramką środowiskową; zwykłe CI nie udaje tego testu, gdy sekretów nie ma.
