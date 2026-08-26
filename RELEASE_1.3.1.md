# Project Octopus 1.3.1

Data: 26.08.2026

## Gemini rate-limit recovery

- HTTP 429 / `RESOURCE_EXHAUSTED` nie jest już traktowany jak trwały błąd dokumentu.
- Project Octopus odczytuje `retryDelay` z odpowiedzi Gemini i zapisuje dokument jako oczekujący na wolny limit AI.
- Aktywne przetwarzanie wykonuje jedno kontrolowane automatyczne odczekanie i ponowienie zamiast natychmiast generować kolejne wywołania.
- Worker paczek ZIP po 429 odracza zadanie, nie zużywa zwykłego budżetu prób i zatrzymuje serię, jeżeli limit nadal jest aktywny.
- Paczka zachowuje dokument w kolejce zamiast błędnie oznaczać go jako uszkodzony lub wymagający ponownego uploadu.
- Centrum przetwarzania pokazuje osobny etap `Czeka na limit Gemini` i informuje, że plik pozostaje bezpiecznie zapisany.
- Dla dokumentu oczekującego na limit dostępny jest przycisk `Wymuś ponowienie teraz`; wykonuje on pełną analizę, routing i Autopilot bez ponownego wysyłania pliku do R2.
- Wersja aplikacji i badge zostały podniesione do 1.3.1.

## Safety

Zmiana nie omija zasad wiarygodności danych: ręczne wymuszenie ponawia analizę źródła, ale nie publikuje wymyślonych wyników pomiarów, odbiorów, podpisów ani decyzji formalnych.
