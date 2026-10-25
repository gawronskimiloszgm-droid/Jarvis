// Jedno miejsce, w ktorym dolaczaja sie nowe moduly serwera (server/extras/*).
// Dodajesz plik z routerem Express i jedna linijke tutaj.

import system, { SERVER_VERSION, MIN_DESKTOP_VERSION } from './system.js';
import documents from './documents.js';
import audit from './audit.js';
import agent from './agent.js';
import approvals from './approvals.js';
import textops from './textops.js';
import voiceux from './voiceux.js';
import macros from './macros.js';
import mailtriage from './mailtriage.js';
import './briefplus.js';
import insights from './insights.js';
import remote from './remote.js';
import profiles from './profiles.js';
import music from './music.js';
import greeting from './greeting.js';

export const extraRouters = [system, documents, audit, agent, approvals, textops, voiceux, macros, mailtriage, insights, remote, profiles, music, greeting];
export { SERVER_VERSION, MIN_DESKTOP_VERSION };
