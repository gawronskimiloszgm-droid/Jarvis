# Agenci maszyny domowej

Dwa procesy Node, ktore dzialaja **na laptopie w domu**, nie na Render -
tylko stad jest dostep do kamer RTSP i do stanu samej maszyny. Zaden z
nich nie ma klucza Gemini: zbieraja dane i wysylaja je do chmury, ktora
je ocenia.

Oba czytaja konfiguracje z `home-server/.env` (nie z `.env` serwera) i
loguja sie tak samo jak przegladarka - haslem wlasciciela.

- `camera-watcher.js` - kamery obwodowe (ponizej)
- `system-monitor.js` - telemetria maszyny (na koncu pliku)

---

# Agent kamer (Perymetr)

## Jak to dziala

1. Jedno polaczenie RTSP na kamere. `ffmpeg` sam filtruje ruch (`select=scene`)
   i skaluje obraz do 720p, wiec laptop nie dekoduje i nie analizuje
   kazdej klatki - tylko te, na ktorych cos sie realnie zmienilo.
2. Kazda taka klatka leci do `/api/cameras/frame` w chmurze, gdzie Gemini
   Vision ocenia, czy jest na niej cos wartego uwagi (czlowiek, pojazd).
   Jesli tak - alert trafia na magistrale zdarzen (widoczny w Centrum
   Operacyjnym, zakladka *Perymetr* i *Logi*) i jako powiadomienie push.
3. Co kilka minut agent wysyla heartbeat (`/api/cameras/heartbeat`) -
   samo potwierdzenie, ze polaczenie z kamera zyje, bez zadnej analizy.

## Uruchomienie

```bash
cd home-server
cp .env.example .env
```

Wypelnij `.env`: adres Twojej appki (`JARVIS_URL`), dane logowania (te
same co w przegladarce) i `RTSP_URL` kamery. Potem:

```bash
node camera-watcher.js
```

Zaden osobny `npm install` nie jest potrzebny - agent korzysta z
`node_modules` glownego projektu (uruchamiasz go z wnetrza repozytorium).

Wymaga `ffmpeg` w PATH (albo wskaz sciezke w `FFMPEG_BIN`).

## Czego NIE sprawdzilem

Polaczenia z prawdziwa kamera. Mechanizm (ffmpeg, filtr ruchu, wysylka,
ocena Gemini, magistrala zdarzen, panel w interfejsie) jest przetestowany
end-to-end na syntetycznym zrodle obrazu. Twoj konkretny model kamery -
autoryzacja w adresie RTSP, obslugiwany kodek, transport TCP vs UDP -
zweryfikuje sie dopiero przy pierwszym realnym uruchomieniu. Jesli
polaczenie nie wstanie, `ffmpeg` wypisze na ekranie ostatni komunikat
bledu (np. zla nazwa uzytkownika, "Connection refused", zly transport) -
to pierwsze miejsce do sprawdzenia.

## Dzialanie 24/7

Trwałe dzialanie w tle na Windows - najprosciej przez Zaplanowane
zadania (Task Scheduler) z akcja `node camera-watcher.js` i wyzwalaczem
"przy starcie systemu". Agent sam ponawia polaczenie z rosnaca przerwa,
jesli RTSP albo chmura na chwile odpadnie.

---

# Monitor maszyny (Telemetria)

Drugi agent, uruchamiany niezaleznie od kamer:

```bash
node home-server/system-monitor.js
```

Co 20 sekund wysyla do chmury obciazenie procesora, pamieci i dysku oraz
liste najciezszych procesow. Widac to w Centrum Operacyjnym w zakladce
*Maszyna*.

**Alarmy sa celowo powolne.** Prog musi byc przekroczony w trzech
kolejnych odczytach z rzedu, zanim cokolwiek sie odezwie - chwilowy skok
przy kompilacji czy starcie gry to normalna praca, nie awaria. Alarm
melduje sie RAZ na epizod (nie co 20 sekund), a powrot do normy jest
zglaszany od razu.

**Samoleczenie konczy sie na meldunku.** Jarvis powie, ktory proces
zjada pamiec i poda jego PID, ale sam go nie ubije. Automatyczne
zabijanie procesow bez pytania to najkrotsza droga do tego, zeby jeden
falszywy alarm skasowal godzine pracy - decyzje zostawiam czlowiekowi.

## Konfiguracja

Oba agenty czytaja ten sam plik `home-server/.env`. Dodatkowe pola dla
monitora:

```
MACHINE_NAME=laptop-garaz
TELEMETRY_INTERVAL_MS=20000
```

Progi alarmowe ustawia sie po stronie serwera (`TELEMETRY_CPU_WARN`,
`TELEMETRY_RAM_WARN`, `TELEMETRY_DISK_WARN`, `TELEMETRY_SUSTAINED`).
