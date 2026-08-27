# Project Octopus 1.4.5 — HR Timesheet Calendar

Data wydania: 27.08.2026

## Zakres

- Zakładka **Kadry → Czas pracy** korzysta z dedykowanej ewidencji czasu zamiast otwierania zwykłej karty pracownika.
- Ewidencja ma przełącznik **7 dni / Miesiąc**.
- Kliknięcie pracownika w ewidencji otwiera osobny widok czasu pracy z kalendarzem dni, inwestycją/budową, godzinami i nadgodzinami.
- Widok pokazuje podsumowanie godzin, liczbę dni z wpisem oraz liczbę inwestycji w wybranym okresie.
- Dodano eksport CSV całej ewidencji dla wybranego okresu oraz eksport dla konkretnego pracownika.
- Zwykła karta pracownika w zakładce **Pracownicy** pozostaje bez zmian i nadal służy do danych HR, zatrudnienia, dokumentów, sprzętu i uprawnień.

## Weryfikacja przed publikacją

Release może zostać scalony do `main` wyłącznie po pełnym zielonym CI: instalacja zależności, audit produkcyjny, stability contract, TypeScript, testy jednostkowe/regresyjne, walidacja migracji, lint i build produkcyjny.
