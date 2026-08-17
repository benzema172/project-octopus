# Project Octopus 0.8.0

Wersja 0.8.0 rozwija istniejące zakładki firmy zamiast tworzyć kolejne puste moduły. Warstwa „Centrum operacyjne” jest dokładana do Finansów, Kadr, Magazynu, Floty i Raportów oraz respektuje dotychczasowe uprawnienia domenowe.

## Finanse
- aging otwartych rozrachunków: >30 dni, 8–30 dni, 1–7 dni i najbliższe 14 dni,
- szybka zmiana przypisania faktury do inwestycji lub kosztów ogólnych,
- workflow zobowiązań: otwarte / zatwierdzone / zamknięte / anulowane,
- podsumowanie wartości faktur przypisanych do poszczególnych inwestycji,
- eksport CSV i JSON.

## Kadry
- przypisanie pracownika do inwestycji z rolą, okresem i procentem zaangażowania,
- historia kolejnych warunków zatrudnienia, kosztu miesięcznego i godzinowego,
- automatyczne wykrywanie przeciążenia pracownika powyżej 100% alokacji,
- lista aktywnych pracowników bez przypisania do inwestycji,
- podsumowanie kosztu miesięcznego i zatwierdzonego czasu pracy,
- eksport CSV i JSON.

## Magazyn
- alerty stanów minimalnych liczone z zatwierdzonych PZ/WZ/RW/ZW/MM,
- szybkie przesunięcie MM z kontrolą dostępnego stanu,
- rezerwacja → rzeczywisty dokument RW jednym kliknięciem,
- blokada wydania i MM przy niewystarczającym stanie,
- anulowanie rezerwacji,
- aktywacja/wycofanie kartoteki bez utraty historii,
- eksport CSV i JSON.

## Flota
- przypisanie pojazdu do inwestycji, pracownika lub obu,
- historia alokacji z okresem, metodą i procentem,
- ręczne odczyty licznika z blokadą cofnięcia przebiegu,
- ekonomika per pojazd: dystans, paliwo, l/100 km, koszt/km, koszt całkowity,
- workflow szkody: zgłoszona → w toku → zamknięta,
- eksport CSV i JSON.

## Raporty
- szybkie włączanie i wstrzymywanie definicji raportów,
- przegląd aktywnych definicji, uruchomień, błędów i powodzeń,
- eksport CSV i JSON.

## Bezpieczeństwo i spójność
- wszystkie nowe zapisy przechodzą przez uprawnienia domenowe,
- identyfikatory są weryfikowane w obrębie aktywnej firmy,
- operacje stanowe są audytowane,
- wydanie rezerwacji i MM sprawdzają rzeczywisty stan zatwierdzonych ruchów,
- odczyt licznika nie pozwala zmniejszyć bieżącego przebiegu,
- dodatkowa warstwa UI działa fail-soft: błąd narzędzi 0.8.0 nie wyłącza istniejącej zakładki.

## Testy
- testy metryk: aging, alokacje pracowników, stany minimalne, ekonomika floty,
- test kontraktu wszystkich nowych akcji i eksportów,
- zachowany test 10 000 przekrojowych prób danych demonstracyjnych,
- pełny CI: TypeScript, Vitest, kontrakt migracji, ESLint i produkcyjny build Next.js.
