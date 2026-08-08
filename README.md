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

**Uwaga o darmowym planie Render:** usypia serwis po ~15 min bezczynnosci. Ponizej opisany jest darmowy sposob, zeby temu zapobiec.

## 4. Nigdy nie usypiaj serwera (keep-alive przez GitHub Actions)

W repozytorium jest gotowy workflow `.github/workflows/keep-alive.yml`, ktory co 10 minut odpytuje appke i jednoczesnie sprawdza, czy sa jakies przypomnienia do wyslania. Zeby dzialal, dodaj w ustawieniach repozytorium na GitHubie (Settings -> Secrets and variables -> Actions -> New repository secret) dwa sekrety:

- `JARVIS_URL` — adres Twojej appki, np. `https://jarvis-u4vw.onrender.com`
- `CRON_SECRET` — ta sama wartosc, co `CRON_SECRET` w zmiennych srodowiskowych na Render

Od tego momentu appka nigdy nie zasnie i przypomnienia beda wysylane na czas.

## 5. Instalacja jako aplikacja (PWA)

Po wejsciu na adres appki (lokalnie lub na Render):
- **Telefon (Android/iOS):** w przegladarce -> menu -> "Dodaj do ekranu glownego" / "Zainstaluj aplikacje".
- **Komputer (Chrome/Edge):** ikona instalacji w pasku adresu, lub menu -> "Zainstaluj J.A.R.V.I.S.".

## 6. Powiadomienia push

Kliknij ikone 🔔 w naglowku appki i zgodz sie na powiadomienia w przegladarce. Od tego momentu Jarvis moze wysylac Ci powiadomienia nawet gdy appka jest zamknieta — np. gdy nadejdzie termin przypomnienia. Klucze VAPID potrzebne do tego generuje sie jednorazowo: `node scripts/generate-vapid-keys.js` (juz wygenerowane i wpisane w `.env`).

## 7. Kamera i generowanie obrazow

- **Kamera** (zakladka 📷): wlacz kamere, opcjonalnie wpisz pytanie w polu tekstowym na dole, kliknij "Zapytaj Jarvisa o to, co widzi" — Jarvis analizuje aktualna klatke (Gemini vision, w ramach tego samego darmowego limitu co czat).
- **Generowanie obrazow**: albo w zakladce 🎨 Obrazy, albo bezposrednio w czacie — napisz np. "narysuj smoka w stylu cyberpunk". Obrazy generuje https://pollinations.ai — w pelni darmowe, bez klucza API, bez limitu.
- Generowanie obrazow przez sam Gemini/Imagen NIE dziala na darmowym kluczu API (zero przydzielonego limitu) — dlatego uzywamy Pollinations jako darmowej alternatywy.

## 8. Aplikacja desktopowa (Windows/Mac/Linux, nie w przegladarce)

W folderze `desktop/` jest osobna mini-aplikacja Electron, ktora otwiera Twojego wdrozonego Jarvisa jako prawdziwe okno programu (wlasna ikona, wlasne okno, bez paska adresu przegladarki) zamiast karty w przegladarce.

```bash
cd desktop
npm install
npm start
```

Zeby zbudowac instalator .exe (Windows) / .dmg (Mac) / .AppImage (Linux), ktory mozna zainstalowac jak normalny program:

```bash
npm run build
```

Plik `desktop/config.json` wskazuje na Twoj adres na Render — zmien go, jesli adres appki kiedys sie zmieni.

## 9. Co dziala w tej wersji

- Czat tekstowy i glosowy (rozpoznawanie mowy w przegladarce, jezyk polski), odpowiedzi strumieniowane na biezaco (slowo po slowie)
- Aktywacja glosem — kliknij 👂 i powiedz "Jarvis, ..." zeby wydac polecenie bez dotykania ekranu
- Odpowiedzi generowane przez Google Gemini (darmowy tier) z osobowoscia Jarvisa (uprzejmy, brytyjski, z poczuciem humoru, zwraca sie "sir")
- Trwala pamiec: Jarvis sam zapisuje istotne fakty o Tobie (np. imie, preferencje) i pamieta je w kolejnych rozmowach
- Lista zadan (zakladka ✅ Zadania) — dodawaj recznie albo poproś Jarvisa w czacie ("dodaj do zadan...")
- Przypomnienia z konkretna data/godzina (zakladka 🔔 Przypomnienia) — dostajesz powiadomienie push dokladnie na czas
- Timer (zakladka ⏱ Timer) z dzwiekiem i powiadomieniem po czasie
- Prawdziwa pogoda na zywo (Open-Meteo, bez klucza) — po prostu zapytaj "jaka jest pogoda w..."
- Animowany interfejs HUD (reaktor, pierscienie, fala dzwiekowa) reagujacy na stan (sluchanie/myslenie/mowienie)
- Instalowalna aplikacja (PWA) na telefon i komputer, dziala non-stop w chmurze dzieki keep-alive
- Aplikacja desktopowa (Electron) jako alternatywa dla PWA — prawdziwe okno programu
- Kamera z analiza obrazu na zywo (Gemini vision)
- Generowanie obrazow (Pollinations.ai) — w czacie albo w dedykowanej zakladce
- Glos Jarvisa przez Microsoft Edge TTS — w pelni darmowy, bez klucza, bez limitu

## 10. Znane ograniczenia (do rozbudowy w kolejnych iteracjach)

- Pamiec przechowywana w prostym pliku JSON na serwerze — na darmowym Render dysk moze byc resetowany przy kazdym nowym deployu (nie przy zwyklym restarcie/usypianiu). Do trwalej pamieci "na zawsze" warto docelowo podpiac darmowa baze (np. Supabase).
- Brak logowania/wielu uzytkownikow — appka zaklada, ze to Twoj prywatny asystent.
- Darmowy tier Gemini ma realne limity zapytan na minute/dzien — przy normalnym uzyciu osobistym wystarcza, ale to nie jest "nieskonczone" API. Microsoft Edge TTS jest nieoficjalnym (reverse-engineered) uzyciem ich uslugi Read Aloud — dziala stabilnie i szeroko stosowane w projektach open-source, ale teoretycznie Microsoft moze je kiedys zablokowac (wtedy appka automatycznie przelacza sie na glos przegladarki).
- Przypomnienia sprawdzane sa tylko co ~10 minut (przez GitHub Actions) — dokladnosc "co do minuty" nie jest gwarantowana, ale w praktyce wystarczajaca.
- Aktywacja glosem ("Jarvis, ...") dziala najlepiej w Chrome/Edge; niektore przegladarki mobilne ograniczaja ciagle nasluchiwanie w tle.
- Generowanie obrazow zalezy od zewnetrznego darmowego serwisu Pollinations.ai — nie jest to oficjalna, gwarantowana usluga, wiec teoretycznie moze byc czasem wolniejsza albo niedostepna.
- Kamera dziala tylko "na zadanie" (robisz zdjecie, Jarvis je analizuje) — nie ma ciaglej, zywej analizy wideo klatka po klatce (to byloby drogie w zapytaniach do AI).
- Aplikacja desktopowa (Electron) to okno ladujace Twoj adres z Render — wymaga dzialajacego polaczenia internetowego, nie dziala w pelni offline.
