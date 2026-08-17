# Project Octopus — plan ukończenia po 0.7.2

Stan na 17 sierpnia 2026 r. Roadmapa rozdziela funkcje działające od zaplanowanych. „Gotowe” oznacza pełny przepływ z zapisem, odczytem, uprawnieniami, audytem i testem — nie sam ekran lub tabelę.

## Działające w 0.7.2

| Obszar | Działający przepływ |
|---|---|
| Dokumenty | prywatny upload R2, serwerowe SHA-256 i magic bytes, kontrola PDF/Office/ZIP, kwarantanna, wersje, kosz, ekstrakcja, klasyfikacja i atomowa decyzja człowieka |
| Brain | zatwierdzone fakty, materiały, urządzenia, wyszukiwanie, asystent i pamięć firmy bez odrzuconych propozycji |
| Kosztorys | import AI → kontrola → atomowe BOQ/WBS → szkic harmonogramu, bez duplikatów po ponowieniu |
| Realizacja | ręczne wymagania, protokoły, zadania, okresy i ilości przerobu, zdarzenia z budowy oraz checklista zamknięcia |
| Firma | operacyjne formularze i rejestry Finansów, Kadr, Magazynu, Floty i Raportów |
| Uprawnienia | role domenowe i projektowe read/write/approve/admin, nadawanie, aktualizacja, odebranie i audyt |
| Wzory i Wyniki | zatwierdzony wzór → snapshot danych → podgląd → decyzja → jeden wersjonowany plik HTML w R2 → pobieranie |
| Monitoring | health endpoint, opóźnienie kolejki, heartbeat, automatyczne odzyskanie zawieszonego zadania, dead-letter, tokeny i koszt konfigurowany stawkami modelu |
| Kontrola jakości | testy jednostkowe i transakcyjne, pełny replay migracji, typecheck, lint i produkcyjny build |

## P0 — konieczne przed danymi produkcyjnymi

1. Wdrożyć migracje do `20260817130000_upload_security_and_atomic_document_review.sql` i potwierdzić marker `20260817_upload_security_and_atomic_document_review`.
2. Wykonać E2E na docelowych Supabase/R2/Gemini: PDF, DOCX, XLSX, ponowienie, akceptacja, odrzucenie, nowa rewizja i pobranie wyniku.
3. Przetestować macierz ról na osobnych kontach: właściciel, finanse, HR, kierownik, magazyn, flota i obserwator; zakres firmy oraz jednej inwestycji.
4. Podłączyć zewnętrzny silnik antymalware/CDR do plików produkcyjnych. Wbudowana kontrola 0.7.2 odrzuca niezgodne sygnatury, aktywne PDF, zip-bomby, traversal, makra oraz pliki wykonywalne, ale nie zastępuje aktualizowanej bazy sygnatur wirusów.

Kryterium: kontrolowany test nie ujawnia danych między domenami, odrzucona rewizja nie zasila Brain, a awaria integracji jest widoczna jako błąd.

## P1 — pełna codzienna praca projektu

1. Edytor wierszy importu BOQ przed akceptacją: błędy, jednostki, ceny, podział i łączenie pozycji.
2. Harmonogram baseline/bieżący/lookahead z zależnościami, kalendarzem, gotowością i widokiem Gantta.
3. Wnioski materiałowe jako dokument: dossier produktu, porównanie ze STWiOR, załączniki, obieg wysłany/uwagi/zatwierdzony.
4. Protokoły jako rekord wykonania: formularz wyniku, pomiary, zdjęcia, osoby, podpisy i dowody wymagane przez BOQ/WBS.
5. Łańcuch materiału need → application → order → delivery → issue → consume → variance, z blokadą ruchu bez zatwierdzenia.
6. Przerób wykonany/odebrany/zafakturowany/zapłacony oraz zamknięcie okresu z korektą i historią.
7. Rejestr korespondencji i transmittali: numer, strony, rewizja, termin odpowiedzi, obowiązująca wersja i retencja.

Kryterium: kierownik otwiera pozycję BOQ i przechodzi do źródła, WBS, zadania, materiału, protokołu, postępu i kosztu bez ręcznego przepisywania.

## P2 — controlling całej firmy

1. Finanse: 13-tygodniowy cash flow, aging, uzgodnienie faktura–zamówienie–PZ/protokół i wynik WBS.
2. KSeF: autoryzowany test inbound, deduplikacja, dekretacja, UPO; sprzedaż dopiero po testach zakupów.
3. Kadry: kalendarz terminów, matryca kwalifikacja–zadanie, plan obciążenia brygad i zatwierdzony koszt WBS.
4. Magazyn: inwentaryzacja, lokalizacje, partie/serie, metoda wyceny i zatwierdzane korekty.
5. Flota: wydania kierowcom, import kart paliwowych/GPS, anomalie spalania, koszt postoju i koszt projektu.
6. Raporty: tygodniowy budowy, miesięczny kontraktu, cash flow, kompletność odbiorowa i portfel ryzyk z dystrybucją.

Kryterium: każde KPI ma definicję, datę, właściciela i link do rekordu źródłowego; snapshot pozostaje niezmienny po późniejszej korekcie danych.

## P3 — przewaga AI i skala SaaS

1. Zbiór ewaluacyjny i metryki dla klasyfikacji, BOQ, faktur, materiałów, urządzeń i dokumentów wynikowych.
2. Konflikty Project DNA: hierarchia źródeł, data obowiązywania, sprzeczne rewizje i jawna decyzja.
3. Wierne wypełnianie DOCX, serwerowy PDF, różnice wersji wzoru i dwuosobowa akceptacja dokumentów formalnych.
4. Anomalie przekrojowe: duplikat faktury, materiał bez wniosku, przerób bez dowodu, czas bez obsady, paliwo poza trasą.
5. Multi-tenant billing, limity, eksport/retencja danych, SSO/MFA, obserwowalność i plan odtwarzania awaryjnego.

## Definicja ukończenia funkcji

- ma realną akcję i stan pusty, walidację wejścia oraz czytelny błąd,
- respektuje rolę i zakres inwestycji w UI, API i RLS,
- złożona decyzja jest atomowa lub bezpiecznie idempotentna,
- zachowuje autora, czas, źródło, wersję i audyt,
- ma test sukcesu, odmowy dostępu, ponowienia i błędu,
- dokument lub liczba wygenerowana przez AI pozostaje propozycją do zatwierdzenia.
