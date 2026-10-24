// Jedno miejsce, w ktorym dolaczaja sie nowe moduly serwera (server/extras/*).
// Dodajesz plik z routerem Express i jedna linijke tutaj.

import system, { SERVER_VERSION, MIN_DESKTOP_VERSION } from './system.js';

export const extraRouters = [system];
export { SERVER_VERSION, MIN_DESKTOP_VERSION };
