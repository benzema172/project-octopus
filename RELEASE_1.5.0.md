# Project Octopus 1.5.0 — kontrola wynagrodzeń i kosztu pracodawcy

## Kadry — wynagrodzenie i pełny koszt firmy

- formularz pracownika rozdziela wypłatę netto, wynagrodzenie brutto, składki pracodawcy / ZUS i pozostałe koszty,
- pełny koszt pracodawcy oraz pełny koszt roboczogodziny są liczone automatycznie,
- karta pracownika pokazuje aktualne wartości, strukturę kosztu i historię warunków zatrudnienia,
- starsze rekordy `monthly_cost` pozostają zgodne i są prezentowane jako pełny koszt bez rozbicia.

## Miesięczne rozliczenia

- nowa ewidencja `employee_payroll_months` przechowuje rzeczywiste rozliczenia pracownika dla danego miesiąca,
- statusy rozliczenia: `Planowane`, `Potwierdzone`, `Wypłacone`,
- pulpit Kadr pokazuje wypłaty netto, składki i inne koszty, pełny koszt zatrudnienia oraz koszt przypisany i nieprzypisany do inwestycji,
- raport CSV zawiera rozbicie kosztów wyłącznie dla użytkowników uprawnionych do danych płacowych.

## Dostęp i audyt

- dane płacowe w aplikacji są dostępne dla właściciela, administratora oraz odpowiednich uprawnień Kadry/Finanse,
- zapis rozliczenia i zmiana jego statusu tworzą zdarzenie audytowe,
- migracja zachowuje poprzedni kontrakt funkcji tworzenia okresu zatrudnienia.
