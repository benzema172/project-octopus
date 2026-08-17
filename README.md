# Project Octopus 0.7.2

System operacyjny firmy wykonawczej, w którym dokument źródłowy zasila Project DNA, kosztorys/BOQ, WBS, harmonogram, materiały, protokoły, przerób, finanse i raportowanie.

## Zasady produktu

- jeden fizyczny dokument może mieć wiele powiązań bez kopiowania pliku,
- kosztorys i WBS są kręgosłupem inwestycji,
- każdy fakt AI zachowuje dokument, wersję, lokalizator i cytowany fragment,
- AI proponuje, reguły walidują, a człowiek zatwierdza operacje formalne, finansowe, kadrowe i magazynowe,
- liczby finansowe pochodzą wyłącznie z rekordów źródłowych i jawnych założeń forecastu,
- dane HR, finansowe i techniczne są rozdzielone rolami domenowymi.

## Wersja 0.7.2

### Bezpieczna Wrzutnia i operacyjny monitoring

- serwer pobiera przesłany obiekt przed rejestracją, wylicza własne SHA-256 i sprawdza sygnaturę zawartości zamiast ufać nazwie oraz MIME klienta,
- PDF, obrazy, tekst, JSON, DOCX, XLSX i ZIP mają kontrolę struktury; archiwa blokują traversal, zaszyfrowane wpisy, zip-bomby, makra i aktywne pliki,
- odrzucony obiekt jest usuwany z R2, a przyczyna trafia do audytu jako zdarzenie kwarantanny,
- wynik kontroli bezpieczeństwa jest zapisywany atomowo razem z wersją dokumentu,
- decyzja dokumentu, publikacja wiedzy, superseded poprzedniej rewizji i audyt wykonują się w jednej transakcji PostgreSQL,
- Skrzynka AI pokazuje stan kolejki, najstarsze zadanie, brak heartbeat, dead-letter, skuteczność i koszt z ostatnich 24 godzin,
- administrator może ręcznie uruchomić do pięciu zadań, a endpoint health nadaje się do zewnętrznego monitoringu.

## Wersja 0.7.1

### Domknięcie przepływów i bezpieczeństwa wiedzy

- wszystkie dokumenty używają jednej kanonicznej taksonomii; starsze polskie identyfikatory są migrowane bez utraty powiązań,
- ręczny upload, filtry modułów, klasyfikacja Gemini i uprawnienia domenowe rozumieją te same kategorie,
- materiały i urządzenia rozpoznane przez AI trafiają do modułów dopiero po zatwierdzeniu dokumentu przez człowieka,
- Brain, asystent, generator oraz wyszukiwarka korzystają wyłącznie z zatwierdzonych faktów i wpisów wiedzy,
- odrzucenie dokumentu wycofuje proponowane wymagania, dowody, protokoły i oczekujący import kosztorysu,
- odbiór inwestycji ma działające oznaczanie pozycji jako kompletne lub brakujące,
- zdarzenia budowy można zatwierdzać lub odrzucać bezpośrednio w module Teren,
- role domenowe można nadawać, aktualizować i odbierać z trwałym audytem,
- zatwierdzony szkic ze Studio Wzorów jest atomowo publikowany jako wersjonowany dokument HTML w R2 i pojawia się w module Wyniki,
- karta inwestycji respektuje tryb tylko do odczytu i nie pokazuje pozornie aktywnych operacji zapisu.

## Wersja 0.7.0

### Sterowanie inwestycją i rejestr zmian

- zespół inwestycji można budować z aktywnych pracowników wraz z rolą, okresem i procentem zaangażowania,
- budżety są wersjonowane i zapisują planowany przychód oraz koszt wykorzystywany przez forecast,
- zmiany kontraktowe mają numer, opis, wpływ na wartość i termin oraz trwały ślad audytowy,
- magazyn inwestycji obsługuje rezerwację istniejącej kartoteki w konkretnym magazynie i terminie,
- widoki finansów, magazynu i zespołu pokazują rzeczywiste rekordy zamiast wyłącznie opisów docelowych możliwości.

## Wersja 0.6.0

### Operacyjne moduły realizacji

- wnioski materiałowe pozwalają ręcznie tworzyć wymagania obok propozycji pochodzących z Brain,
- protokoły mają działający rejestr wymaganych prób, pomiarów, robót zanikowych i odbiorów,
- harmonogram pozwala tworzyć zadania z kodem, terminami i flagą ścieżki krytycznej,
- przerób obsługuje okresy oraz wpisy wykonania i odbioru dla pozycji BOQ,
- wartości przerobu są obliczane z ceny jednostkowej BOQ, a ilości zbiorcze wracają do pozycji kosztorysu,
- kosztorys udostępnia kolejkę importów do zatwierdzenia oraz rejestr zmian kontraktowych.

## Wersja 0.5.2

### Domknięcie operacji przedsiębiorstwa

- Kadry: badania medyczne, rozdzielone terminy przyszłe i wygasłe, decyzje urlopowe i czasu pracy oraz aktywacja/dezaktywacja pracownika,
- Magazyn: rezerwacje materiałowe i bieżąca wartość zapasu liczona jako stan razy ostatni koszt,
- Flota: przejazdy, koszt na kilometr, szkody, aktualizacja przebiegu z tankowania, zamykanie serwisów i status pojazdu,
- Raporty: zakres okresu i inwestycji jest respektowany, a zamknięty snapshot można pobrać jako CSV lub JSON,
- Dokumenty: upload wielu plików, podgląd, stabilne odnośniki do rekordu i czytelny postęp paczki.

## Naprawy wersji 0.5.1

- filtry pustych wyników nie pokazują już błędnego stanu listy,
- faktura ręczna może zawierać pozycję i zatwierdzoną alokację na inwestycję,
- suma zapłacona jest przeliczana z potwierdzonych płatności,
- alerty 30-dniowe nie mieszają przyszłych terminów z dokumentami już wygasłymi,
- tankowanie aktualizuje przebieg pojazdu i zapisuje odczyt licznika,
- snapshot raportu filtruje dane według definicji inwestycji oraz wybranego okresu.

## Wersja 0.5.1

### Automatyczna dekretacja i rejestry rozwijane

- Gemini odczytuje z faktur, WZ/PZ i dokumentów dostaw numery, daty, NIP-y, kwoty oraz pozycje materiałowe,
- AI porównuje wskazówki z dokumentu z katalogiem aktywnych inwestycji; brak pewnego dopasowania pozostawia dokument w rozrachunku ogólnym firmy,
- Finanse zaczytują fakturę wraz z kontrahentem, pozycjami i alokacją na inwestycję,
- Magazyn tworzy kontrolowany szkic PZ z faktury/WZ; stan zmienia się dopiero po zatwierdzeniu,
- wszystkie kafle Finansów, Kadr, Magazynu, Floty i Raportów są rozwijane do prostych list,
- każda z tych sekcji ma wyszukiwarkę filtrującą rekordy, statusy, dokumenty i przypisania.

## Wersja 0.5.0

### Operacyjne centrum przedsiębiorstwa

- Finanse: działające formularze kontrahentów, faktur, płatności i zobowiązań oraz bieżące KPI,
- Kadry: dodawanie pracowników wraz z zatrudnieniem i kosztami, czas pracy, urlopy i kwalifikacje,
- Magazyn: magazyny, kartoteki oraz zatwierdzane ruchy PZ/WZ/RW/ZW/MM z wyliczaniem stanów,
- Flota: pojazdy, tankowania, serwis i terminy dokumentów wraz z kosztami,
- Raporty: definicje raportów i generowanie zamkniętych snapshotów danych firmy,
- Centrum AI: jedna przestrzeń łącząca Wzory, Pamięć firmy i Octopus Brain,
- Dokumenty: stabilna biblioteka centralna, ręczny kontekst uploadu i klasyfikacja AI.

## Fundament wersji 0.4.1

### Dokumenty i AI

- jedna Wrzutnia na poziomie firmy i inwestycji,
- upload do prywatnego R2, wersjonowanie, kosz i przywracanie,
- trwała kolejka z atomowym claim, retry, dead-letter i ręcznym ponowieniem,
- przetwarzanie PDF/obrazu, DOCX, XLSX, ZIP i tekstu,
- Gemini Files API dla PDF/obrazów większych niż limit inline, do 50 MB na pojedynczy plik,
- Skrzynka AI: Nowe / Przetwarzane / Wymaga decyzji / Błąd / Gotowe / Odrzucone,
- zatwierdzanie dokumentów, faktów, kosztorysów, wzorów, zmian i zdarzeń budowy,
- wyszukiwarka pełnotekstowa dokumentów, faktów i zatwierdzonej wiedzy firmy,
- radar skutków nowej rewizji dla zakresu, BOQ, wniosków i protokołów.

### Pion „Kosztorys do odbioru”

- rozpoznawanie pozycji kosztorysu przez AI,
- import roboczy z kontrolą pozycji i błędów,
- zatwierdzenie tworzące wersję BOQ, WBS i szkic harmonogramu,
- matryca wniosków materiałowych oraz wymaganych protokołów,
- wymagania dowodowe dla protokołów i odbiorów,
- łańcuch materiału od wniosku do zużycia na WBS,
- okresy przerobowe rozdzielające wykonanie, odbiór, fakturę i płatność,
- Kontrola 360°, forecast EAC/marży/terminu i paczka zamknięcia inwestycji.

### Firma

- Wzory: automatyczna rejestracja, pola, wersje, kwarantanna, zatwierdzanie i kontrolowany szkic dokumentu,
- Pamięć firmy: lekcje, rozwiązania, wydajności i ryzyka wymagające zatwierdzenia,
- Finanse: faktury, zobowiązania, alokacje, forecast i staging KSeF inbound,
- Kadry: zatrudnienie, badania, kwalifikacje, urlopy, czas i przypisania,
- Magazyn: PZ/WZ/RW/ZW/MM, rezerwacje, narzędzia i materiałowy ślad inwestycji,
- Flota: pojazdy, terminy, paliwo, przejazdy, serwis, szkody i alokacje,
- Raporty: definicje, uruchomienia, snapshoty, alerty i dystrybucja,
- role domenowe: odczyt / zapis / zatwierdzanie / administracja, opcjonalnie dla jednej inwestycji,
- mobilne zdarzenia z budowy z lokalizacją i kontrolą kierownika.

## Zmienne środowiskowe

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
R2_ACCOUNT_ID
R2_BUCKET_NAME
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_ENDPOINT
AI_PROVIDER=gemini
GEMINI_MODEL=gemini-3.5-flash
GEMINI_API_KEY
GEMINI_INPUT_USD_PER_MILLION
GEMINI_OUTPUT_USD_PER_MILLION
CRON_SECRET
```

`CRON_SECRET` chroni automatyczne wywołanie `/api/brain/worker`. Stawki Gemini służą wyłącznie do jawnego szacowania kosztu na podstawie `usageMetadata`; ustaw je zgodnie z aktualnym cennikiem używanego modelu. Sekrety nie są zapisywane w tabelach biznesowych.

## Migracje

Na aktualnej bazie produkcyjnej zastosuj kolejno:

```text
supabase/migrations/20260814090000_octopus_operating_system.sql
supabase/migrations/20260814130000_octopus_execution_layer.sql
supabase/migrations/20260814170000_atomic_estimate_approval.sql
supabase/migrations/20260814180000_domain_access_hardening.sql
supabase/migrations/20260817090000_document_taxonomy_and_ai_review.sql
supabase/migrations/20260817130000_upload_security_and_atomic_document_review.sql
```

Na pustej bazie uruchom wszystkie migracje chronologicznie. Funkcje 0.7.2 wymagają markera `20260817_upload_security_and_atomic_document_review`.

## Walidacja

```bash
npm install
npm run lint
npm run test
npm run test:migrations
npm run typecheck
npm run build
```

Po ustawieniu środowiska:

```bash
npm run check:schema
npm run test:e2e-upload
```

Szczegóły wdrożenia znajdują się w `DEPLOYMENT.md`, bieżący plan domknięcia produktu w `ROADMAP.md`, a historyczny przegląd architektury w `AUDIT_2026-08-14.md`.
