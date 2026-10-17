// Lista aplikacji, o ktore mozna rozszerzyc sterowanie desktopowe (#141).
//
// WYLACZNIE informacyjna - nie wykonuje absolutnie niczego. Realne akcje
// zyja w desktop/actions.js, celowo zamknietej bialej liscie (patrz
// komentarz na gorze tamtego pliku) - ktorej NIE edytujemy tutaj. Ten plik
// to tylko statyczny katalog "co by mozna dodac", zeby UI mogl to pokazac,
// a wlasciciel recznie dopisal wybrane pozycje do actions.js po przejrzeniu
// dokladnej implementacji opisanej w raporcie agenta.

import express from 'express';
import { requireOwner } from '../core/auth.js';

// `wdrozone: true` = akcja juz istnieje dzisiaj w desktop/actions.js.
// `wdrozone: false` = tylko propozycja, jeszcze nie zaimplementowana.
export const SUPPORTED_APPS = [
  { nazwa: 'Spotify', akcja: 'otworz-spotify', wdrozone: true },
  { nazwa: 'YouTube Music', akcja: 'otworz-youtube-music', wdrozone: true },
  { nazwa: 'Przegladarka', akcja: 'otworz-przegladarke', wdrozone: true },
  { nazwa: 'Eksplorator plikow', akcja: 'otworz-eksplorator', wdrozone: true },
  { nazwa: 'Discord', akcja: 'otworz-discord', wdrozone: false },
  { nazwa: 'Microsoft Teams', akcja: 'otworz-teams', wdrozone: false },
  { nazwa: 'Slack', akcja: 'otworz-slack', wdrozone: false },
  { nazwa: 'Visual Studio Code', akcja: 'otworz-vscode', wdrozone: false },
];

const router = express.Router();

// Zamontowac np. jako: app.use('/api/desktop', desktopAppsRouter)
router.get('/apps', requireOwner, (req, res) => {
  res.json({ apps: SUPPORTED_APPS });
});

export default router;
