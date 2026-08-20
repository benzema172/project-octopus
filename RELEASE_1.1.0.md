# Project Octopus 1.1.0

Data wydania: 20.08.2026

## Status

Wersja 1.1.0 jest wydaniem po audycie certyfikacyjnym i domknięciu produkcyjnego przepływu dokumentów AI.

## Najważniejsze elementy wydania

- działający zapis plików do Cloudflare R2 z uprawnieniem Object Read & Write,
- rozpoznawanie właściwego endpointu R2 i bramka realnej zdolności zapisu,
- atomowe zakończenie uploadu z ETag i SHA256,
- trwałe `processing_jobs` dla pipeline dokumentów,
- poprawiony kontrakt JSON dla Gemini,
- kompatybilny zapis faktów do Octopus Brain także dla starszego schematu produkcyjnego,
- zweryfikowany produkcyjnie przepływ `Wrzutnia → R2 → complete → Gemini → Brain`,
- pomyślne testy live dla PDF i XLSX,
- brak znanych reprodukowalnych błędów P0/P1/P2 po zamknięciu audytu #30.

## Oficjalne oznaczenie

`Project Octopus v1.1.0 • wdrożono 20.08.2026`
