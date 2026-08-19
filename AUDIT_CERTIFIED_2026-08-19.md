# Project Octopus — audyt certyfikacyjny 2026-08-19

Status: w toku.

## Kryterium odbioru

Aktualna wersja może zostać uznana za certyfikowaną dopiero po spełnieniu łącznie:

- brak reprodukowalnych błędów P0/P1/P2 w aktualnym `main`,
- pełne zielone CI,
- zielony live E2E obejmujący Auth/RLS → API → R2 → Gemini → Brain,
- przejście krytycznego lifecycle inwestycji,
- rozstrzygnięcie ostrzeżeń Supabase Security Advisor,
- świadomy przegląd hot-pathów i indeksów bez hurtowego indeksowania,
- przegląd starych ścieżek/redirectów i martwego kodu,
- sprawdzenie runtime logs po publikacji.

## Aktualnie potwierdzone blokery

1. Live E2E uploadu: presigned R2 PUT zwracał 403 `AccessDenied` na produkcji.
2. Guest/Demo: wcześniejsze seedy ujawniły drift schematu i konflikt z niezmienną historią magazynową; obecna wersja datasetu ogranicza reseed, ale retry po częściowym seedzie wymaga osobnego potwierdzenia.
3. Security Advisor: ostrzeżenia dotyczące `vector` w `public`, publicznie osiągalnych `SECURITY DEFINER` dla roli `authenticated` i ochrony przed wyciekniętymi hasłami.
4. Standardowe CI nie jest równoznaczne z live E2E; finalny merge musi uruchomić oba poziomy weryfikacji.

## Zasada wdrażania audytu

Zmiany audytowe powstają na jednej gałęzi. Produkcyjny `main` ma otrzymać jeden zweryfikowany pakiet zamiast serii diagnostycznych deploymentów.
