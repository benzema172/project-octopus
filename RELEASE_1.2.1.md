# Project Octopus 1.2.1

Data wydania: 26.08.2026

## Zakres
Audyt niezawodności aktualnej aplikacji ze szczególnym naciskiem na Wrzutnię, automatyczne przetwarzanie dokumentów AI, kolejkę dokumentów z paczek ZIP oraz odzyskiwanie sesji panelu firm.

## Naprawione
- Panel firm nie kończy się błędem po przejściowym odrzuceniu Supabase `JWT issued at future`; service-role requests ponawiają wyłącznie ten konkretny przypadek rozbieżności zegara.
- Ekran błędu `/workspace` korzysta z poprawnego `POST /auth/sign-out`, zamiast wysyłać nieobsługiwany GET powodujący 405.
- Worker kolejki AI pobiera dokument źródłowy i autora uploadu, dzięki czemu zadania cron zachowują audytowalnego aktora.
- Dokumenty inwestycji przetwarzane z kolejki przechodzą teraz przez `investment-document-routing`, a następnie przez Autopilot, tak jak dokument przetwarzany bezpośrednio po Wrzutni.
- Pliki potomne utworzone z ZIP nie kończą już procesu na samej ekstrakcji/klasyfikacji: mogą zasilać właściwe moduły inwestycji i tworzyć bezpieczne szkice wymaganych dokumentów.
- Numer wydania został podniesiony do 1.2.1 i jest weryfikowany testem release badge.

## Granice bezpieczeństwa AI
AI nadal nie może fabrykować wyników prób, pomiarów, odbiorów ani podpisów. Może rozpoznać wymaganie i przygotować szkic, ale dane formalne muszą pochodzić z rzeczywistego wykonania.

## Regresje
Dodano `tests/release-1.2.1-reliability.test.ts`, który pilnuje poprawnego POST wylogowania, retry JWT clock-skew oraz pełnego routingu i Autopilota dla dokumentów kolejki.
