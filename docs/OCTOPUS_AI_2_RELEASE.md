# Octopus AI 2.0 — Autonomous Company Brain

Release 2.0.0 jest jednym zintegrowanym wdrożeniem warstwy inteligencji Project Octopus.

## Zakres

- centralny AI Control Plane i router modeli,
- Hybrid RAG: wyszukiwanie tekstowe + embeddingi 768D + lokalizatory źródeł,
- OctopusAI Agent z narzędziami do odczytu danych i bezpiecznych działań,
- polityka autonomii L0–L3 z progami pewności,
- calibrated confidence uczony z rzeczywistych decyzji użytkowników,
- Night Shift i cross-module briefing,
- AI Health, ślady narzędziowe i metryki jakości,
- hybrydowe wyszukiwanie Brain dostępne także poza czatem.

## Granice autonomii

AI może wykonywać tylko działania, które przejdą kontrolę uprawnień, poziomu autonomii, ryzyka i pewności. Zadania oraz szkice są odwracalne. Zamówienia tworzone przez AI pozostają `draft` i otrzymują `pending approval`. Fizyczny ruch magazynowy, zobowiązanie finansowe, finalne zamówienie oraz działania HR wysokiego ryzyka nie są zatwierdzane autonomicznie.

## Niezawodność

Każde wywołanie narzędzia ma trace ID i zapis w `ai_action_log`. RAG ma fallback tekstowy, jeśli embedding API jest chwilowo niedostępne. Night Shift tworzy briefing deterministyczny także wtedy, gdy model generatywny jest niedostępny. Dokumentowy pipeline Warehouse zachowuje istniejący cache porcji i retry.

## Release gate

Przed scaleniem do `main` wymagane są: synchronizacja lockfile, typecheck, pełne testy, walidacja migracji, lint, build oraz produkcyjna kontrola Vercel/Supabase po wdrożeniu.
