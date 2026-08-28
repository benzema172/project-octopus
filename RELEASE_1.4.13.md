# Project Octopus 1.4.13 — HR actions stable

Data: 28.08.2026

## Zakres
- usunięcie kruchego portalu React odpowiedzialnego za przenoszenie `+ Dodaj pracownika`,
- wykorzystanie oryginalnego formularza Kadr i trwałe pozycjonowanie kompaktowego przycisku obok `Raport CSV`,
- po otwarciu formularz wraca do normalnego pełnego układu nad kartoteką,
- wpisy `Octopus HR → Wymaga uwagi` zachowują nawigację do miejsca obsługi,
- alerty mają teraz widoczne oznaczenie `Otwórz →`, hover i obsługę klawiatury,
- zachowany kontrakt czytelnej listy pracowników: `LP.`, numerowanie od 1, separatory i ukryty numer techniczny,
- brak zmian w bazie danych i API.

## Powód
W 1.4.11 przycisk był przenoszony przez portal do elementu zarządzanego przez potomny komponent React. Deployment był poprawny technicznie, ale takie rozwiązanie mogło znikać po rerenderze i nie dawało stabilnego efektu wizualnego.

## Warunek wydania
Pełne zielone CI: dependencies, audit, stability, TypeScript, wszystkie testy, kontrakt migracji, lint i production build.
