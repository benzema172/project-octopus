# Project Octopus — Investment Autopilot

## Cel

Moduł Inwestycje staje się operacyjnym rdzeniem Project Octopus: dokumentacja i kosztorys są źródłem prawdy, Brain buduje Project DNA, Mission Engine ustala obowiązki, Autopilot wykonuje bezpieczne czynności biurowe, a Change Radar oraz Control 360° pilnują zmian i zgodności realizacji.

## Wprowadzone elementy

- **Mission Engine** — dynamiczna lista działań z właścicielem: Octopus AI, decyzja człowieka albo czynność na budowie; priorytetem, blokadą, źródłem oraz następnym krokiem.
- **Investment Autopilot** — idempotentne przygotowywanie szkiców wniosków materiałowych, protokołów i etapów harmonogramu z istniejących wymagań. Autopilot nie generuje wyniku fizycznej próby ani podpisów.
- **Automatyczne uruchomienie po analizie dokumentu** — po poprawnym przetworzeniu kolejnego pliku Brain uruchamia bezpieczną synchronizację Autopilota. Niepowodzenie Autopilota nie unieważnia poprawnie przeanalizowanego dokumentu.
- **Unieważnianie nieaktualnych szkiców** — szkice wygenerowane ze źródeł, które przestały obowiązywać po nowej rewizji, otrzymują status `superseded`.
- **Change Radar 2.0** — każda proponowana zmiana dokumentacji otrzymuje listę konsekwencji dla WBS, BOQ, harmonogramu, materiałów, wniosków, protokołów i kontroli wykonania.
- **Matryca instalacji** — widok gotowości instalacji łączący Project DNA, WBS, BOQ, materiały/urządzenia, WM, harmonogram, protokoły i dowody.
- **Project Health + Następny krok** — wyliczany stan inwestycji oraz zwarty pasek Autopilota dostępny w całym workspace inwestycji.
- **Genealogia danych** — kontrola pokrycia faktów źródłami i widoczność jakości Project DNA.
- **Lokalne decyzje AI** — decyzje ze Skrzynki AI filtrowane do aktualnej inwestycji.
- **Reconciliation** — pierwsza warstwa kontroli `Projekt ↔ BOQ ↔ faktury ↔ WZ/MM`: sprzedaż kontra odebrany przerób, pozycje zakupowe kontra wiedza inwestycji, ruchy magazynowe kontra materiały/urządzenia/BOQ oraz integralność ilości BOQ.
- **Pełniejsze środowisko demo** — 13 inwestycji, 20 pracowników, 10 pojazdów, 5 magazynów, 50 faktur, 60+ dokumentów, 88 pozycji BOQ i 70 aktywności harmonogramu, w tym przetarg, budowa wstrzymana i kilka aktywnych kontraktów.

## Zasada bezpieczeństwa

Octopus może automatycznie klasyfikować, analizować, wyliczać, tworzyć checklisty i szkice oraz unieważniać własne niezatwierdzone szkice. Wynik próby, faktyczne wykonanie robót, podpis, formalna akceptacja materiału, zatwierdzenie zmiany BOQ/kontraktu i operacje finansowe pozostają decyzją człowieka.

## Następny etap danych

Reconciliation jest gotowy na rozszerzenie o semantyczne dopasowanie pozycji faktur i WZ/MM do konkretnych pozycji BOQ/material master oraz o reguły ilościowo-cenowe. Obecna warstwa korzysta już z istniejących alokacji finansowych i ruchów magazynowych, dzięki czemu nie tworzy równoległego silosu danych.
