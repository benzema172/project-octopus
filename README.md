# Project Octopus

Pierwsza wersja MVP aplikacji do prowadzenia inwestycji, dokumentacji i przygotowania pod Octopus Brain.

## Funkcje MVP

- logowanie i rejestracja przez Supabase,
- automatyczny workspace użytkownika,
- lista inwestycji oparta o tabelę `projects`,
- tworzenie nowej inwestycji,
- widok konkretnej inwestycji,
- sekcja Dokumentacja,
- endpoint `POST /api/storage/upload-url` generujący presigned PUT URL do prywatnego Cloudflare R2,
- bezpośredni upload z przeglądarki do bucketa R2,
- zapis metadanych do `documents` i `document_versions`,
- podstawowy ekran Octopus Brain przygotowany pod `AI_PROVIDER=gemini`.

## Zmienne środowiskowe

Używane są wyłącznie nazwy zmiennych ustawione wcześniej w Vercel:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
R2_ACCOUNT_ID
R2_BUCKET_NAME
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_ENDPOINT
AI_PROVIDER
GEMINI_API_KEY
```

Sekrety są używane wyłącznie po stronie serwera.

## Supabase

Migracja MVP znajduje się w:

```text
supabase/migrations/20260811130000_project_octopus_mvp.sql
```

Jeśli baza była już utworzona wcześniejszym skryptem Project Octopus, migracja jest idempotentna i dodaje tylko brakujące kolumny wymagane przez MVP.

## Lokalne uruchomienie

```bash
npm install
npm run dev
```

## Weryfikacja

```bash
npm run lint
npm run test
npm run build
```

Opcjonalnie, po ustawieniu prawdziwych zmiennych środowiskowych:

```bash
npm run check:schema
npm run test:e2e-upload
```
