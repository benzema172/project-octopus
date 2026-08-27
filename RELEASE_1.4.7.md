# Project Octopus 1.4.7 — HR calendar day status

## Zakres
- rozszerzony kolorystycznie kalendarz miesięczny na Pulpicie Kadr,
- zielone oznaczenia pracy, niebieskie nieobecności, bursztynowe braki wpisu i czerwone konflikty,
- liczniki statusów bezpośrednio na kafelkach dni,
- kliknięcie dnia rozwija listę wszystkich pracowników,
- prosty układ: pracownik → miejsce/inwestycja → liczba godzin,
- miejsce pracy bierze najpierw faktyczny projekt z karty czasu, a przy jego braku planowane przypisanie,
- uwzględnienie zatwierdzonych urlopów/absencji,
- wykrywanie konfliktu „urlop + wpis czasu”,
- nadgodziny wliczone do sumy i pokazane osobno,
- brak nowych tabel i migracji — widok korzysta z istniejących danych Kadr.

## Regresja
Nie zmieniono istniejących formularzy pracowników, czasu pracy, urlopów, uprawnień, zespołów ani dokumentów. Górny rząd KPI pozostaje ukryty na Pulpicie zgodnie z 1.4.6.
