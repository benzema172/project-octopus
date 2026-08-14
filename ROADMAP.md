# Project Octopus — roadmap po 0.4.0

## Zrealizowane w kodzie

- pełny model i widoki procesu dokument → BOQ/WBS → odbiór,
- kolejka AI, retry/dead-letter, Skrzynka AI i akceptacje,
- wyszukiwarka ze źródłami oraz pamięć organizacji,
- radar rewizji, kompletność dowodowa, forecast i paczka zamknięcia,
- mobilne zdarzenia z budowy,
- Wzory oraz kontrolowany generator szkicu,
- staging KSeF, role domenowe, integracje, alerty i dane operacyjne wszystkich modułów.

## Następny etap produkcyjny

1. Zastosować migrację i uruchomić test E2E na środowisku Supabase/R2/Gemini.
2. Podłączyć harmonogram wywołujący worker i monitoring jego kosztu/błędów.
3. Przeprowadzić testy na rzeczywistych: projekcie, STWiOR, kosztorysie XLSX, wzorze wniosku i protokole.
4. Dodać edycję wierszy kosztorysu przed zatwierdzeniem oraz graficzny Gantt.
5. Rozszerzyć generator o wierne wypełnianie DOCX oraz serwerowy eksport PDF.
6. Podłączyć autoryzowany KSeF inbound na środowisku testowym, następnie produkcyjnym.
7. Podłączyć wybrane systemy: bank/księgowość, karty paliwowe/GPS lub kadry-płace — każdą integrację jako osobny zakres.
8. Wykonać test uprawnień, retencji, odtwarzania backupu i wydajności większych inwestycji.

## Kryterium gotowości operacyjnej

Kierownik wybiera pozycję kosztorysu i widzi dokument źródłowy, WBS, wymagania, materiały, terminy, dokumenty formalne, wykonanie, dowody i koszt. Żadna sugestia AI nie zmienia zatwierdzonego zakresu bez zapisanej decyzji człowieka.

