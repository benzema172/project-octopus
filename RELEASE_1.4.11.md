# Project Octopus 1.4.11 — HR action navigation

Data: 28.08.2026

## Zakres

- przeniesienie kompaktowego `+ Dodaj pracownika` do tego samego prawego kontenera akcji co `Raport CSV`,
- usunięcie starego, osobnego miejsca zajmowanego przez zwinięty formularz dodawania,
- zachowanie poprawionej listy pracowników 1.4.10 z `LP.` i czytelnymi separatorami,
- zamiana wpisów `Octopus HR → Wymaga uwagi` w klikalne akcje dostępne również z klawiatury,
- karta czasu oczekująca na decyzję prowadzi do `Czas pracy → Do zatwierdzenia`,
- brak wpisu czasu prowadzi do formularza czasu pracy z ustawioną datą z alertu,
- wniosek urlopowy prowadzi do sekcji decyzji urlopowych,
- alert uprawnienia/badania/BHP prowadzi do `Uprawnienia i BHP`,
- konflikt obłożenia prowadzi do `Zespoły i inwestycje`,
- brak zmian w bazie danych i API.

## Regresja

Test `hr-actions-1411.test.ts` pilnuje jednocześnie nowego położenia przycisku, nawigacji alertów oraz zachowania kontraktu czytelnej listy pracowników z 1.4.10.

## Warunek wydania

Pełne zielone CI: dependencies, audit, stability, TypeScript, wszystkie testy, kontrakt migracji, lint i production build.
