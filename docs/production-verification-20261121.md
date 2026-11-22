# Project Octopus — protokół wydania z 21 listopada 2026

Stan produkcji sprawdzono ponownie 22 listopada. GitHub main i główny adres Vercel wskazują ten sam [commit f2fa00e7ff01](https://github.com/benzema172/project-octopus/commit/f2fa00e7ff01ae70cb03387ba67bf40563872a1f). Zawiera on [wdrożenie paneli i powiązań źródłowych](https://github.com/benzema172/project-octopus/commit/63ea2bf16fa3f6843f0d6c8959fa02a24a893b11) oraz jeden późniejszy commit.

## Wyniki Octopusa

| Kontrola | Wynik |
|---|---|
| Przed zmianami | 11 120 testów zaliczonych. |
| Wydanie funkcjonalności z PR #234 | 11 138 testów i walidacja 239 migracji. Produkcyjne testy obiegu dokumentów, izolacji firm i inwestycji oraz jakości pól przeszły. |
| Aktualny commit produkcyjny | 11 145 testów zaliczonych, 240 migracji zwalidowanych. Typecheck i build przeszły. Lint zgłosił 0 błędów i 5 ostrzeżeń. |
| Interfejs | Na obu wydaniach przeszła kontrola pięciu widoków po zalogowaniu. Chrome rozwinął trzy panele i odczytał wiersze źródłowe bez poważnych błędów konsoli. Osobno sprawdzono pierwsze otwarcie w świeżej sesji. |
| Monitorowanie | Podczas końcowego testu wydania z PR #234, 21 listopada od 14:25:20 do 14:29:09 czasu polskiego, Vercel nie odnotował błędów wykonania. |

[CI aktualnego commitu](https://github.com/benzema172/project-octopus/actions/runs/44912944577) · [Produkcyjne E2E aktualnego commitu](https://github.com/benzema172/project-octopus/actions/runs/44912944537) · [E2E wydania funkcjonalności](https://github.com/benzema172/project-octopus/actions/runs/44908772912) · [Pierwsze otwarcie w Chrome](https://github.com/benzema172/project-octopus/actions/runs/44908270279/attempts/2)

## Przypadki sprawdzone na wydzielonej inwestycji

- **Kosztorys.** Rewizja R2 zmieniła wartość na właściwej kondygnacji i zachowała adres komórki E2 w arkuszu korekt. Niejednoznaczne dane wstrzymują publikację.
- **Harmonogram.** Z dwóch numerowanych pozycji powstały dwie propozycje oczekujące na decyzję. Propozycja dla WBS W2 wskazuje właściwy wiersz specyfikacji PDF.
- **Wnioski materiałowe.** Karta DN50 została powiązana z właściwym wariantem pozycji kosztorysowej.
- **Protokoły.** Pomiar 0,5 MPa z Worda spełnił wymóg co najmniej 5 bar dla właściwego odcinka. Pomiar bez jednostki pozostał do weryfikacji. Uwaga o nieodebraniu i odsyłacz z przypisu pozostały przy właściwym wierszu.
- **PDF wielodokumentowy.** Test rozdzielił kosztorys, harmonogram i protokół z zachowaniem oryginału.

## Poprawki i ograniczenia

Testy wcześniejszych wydań wykryły utratę odcinka i pominięcie całego wiersza PDF przez model oraz problem z pierwszym otwarciem panelu. Jedna wcześniejsza próba została przerwana po odpowiedzi HTTP 503 dostawcy Gemini. Wymagania testów zachowano. Bezpośredni odczyt jednoznacznych wierszy wymaga warstwy tekstowej PDF. Skany korzystają z dotychczasowej analizy. Wdrożenie nie przelicza automatycznie archiwum.

Metody i wyniki autorów pięciu źródeł oraz decyzje wdrożeniowe opisuje [rejestr badań i zmian](https://github.com/benzema172/project-octopus/blob/f2fa00e7ff01ae70cb03387ba67bf40563872a1f/docs/ai-improvements-log.md). Liczby w tym protokole opisują wyłącznie testy Octopusa.
