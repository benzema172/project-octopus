# Autonomous Wrzutnia — 2026-08-26

## Cel
Wrzutnia w Inwestycjach jest wyłącznie punktem wejścia plików. Użytkownik nie wybiera kategorii, branży, rewizji ani modułu docelowego.

## Przepływ
1. Plik/folder trafia do prywatnego R2.
2. Octopus ekstrahuje treść i analizuje ją Gemini.
3. AI klasyfikuje dokument i odczytuje dane operacyjne.
4. Warstwa `investment-document-routing` łączy treść dokumentu z kontekstem inwestycji: istniejącymi systemami, kosztorysem, materiałami, wymaganiami, dokumentami i protokołami.
5. Dla technicznych dokumentów warstwa może pomocniczo użyć Gemini + Google Search; brak quota/awaria nie blokuje routingu deterministycznego i wiedzy modelu.
6. AI nadaje dokumentowi nazwę, branżę/system i uzupełnia przypisanie materiałów.
7. AI tworzy dodatkowe wymagania/szkice protokołów wynikające z rodzaju robót, np. kanalizacja/PVC → wymaganie próby szczelności kanalizacji.
8. Autopilot publikuje rozpoznane dane do właściwych modułów inwestycji.
9. Wyniki rzeczywistych prób, odbiorów, pomiarów i podpisy nigdy nie są wymyślane — szkice pozostają do faktycznego wykonania.

## Dokumenty
Zakładka Dokumenty jest biblioteką uporządkowaną przez AI. Nie ma w niej drugiej Wrzutni ani ręcznego przycisku Analizuj.

## Kontrola regresji
`tests/investment-wrzutnia-autonomous-routing.test.ts` pilnuje upload-only UI, routingu przed Autopilotem, kontekstu branżowego oraz biblioteki Dokumentów.
