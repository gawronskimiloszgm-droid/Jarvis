# Głos Jarvisa — klonowanie (XTTS-v2)

Mikroserwis, ktory mowi **Twoim wybranym glosem** zamiast gotowym glosem
z katalogu. Osobna usluga, bo model wazy ~2 GB i wymaga Pythona z torchem.

## Czego potrzebujesz NAJPIERW

**Probki glosu `jarvis_sample.wav`** — bez niej nie ma czego klonowac.

- 10–30 sekund czystej mowy
- mono, najlepiej 22050 Hz lub wiecej
- bez muzyki w tle, bez pogłosu, bez drugiej osoby
- jedna osoba, spokojne tempo

Wrzuc plik do tego katalogu jako `jarvis_sample.wav`.

## Jak dziala pamiec glosu (spec I.3)

Wyciagniecie wektorow glosu z probki to **najdrozsza** operacja w calym
procesie. Robimy ja **raz**: wynik ląduje w `jarvis_voice.pth`, a kazde
kolejne zapytanie wczytuje gotowe wektory prosto z pamieci procesu.
Probka sie nie zmienia, wiec liczenie ich za kazdym razem byloby czysta
strata.

Endpoint `/health` pokazuje, czy wektory sa juz zbudowane
(`voiceCached`). `/warmup` wymusza wczytanie modelu po wdrozeniu, zeby
pierwsze prawdziwe zapytanie nie czekalo minuty.

## Czy zla wymowa w probce "przyklei sie" do glosu?

Krotka odpowiedz: **nie do pojedynczych slow**, ale probka i tak powinna
byc czysta.

XTTS-v2 uczy sie z probki **barwy i charakteru glosu** (wektory
`gpt_cond_latent` / `speaker_embedding`), nie zapamietuje transkryptu
tego, co w niej powiedziano. Gdy pozniej prosisz o wypowiedzenie zdania
"Dzien dobry, sir", model wymawia je wedlug WLASNEGO, wbudowanego modelu
jezyka polskiego (`language="pl"`) - nie odtwarza tego, jak konkretne
slowo zabrzmialo w probce. Sprawdzono na przykladzie: probka z tym
projektem miala zdanie o II wojnie swiatowej przeczytane przez silnik
angielski, ktory nie znal polskiego - "1939" wyszlo jako bezladny ciag
angielskich glosek, "byl" jako angielskie "by", "roku" jako "mroku".
Zadne z tych konkretnych slow nie ma szans wystapic w odpowiedziach
Jarvisa w tej samej, znieksztalconej formie - to nie tak dziala
klonowanie.

Ryzyko jest inne i subtelniejsze: gdy probka referencyjna ma **obcy
akcent, nienaturalny rytm albo cyfrowe artefakty** (jak ta czytana przez
zle dopasowany silnik), model potrafi to czesciowo wchlonac jako
charakterystyke calego glosu - nie konkretne slowa, ale ogolne "brzmienie
nie do konca jak zywy czlowiek". Dlatego zalecenie z gory tego pliku
("czysta mowa, bez muzyki, jedna osoba") to nie formalnosc - to jest
realny czynnik jakosci.

**Jesli masz do wyboru:** nagranie prawdziwego czlowieka mowiacego
naturalnie po polsku (nawet o czyms zupelnie innym niz docelowe
wypowiedzi Jarvisa) da lepszy klon niz jakikolwiek zapis z syntezatora,
ktory nie radzi sobie z polskim.

**Zweryfikowane na prawdziwym audio (nie teoria):** proste, krotkie zdania
("Dzien dobry, sir. Wszystkie systemy dzialaja prawidlowo.") wychodza
wyraznie i zrozumiale - transkrypcja Gemini potwierdzila kazde slowo, choc
brzmienie jest wyraznie syntetyczne/robotyczne (monotonna intonacja), nie
jak zywy czlowiek. To normalne dla klonowania zero-shot na CPU, nie blad.
Zlozone, wielowyrazowe liczebniki po polsku ("tysiac dziewiecset
trzydziestego dziewiatego") potrafia sie rozjechac na koncu - w jednym
tescie "dziewiatego roku" wyszlo jako bezsensowne "untio". To NIE jest
powtorzenie bledu z probki (probka mialaby swoj wlasny, inny bledny
zapis) - to osobne, realne ograniczenie modelu przy dlugich zlozeniach
liczbowych, prawdopodobnie pogorszone przez niska jakosc probki
referencyjnej. Krotkie, biezace odpowiedzi Jarvisa (do tego zaprojektowany
jest tryb klonowany - patrz TTS_CLONE_MAX_CHARS) rzadko zawieraja takie
konstrukcje; jesli zauwazysz podobny problem w praktyce, pierwszym
krokiem jest lepsza probka, nie zmiana kodu.

## Uruchomienie lokalne

```bash
cd tts_cloud
pip install -r requirements.txt
python app.py
```

Serwis stanie na `http://localhost:7860`.

## Wdrozenie na HuggingFace Spaces

1. Zaloz Space typu **Docker**.
2. Wgraj `app.py`, `requirements.txt`, `Dockerfile` i `jarvis_sample.wav`.
3. W ustawieniach Space dodaj sekret `TTS_API_TOKEN` (dowolny losowy ciag) —
   bez niego kazdy, kto zna adres, generuje mowe na Twoj koszt.
4. Po pierwszym starcie wywolaj raz `POST /warmup`.

## Podlaczenie do Jarvisa

W zmiennych srodowiskowych aplikacji (Render):

```
TTS_CLOUD_URL=https://twoj-space.hf.space
TTS_CLOUD_TOKEN=ten-sam-losowy-ciag
TTS_CLONE_MAX_CHARS=240
```

## Ograniczenia — przeczytaj, zanim sie zawiedziesz

**Na darmowym procesorze to jest wolne.** XTTS-v2 bez karty graficznej
generuje mowe wolniej, niz czlowiek ja wypowiada. Dlatego Jarvis uzywa
sklonowanego glosu **tylko dla krotkich wypowiedzi** (domyslnie do 240
znakow) — dluzsze i tak ida szybkim silnikiem, bo inaczej czekalbys na
odpowiedz dluzej, niz trwa jej wysluchanie. Granice zmienia
`TTS_CLONE_MAX_CHARS`.

**Rozmowa na zywo tego NIE uzywa.** Tryb glosowy na zywo to dwukierunkowy
strumien audio prosto z Gemini Live — dzwiek powstaje po ich stronie i nie
przechodzi przez nasz serwer, wiec nie da sie go podmienic. Sklonowany
glos slychac w czacie pisanym, powitaniach i meldunkach systemowych.

**Licencja.** Model XTTS-v2 jest na Coqui Public Model License —
**niekomercyjnej**. Do wlasnego uzytku w porzadku; do produktu zarobkowego
nie.

**Darmowe Spaces zasypiaja** po okresie bezczynnosci i budza sie ~30 s.
Pierwsze zapytanie po przerwie przekroczy limit czasu i Jarvis zejdzie na
szybki silnik — to zamierzone, lepsze niz cisza.
