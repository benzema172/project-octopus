# Project Octopus 1.0.1 — audyt po wydaniu 1.0

Wydanie 1.0.1 jest poprawką integralności po pełnym audycie kodu i ponownym uruchomieniu testów wersji 1.0. Nie dodaje pustych modułów — naprawia rzeczywiste ścieżki zapisu i rozszerza testy regresyjne.

## Naprawione błędy

- Wrzutnia firmowa może finalizować dokument bez przypisanej inwestycji (`project_id = null`).
- Dokument firmowy nie może zostać przypadkowo przepięty do inwestycji przez kolejną wersję; porównania identity są NULL-safe (`IS DISTINCT FROM`).
- Ręczne PZ/WZ/RW/ZW/MM zapisują nagłówek i pozycję w jednej transakcji PostgreSQL.
- RW/WZ/MM nie mogą zejść poniżej dostępnego stanu; MM wymaga innego magazynu docelowego z tej samej firmy.
- Zatwierdzanie szkiców ruchów magazynowych ponownie sprawdza typ, pozycje i dostępny stan.
- Przypisanie dokumentu AI do inwestycji atomowo aktualizuje dokument, wersje, ekstrakcje, intake, klasyfikacje i joby.
- Zakres projektu dla operacji aktualizujących jest wyprowadzany z rzeczywistego rekordu (np. czasu pracy, ruchu magazynowego, definicji raportu), a nie z niezweryfikowanego `projectId` przesłanego przez klienta.
- Zapis płatności i przeliczenie `paid_amount/status` faktury są jedną transakcją.
- Zapis tankowania oraz aktualizacja przebiegu/odczytu licznika są jedną transakcją.
- Usunięto cztery ostrzeżenia ESLint ujawnione przez świeży rerun CI.
- `@types/node` podniesiono z 22.10.1 do 22.12.0, zgodnie z peer requirement używanego Vite; lockfile został wygenerowany przez npm.

## Rozszerzone testy

Migration smoke-test uruchamia cały łańcuch migracji i dodatkowo sprawdza:

- finalizację dokumentu firmowego bez projektu,
- odrzucenie próby niespójnego rebindingu dokumentu,
- atomowe przypisanie dokumentu do projektu,
- odrzucenie RW ponad stan,
- prawidłowy ręczny RW i późniejszy MM,
- odrzucenie zatwierdzenia draftu WZ ponad stan,
- atomową płatność wraz z aktualizacją faktury,
- atomowe tankowanie wraz z przebiegiem i `meter_readings`,
- dotychczasowe budżety, magazyn, zamówienia, wyszukiwarkę, anomalie i Command Center.

Dodatkowy plik `tests/audit-1.0.1.test.ts` utrzymuje statyczne kontrakty dla naprawionych ścieżek i spójności metadanych release.

## Granice audytu

Pełne CI i PGlite walidują kod, TypeScript, migracje, logikę i build. Test przeciw realnemu Supabase/R2 jest osobnym staging E2E i wymaga sekretów środowiska oraz wdrożenia nowych migracji do docelowej bazy. Audyt nie udaje, że produkcyjna baza została zaktualizowana, jeśli nie ma bezpośredniego potwierdzenia tego wdrożenia.

Pełny skaner antymalware plików nadal nie jest częścią aplikacji; istniejąca warstwa uploadu sprawdza rozszerzenie/MIME oraz magic bytes, ale nie zastępuje AV/sandboxingu.
