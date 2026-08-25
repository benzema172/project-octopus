# Project Octopus — Inwestycje AI 2026-08-24

## Zakres wdrożenia

Sekcja Inwestycje otrzymała wspólny, kontrolowany przepływ:

`Wrzutnia → R2 → ekstrakcja → Gemini → propozycje pól → decyzja człowieka → moduły`

Najważniejsza zasada: zatwierdzenie klasyfikacji dokumentu nie publikuje automatycznie danych operacyjnych. Każda pozycja wymagająca odpowiedzialności formalnej, finansowej lub wykonawczej przechodzi osobną decyzję w Centrum weryfikacji.

## Dodane funkcje

- Centrum weryfikacji AI w `Inwestycje → Dokumentacja` i `Inwestycje → Brain AI`.
- Widoczny w całej inwestycji licznik propozycji oczekujących na decyzję.
- Edycja tytułu i modułu docelowego przed publikacją.
- Decyzje pojedyncze i zbiorcze, historia publikacji i odrzuceń.
- Cytat, lokalizacja źródłowa, dokument, pewność AI i oznaczenie decyzji formalnej przy każdej pozycji.
- Specjalistyczna analiza: dane inwestycji, BOQ, harmonogram, zadania, ryzyka, budowa, przeroby, WM, protokoły, finanse, magazyn, raporty i zamknięcie.
- Deterministyczny parser XLS/XLSX dla BOQ, harmonogramu, przerobów i materiałów z identyfikatorem arkusza i wiersza.
- Rozszerzony Gemini JSON schema i prompt bez domyślania wyników, postępu lub odbiorów.
- Radar rewizji na poziomie konkretnych pozycji BOQ, harmonogramu, WM, protokołów i przerobów.
- Metadane Wrzutni: typ wydania, nazwa paczki, oznaczenie rewizji i data obowiązywania.
- Poprawiona obsługa bezpiecznych paczek ZIP do 50 MB.

## Publikacja do modułów

- Fakt → zatwierdzona wiedza Project DNA / Brain.
- BOQ → pozycja importu kosztorysu, nadal wymagająca akceptacji całej wersji BOQ.
- Materiał → wymaganie oraz szkic wniosku materiałowego.
- Protokół → wymaganie protokołu i brakujący dowód.
- Harmonogram → planowana aktywność powiązana z WBS, jeśli kod został rozpoznany.
- Zdarzenie budowy → szkic dziennika budowy.
- Przerób → szkic pozycji przerobu tylko po jednoznacznym dopasowaniu BOQ; brak dopasowania tworzy zadanie weryfikacyjne.
- Zadanie lub ryzyko → zadanie operacyjne ze śladem dokumentu.
- Finanse i magazyn → istniejąca skrzynka biznesowa w statusie `review`, bez automatycznej akceptacji finansowej.
- Zamknięcie → brakujące wymaganie w matrycy dokumentacji.

## Bezpieczeństwo i audyt

- RLS włączony dla propozycji AI.
- Odczyt tylko przez istniejące uprawnienia domenowe inwestycji.
- Publikacja wykonywana atomowo i tylko przez backend `service_role`.
- Trigger blokuje publikację, gdy dokument źródłowy nie jest zatwierdzony i przypisany do inwestycji.
- Każda decyzja ma autora, czas, notatkę, encję wynikową i wpis audytowy.
- Wiedza Brain pokazuje tylko fakty w statusie `approved`.
- Zastąpione rewizje wygaszają nieopublikowane propozycje starszej wersji.

## Baza danych

Wdrożone migracje:

- `20260824140000_investment_ai_review_center.sql`
- `20260824141000_investment_ai_review_center_indexes.sql`
- `20260824142000_investment_ai_publication_guard.sql`

Kontrola po wdrożeniu: 27 kolumn tabeli propozycji, RLS aktywny, 1 polityka odczytu, 8 indeksów, 2 funkcje transakcyjne i 1 trigger ochronny.

## Weryfikacja

- TypeScript: bez błędów.
- ESLint: bez błędów.
- Vitest: 57 plików, 380 testów — wszystkie zaliczone.
- Next.js 16.3.2 production build: zaliczony.
- Lokalny serwer produkcyjny: HTTP 200, nagłówki CSP/HSTS/X-Frame-Options aktywne.
- Vercel preview build: `READY`.
- Vercel runtime errors po wdrożeniu preview: 0.

## Obsługa

1. Wejdź do inwestycji i otwórz Wrzutnię.
2. Uzupełnij metadane wydania, dodaj dokumenty lub ZIP i uruchom analizę.
3. Najpierw zatwierdź kategorię i inwestycję dokumentu.
4. Otwórz Centrum weryfikacji w Dokumentacji albo Brain AI.
5. Sprawdź cytat i lokalizację, ewentualnie popraw tytuł lub moduł.
6. Zatwierdź wybrane pozycje. Elementy formalne i finansowe pozostają w swoich istniejących procesach akceptacji.
