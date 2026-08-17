# Wdrożenie Project Octopus 0.7.2

## Kolejność

1. Wykonaj backup Supabase oraz zapisz identyfikator poprzedniego wdrożenia aplikacji.
2. Zastosuj chronologicznie wszystkie brakujące migracje, kończąc na `20260817130000_upload_security_and_atomic_document_review.sql`.
3. Uruchom `npm run check:schema`; wymagany marker to `20260817_upload_security_and_atomic_document_review`.
4. Potwierdź zmienne Supabase, R2, Gemini i `CRON_SECRET`. Ustaw aktualne `GEMINI_INPUT_USD_PER_MILLION` oraz `GEMINI_OUTPUT_USD_PER_MILLION`, aby monitoring kosztu nie pokazywał zera. Sekrety nie mogą trafić do tabel biznesowych ani logów klienta.
5. Wdróż kod 0.7.2 i uruchom `npm run test:e2e-upload`.
6. Wywołaj `POST /api/brain/worker?limit=1` z nagłówkiem `Authorization: Bearer <CRON_SECRET>`, a następnie skonfiguruj cykliczny worker.
7. Przeprowadź test akceptacyjny poniżej na danych testowych przed wpuszczeniem danych produkcyjnych.

## Test akceptacyjny 0.7.2

- dodanie PDF/DOCX/XLSX i ręcznej kategorii przechodzi do Skrzynki AI,
- plik z błędną sygnaturą, aktywnym PDF lub wykonywalnym wpisem ZIP jest usuwany z R2 i zapisuje zdarzenie kwarantanny,
- akceptacja dokumentu publikuje fakty, materiały, urządzenia, wymagania i protokoły; odrzucenie ich nie publikuje,
- nowa wersja dokumentu wraca do `pending`, a zatwierdzonej wersji nie można nadpisać ponowną analizą,
- import kosztorysu tworzy raz BOQ, WBS i harmonogram także po ponowieniu żądania,
- zdarzenie Teren można zatwierdzić i odrzucić w module,
- pozycję checklisty Zamknięcia można oznaczyć jako kompletną i cofnąć,
- rolę domenową można nadać, zmienić, odebrać i zobaczyć efekt odmowy dostępu,
- szkic Wzorów można podejrzeć, zatwierdzić i pobrać z Wyników; ponowienie nie tworzy drugiego dokumentu,
- wyszukiwarka, asystent i generator nie zwracają odrzuconych ani zastąpionych faktów.
- `/api/brain/health?workspaceId=...` zwraca stan kolejki, a administrator może uruchomić worker ze Skrzynki AI.

## KSeF i pozostałe integracje

Migracje tworzą staging KSeF i rejestr synchronizacji, ale nie aktywują połączenia bez poświadczeń firmy. Najpierw testuj wyłącznie inbound zakupów, deduplikację i dekretację. Sprzedaż, UPO, bank, księgowość, GPS i kadry-płace są osobnymi wdrożeniami integracyjnymi.

## Monitoring po wdrożeniu

- udział `error/dead_letter`, czas kolejki i liczba ponowień,
- koszt, tokeny i czas odpowiedzi Gemini,
- liczba decyzji oczekujących i wiek najstarszej decyzji,
- kompletność cytowań i udział zatwierdzonych faktów,
- błędy publikacji R2 oraz niespójność dokument–wersja–generated_document,
- próby odmowy dostępu do Finansów, HR i zakresów projektowych.

Endpoint `/api/brain/health?workspaceId=<uuid>` może być odpytywany przez monitor z nagłówkiem `Authorization: Bearer <CRON_SECRET>`; dla stanu krytycznego zwraca HTTP 503.

## Wycofanie

W razie problemu przywróć poprzednie wdrożenie aplikacji i zatrzymaj worker. Nie usuwaj tabel, plików R2 ani markerów migracji. Migracje 0.7.1–0.7.2 normalizują kategorie, wygaszają duplikaty ról, oznaczają nieaktualną wiedzę jako `superseded` i zapisują stan kontroli pliku; rollback kodu nie powinien odwracać tych decyzji danych bez osobnego, zweryfikowanego skryptu.
