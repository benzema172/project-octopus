# Project Octopus 0.4.0 — zakres wykonania

Data: 14 sierpnia 2026 r.

## Zrealizowane funkcjonalnie

- pipeline dokumentów z trwałym zadaniem, atomowym pobieraniem zadania, retry i dead-letter,
- analiza mniejszych plików bezpośrednio oraz większych PDF/obrazów przez czasowy upload Gemini Files API,
- rozpoznawanie kategorii, faktów, źródeł, BOQ, etapów, wniosków i protokołów,
- Skrzynka AI z akceptacją, odrzuceniem i ręcznym ponowieniem,
- zatwierdzenie kosztorysu tworzące BOQ, WBS oraz szkic harmonogramu,
- pełnotekstowa wyszukiwarka dokumentów, faktów i pamięci firmy,
- automatyczne propozycje wpływu po zmianie rewizji dokumentu,
- indeks dowodów, łańcuch materiału, forecast i paczka zamknięcia,
- mobilny zapis zdarzenia z geolokalizacją,
- rejestrowanie Wzorów, wersji i pól oraz kontrolowany szkic dokumentu z podglądem do PDF,
- pamięć organizacji wymagająca zatwierdzenia,
- role domenowe egzekwowane przez krytyczne API,
- staging danych KSeF i integracji bez przechowywania sekretów w bazie biznesowej,
- żywe panele danych dla Finansów, Kadr, Magazynu, Floty, Raportów i Ustawień.

## Wymaga konfiguracji środowiska

- harmonogram dla `/api/brain/worker`,
- produkcyjny klucz Gemini oraz test kosztów i limitów,
- rzeczywiste uwierzytelnienie KSeF,
- dane lub poświadczenia banku, księgowości, GPS/kart paliwowych i systemu kadrowego,
- procedura backupu i test odtwarzania Supabase/R2.

## Świadome granice 0.4.0

- generator tworzy kontrolowany szkic i podgląd drukowalny; wierna edycja istniejącego DOCX i serwerowy PDF są kolejnym przyrostem,
- OCR i rozumienie skanów wykonuje model multimodalny; aplikacja zapisuje najważniejsze fragmenty wyszukiwalne, nie pełny techniczny OCR każdej strony,
- radar rewizji porównuje strukturalnie rozpoznane zakresy; dokładny diff rysunków CAD/BIM wymaga osobnego silnika,
- KSeF ma model, staging i widok kontrolny, ale nie wykonuje połączenia bez poświadczeń firmy,
- moduły nie zastępują księgowości ani systemu płacowego — odpowiadają za controlling zarządczy i alokację kosztów.
