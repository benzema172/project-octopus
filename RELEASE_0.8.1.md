# Project Octopus 0.8.1

Wersja 0.8.1 rozszerza Wrzutnię o rzeczywistą obsługę starszych formatów Microsoft Office: DOC i XLS.

## Wrzutnia
- rozszerzenia `.doc` i `.xls` są dostępne w wyborze plików oraz drag & drop,
- walidacja akceptuje standardowe MIME `application/msword` oraz `application/vnd.ms-excel`, a także typowe identyfikatory kontenera OLE/CFB,
- zachowany jest limit 50 MB i kontrola zgodności rozszerzenia z MIME.

## Ekstrakcja
- DOC (Word 97–2003): serwerowa ekstrakcja treści, nagłówków, stopek, przypisów, komentarzy i pól tekstowych,
- XLS (Excel 97–2003): odczyt arkuszy, wierszy i komórek z binarnego formatu BIFF/OLE,
- wyodrębniony tekst trafia do istniejącego pipeline Gemini, klasyfikacji dokumentu, Project DNA / Brain i modułów operacyjnych.

## Testy
- regresja walidacji DOC/XLS,
- test faktycznego odczytu wygenerowanego skoroszytu BIFF8 `.xls`,
- kontrola podłączenia parserów do pipeline dokumentów,
- pełny CI: TypeScript, Vitest, migracje, ESLint i produkcyjny build Next.js.

Zmiana nie wymaga migracji bazy danych.
