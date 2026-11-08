# Kontrola pól i źródeł — 8 listopada 2026

Zmiana rozwija istniejący obieg Wrzutnia → R2 → analiza → propozycje → moduły.

- Kontrola danych krytycznych: cytat/lokalizator dla wartości, arytmetyka kosztorysów i faktur, rzeczywiste daty, kierunek terminów, cykle i brakujące poprzedniki harmonogramu, ilości wykonane i odebrane.
- Wynik jest kontrolą dowodów i spójności, nie skalibrowanym prawdopodobieństwem. Samo confidence modelu nie usuwa rozbieżności.
- Excel: fizyczne adresy komórek i wierszy, nazwy zakładek, jawne zero, brakujące dane i formuły bez poprawnej wartości. Formuły nie są przeliczane przez LLM.
- Word: zachowane granice komórek i wierszy tabel. Bez wymyślania numerów stron.
- PDF: rozpoznawanie granic w oknach ośmiu stron z jedną stroną wspólną, kontrola pokrycia i zgodności, zapis postępu, limit 120 stron. Niepewny podział trafia do kontroli. Oryginał pozostaje niezmieniony; pliki potomne korzystają z obecnej kolejki paczek i zapisują odwołanie do stron oryginału.
- Ponowny odczyt: do czterech wybranych pól z wycinków źródła; PDF z kontekstem nagłówka, obrazy z marginesem wokół wartości. Rozbieżność nie nadpisuje pierwszej wartości. Brak możliwości sprawdzenia pozostawia pole do kontroli.
- Publikacja: poprawne propozycje przechodzą osobno; niekompletny kosztorys nie staje się automatycznie zatwierdzoną bazą BOQ. Kontrola również w triggerze bazy; indywidualna decyzja wymaga potwierdzenia sprawdzenia źródła. Grupowa decyzja nie omija tej blokady.
- UI: panel „Kontrola pól i źródła”, odsyłacze do stron pliku i komórek, lista rozbieżności oraz korekta liczb i dat w propozycjach.

## Weryfikacja

`npm test`, `npm run typecheck`, `npm run lint`, `npm run test:migrations`, `npm run build:app`, `npm audit --omit=dev --audit-level=high`.

`scripts/e2e-document-quality.mjs` testuje rzeczywiste R2/Gemini/Supabase na syntetycznych dokumentach w wydzielonej firmie gościa: poprawny XLSX, błędny XLSX i zbiorczy PDF (kosztorys/harmonogram/protokół), zachowanie oryginału, śledzenie źródła i autoryzację API. Ten sam test uruchamia Live E2E Audit po wdrożeniu właściwego commitu.

## Granice

Zmiana nie trenuje modelu AwaRes i nie deklaruje statystycznej gwarancji conformal risk control bez kalibracji na własnych oznaczonych danych. Nie potwierdza wykonania robót, podpisów ani wyniku próby. Test syntetyczny nie zastępuje odbioru paczki 100 rzeczywistych dokumentów.
