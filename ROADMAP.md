# Project Octopus — roadmap po 1.0

## Zrealizowane do 1.0

- pełny proces `Wrzutnia → Brain → Project DNA → BOQ/WBS → plan → realizacja → odbiór → rozliczenie → raport → wiedza firmy`,
- kolejka AI z retry/dead-letter, Skrzynką AI, decyzjami człowieka i telemetryką jakości,
- atomowe operacje dla krytycznych zapisów przerobu, budżetu, magazynu, faktur, przebiegów i profilu inwestycji,
- pełny ledger magazynowy liczony po całej historii zatwierdzonych ruchów,
- Investment Autopilot z trwałą idempotencją i semantycznym doborem kandydatów,
- Reconciliation Graph: WM → zamówienie → zobowiązanie → materiał/faktura → BOQ/WBS → magazyn → wykonanie/odbiór,
- Project Command Center z Project Health Score, następnym krokiem, Anomaly Engine, 13-tygodniowym cash flow, Resource Plannerem i korespondencją,
- wyszukiwarka wielomodułowa,
- role domenowe i projektowe oraz RLS,
- walidacja całego łańcucha migracji i staging E2E dla kluczowych operacji,
- weryfikacja sygnatur plików po R2 przed uruchomieniem Brain.

## Następny etap produkcyjny po 1.0

1. Uruchomić staging E2E przeciw rzeczywistemu Supabase/R2/Gemini po skonfigurowaniu sekretów GitHub.
2. Wykonać benchmark Brain na reprezentatywnym zestawie rzeczywistych projektów, STWiOR, kosztorysów XLS/XLSX, faktur/WZ/PZ, WM i protokołów; ustalić progi jakości w `report:ai-quality`.
3. Dodać pełny skaner antymalware/quarantine przed dopuszczeniem dokumentu do Brain.
4. Podłączyć harmonogram produkcyjnego workera oraz monitoring kosztu, czasu i dead-letter queue.
5. Rozszerzyć edycję BOQ, zależności harmonogramu i wizualny Gantt.
6. Rozszerzyć generator dokumentów o wierne DOCX oraz serwerowy PDF.
7. Podłączyć wybrane zewnętrzne systemy: KSeF, bank/księgowość, karty paliwowe/GPS lub kadry-płace — każdą integrację jako osobny zakres.
8. Przeprowadzić test retencji, backup/restore i obciążenie na wielkich inwestycjach oraz wieloletniej historii firmy.

## Kryterium operacyjne 1.0

Kierownik otwiera inwestycję i z jednego Control 360 widzi stan finansowy, harmonogram, ryzyka, braki dowodowe, materiały, zamówienia, zasoby, korespondencję i następny krok. Pozycja kosztorysu może być prześledzona do kosztu i materiału, a krytyczne zapisy nie mogą zostać częściowo wykonane przy błędzie lub równoległej pracy. Żadna sugestia AI nie zmienia zatwierdzonego zakresu bez zapisanej decyzji człowieka.
