# Project Octopus 1.4.2 — Kadry employee profile modal

Data: 27.08.2026

## Zakres

Patch naprawia nienaturalne zachowanie karty pracownika w module Kadry 2.0.

- karta pracownika nie otwiera się już jako pełnoekranowy prawy drawer,
- profil jest wyśrodkowany w normalnym oknie modalnym,
- szerokość jest ograniczona do czytelnego maksimum i zachowuje margines od krawędzi ekranu,
- tło aplikacji jest delikatnie przyciemnione i rozmyte zamiast odcinać pół widoku,
- sekcje profilu mają czytelne kafle i układ dwukolumnowy na dużych ekranach,
- podsumowanie pracownika wykorzystuje pełną szerokość,
- edycja karty wykorzystuje pełną szerokość,
- na tabletach i telefonach karta przechodzi do jednej kolumny,
- istniejące akcje, formularze i logika HR pozostają bez zmian.

## Walidacja

Release wymaga pełnego zielonego CI: dependency audit, stability contract, TypeScript, testy jednostkowe, kontrakt migracji, lint i produkcyjny build przed scaleniem do `main`.
