# Project Octopus 1.0.2 Stability

Data wydania: 18.08.2026

## Cel

Wersja 1.0.2 jest wydaniem stabilizacyjnym pomiędzy 1.0.1 i 1.1. Nie dodaje kolejnych pustych modułów. Usuwa regresje runtime wykryte na produkcji i wzmacnia integralność danych przed rozbudową 1.1.

## Naprawione

- Dokumenty firmy i inwestycji nie używają już niejednoznacznego embed `documents ↔ document_versions`; wersje są pobierane osobno w kontrolowanych paczkach.
- Podsumowanie Autopilota nie wysyła do Supabase literalów enum severity, które mogą nie istnieć w danej instalacji. Częściowy błąd zapytania nie może już sztucznie podnosić health score.
- Odczyt membership/workspace ma ograniczony retry z backoff dla przejściowego `JWT issued at future`.
- Raport nie może mieć statusu `completed`, jeśli nie istnieje jego snapshot. Snapshot automatycznie finalizuje run.
- Anomaly Engine zachowuje pierwszą datę wykrycia i oddzielnie aktualizuje `last_seen_at`.
- Płatności nie mogą po cichu przekroczyć wartości faktury ani być księgowane do anulowanych faktur.

## Testy regresyjne

Dodano `tests/stability-1.0.2.test.ts`. Migracja 1.0.2 jest również włączona do pełnego łańcucha testów migracyjnych w wydaniu 1.1.
