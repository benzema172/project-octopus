# Project Octopus 1.3.2

Data: 26.08.2026

## Background AI Queue

- Dokumenty odroczone przez Gemini `HTTP 429 / RESOURCE_EXHAUSTED` nie wymagają otwartej aplikacji ani ręcznego kliknięcia.
- Hosted Supabase budzi `/api/brain/worker?limit=3` co 5 minut przez `pg_cron` + `pg_net`.
- Worker nadal respektuje `processing_jobs.available_at <= now()`, więc cooldown zwrócony przez Gemini nie jest omijany.
- Wake-up jest uwierzytelniany losowym tokenem generowanym dopiero w produkcyjnym Supabase i przechowywanym w Vault. Token nie trafia do GitHuba, frontendu ani logiki klienta.
- Istniejący Vercel Cron pozostaje dodatkowym dziennym backstopem, a `GET` i `POST` korzystają ze wspólnej logiki workera.
- Jedno automatyczne wywołanie pobiera maksymalnie 3 dostępne zadania, żeby ograniczać skoki obciążenia i ryzyko ponownego wyczerpania darmowego limitu Gemini.
- Przycisk `Wymuś ponowienie teraz` z 1.3.1 pozostaje dostępny jako ręczne przyspieszenie, ale nie jest potrzebny do pracy kolejki w tle.

## Efekt użytkowy

Po błędzie 429 można zamknąć Project Octopus. Dokument pozostaje w kolejce. Gdy minie `retryDelay`, najbliższy cykl tła (maksymalnie około 5 minut później) ponownie uruchamia analizę, routing i Autopilot bez ponownego uploadu pliku.

## Safety

Background Queue nie omija zasad wiarygodności danych i nie publikuje wymyślonych pomiarów, odbiorów, podpisów ani decyzji formalnych. Zmienia wyłącznie sposób wznowienia istniejącego pipeline AI.
