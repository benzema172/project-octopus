# Project Octopus — rejestr ulepszeń z publikacji

## 2026-11-14 — dokładność pól i tożsamość źródła po deduplikacji

Punkt wyjścia: aktualny `main` i produkcja `7dd4b789d3c810781e6a2def1a1c55ba165980af`.
Wcześniejsze wdrożenie opisuje [kontrola pól z 8 listopada](document-quality-20261108.md).

### Dostępny raport i źródła

Sprawdzono historię przeglądu „AI dla Project Octopus”. Uruchomienie z 13 listopada
nie udostępnia nowego tekstu raportu; ostatni dostępny wynik pochodzi z 6 listopada.
Nie przypisano starszego wyniku do 13 listopada i nie uznano tego za dowód, że nie
ukazały się nowe publikacje. Dodatkowe wyszukanie wcześniejszego kontekstu nie
odnalazło raportu Octopusa z 13 listopada. Poniższe pierwotne źródła zweryfikowano
ponownie w ACL Anthology 14 listopada. Wszystkie mają datę publikacji: październik 2026.

| Publikacja i źródło pierwotne | Metoda autorów i ograniczenia | Decyzja dotycząca Octopusa |
| --- | --- | --- |
| [Perception, Layout, and Validation: Calibrated Confidence for Reliable Straight-Through Processing of Financial Documents](https://aclanthology.org/2026.docinsights-1.17/) | Sygnały odczytu, układu i walidacji oraz conformal risk control. Badania dokumentów finansowych nie kalibrują ryzyka na polskich dokumentach Octopusa. | Pozostaje deterministyczna kontrola źródeł i spójności. Brak własnego zbioru kalibracyjnego wyklucza deklarację statystycznej gwarancji. |
| [Silent Structured-Content Corruption in Document Parsing: A Span-Typed Diagnostic and a Released Cross-Parser Resource](https://aclanthology.org/2026.docinsights-1.19/) | Diagnostyka zachowania typowanych fragmentów, m.in. liczb, dat i identyfikatorów. Ogólne podobieństwo tekstu nie wystarcza. Korpus nie stanowi odbioru dokumentacji budowlanej Octopusa. | Własna poprawka opisana poniżej: porównanie całych wartości, zachowanie znaków liczb oraz jednoznaczne powiązanie oceny z wierszem źródłowym. |
| [Splitting Documents at Lower Cost: Multi-Split Boundary Decisions for LLM-Based Page Stream Segmentation](https://aclanthology.org/2026.docinsights-1.3/) | Kilka granic dokumentów w jednym oknie stron. Dobór wielkości okna zależy od modelu i korpusu; metoda sama nie klasyfikuje ani nie usuwa duplikatów. | Podział PDF z nakładaniem okien i zachowaniem oryginału działa od 8 listopada. Nie zmieniono parametrów bez nowych pomiarów. |
| [Look Where It Matters: High-Resolution Crops Retrieval for Efficient VLMs](https://aclanthology.org/2026.docinsights-1.25/) | Trenowany wybór wycinków o wysokiej rozdzielczości. Samo przycinanie z istniejącym modelem nie odtwarza wyników AwaRes. | Pozostaje ograniczony drugi odczyt wycinka z nagłówkiem. Wspólne zasady interpretacji liczb obejmują teraz również porównanie drugiego odczytu. |

### Własne ustalenia i wdrożone poprawki

1. Stary warunek podciągu mógł uznać `m` za potwierdzone przez `cm`, `m²` lub `m/s`,
   a `FV/1` przez `FV/10`. Nowa kontrola sprawdza granice całego fragmentu.
   Obsługuje też jednoznaczne polskie daty z nieuzupełnionym zerem, np. `1.11.2026`.
2. Usuwanie znaków z komórki mogło zmienić `−10` lub `(10)` w dodatnie `10`.
   Natywny parser zachowuje minus typograficzny i zapis księgowy w nawiasach,
   rozpoznaje pełne grupowane liczby `1.234,56` / `1,234.56` i zapis wykładniczy.
   Nie przerabia dowolnego tekstu, np. `0 nieczytelne`, w potwierdzone zero.
   Oryginalny cytat i fizyczna komórka pozostają zapisane w dowodzie.
3. Absolutna tolerancja `0.000001` mogła uznać małą niezerową ilość za zero.
   Zastąpiono ją porównaniem dopuszczającym jedynie względny błąd reprezentacji
   zmiennoprzecinkowej. Kontrole arytmetyki i zaokrągleń biznesowych pozostają osobne.
4. Zwycięzca deduplikacji z identycznymi wartościami, ale innym lub brakującym
   dowodem, mógł odziedziczyć ocenę pierwszego wiersza. Propozycje faktów, BOQ,
   harmonogramu, przerobów i wymagań protokołów niosą teraz `source_locator.analysisPath`.
   Wskaźnik powstaje przed deduplikacją, a ocena wskazuje wiersz jej zwycięzcy. Nieprawidłowy
   wskaźnik i niejednoznaczny stary format wymagają kontroli.
5. Wiersz przerobów z zerowymi, pustymi lub nieczytelnymi ilościami nie znika już
   z ekstrakcji natywnej. Poprawne zero zachowuje dowód, a brak wartości trafia do
   weryfikacji zamiast ustępować miejsca odpowiedzi modelu.

Są to poprawki wykryte w kodzie Octopusa, a nie wyniki eksperymentów autorów.
Nie dodano drugiego obiegu dokumentów, zależności, usług ani zmiany planu rozliczeń.
Raport i propozycje zachowują kompatybilny `field-quality-v1`, z identyfikatorem
reguł `typed-spans-20261114`. Nie była potrzebna migracja schematu bazy.
Istniejący trigger kontroli publikacji działa na produkcji.

### Weryfikacja przed publikacją

- Baza przed zmianą: 217 plików / 11 087 testów — poprawnie.
- Odtworzenie luk: 25 z pierwszych 28 nowych przypadków nie przechodziło starego kodu.
  Dodatkowe 3 przypadki przerobów potwierdziły znikanie wierszy.
- Po poprawce: 33 nowe przypadki; razem z wcześniejszą kontrolą pól 55 testów — poprawnie.
- Pełny zestaw po ostatniej zmianie: 218 plików / 11 120 testów — poprawnie.
- Zdiagnozowano też graniczny czas rozruchu PGlite: test izolowany przechodził w 4,85 s,
  a w pełnym zestawie przekraczał domyślne 5 s. Rozruch silnika WASM przeniesiono do
  `beforeAll` z osobnym budżetem 30 s. Wszystkie asercje blokad i uprawnień pozostają,
  a właściwy test zachowuje dotychczasowy limit 5 s; nie pominięto żadnego sprawdzenia.
- Typecheck i kompilacja aplikacji — poprawnie; pełny `npm run build` obejmujący
  także zestawy HR i przepływu dokumentów również wykonano.
- Lint: 0 błędów, 5 istniejących wcześniej ostrzeżeń poza zmienianym kodem.
- Łańcuch 238 migracji — poprawnie. `npm audit --omit=dev --audit-level=high`: 0 podatności.
- Kontrole stabilności, porządku repozytorium i składni skryptu E2E — poprawnie.

### Scenariusze produkcyjne i granice

Rozszerzony `scripts/e2e-document-quality.mjs` sprawdza prawdziwe R2, Gemini i
Supabase w istniejącym wydzielonym projekcie gościa. Oprócz poprawnego/błędnego
kosztorysu i mieszanego PDF sprawdza teraz ujemne i grupowane wartości, nieczytelne
komórki BOQ i przerobów, blokadę publikacji oraz identyfikator źródłowego wiersza.
Sprawdza też aktualną wersję reguł, aby nie zaliczyć raportu ze starej ekstrakcji.

Potwierdzone wdrożenie funkcjonalne:
[`07499c4cfdfb33408e002c58c84cd8a5f330c9da`](https://github.com/benzema172/project-octopus/commit/07499c4cfdfb33408e002c58c84cd8a5f330c9da).

| Kontrola po publikacji | Potwierdzony wynik 14 listopada |
| --- | --- |
| [CI](https://github.com/benzema172/project-octopus/actions/runs/43573202683) | Sukces: 218 plików, 11 120 testów; 238 migracji; typecheck; build; 0 podatności; lint 0 błędów / 5 wcześniejszych ostrzeżeń. |
| Produkcja Vercel | READY; alias `project-octopus-alpha.vercel.app` wskazywał commit `07499c4`; skrypt oczekiwania niezależnie potwierdził ten sam commit w aplikacji. |
| [Testy produkcyjne E2E](https://github.com/benzema172/project-octopus/actions/runs/43573202710) | Wszystkie trzy kroki poprawne: integracja, tenant isolation / IDOR, kontrola pól i PDF. |
| Poprawny XLSX | Wartość potwierdzona z komórki F3; raport zawiera 6 pól. |
| Błędny XLSX | Rozbieżność F3, wymagane sprawdzenie; brak publikacji błędnej pozycji. |
| XLSX ze znakami i separatorami | `quantity=-10`, `total=-200`, druga wartość `2469.12`; zachowane komórki; nieczytelny wiersz BOQ wstrzymany; `analysisPath` obecny w propozycjach. |
| Nieczytelny przerób | Wiersz zachowany, komórka C2 skierowana do kontroli, propozycja nieopublikowana. |
| Mieszany PDF | Trzy dokumenty potomne rozpoznane jako `estimate`, `schedule`, `protocol`; oryginał zachował SHA-256 i powiązania źródłowe. |
| Kontrola widoków | Zalogowany pulpit firmy, inwestycja, archiwum, filtr kategorii i otwarcie panelu źródeł; brak błędów aplikacji w konsoli. Dokumenty historyczne bez raportu nadal poprawnie udostępniają oryginał. |
| Logi uruchomieniowe | Brak wpisów `error` / `fatal` nowego wdrożenia w sprawdzonym oknie 07:43–07:58 UTC obejmującym E2E. |

Uzupełnienie tego rejestru po testach nie zmienia kodu aplikacji. Historyczne
wyniki powyżej odnoszą się do wskazanego wdrożenia funkcjonalnego.

Reguły obejmują nowe i ponownie analizowane pliki; nie przepisywano historycznych
decyzji ani danych użytkowników. Pojedynczy separator `,` lub `.` oznacza część
dziesiętną; dokumenty o niejednoznacznej konwencji liczb wymagają sprawdzenia.
Nie przeliczano formuł bez zapisanej wartości. Poprawny zapis liczby nie potwierdza
jej znaczenia biznesowego, wykonania robót ani podpisu protokołu. Testy syntetyczne
nie stanowią gwarancji poprawności wszystkich rzeczywistych dokumentów.

## 21 listopada 2026 — raport z 20 listopada

Punkt wyjścia: `b5abd4a`. Zmiany działają na nowych i ponownie analizowanych wersjach. Panel inwestycji odczytuje aktualne, dostępne dla niej źródła na żądanie. Nie ma migracji ani dodatkowego płatnego API.

| Źródło | Wynik lub ograniczenie autorów | Zastosowanie w Octopusie |
| --- | --- | --- |
| [Mihić i Vilibić, Buildings, 16.11](https://doi.org/10.3390/buildings16224570) | 90 map z dziesięciu przetargów. Większa liczba kroków nie rozstrzyga o poprawności harmonogramu. | Numerowane pozycje przedmiaru dają propozycje bez dat. Porównanie kodów z zatwierdzonym dokumentem harmonogramu i punktów zatwierdzonej specyfikacji. |
| [Buecheler i in., arXiv, 18.11](https://arxiv.org/abs/2611.24998) | Wypełnianie paszportów produktów z dokumentacji. Poprawność składni JSON wyniosła 97,4%, a pól 30,8% w ocenie deterministycznej. | Dopasowanie karty do źródłowej pozycji tylko przy zgodnym kodzie, wariancie i jednostce. Wiele kandydatów wymaga decyzji użytkownika. |
| [Garre i in., arXiv, 13.11](https://arxiv.org/abs/2611.17766) | 41 z 70 zadań wymagało pracy między zakładkami. Wynik całości nie stanowi miary dla kosztorysów Octopusa. | Zakładka Korekta/Korekty/Corrections, identyfikator pozycji, WBS lub kondygnacja, kontrola kolejności rewizji i fizycznej komórki. Nierozstrzygnięte zmiany wstrzymują automatyczną publikację BOQ. |
| [Lee i in., Buildings, 16.11](https://doi.org/10.3390/buildings16224562) | Wykonywalne progi badano m.in. na 67 sztucznych przypadkach. | Porównanie ciśnienia próby i spadku ciśnienia z jednym właściwym punktem bieżącej zatwierdzonej specyfikacji. Obsługiwane Pa, kPa, MPa i bar. Wynik nie zatwierdza protokołu. |
| [Docling v2.150.1, 14.11](https://github.com/docling-project/docling/releases/tag/v2.150.1) | Poprawki struktury tabel Word i adresów odsyłaczy w przypisach. | Odczyt DOCX w istniejącym procesie Node, zachowanie uwagi, właściwego wiersza i linku w przypisie. Bez serwisu Docling. |

Kontrole przed publikacją: poprzednia wersja 11 120 poprawnych testów; nowa 11 126, w tym sześć nowych scenariuszy z przypadkami granicznymi. Walidacja 238 migracji. Aktualizacja Next.js i konfiguracji lint z 16.4.3 do 16.4.6 usuwała wykryte ostrzeżenie audytu zależności i blokadę wcześniejszego buildu. Scenariusz produkcyjny jest częścią `scripts/e2e-document-quality.mjs` i korzysta z wydzielonej inwestycji gościa. Wynik każdego wykonania przechowuje GitHub Actions w przebiegu powiązanym z konkretnym SHA.

### Weryfikacja na produkcji 21 listopada 2026

Pierwsze wydanie z [PR #230](https://github.com/benzema172/project-octopus/pull/230) przeszło pełne CI, audyt obiegu plików i testy izolacji. W [teście rzeczywistych źródeł](https://github.com/benzema172/project-octopus/actions/runs/44881333535) odczytano 0,5 MPa z tabeli Word. Identyfikator odcinka w PDF pozostał w osobnej komórce cytatu, mimo że model opuścił pole odcinka. Z tego powodu system skierował pomiar do weryfikacji. Na czas poprawki przywrócono produkcyjny commit `b5abd4a`. Wycofanie dotyczyło wersji aplikacji.

Poprawka paruje odcinek z wierszem zatwierdzonej specyfikacji tylko przy zgodnym punkcie, rodzaju pomiaru i samodzielnych komórkach cytatu. Ten sam próg może się powtórzyć obok numeru przedmiaru lub WBS, oba miejsca pozostają widoczne. Inny próg, druga specyfikacja, niezgodny odcinek lub brak jednostki wymagają weryfikacji. Regresja została odtworzona z danych wydzielonej inwestycji. Skrypt produkcyjny sprawdza również pięć zalogowanych widoków na konkretnym SHA. Każdy wynik wydania jest powiązany ze scalonym commitem w [przebiegach produkcyjnych](https://github.com/benzema172/project-octopus/actions/workflows/e2e-staging.yml).
