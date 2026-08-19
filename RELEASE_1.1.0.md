# Project Octopus 1.1.0 — UX, dostępność i prostsza obsługa

Data: 19.08.2026

## Cel wydania

Wersja 1.1.0 porządkuje warstwę użytkową bez ograniczania możliwości systemu. Funkcje pozostają dostępne, ale codzienna praca ma mniej stale widocznych formularzy, mniej technicznych komunikatów i prostszą nawigację.

## Najważniejsze zmiany

- wspólna warstwa UX dla całego zalogowanego workspace,
- widoczny fokus klawiatury, skip-link, większe pola interakcji i obsługa `prefers-reduced-motion`,
- mobilne menu firmy jako wysuwany panel,
- rozdzielenie podstawowych modułów firmy od rzadziej używanych narzędzi,
- responsywne menu inwestycji z prostym wyborem sekcji na małych ekranach,
- formularze Finansów, Kadr, Magazynu i Floty ukryte w czytelnych akcjach rozwijanych,
- tabele operacyjne na telefonie zmieniają się w podpisane karty zamiast wymuszać poziome przewijanie,
- uproszczony język w alokacji kosztów i obsłudze szkiców PZ,
- szkice PZ są zadaniami do rozwinięcia zamiast stale otwartych bloków,
- lista inwestycji ma natychmiastowe wyszukiwanie po nazwie, inwestorze, lokalizacji, opisie i statusie,
- „Narzędzia zaawansowane” uproszczone do „Więcej narzędzi” i nadal ładowane dopiero na żądanie,
- dodatkowe oznaczenia ARIA oraz komunikaty `aria-live` dla zapisu i błędów.

## Zasada wydania

Nie usuwamy istniejących funkcjonalności biznesowych. Zmieniamy hierarchię ich prezentacji: najczęstsze czynności są dostępne od razu, a operacje administracyjne, diagnostyczne i zaawansowane pozostają o jedno kliknięcie dalej.
