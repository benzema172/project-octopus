# Wdrożenie Project Octopus 0.2.0

## Kolejność

1. Wykonaj kopię zapasową bazy Supabase.
2. W edytorze SQL Supabase uruchom cały plik `supabase/migrations/20260812100000_project_octopus_foundation_fix.sql`.
3. Uruchom `npm run test:migrations`, a następnie — ze skonfigurowanymi zmiennymi środowiskowymi — `npm run check:schema`.
4. Wdróż kod 0.2.0 do Vercel.
5. Uruchom `npm run test:e2e-upload` przeciwko nowemu wdrożeniu.
6. Sprawdź ręcznie: logowanie, otwarcie inwestycji, upload PDF, odświeżenie listy, pobranie i dodanie nowej wersji.

Migracja jest transakcyjna i idempotentna. W razie błędu PostgreSQL wycofa całość. Kod pozostawia upload wyłączony, dopóki w `app_schema_versions` nie pojawi się marker `20260812_foundation_fix`.

## Wycofanie kodu

W razie problemu przywróć poprzednie wdrożenie w Vercel. Nie usuwaj dodanych kolumn ani funkcji z bazy — są zgodne wstecznie i nie wpływają na odczyt przez poprzednią wersję aplikacji.
