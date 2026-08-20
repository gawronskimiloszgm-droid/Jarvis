# Agent kamer (Perymetr)

Osobny proces Node, ktory dziala **na laptopie w domu**, nie na Render -
tylko stad jest dostep do kamer RTSP w sieci lokalnej. Sam nie ma klucza
Gemini: wyciaga klatki z kamery i wysyla je do chmury, ktora je ocenia.

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
