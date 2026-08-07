# J.A.R.V.I.S.

Osobisty asystent AI w stylu J.A.R.V.I.S. — dziala jako aplikacja webowa (PWA), ktora mozna zainstalowac na telefonie i komputerze. Rozmawia (glosowo i tekstowo), zapamietuje fakty o Tobie i zwraca sie per "sir".

## 1. Uruchomienie lokalne

```bash
npm install
cp .env.example .env
```

Wpisz w `.env` swoj `GEMINI_API_KEY` (darmowy klucz z https://aistudio.google.com/apikey).

```bash
npm start
```

Otworz http://localhost:3000

## 2. Glos Jarvisa (Microsoft Edge TTS)

Appka generuje glos serwerowo przez neuronowe glosy Microsoft Edge ("Read Aloud") — w pelni za darmo, bez klucza API, bez limitu i bez zakladania kontа. Dziala od razu po `npm install`, nic dodatkowego nie trzeba konfigurowac.

Domyslny glos to `pl-PL-MarekNeural` (polski, meski). Zeby zmienic glos:

1. Zobacz pelna liste dostepnych glosow: `npm run list-voices` (albo `npm run list-voices -- pl-PL` zeby przefiltrowac po polskich).
2. Ustaw wybrany glos w `.env` jako `TTS_VOICE`, np. `en-GB-RyanNeural` (brytyjski meski, brzmi najblizej filmowego Jarvisa, ale bedzie czytal polski tekst z angielskim akcentem) albo `pl-PL-ZofiaNeural` (polski kobiecy).
3. Zrestartuj serwer.

Jesli z jakiegos powodu serwis Microsoftu bedzie niedostepny, appka automatycznie przelacza sie na darmowy syntezator mowy przegladarki (Web Speech API) — nigdy nie zostajesz bez glosu.

## 3. Wdrozenie w chmurze (Render.com — darmowy plan)

1. Wrzuc ten projekt do repozytorium na GitHub (moge Ci w tym pomoc, ale wymaga to Twojej zgody i zalogowania sie na GitHub).
2. Wejdz na https://render.com, zaloz konto (np. przez GitHub) i kliknij **New +** -> **Blueprint**, wskazujac to repozytorium (Render odczyta `render.yaml` automatycznie).
   - Alternatywnie: **New +** -> **Web Service**, Build command: `npm install`, Start command: `npm start`.
3. W ustawieniach serwisu (Environment) dodaj zmienna:
   - `GEMINI_API_KEY` — Twoj darmowy klucz Google Gemini
   - (`TTS_VOICE` i `OWNER_TITLE` juz maja domyslne wartosci w `render.yaml`, zmien je tam jesli chcesz)
4. Deploy. Render nada Ci publiczny adres typu `https://jarvis-xxxx.onrender.com`.

**Uwaga o darmowym planie Render:** usypia serwis po ~15 min bezczynnosci, wiec pierwsze zapytanie po przerwie moze potrwac 30-50s (budzenie). To jedyny sensowny kompromis dla hostingu w 100% za darmo — jesli to przeszkadza, mozna przejsc na platny plan ($7/mc) albo dodac zewnetrzny "ping" co 10 minut.

## 4. Instalacja jako aplikacja (PWA)

Po wejsciu na adres appki (lokalnie lub na Render):
- **Telefon (Android/iOS):** w przegladarce -> menu -> "Dodaj do ekranu glownego" / "Zainstaluj aplikacje".
- **Komputer (Chrome/Edge):** ikona instalacji w pasku adresu, lub menu -> "Zainstaluj J.A.R.V.I.S.".

## 5. Co dziala w tej wersji (v1)

- Czat tekstowy i glosowy (rozpoznawanie mowy w przegladarce, jezyk polski)
- Odpowiedzi generowane przez Google Gemini (darmowy tier) z osobowoscia Jarvisa (uprzejmy, brytyjski, z poczuciem humoru, zwraca sie "sir")
- Trwala pamiec: Jarvis sam zapisuje istotne fakty o Tobie (np. imie, preferencje) i pamieta je w kolejnych rozmowach
- Animowany interfejs HUD (reaktor, pierscienie, fala dzwiekowa) reagujacy na stan (sluchanie/myslenie/mowienie)
- Instalowalna aplikacja (PWA) na telefon i komputer
- Glos Jarvisa przez Microsoft Edge TTS — w pelni darmowy, bez klucza, bez limitu

## 6. Znane ograniczenia v1 (do rozbudowy w kolejnych iteracjach)

- Pamiec przechowywana w prostym pliku JSON na serwerze — na darmowym Render dysk moze byc resetowany przy kazdym nowym deployu (nie przy zwyklym restarcie/usypianiu). Do trwalej pamieci "na zawsze" warto docelowo podpiac darmowa baze (np. Supabase).
- Brak logowania/wielu uzytkownikow — appka zaklada, ze to Twoj prywatny asystent.
- Darmowy tier Gemini ma realne limity zapytan na minute/dzien — przy normalnym uzyciu osobistym wystarcza, ale to nie jest "nieskonczone" API. Microsoft Edge TTS jest nieoficjalnym (reverse-engineered) uzyciem ich uslugi Read Aloud — dziala stabilnie i szeroko stosowane w projektach open-source, ale teoretycznie Microsoft moze je kiedys zablokowac (wtedy appka automatycznie przelacza sie na glos przegladarki).
