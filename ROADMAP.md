# Project Octopus - plan wdrozenia

## Etap 1 - fundament inwestycji

Stan: wdrozone.

- menu i pulpit konkretnej inwestycji,
- edytowalna karta stalych danych,
- strony kontraktu, terminy, adresy i osoby funkcyjne,
- centralny rekord danych gotowy dla przyszlych generatorow.

Kryterium odbioru: dane mozna zapisac, ponownie otworzyc i edytowac bez utraty wartosci.

## Etap 2 - dokumentacja

Stan: nastepny.

- uzgodnienie i migracja produkcyjnego schematu `documents` oraz `document_versions`,
- bezposredni upload do prywatnego Cloudflare R2,
- kategorie i drzewo dokumentacji,
- wersjonowanie oraz oznaczanie aktualnej rewizji,
- pobieranie pliku przez krotko wazny adres podpisany.

Kryterium odbioru: PDF testowy trafia do R2, metadane trafiaja do Supabase, a plik jest widoczny po ponownym otwarciu inwestycji.

## Etap 3 - Octopus Brain

- kolejka przetwarzania plikow,
- ekstrakcja PDF, DOCX i XLSX oraz OCR skanow,
- podzial na strony i fragmenty,
- indeks semantyczny,
- fakty projektu z odniesieniem do dokumentu, strony i cytatu,
- pytania do dokumentacji z odpowiedziami opartymi na zrodlach.

Kryterium odbioru: odpowiedz AI zawsze pokazuje dokument i miejsce, z ktorego pochodzi informacja.

## Etap 4 - generatory dokumentow

- biblioteka szablonow DOCX,
- wnioski materialowe,
- protokoly prob, odbiorow i robot zanikowych,
- RFI, pisma i notatki,
- automatyczne podstawianie danych z karty inwestycji,
- eksport DOCX oraz PDF.

Kryterium odbioru: jeden zatwierdzony szablon generuje kompletny dokument bez ponownego wpisywania stalych danych.

## Etap 5 - kosztorys, harmonogram i kontrola

- import przedmiaru i kosztorysu,
- postep i przeroby miesieczne,
- harmonogram z zaleznosciami,
- porownywanie rewizji dokumentacji,
- kontrole projekt - STWiOR - kosztorys,
- lista brakow i czynnosci do wykonania.

Kryterium odbioru: system wykrywa rozbieznosci i prowadzi uzytkownika do dokumentu zrodlowego.

## Etap 6 - praca zespolowa i produkcja

- role i dostep per inwestycja,
- historia zmian i audyt,
- powiadomienia i zadania,
- kopie zapasowe i monitoring,
- polityka retencji dokumentow,
- testy bezpieczenstwa i przygotowanie planu produkcyjnego.
