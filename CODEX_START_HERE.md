# ProjectOctopus - przekazanie do Codexa

Stan paczki: 2026-08-24

## Produkcja

- Aplikacja: https://project-octopus-alpha.vercel.app
- Repozytorium: https://github.com/benzema172/project-octopus
- Wdrozony commit `main`: `18033f0cfa0c9ee2c2e016760e44300838b2b506`
- Hosting aplikacji: Vercel
- Baza i Auth: Supabase, projekt `Project Octopus`
- Pliki dokumentow: prywatny Cloudflare R2
- Analiza dokumentow: Gemini

## Aktualny przeplyw dokumentow

`Wrzutnia -> R2 -> ekstrakcja PDF/DOCX/XLS/XLSX/ZIP -> klasyfikacja i analiza AI -> weryfikacja -> Octopus Brain -> moduly inwestycji i firmy`

Kod obejmuje m.in. wersjonowanie dokumentow, kolejke przetwarzania, dopasowanie do inwestycji, aliasy uczone z korekt, zatwierdzanie analizy, kwarantanne, sciezki akceptacji, data roomy, SLA, audyt oraz plan dzialan inwestycji.

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

## Zasady dalszej pracy

- Najpierw przeanalizuj istniejace moduly i migracje; nie tworz rownoleglego drugiego obiegu dokumentow.
- Zachowuj prosty, zwarty i jasny interfejs. Funkcje operacyjne maja dzialac w tle.
- Nie publikuj atrap ani pustych kafli. Kazda widoczna akcja ma miec prawdziwy zapis, walidacje, uprawnienia i audyt.
- Nie wprowadzaj platnych uslug bez wyraznego zatwierdzenia przez Wiktora.
- Nie cofaj istniejacych zmian. Przed wdrozeniem sprawdz migracje Supabase, testy, build i produkcyjny przeplyw.

## Bezpieczenstwo paczki

Paczka zawiera tylko sledzone zrodla projektu i ten dokument. Nie zawiera `node_modules`, `.next`, `.git`, `.env.local` ani sekretow produkcyjnych.
