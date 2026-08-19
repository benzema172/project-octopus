# Project Octopus 1.0.1

Project Octopus to operacyjny system firmy wykonawczej i inwestycji, w którym dokumenty źródłowe zasilają wspólny model danych: Project DNA, kosztorys/BOQ, WBS, harmonogram, materiały, protokoły, przerób, finanse, magazyn, kadry, flotę i raportowanie.

## Zasady produktu

- jeden fizyczny dokument może mieć wiele powiązań bez kopiowania pliku,
- kosztorys i WBS są kręgosłupem inwestycji,
- AI klasyfikuje i proponuje, ale operacje formalne, finansowe, kadrowe i magazynowe pozostają kontrolowane przez reguły i uprawnienia,
- fakty AI zachowują źródło, wersję dokumentu, lokalizator i ślad audytowy,
- dane domenowe są rozdzielone uprawnieniami `read / write / approve / admin`, także z zakresem pojedynczej inwestycji,
- zapis magazynowy i kluczowe operacje finansowe używają ścieżek atomowych zamiast luźnych aktualizacji klienta.

## Aktualny zakres 1.0.1

### Firma

- centrum działań i alertów wymagających uwagi,
- Finanse: faktury, płatności, zobowiązania, alokacje, przypisanie do inwestycji i przepływ dokumentów,
- Kadry: pracownicy, zatrudnienie, czas pracy, urlopy, badania, kwalifikacje i przypisania,
- Magazyn: kartoteki, PZ/WZ/RW/ZW/MM, rezerwacje, kontrolowane przyjęcia z dokumentów i stany,
- Flota: pojazdy, paliwo, przejazdy, serwis, szkody i terminy dokumentów,
- Raporty i snapshoty operacyjne,
- centralna biblioteka dokumentów, wyszukiwanie i Wrzutnia AI.

### Inwestycja

- Project DNA i dane kontraktowe,
- kosztorys/BOQ, WBS i wersjonowanie,
- harmonogram, przerób i Kontrola 360°,
- wnioski materiałowe oraz protokoły z workflow zatwierdzania,
- dokumenty, Brain i źródła wiedzy,
- forecast finansowy, rozliczenie, closeout i Project Command Center.

### Dokumenty i AI

Docelowy obieg jest spójny z architekturą:

`Wrzutnia → Cloudflare R2 → ekstrakcja PDF/DOCX/XLSX → Gemini → klasyfikacja i ekstrakcja → Brain → moduły`

Pliki są przechowywane prywatnie w R2, a baza przechowuje metadane, wersje, wyniki ekstrakcji, powiązania i ślad audytowy.

## Architektura

- Next.js 16 / React 19,
- Supabase: PostgreSQL, Auth, RLS i funkcje RPC,
- Cloudflare R2: pliki źródłowe,
- Gemini: klasyfikacja i ekstrakcja dokumentów,
- Vercel: hosting i Functions; produkcja pracuje w regionie `dub1`,
- GitHub Actions: pełne CI oraz osobny black-box audyt produkcyjnych integracji.

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
GEMINI_MODEL
GEMINI_API_KEY
CRON_SECRET
```

Sekretów nie zapisujemy w tabelach biznesowych ani w repozytorium. Publiczny URL Supabase i klucz `sb_publishable_*` nie są sekretami; aplikacja kliencka używa ich jawnie do Auth/RLS.

## Migracje

Migracje znajdują się w `supabase/migrations` i muszą być wykonywane chronologicznie. Nie należy ręcznie wybierać historycznej podlisty migracji z tego README — kontrakt migracyjny w CI sprawdza pełny aktualny łańcuch od pustej bazy.

## Walidacja lokalna

```bash
npm ci
npm audit --omit=dev --audit-level=high
npm run check:stability
npm run typecheck
npm run test
npm run test:migrations
npm run lint
npm run build
```

## Live E2E Audit

Workflow `.github/workflows/e2e-staging.yml` nie przechowuje prywatnych kluczy Supabase, R2 ani Gemini. Buduje audytowaną gałąź, a następnie traktuje publiczną aplikację jak zewnętrzny klient:

1. przygotowuje izolowane konto demonstracyjne przez publiczny endpoint,
2. loguje się przez Supabase Auth/RLS,
3. sprawdza blokadę niezalogowanego API,
4. sprawdza wyszukiwanie firmy i Project Command Center,
5. wysyła realny PDF i XLSX przez `/api/storage/upload-url`,
6. zapisuje plik przez presigned URL w Cloudflare R2,
7. kończy upload i uruchamia `/api/brain/process-document`,
8. potwierdza klasyfikację Gemini, ekstrakcję Brain, job pipeline, tekst i źródła,
9. przenosi dokument audytowy do kosza, żeby nie mieszał się z aktywnymi danymi demonstracyjnymi.

Dzięki temu test przechodzi przez te same endpointy, autoryzację i integracje, z których korzysta aplikacja, zamiast omijać je kluczem `service_role`. Historyczne uprzywilejowane skrypty E2E pozostają w `scripts/` do diagnostyki środowiska developerskiego, ale nie są traktowane jako zielona bramka, dopóki nie mają jawnie skonfigurowanych sekretów.

## Zasady wydania

- gałęzie robocze nie tworzą automatycznie preview na Vercelu,
- pełne CI musi być zielone przed merge,
- `main` jest jedyną gałęzią automatycznie publikowaną na produkcję,
- większy audyt zmienia `scripts/e2e-live-trigger.txt`, co wymusza Live E2E Audit przed merge i po publikacji,
- po wdrożeniu produkcyjnym wynik live E2E należy ponownie potwierdzić na gotowym deploymentcie,
- zmiany w RLS i operacjach atomowych muszą mieć test regresyjny lub kontrakt migracyjny.

Historyczne opisy wersji i audytów pozostają w Git i dokumentach projektu; ten README opisuje wyłącznie bieżący stan aplikacji.
