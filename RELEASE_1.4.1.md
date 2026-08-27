# Project Octopus 1.4.1 — Kadry employee list polish

Data: 27.08.2026

## Zakres

Patch poprawia czytelność kartoteki pracowników w module Kadry 2.0 bez zmiany modelu danych ani logiki HR.

- kompaktowy przycisk `+ Dodaj pracownika` wyrównany do prawej strony,
- formularz dodawania po rozwinięciu nadal wykorzystuje pełną szerokość,
- numeracja widocznych pracowników zaczyna się od `1` i reaguje na filtry,
- osobna wizualna kolumna `LP.` niezależna od numeru pracownika,
- ukrycie technicznego numeru pracownika spod nazwiska w tabeli,
- mocniejsza separacja nagłówka i wierszy,
- czytelniejsze pionowe podziały kolumn i hover wiersza,
- zachowana responsywność na telefonach.

## Walidacja

Release musi przejść pełne CI projektu: dependency audit, stability contract, TypeScript, testy jednostkowe, kontrakt migracji, lint i produkcyjny build przed scaleniem do `main`.
