# Project Octopus 1.4.0 — Kadry 2.0

Data wydania: 27.08.2026

## Cel

Przebudowa modułu Kadry z jednego operacyjnego rejestru do codziennego centrum zarządzania ludźmi w firmie wykonawczej.

## Zakres

- 7 zakładek: Pulpit, Pracownicy, Czas pracy, Urlopy i absencje, Uprawnienia i BHP, Zespoły i inwestycje, Dokumenty.
- Dashboard HR z aktywnymi pracownikami, obsadą budów, nieobecnościami, osobami bez alokacji, terminami compliance i decyzjami.
- Pełna karta pracownika: kontakt, zatrudnienie, koszt, inwestycje, czas, urlopy, compliance, dokumenty, sprzęt/ŚOI.
- Edycja danych pracownika oraz historia warunków zatrudnienia.
- Brygady (`hr_teams`) i historia członkostwa (`hr_team_members`).
- Przypisanie całej brygady do inwestycji z utworzeniem śladu indywidualnych alokacji.
- Czas pracy pojedynczy oraz zbiorczy dla brygady, plus tygodniowa macierz czasu.
- Urlopy z automatycznym liczeniem polskich dni roboczych, w tym świąt ruchomych i Wigilii jako święta ustawowego od 2025 r.
- Roczne limity urlopowe, zaległe i dodatkowe dni oraz saldo pracownika.
- Wspólny compliance: uprawnienia, badania medyczne i szkolenia BHP.
- Dokumenty pracownika z możliwością ręcznego powiązania lub sugestii na podstawie istniejącej analizy dokumentu przez Octopusa.
- Przy niejednoznacznym dopasowaniu dokumentu system zwraca `AI potrzebuje decyzji` zamiast przypisywać na siłę.
- Sprzęt i ŚOI: wydanie oraz zwrot w karcie pracownika.
- Koszt pracy per inwestycja liczony z zatwierdzonego czasu i bieżącego kosztu godzinowego.
- Eksport raportu HR do CSV.

## Model danych

Nowe tabele:

- `hr_teams`
- `hr_team_members`
- `safety_trainings`
- `employee_documents`
- `leave_entitlements`

Rozszerzenia:

- `employees`: kontakt awaryjny, notatki, `updated_at`
- `timesheets`: `team_id`, `source`
- `assignments`: `source_team_id`

## Bezpieczeństwo

- Wszystkie nowe tabele mają RLS.
- API wymaga aktywnej sesji i uprawnienia domeny `hr`.
- Zatwierdzanie urlopów i czasu wymaga poziomu `approve`.
- Sugestia AI dokumentu nie tworzy faktów kadrowych takich jak data ważności, jeżeli nie ma ich zweryfikowanego źródła.

## Poza zakresem

1.4.0 nie jest systemem płacowym. Nie generuje list płac, deklaracji ZUS/PPK ani rozliczeń podatkowych. Kadry 2.0 mają zarządzać pracownikiem, dostępnością, dokumentacją, zdolnością do pracy, czasem i kosztem realizacji; integrację kadrowo-płacową można dodać osobno.
