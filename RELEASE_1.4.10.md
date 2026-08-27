# Project Octopus 1.4.10 — HR employee list regression fix

Data: 27.08.2026

## Problem

Po dodaniu wrappera kalendarza w 1.4.6 style listy pracowników z 1.4.1 nadal były w repo, ale przestały trafiać w aktualną strukturę DOM. W efekcie wizualnie wrócił starszy widok zakładki „Pracownicy”.

## Naprawa

- przywrócony kompaktowy przycisk `+ Dodaj pracownika` po prawej,
- przywrócona kolumna `LP.` numerowana od 1 dla aktualnie filtrowanych wierszy,
- ukryty techniczny numer pracownika spod nazwiska,
- przywrócone pionowe separatory, padding i hover tabeli,
- dodany stabilny `data-hr-workspace-slot` do wrappera Kadr,
- nowe selektory nie zależą od liczby wrapperów kalendarza,
- brak zmian w danych, API, logice HR i migracjach.

## Regresja

Dodany test pilnuje, że styl 1.4.1 pozostaje podłączony również przy obecnym wrapperze 1.4.7+ i że LP/przycisk/ukrycie numeru technicznego nie znikają ponownie.

## Warunek wydania

Pełne zielone CI: dependencies, audit, stability, TypeScript, wszystkie testy, kontrakt migracji, lint i production build.
