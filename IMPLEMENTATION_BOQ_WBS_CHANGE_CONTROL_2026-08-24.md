# Project Octopus 1.2.0 — BOQ / WBS Change Control

Data: 24.08.2026

## Zakres wdrożenia

- kontrolowane wersje kosztorysu BOQ zamiast nadpisywania obowiązujących danych,
- wersja bazowa, rewizja, korekta, zmiana kontraktowa i wersja powykonawcza,
- edycja pozycji wyłącznie w szkicu oraz niezmienne snapshoty wersji,
- porównanie pozycji i wartości: dodane, zmienione, usunięte oraz wpływ netto,
- zatwierdzanie nowego baseline'u z automatycznym wycofaniem poprzedniego,
- aktywne projekcje BOQ dla kosztów, uzgodnień, realizacji i Autopilota,
- edytor hierarchicznej struktury WBS z branżą, instalacją, strefą i kodem kosztowym,
- rejestr Change Order z wpływem wartościowym i terminowym,
- obieg Change Order: rozpoznana, zgłoszona, zatwierdzona, odrzucona i ponownie otwarta,
- kontrola uprawnień domen Inwestycje i Finanse w interfejsie i API,
- osiem atomowych operacji bazodanowych dostępnych wyłącznie dla warstwy serwisowej,
- obsługa błędu sieciowego i automatyczne przejście do nowo utworzonej rewizji.

## Najważniejsze elementy techniczne

- `app/workspace/projects/[projectId]/cost-estimate/page.tsx` — nowy ekran operacyjny,
- `components/projects/boq-change-control-workspace.tsx` — edytor BOQ/WBS/Change Order,
- `app/api/projects/boq-control/route.ts` — autoryzowane operacje serwerowe,
- `lib/data/project-boq-control.ts` — odczyt danych kontrolnych,
- `lib/boq-version-diff.ts` — czysta logika porównania wersji,
- `supabase/migrations/20260824143000_boq_wbs_change_control.sql` — model i operacje atomowe,
- `supabase/migrations/20260824144000_boq_active_projections.sql` — aktywne projekcje kosztów i realizacji.

## Weryfikacja

- pełny łańcuch 90 migracji oraz scenariusz BOQ/WBS/Change Order: OK,
- 58 plików testowych, 384 testy: OK,
- TypeScript: OK,
- ESLint: OK,
- produkcyjna kompilacja Next.js 16.3.2: OK,
- migracje zastosowane w bazie aplikacji: OK,
- RLS tabeli `boq_version_items`: aktywne, jedna polityka odczytu,
- osiem RPC kontroli zmian: brak wykonania dla roli `authenticated`,
- cztery projekcje aktywnego BOQ sprawdzone na danych aplikacji: poprawny wynik JSON.

Cały zestaw kontroli został ponownie uruchomiony po końcowej poprawce obsługi błędu sieciowego. TypeScript, ESLint, 384 testy, 90 migracji oraz produkcyjny build zakończyły się powodzeniem.

## Stan wdrożenia

Migracje bazy zostały zastosowane i zweryfikowane. Kod aplikacji jest gotowy do wdrożenia. Nowy podgląd Vercel nie został utworzony, ponieważ warstwa zatwierdzania dużego uploadu w bieżącej rozmowie ponownie odrzuciła kompletny projekt po lokalnej walidacji. Nie wpłynęło to na istniejący podgląd ani środowisko produkcyjne aplikacji. Do wdrożenia podglądu należy użyć końcowej paczki w nowym, krótszym wątku roboczym.

## Znane ustawienia projektu

Po zmianie nie pojawiły się nowe ostrzeżenia bezpieczeństwa Supabase. Nadal istnieją dwa wcześniejsze komunikaty administracyjne: informacyjny brak polityki na technicznej tabeli wersji schematu oraz wyłączona ochrona haseł wyciekłych. Nie są one skutkiem tej paczki.
