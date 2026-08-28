# Project Octopus 1.4.15 — modal dodawania pracownika

Data: 28.08.2026

## Zakres
- usunięcie absolutnego pozycjonowania przycisku `Dodaj pracownika`, które powodowało nachodzenie na `Raport CSV`,
- umieszczenie obu akcji w jednym responsywnym pasku z trwałym odstępem,
- zastąpienie rozwijanej sekcji prawdziwym oknem modalnym z tłem, przyciskiem zamknięcia, anulowaniem i obsługą klawisza Escape,
- zamykanie modala dopiero po poprawnym zapisaniu pracownika; przy błędzie formularz pozostaje dostępny,
- zachowanie numeracji, filtrów i wyglądu listy pracowników przez stabilny znacznik widoku,
- brak zmian w bazie danych i API.

## Warunek wydania
Pełne zielone testy, TypeScript, lint bez błędów i produkcyjny build.
