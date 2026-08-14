# Project Octopus 0.3.0 — analiza produktu i rekomendacje

Data analizy: 14 sierpnia 2026 r.

## Wniosek zarządczy

Project Octopus ma wyraźny sens jako system operacyjny firmy wykonawczej, pod warunkiem że nie stanie się zbiorem niezależnych zakładek. Jego wartość powstaje wtedy, gdy ten sam fakt źródłowy przepływa przez cały proces: dokument → inwestycja → kosztorys/WBS → harmonogram → materiały i robocizna → protokoły/wnioski → przerób → finanse → raport.

Najsilniejszym wyróżnikiem produktu powinny być trzy elementy:

1. **Project DNA** — uporządkowany, aktualny kontekst każdej budowy, tworzony z dokumentów i decyzji użytkowników.
2. **Kosztorys i WBS jako kręgosłup** — pozycje zakresu łączą terminy, wymagania formalne, materiały, koszty i zaawansowanie.
3. **Dowodowość AI** — każda istotna sugestia AI wskazuje dokument, wersję i miejsce źródłowe; wynik o niskiej pewności trafia do człowieka.

W tej wersji powstał szeroki fundament aplikacji i model danych. Kolejny etap powinien pogłębić jeden pełny proces inwestycyjny end-to-end, zamiast dodawać dalsze odseparowane moduły.

## Co zostało wprowadzone w 0.3.0

### Dokumenty, Wrzutnia i AI

- jedna Wrzutnia na pulpicie, w Dokumentach i wewnątrz inwestycji,
- dokument firmowy może istnieć bez przypisania do inwestycji,
- jeden plik fizyczny i wiele kontekstowych powiązań zamiast duplikatów,
- prywatne R2, metadane Supabase, wersjonowanie, kosz i przywracanie,
- automatyczne utworzenie intake oraz idempotentnego zadania analizy,
- ekstrakcja PDF/obrazu przez model oraz lokalna ekstrakcja DOCX, XLSX, ZIP i tekstu,
- strukturalny wynik AI: kategoria, podkategoria, pewność, streszczenie, etap, instalacja, wymagany protokół/wniosek, fakty i ostrzeżenia,
- rejestr klasyfikacji, ekstrakcji, zdarzeń audytowych i przyszłych akceptacji,
- wyszukiwanie i filtrowanie centralnej biblioteki dokumentów.

### Inwestycje

- pulpit portfela i rozbudowany pulpit konkretnej inwestycji,
- zwarte dane kontraktu, inwestora, lokalizacji i statusu,
- Dokumentacja, Kosztorys, Wnioski, Protokoły, Harmonogram, Przerób, Finanse, Zespół, Magazyn, Raporty i Brain,
- model danych BOQ/WBS, wymagań, wymaganych protokołów, baz harmonogramu, okresów przerobowych, zmian kontraktowych i źródeł.

### Firma

- Finanse: cash flow, budżety, zobowiązania, faktury, płatności i alokacje do inwestycji/WBS,
- Kadry: pracownicy, zatrudnienie, badania, kwalifikacje, urlopy, czas pracy, przydziały i wyposażenie,
- Magazyn: magazyny, kartoteki, ruchy, MM/WZ/PZ, rezerwacje, inwentaryzacje i serwis narzędzi,
- Flota: pojazdy, dokumenty, liczniki, paliwo, przejazdy, serwis, szkody i alokacja kosztów,
- Wzory: wersjonowane szablony, pola, reguły, uruchomienia generatora i dokumenty wynikowe,
- Raporty: definicje, uruchomienia, niezmienne migawki i przyszła dystrybucja,
- Ustawienia, role, akceptacje, zadania oraz audyt jako wspólny fundament.

## Ocena logiki produktu

### Co jest trafne

- Rozdzielenie dokumentu od jego powiązań usuwa duplikaty i problemy z aktualnością.
- Wersjonowanie pozwala ustalić, na jakiej rewizji oparto decyzję lub dokument wynikowy.
- Kosztorys/WBS daje wspólny identyfikator dla produkcji, zakupów, czasu pracy i finansów.
- Moduł Wzory buduje prywatną wiedzę firmy i stabilizuje jakość dokumentów formalnych.
- Oddzielenie analizy AI od zatwierdzenia zmniejsza ryzyko błędnej klasyfikacji lub wygenerowania nieprawidłowego dokumentu.
- Finanse pełnią rolę controllingu zarządczego i nie próbują zastępować księgowości ani płac.

### Najważniejsze ryzyka

1. **Szerokość bez głębokości.** Widoki i model obejmują całą firmę, lecz użytkownik odczuje wartość dopiero po domknięciu realnego procesu od kosztorysu do przerobu i dokumentów odbiorowych.
2. **Jakość źródeł.** Skan, błędny kosztorys lub nieaktualna rewizja może zanieczyścić Project DNA. Potrzebne są reguły ważności, supersedowania i konfliktów między źródłami.
3. **Skalowanie AI.** Bieżąca ścieżka analizuje mniejsze pliki na żądanie. Duże pliki, ponowienia i większy wolumen wymagają trwałego workera kolejki, limitów oraz monitoringu kosztów.
4. **Uprawnienia domenowe.** Dane kadrowe i finansowe muszą mieć węższy dostęp niż dokumentacja techniczna. Samo członkostwo w firmie nie wystarczy w produkcji.
5. **Granica odpowiedzialności AI.** Protokoły, wnioski, harmonogramy i dane finansowe muszą mieć właściciela, stan roboczy, akceptację i historię zmian.
6. **Integracje.** KSeF, bank, księgowość, GPS i system płacowy wymagają osobnych zakresów, uwierzytelnienia, mapowania danych i obsługi błędów; nie powinny być „ukryte” jako proste importy.

## Rekomendowany następny zakres — pion „Kosztorys do odbioru”

To powinien być kolejny przyrost produktu, ponieważ wykorzystuje dokumentację, AI i większość danych inwestycji jednocześnie.

1. Import XLSX/PDF kosztorysu do roboczej wersji BOQ.
2. Ekran mapowania kolumn, rozpoznanych działów i pozycji; zatwierdzenie przez użytkownika.
3. Utworzenie WBS oraz połączenie pozycji z dokumentacją projektową i STWiOR.
4. Wykrycie wymaganych materiałów, wniosków i protokołów dla każdego elementu zakresu.
5. Utworzenie bazowego harmonogramu z zależnościami i ograniczeniami terminu kontraktowego.
6. Rejestr pobrań magazynowych, faktur i czasu pracy przypisanych do pozycji/WBS.
7. Obmiar i przerób okresowy: ilość, procent, wartość, koszt, prognoza końcowa.
8. Generator wniosku materiałowego i protokołu robót zanikowych z wybranego wzoru oraz ze źródłami.

Kryterium sukcesu: kierownik wybiera pozycję kosztorysu i widzi jednocześnie dokument źródłowy, wymagania, materiały, terminy, dokumenty formalne, wykonanie i koszt.

## Dodatkowe funkcjonalności o największej wartości

### 1. Radar skutków zmiany

Po dodaniu nowej rewizji projektu AI pokazuje, które pozycje kosztorysu, terminy, zamówienia, wnioski i protokoły mogą wymagać aktualizacji. Użytkownik zatwierdza każdą zmianę oddzielnie.

### 2. Indeks kompletności dowodowej

Dla etapu/WBS system liczy nie „postęp AI”, lecz kompletność wymaganych dowodów: aktualny projekt, zatwierdzony materiał, odbiór, próba, zdjęcia, obmiar i podpis. Pozwala to uniknąć deklarowania przerobu bez dokumentacji.

### 3. Łańcuch materiału

Wniosek materiałowy → akceptacja → zamówienie/faktura → PZ → rezerwacja → WZ/MM na budowę → przypisanie do WBS → protokół/odbiór. Dzięki temu można ocenić dostępność, koszt i rzeczywiste zużycie.

### 4. Prognoza końca kontraktu

System łączy harmonogram, tempo przerobu, zobowiązania, materiały, czas pracy i zmiany zakresu. Wynikiem jest EAC kosztu, prognozowana data zakończenia i lista przyczyn odchylenia — zawsze z rozróżnieniem danych źródłowych od założeń.

### 5. Mobilna rejestracja z budowy

Zdjęcie, notatka głosowa, dostawa, obmiar lub odbiór są zapisywane na telefonie i przypinane do lokalizacji, WBS i daty. AI proponuje opis, ale użytkownik zatwierdza rekord.

### 6. Paczka zamknięcia inwestycji

Automatyczny wykaz braków i generator uporządkowanej dokumentacji powykonawczej: rewizje, deklaracje, karty materiałowe, próby, protokoły, zdjęcia, gwarancje i spis przekazania.

### 7. Pamięć organizacji

Po zamknięciu kontraktu zatwierdzone problemy, rozwiązania, wydajności i odchylenia trafiają do biblioteki wiedzy firmy. System może porównywać nową inwestycję z podobnymi, ale nie miesza danych bez wyraźnego uprawnienia i źródła.

## Kolejność wdrożeniowa

### Etap A — produkcyjne domknięcie fundamentu

- wdrożyć migrację 0.3.0 i wykonać test uploadu na środowisku,
- dodać worker kolejki, retry/dead-letter, OCR, koszt i monitoring AI,
- uruchomić skrzynkę przeglądu AI oraz wyszukiwanie semantyczne,
- wprowadzić role HR/Finanse/Inwestycje i pełne polityki zapisu.

### Etap B — kosztorys/WBS i dokumenty formalne

- wykonać pion „Kosztorys do odbioru”,
- zbudować edytor i walidator Wzorów,
- dodać generowanie DOCX/PDF oraz obieg akceptacji.

### Etap C — controlling i zasoby

- faktury PDF/KSeF, płatności, budżety i prognozy,
- magazyn, robocizna i flota rozliczane na WBS,
- cash flow przedsiębiorstwa oraz rentowność inwestycji.

### Etap D — automatyzacja i mobilność

- raporty cykliczne, alerty, mobilna budowa i paczka zamknięcia,
- radar skutków zmian oraz pamięć organizacji,
- testy odtwarzania, bezpieczeństwa i wydajności.

## Warunki jakości przed produkcją

- żadna liczba finansowa nie jest prezentowana jako rzeczywista bez źródła i okresu,
- żadna sugestia AI o niskiej pewności nie aktualizuje automatycznie danych podstawowych,
- dokument wynikowy pamięta wersje wszystkich źródeł i wzoru,
- usunięcie dokumentu jest odwracalne, a retencja i legal hold są respektowane,
- operacje na danych HR i finansach są audytowane i ograniczone rolą,
- kolejka AI jest idempotentna i nie tworzy podwójnych faktów ani kosztów,
- każda migracja, build oraz krytyczny przepływ uploadu mają test automatyczny.
