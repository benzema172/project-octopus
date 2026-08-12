# Wdrożenie Project Octopus 0.3.0

## Zakres aktualizacji

- ekran logowania pozostaje bez zmian,
- po zalogowaniu pojawia się wybór firm w formie kafli,
- dodawanie firmy z pełnym profilem organizacji,
- jasny panel firmy w kolorystyce logo OCTOPUS,
- stały sidebar: Dashboard, Inwestycje, Finanse, Kadry, Magazyn, Dokumenty, Raporty, Ustawienia,
- centralny moduł Dokumenty,
- Ustawienia firmy,
- Raporty i analityka,
- pływający OctopusAI działający w kontekście wybranej firmy przez OpenAI Responses API.

## Kolejność

1. Wykonaj kopię zapasową bazy Supabase.
2. Jeżeli nie był jeszcze wykonywany, uruchom `supabase/migrations/20260812100000_project_octopus_foundation_fix.sql`.
3. Uruchom `supabase/migrations/20260812120000_company_workspace_shell.sql`.
4. W Vercel ustaw `OPENAI_API_KEY`. Opcjonalnie ustaw `OPENAI_MODEL`; domyślnie aplikacja używa `gpt-5`.
5. Zachowaj wszystkie dotychczasowe zmienne Supabase i Cloudflare R2.
6. Wdróż kod.
7. Sprawdź ręcznie: logowanie, wybór firmy, dodanie firmy, wejście do panelu firmy, wszystkie pozycje sidebaru, utworzenie inwestycji, centralne Dokumenty, edycję Ustawień i OctopusAI.

## Bezpieczne zachowanie przed migracją

Ekran wyboru firmy potrafi odczytać istniejące workspace'y również przed nową migracją. Dodawanie nowej firmy oraz edycja pełnego profilu są wtedy zablokowane, aby nie utracić wpisywanych danych.

## Wycofanie kodu

W razie problemu przywróć poprzednie wdrożenie Vercel. Nowe kolumny w `workspaces` są zgodne wstecznie i nie trzeba ich usuwać.
