# Project Octopus 0.4.0

System operacyjny firmy wykonawczej, w którym dokument źródłowy zasila Project DNA, kosztorys/BOQ, WBS, harmonogram, materiały, protokoły, przerób, finanse i raportowanie.

## Zasady produktu

- jeden fizyczny dokument może mieć wiele powiązań bez kopiowania pliku,
- kosztorys i WBS są kręgosłupem inwestycji,
- każdy fakt AI zachowuje dokument, wersję, lokalizator i cytowany fragment,
- AI proponuje, reguły walidują, a człowiek zatwierdza operacje formalne, finansowe, kadrowe i magazynowe,
- liczby finansowe pochodzą wyłącznie z rekordów źródłowych i jawnych założeń forecastu,
- dane HR, finansowe i techniczne są rozdzielone rolami domenowymi.

## Wersja 0.4.0

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
CRON_SECRET
```

`CRON_SECRET` chroni automatyczne wywołanie `/api/brain/worker`. Sekrety nie są zapisywane w tabelach biznesowych.

## Migracje

Na aktualnej bazie produkcyjnej zastosuj kolejno:

```text
supabase/migrations/20260814090000_octopus_operating_system.sql
supabase/migrations/20260814130000_octopus_execution_layer.sql
```

Na pustej bazie uruchom wszystkie migracje chronologicznie. Interfejs uploadu wymaga markera `20260814_execution_layer`.

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

Szczegóły wdrożenia znajdują się w `DEPLOYMENT.md`, a zakres wykonania i granice integracji w `IMPLEMENTATION_0.4.0.md`.
