# Project Octopus — audyt UI/layout 2026-08-20

## Cel

Audyt dotyczy zalogowanej aplikacji Project Octopus i problemów zgłoszonych w działających modułach: nachodzenie tekstu, ściskanie wartości, sztywne wysokości, nadmiarowa pusta przestrzeń, niespójne odstępy oraz różne zachowanie starszych i nowszych komponentów.

## Zidentyfikowane przyczyny

1. Równoległe systemy klas UI. Nowsze moduły używają `ops-metrics` / `ops-metric`, a starszy Enterprise Flow używa `ops-metrics-grid` / `ops-metric-card` / `ops-disclosure`. Starsze karty nie miały kompletnego kontraktu grid/overflow.
2. `content-visibility:auto` z `contain-intrinsic-size:auto 220px` rezerwował sztuczną wysokość paneli. W interaktywnym workspace dawało to duże puste prostokąty i skoki wysokości.
3. W wielu kartach zachowały się wysokości z etapu makietowego, m.in. 105–150 px oraz 280 px, mimo że treść nie wymagała takiej przestrzeni.
4. Część gridów i flexów nie miała pełnego `min-width:0`, przez co długie etykiety, kwoty, nazwy i statusy mogły wypychać sąsiednie kolumny.
5. Puste sekcje danych były renderowane jak pełne panele, mimo że nie zawierały rekordów.
6. CSS ładowany jest warstwowo: globalny workspace, style modułowe oraz style stron inwestycji. Audyt musi więc stabilizować zarówno wspólny system, jak i źródłowe arkusze podstron/CSS Modules.

## Zakres sprawdzenia

Przejrzano główne arkusze zalogowanego workspace i ich zależności: `octopus-app.css`, `octopus-1-release.css`, `ux-system.css`, `workspace-experience.css`, `finance-compact.css`, `project-workspace-v2.css`, `project-dashboard-combined.css`, `project-dashboard-compact.css`, `project-dashboard-layout-refinement.css`, `project-modules-operational.css`, `project-intake.css`, `investments-refinement.css`, `brain-knowledge.css`, a także CSS Modules dla zaawansowanych narzędzi firmy i Autopilota inwestycji.

Sprawdzono główne rodziny widoków: firma i moduły operacyjne, Finanse + Enterprise Flow/Business Inbox, Inwestycje, dashboard inwestycji, moduły inwestycji, Brain, listy, KPI, formularze, disclosure/details, tabele i układy responsywne.

## Wprowadzone reguły

- Jednolity kontrakt `min-width:0` dla głównych dzieci grid/flex.
- Wyłączenie sztucznej rezerwacji 220 px na interaktywnych panelach.
- Usunięcie lub istotne zmniejszenie dekoracyjnych `min-height` tam, gdzie treść powinna wyznaczać wysokość.
- Enterprise Flow: jawny grid KPI `ikona | etykieta | wartość` + osobny wiersz opisu, bez kolizji tekstu.
- Formularze: desktop 4 kolumny, potem 2 i 1 w zależności od szerokości.
- Nagłówki/details: jawne kolumny, bez nachodzenia licznika i tytułu; na mobile licznik przechodzi do kolejnego wiersza.
- Kompaktowe panele/listy/empty-state, krótsze pionowe odstępy.
- Finanse: pusta sekcja „Najbliższe zobowiązania” nie jest renderowana bez rekordów.
- Inwestycje: wiersze portfela zredukowane z 92 do 72 px i mają bardziej zwarte paddingi/gapy.
- Dashboard/moduły inwestycji: redukcja historycznych wysokości m.in. 105 → 76, 96 → 74, 126 → 68, 150 → 102, 86 → 66; karta operacyjna nie trzyma już 280 px pustej przestrzeni.
- Brain: karty wiedzy 82 → 68 px i bardziej kompaktowe listy faktów z bezpiecznym zawijaniem.
- „Więcej narzędzi”: osobny CSS Module został skompaktowany u źródła; nie polega na globalnych selektorach.
- Układy mobilne przechodzą na 2/1 kolumnę zanim pojawi się kolizja treści.

## Celowo zachowane przestrzenie

Nie usuwano przestrzeni, która pełni funkcję użytkową: obszarów dropzone wymagających wygodnego drag&drop, poziomego scrolla dużych tabel, minimalnych pól formularzy potrzebnych do obsługi dotykowej oraz czytelnych przerw między logicznymi sekcjami. Celem jest gęstszy interfejs bez pogorszenia użyteczności.

## Ochrona regresyjna

`tests/layout-density-audit.test.ts` pilnuje m.in. kolejności warstw CSS, usunięcia rezerwacji 220 px, Enterprise Flow KPI, responsywnych formularzy/disclosure, redukcji największych wysokości projektu, kompaktowych Inwestycji/Brain/CSS Modules oraz warunkowego renderowania pustych zobowiązań.

## Kryterium wdrożenia

Zmiana może trafić na produkcję dopiero po zielonym pełnym CI: dependency audit, stability contract, TypeScript, unit tests, migration contract, lint i production build. Po merge wymagane jest potwierdzenie produkcyjnego deploymentu READY, aktywnego aliasu oraz braku świeżych błędów runtime związanych z wdrożeniem.
