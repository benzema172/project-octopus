# Project Octopus 1.1.0

Data wydania: 18.08.2026

## Kierunek

1.1 rozwija stabilne 1.0.x bez dokładania pustych modułów. Główne zmiany dotyczą skalowania operacyjnego, wiarygodności danych i wyjaśnialności decyzji systemu.

## Najważniejsze zmiany

- Command Center odświeża Anomaly Engine tylko po zmianie danych lub po wygaśnięciu cache, zamiast przy każdym wejściu.
- Project Health pokazuje konkretne potrącenia punktów oraz osobną wiarygodność danych finansowych.
- Finanse rozróżniają koszt przypisany, przychód przypisany, zobowiązania i pokrycie alokacją.
- Cash flow 13 tygodni ma scenariusz bazowy oraz ostrożny.
- Raporty mają atomowy generator snapshotu z agregacjami wykonywanymi po stronie PostgreSQL.
- Wyszukiwarka firmowa korzysta z indeksowanego Full Text Search i obejmuje inwestycje, dokumenty, faktury, pracowników, magazyn, flotę, BOQ i wiedzę firmy.
- E2E upload obejmuje dokument inwestycji i dokument firmowy bez projectId oraz sprząta dane i obiekty R2 po teście.
- Pełny validator uruchamia cały łańcuch 22 migracji oraz smoke testy finansów, magazynu, raportów, anomalii, wyszukiwania i Command Center.

## Bezpieczeństwo

AI nadal przygotowuje, klasyfikuje i sugeruje. Formalne odbiory, wyniki prób, zatwierdzenia dokumentów i operacje finansowe pozostają pod kontrolą człowieka.
