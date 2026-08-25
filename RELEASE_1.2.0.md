# Project Octopus 1.2.0 — BOQ / WBS Change Control

- Edytowalna wersja robocza BOQ bez nadpisywania zatwierdzonego baseline'u.
- Historia wersji `draft → review → approved → superseded` z atomową publikacją aktywnej projekcji.
- Stabilna genealogia pozycji BOQ zachowująca powiązania przerobu, faktur, magazynu i audytu.
- Porównanie pozycji i wartości: dodano, zmieniono, usunięto oraz wpływ netto.
- Edytor struktury WBS z branżą, instalacją, strefą, hierarchią i kodem kosztowym.
- Rejestr Change Order z wpływem na wartość i termin oraz kontrolowaną decyzją człowieka.
- Wycofane pozycje pozostają historyczne, ale nie zawyżają aktywnego BOQ, Autopilota, Kontroli 360 ani grafu kosztów.
- Operacje wielotabelowe są atomowe, audytowane i dostępne wyłącznie przez autoryzowany backend.
