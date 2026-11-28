# Weryfikacja produkcyjna 28 listopada 2026

Wydanie `4747f5691841b97eeec336fa99d89ec038dbdc50`, PR [#241](https://github.com/benzema172/project-octopus/pull/241), Vercel `dpl_B1gr4Lw9qrhfpV2MDuVjntii3GXC`. Alias aplikacji i strona główna potwierdziły ten sam commit. Kod wydania ma identyczne drzewo Git jak sprawdzone zmiany na gałęzi PR. Źródła i decyzje opisuje [rejestr](./ai-improvements-log.md).

Przed wdrożeniem na bazowym commicie przeszło 11 149 testów. Trzy nowe przypadki odtworzyły usterki. Po poprawce przeszło 11 152 testów, walidacja pełnego łańcucha 240 migracji, typecheck, lint (5 ostrzeżeń, 0 błędów), build, kontrole stabilności i higieny. Audyt pakietów produkcyjnych zgłosił 0 podatności. Nie stosowano migracji.

[CI wydania](https://github.com/benzema172/project-octopus/actions/runs/46120500121) i [produkcyjne E2E](https://github.com/benzema172/project-octopus/actions/runs/46120500142) zakończyły się powodzeniem. Audyt obiegu plików i izolacji korzystał z wydzielonych danych. W arkuszu zachowano −1250 PLN w F5 oraz −12 EUR w F6, a kosztorys skierowano do weryfikacji. W DOCX odczytano ≤ 5 bar obok grafiki w uwadze dla OCT-OTHER, tabela 1, wiersz 2. W dwóch wersjach PDF zachowano pozycję 2, ilość 1 pc i daty 10–12 listopada. Zakresy oryginału wynosiły odpowiednio 1/2/3 oraz 1–2/3–4/5. Sumy kontrolne oryginałów pozostały zgodne.

Sprawdzono pięć zalogowanych widoków oraz trzy rozwinięte panele źródłowe w Chrome. Brak poważnych błędów przeglądarki w testowanych scenariuszach. Dla tego wdrożenia Vercel nie zwrócił wpisów error ani fatal w przedziale 07:07:34–07:22:34 UTC. Wyniki dotyczą wskazanych plików testowych i okna obserwacji.
