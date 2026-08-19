# Stability & Performance Core

Data przygotowania: 19.08.2026

## Cel

Pakiet stabilizuje sposób dostarczania Project Octopus i usuwa dwa infrastrukturalne źródła problemów: nadmierną liczbę automatycznych wdrożeń oraz niepotrzebne opóźnienie pomiędzy warstwą serwerową aplikacji i bazą danych.

## Zakres

- automatyczne wdrożenia Vercel tylko z `main`; wszystkie pozostałe gałęzie są domyślnie wyłączone z automatycznych deployów,
- Vercel Functions przeniesione do `dub1`, bliżej bazy Supabase działającej w `eu-west-1`,
- CI działa na Node 24, zgodnie z aktualnym runtime projektu Vercel,
- kolejne runy CI dla tej samej gałęzi anulują starsze, nieaktualne runy,
- CI działa z minimalnym uprawnieniem `contents: read`,
- instalacja zależności w CI pomija audit/fund, zachowując deterministyczne `npm ci`,
- nowy `npm run check:stability` blokuje regresje w konfiguracji Vercel i CI,
- pełny dotychczasowy zestaw kontroli pozostaje aktywny: typecheck, testy, kontrakt migracji, lint i build.

## Świadomie bez zmian

- nie dodano masowo nowych indeksów do bazy tylko dlatego, że linter je sugeruje; obecna baza jest mała, a najważniejsze ścieżki odczytu dokumentów, harmonogramu, kosztorysu i AI posiadają już indeksy. Dalsze indeksowanie powinno wynikać z realnych statystyk zapytań,
- nie wykonujemy ręcznego redeployu podczas aktywnego limitu dziennego Vercela,
- nie zmieniamy logiki biznesowej modułów w tym pakiecie.

## Weryfikacja

Pakiet uznajemy za gotowy dopiero po przejściu:

```bash
npm run check:stability
npm run typecheck
npm run test
npm run test:migrations
npm run lint
npm run build
```

Po scaleniu do `main` Vercel ma wykonać wyłącznie pojedynczy deployment produkcyjny, gdy limit wdrożeń ponownie będzie dostępny.
