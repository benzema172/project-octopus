# ProjectOctopus - aktualny punkt startowy dla Codexa

Stan roboczy: 2026-08-31
Wersja aplikacji: 1.6.0

## Produkcja

- Aplikacja: https://project-octopus-alpha.vercel.app
- Repozytorium: https://github.com/benzema172/project-octopus
- Aktualny `main`: `754eaa0d9d28c07fc896cfb913d67732ac9794b6`
- Ostatni commit: `Restore company power tools regression while updating release version`
- Hosting aplikacji: Vercel
- Baza i Auth: Supabase, projekt `Project Octopus`
- Pliki dokumentow: prywatny Cloudflare R2
- Analiza dokumentow: Gemini

## Aktualny przeplyw dokumentow

`Wrzutnia -> R2 -> ekstrakcja PDF/DOCX/XLS/XLSX/ZIP -> klasyfikacja i analiza AI -> weryfikacja -> Octopus Brain -> moduly inwestycji i firmy`

Kod obejmuje m.in. wersjonowanie dokumentow, kolejke przetwarzania, dopasowanie do inwestycji, aliasy uczone z korekt, zatwierdzanie analizy, kwarantanne, sciezki akceptacji, data roomy, SLA, audyt oraz plan dzialan inwestycji.

## Najnowszy zakres zmian

- Kadry 1.5.0: kontrola wynagrodzen, koszt pracodawcy, koszt roboczogodziny, miesieczne rozliczenia i audyt danych placowych.
- Kadry po 1.5.0: rozbudowany formularz pracownika, badania lekarskie, BHP, kwalifikacje, limity urlopowe, kalendarz pracy i historia audytu.
- Projekty i finanse: przypisywanie kosztow pracy do inwestycji, hybrydowy model rozliczen, snapshoty kosztow pracy oraz KPI finansowe zasilane danymi HR.
- Ksieogowosc HR 1.6.0: most danych kadrowo-ksiegowych, eksporty, rejestr kompletacji dokumentow pracowniczych i utwardzenie regresji.
- Release badge: wersja i metadane wdrozenia sa wyliczane automatycznie z `package.json` oraz zmiennych buildu.

## Wazna decyzja infrastrukturalna

Projekt ma pozostac na darmowych planach. Cloudflare odpowiada obecnie tylko za R2. Folder `services/malware-scanner` zawiera przygotowana opcjonalna infrastrukture ClamAV, ale usluga nie jest wdrozona, poniewaz Cloudflare Containers wymagaja planu platnego.

- `OCTOPUS_REQUIRE_MALWARE_SCAN` ma pozostac `false`.
- Nie zakladaj, ze rzeczywisty skan antywirusowy jest aktywny.
- Wynik `infected` zawsze blokuje plik, ale bez skonfigurowanego endpointu skan ma status `unavailable` i nie blokuje przeplywu.

## Uruchomienie lokalne

1. Zainstaluj Node.js zgodny z `package.json`.
2. Uruchom `npm ci`.
3. Uzupelnij lokalny `.env.local` na podstawie `.env.example`; nie zapisuj sekretow w repozytorium.
4. Uruchom `npm run dev`.
5. Przed zmianami uruchom odpowiednie testy oraz `npm run build`.

Zaleznosc SheetJS jest celowo przypieta w `package.json` i lockfile do oficjalnego artefaktu `xlsx-0.20.3`, aby `npm ci`, TypeScript i build byly powtarzalne.

## Ostatnia weryfikacja lokalna

- `npm ci` - OK
- `npm test` - OK, 119 plikow testowych, 574 testy
- `npm run typecheck` - OK
- `npm run lint` - OK, 8 ostrzezen bez bledow
- `npm run build` - OK

Pozostale ostrzezenia lint sa techniczne i nie blokuja pracy: nieuzywane zmienne `_net`, `_gross`, `_contrib`, `_other`, `_total`, `_labor`, brakujaca zaleznosc `employeeDay` w `useMemo` oraz nieuzywane `shownProjectIds`.

## Zasady dalszej pracy

- Najpierw przeanalizuj istniejace moduly i migracje; nie tworz rownoleglego drugiego obiegu dokumentow.
- Zachowuj prosty, zwarty i jasny interfejs. Funkcje operacyjne maja dzialac w tle.
- Nie publikuj atrap ani pustych kafli. Kazda widoczna akcja ma miec prawdziwy zapis, walidacje, uprawnienia i audyt.
- Nie wprowadzaj platnych uslug bez wyraznego zatwierdzenia przez Wiktora.
- Nie cofaj istniejacych zmian. Przed wdrozeniem sprawdz migracje Supabase, testy, build i produkcyjny przeplyw.

## Uwaga o zalaczniku z rozmowy

W rozmowie byl wskazany plik `ProjectOctopus_1.5.0_Koszty-Pracownikow_2026-08-28.zip`, ale dostepna kopia scratch wskazywala na starsza paczke `ProjectOctopus_aktualny-czysty_2026-08-24.zip`. Dlatego aktualnym zrodlem prawdy jest repozytorium GitHub na `main`.
