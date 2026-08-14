# Wdrożenie Project Octopus 0.4.1

## Kolejność

1. Wykonaj backup Supabase oraz zapisz poprzednie wdrożenie Vercel.
2. Uruchom kolejno migracje `20260814090000_octopus_operating_system.sql`, `20260814130000_octopus_execution_layer.sql`, `20260814170000_atomic_estimate_approval.sql` oraz `20260814180000_domain_access_hardening.sql`.
3. Sprawdź marker `20260814_domain_access_hardening` poleceniem `npm run check:schema`.
4. Dodaj `CRON_SECRET` do zmiennych środowiskowych Vercel.
5. Wdróż kod 0.4.1.
6. Uruchom `npm run test:e2e-upload`.
7. Wywołaj `POST /api/brain/worker?limit=1` z nagłówkiem `Authorization: Bearer <CRON_SECRET>` i sprawdź przejście dokumentu do Skrzynki AI.
8. Skonfiguruj harmonogram wywołujący worker. Przy małym ruchu wystarczy krótki interwał i limit 1–5 zadań.
9. Sprawdź ręcznie: upload PDF/DOCX/XLSX, akceptację dokumentu, import kosztorysu, utworzenie BOQ/WBS, wyszukiwarkę, radar rewizji, forecast, zdarzenie mobilne, Wzory i checklistę zamknięcia.

## KSeF i inne integracje

Migracja tworzy bezpieczny staging KSeF oraz rejestr synchronizacji. Uruchomienie prawdziwego pobierania wymaga osobnego sekretu/certyfikatu i konfiguracji firmy. Najpierw aktywuj wyłącznie faktury zakupowe na środowisku testowym; sprzedaż i UPO pozostaw wyłączone do zakończenia testów.

## Wycofanie

W razie problemu przywróć poprzednie wdrożenie aplikacji. Nie usuwaj tabel 0.4.x. Są rozszerzeniem modelu 0.3.0. Zadania kolejki można zatrzymać przez usunięcie harmonogramu bez utraty dokumentów.

## Kontrola po wdrożeniu

- odsetek dokumentów w `error/dead_letter`,
- czas oczekiwania i liczba ponowień,
- koszt i liczba analiz Gemini,
- liczba decyzji oczekujących,
- kompletność źródeł oraz udział faktów zatwierdzonych,
- brak dostępu technicznego użytkownika do danych HR/Finanse bez roli domenowej.
