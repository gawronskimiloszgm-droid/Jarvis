// Panel zdrowia systemu (#146), samo-diagnostyka modulow (#147), warstwa
// DANYCH dla trybu goscia z granularnymi uprawnieniami (#148), warstwa
// DANYCH dla wielu domownikow (#149) i przelaczany "charakter" Jarvisa
// (#150).
//
// WAZNE (#148, #149): ponizsze endpointy zapisuja WYLACZNIE dane/konfiguracje
// w trwalej pamieci (przez server/memory.js, namespace data.meta). Zaden z
// nich nie zmienia faktycznego mechanizmu autoryzacji w server/auth.js ani
// nie podlacza sie do server/jarvis.js - to celowo zostawione do recznej,
// pozniejszej integracji (zbyt ryzykowne/rozlegle na rownolegla zmiane).

import express from 'express';
import { nanoid } from 'nanoid';
import * as memory from './memory.js';
import { requireOwner } from './auth.js';
import { snapshot as telemetrySnapshot } from './telemetry.js';
import { isRemote, backendName } from './store.js';

const router = express.Router();

// --- #146: panel admina zdrowia systemu ---
// Agreguje telemetry.js (bez duplikowania jego logiki progow/alarmow) plus
// wlasne, proste sprawdzenia konfiguracji.

// Zamontowac np. jako: app.use('/api/meta', metaRouter)
router.get('/health-dashboard', requireOwner, (req, res) => {
  res.json({
    at: new Date().toISOString(),
    maszyny: telemetrySnapshot(),
    pamiec: { backend: backendName(), zdalna: isRemote },
    gemini: { skonfigurowany: Boolean(process.env.GEMINI_API_KEY) },
  });
});

// --- #147: samo-diagnostyka modulow ---

async function checkModuleHealth() {
  const wyniki = [];

  // Dynamiczny import - jesli ktorys modul rzuca blad przy zaladowaniu
  // (skladnia, brakujacy plik, blad na najwyzszym poziomie), zobaczymy to
  // tutaj zamiast wywrocenia calego serwera przy starcie.
  const modulesToCheck = [
    { nazwa: 'geminiChain', sciezka: './geminiChain.js' },
    { nazwa: 'memory', sciezka: './memory.js' },
    { nazwa: 'store', sciezka: './store.js' },
    { nazwa: 'bus', sciezka: './bus.js' },
    { nazwa: 'telemetry', sciezka: './telemetry.js' },
    { nazwa: 'calendar', sciezka: './calendar.js' },
  ];

  for (const mod of modulesToCheck) {
    try {
      await import(mod.sciezka);
      wyniki.push({ modul: mod.nazwa, status: 'ok' });
    } catch (e) {
      wyniki.push({ modul: mod.nazwa, status: 'error', szczegoly: e.message });
    }
  }

  wyniki.push(
    process.env.GEMINI_API_KEY
      ? { modul: 'GEMINI_API_KEY', status: 'ok' }
      : { modul: 'GEMINI_API_KEY', status: 'error', szczegoly: 'Brak zmiennej srodowiskowej - Jarvis nie odpowie.' }
  );

  // TTS_VOICE - sprawdzamy tylko FORMAT (jezyk-KRAJ-NazwaNeural, jak w Edge
  // TTS), bez wywolywania faktycznej syntezy (kosztowne i wymaga sieci).
  const ttsVoice = process.env.TTS_VOICE || '';
  if (!ttsVoice) {
    wyniki.push({ modul: 'TTS_VOICE', status: 'warn', szczegoly: 'Nie ustawiono - zostanie uzyty domyslny glos.' });
  } else if (!/^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(ttsVoice)) {
    wyniki.push({
      modul: 'TTS_VOICE',
      status: 'warn',
      szczegoly: `Format "${ttsVoice}" wyglada nietypowo dla glosu Edge TTS (oczekiwano np. "pl-PL-MarekNeural").`,
    });
  } else {
    wyniki.push({ modul: 'TTS_VOICE', status: 'ok' });
  }

  // PRINTER_URL - jesli ustawiony, sprawdzamy tylko czy w ogole odpowiada
  // (krotki timeout - to diagnostyka, nie moze wisiec).
  const printerUrl = process.env.PRINTER_URL || '';
  if (!printerUrl) {
    wyniki.push({ modul: 'PRINTER_URL', status: 'ok', szczegoly: 'Nie skonfigurowano (funkcja opcjonalna).' });
  } else {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2000);
      const r = await fetch(printerUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      wyniki.push({
        modul: 'PRINTER_URL',
        status: r.ok ? 'ok' : 'warn',
        szczegoly: r.ok ? undefined : `Drukarka odpowiedziala HTTP ${r.status}.`,
      });
    } catch (e) {
      wyniki.push({ modul: 'PRINTER_URL', status: 'warn', szczegoly: `Brak odpowiedzi drukarki: ${e.message}` });
    }
  }

  return wyniki;
}

// Zamontowac np. jako: app.use('/api/meta', metaRouter)
router.get('/self-check', requireOwner, async (req, res) => {
  try {
    const wyniki = await checkModuleHealth();
    const ogolny = wyniki.some((w) => w.status === 'error')
      ? 'error'
      : wyniki.some((w) => w.status === 'warn')
      ? 'warn'
      : 'ok';
    res.json({ status: ogolny, moduly: wyniki });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export { checkModuleHealth };

// --- Wspolny namespace pamieci dla #148/#149/#150 ---

function getMetaData() {
  const data = memory.load();
  if (!data.meta || typeof data.meta !== 'object') data.meta = {};
  if (!Array.isArray(data.meta.guestPermissionProfiles)) data.meta.guestPermissionProfiles = [];
  if (!Array.isArray(data.meta.householdMembers)) data.meta.householdMembers = [];
  if (!data.meta.personalityMode) data.meta.personalityMode = 'formalny';
  return data;
}

// --- #148: definicje granularnych uprawnien dla przyszlych goscii ---
// TYLKO WARSTWA DANYCH - patrz zastrzezenie na gorze pliku. Kazdy "profil"
// to opis ("gosc X widzi pogode i kalendarz, nie widzi zadan"), ktory
// faktyczne auth.js musialoby pozniej odczytac i wyegzekwowac - dzis nic
// tego nie robi.

// Zamontowac np. jako: app.use('/api/meta', metaRouter)
router.get('/guest-permissions', requireOwner, (req, res) => {
  res.json({ profile: getMetaData().meta.guestPermissionProfiles });
});

router.post('/guest-permissions', requireOwner, (req, res) => {
  const nazwa = String(req.body?.nazwa || '').trim();
  if (!nazwa) return res.status(400).json({ error: 'Podaj nazwe profilu (np. imie/etykiete goscia).' });
  const dozwolone = Array.isArray(req.body?.dozwolone) ? req.body.dozwolone.map(String) : [];
  const zabronione = Array.isArray(req.body?.zabronione) ? req.body.zabronione.map(String) : [];

  const data = getMetaData();
  const existing = data.meta.guestPermissionProfiles.find((p) => p.nazwa === nazwa);
  if (existing) {
    existing.dozwolone = dozwolone;
    existing.zabronione = zabronione;
    existing.updatedAt = Date.now();
  } else {
    data.meta.guestPermissionProfiles.push({
      id: nanoid(8),
      nazwa,
      dozwolone,
      zabronione,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  memory.save(data);
  res.json({ profile: data.meta.guestPermissionProfiles });
});

router.delete('/guest-permissions/:id', requireOwner, (req, res) => {
  const data = getMetaData();
  data.meta.guestPermissionProfiles = data.meta.guestPermissionProfiles.filter((p) => p.id !== req.params.id);
  memory.save(data);
  res.json({ profile: data.meta.guestPermissionProfiles });
});

// --- #149: wielu domownikow, osobna "pamiec" per osoba ---
// TYLKO PRZYGOTOWANIE STRUKTURY DANYCH - patrz zastrzezenie na gorze pliku.
// Pelna integracja (np. Jarvis rozpoznajacy KTORY domownik mowi i uzywajacy
// jego facts/todos zamiast globalnych z memory.js) wymaga zmian w
// memory.js i jarvis.js, ktore sa poza zakresem tego pliku.

// Zamontowac np. jako: app.use('/api/meta', metaRouter)
router.get('/household', requireOwner, (req, res) => {
  res.json({ members: getMetaData().meta.householdMembers });
});

router.post('/household', requireOwner, (req, res) => {
  const imie = String(req.body?.imie || '').trim();
  if (!imie) return res.status(400).json({ error: 'Podaj imie domownika.' });
  const opis = String(req.body?.opis || '').trim();

  const data = getMetaData();
  data.meta.householdMembers.push({
    id: nanoid(8),
    imie,
    opis,
    facts: [],
    todos: [],
    createdAt: Date.now(),
  });
  memory.save(data);
  res.json({ members: data.meta.householdMembers });
});

router.patch('/household/:id', requireOwner, (req, res) => {
  const data = getMetaData();
  const member = data.meta.householdMembers.find((m) => m.id === req.params.id);
  if (!member) return res.status(404).json({ error: 'Nie znaleziono domownika.' });
  if (req.body?.imie != null) member.imie = String(req.body.imie).trim();
  if (req.body?.opis != null) member.opis = String(req.body.opis).trim();
  memory.save(data);
  res.json({ members: data.meta.householdMembers });
});

router.delete('/household/:id', requireOwner, (req, res) => {
  const data = getMetaData();
  data.meta.householdMembers = data.meta.householdMembers.filter((m) => m.id !== req.params.id);
  memory.save(data);
  res.json({ members: data.meta.householdMembers });
});

// --- #150: przelaczany "charakter" Jarvisa ---
// Wybor trybu jest tu TYLKO zapisany w pamieci. Realne wpiecie do promptu w
// server/jarvis.js (dopisanie odpowiedniego fragmentu do systemInstruction
// wg wybranego trybu) wymaga mojej recznej integracji - ponizej gotowe,
// krotkie fragmenty tekstu dla kazdego trybu, do wkopiowania 1:1.

export const PERSONALITY_MODE_PROMPTS = {
  formalny:
    'Tryb FORMALNY: mow jeszcze bardziej wytwornie i rzeczowo niz zwykle, ograniczajac zarty do absolutnego ' +
    'minimum - priorytetem jest precyzja i klasa, nie humor.',
  zartobliwy:
    'Tryb ZARTOBLIWY: zwieksz czestotliwosc suchych, ironicznych uwag (nadal maksymalnie jedna-dwie na ' +
    'wypowiedz, zero kabaretu) - humor moze wybrzmiec nawet przy neutralnych pytaniach, nie tylko przy okazji.',
  zwiezly:
    'Tryb ZWIEZLY: odpowiadaj najkrocej jak sie da - jedno, maksymalnie dwa zdania, zero dygresji i zartow, ' +
    'chyba ze samo pytanie jest zartobliwe.',
};

const VALID_MODES = Object.keys(PERSONALITY_MODE_PROMPTS);

// Zamontowac np. jako: app.use('/api/meta', metaRouter)
router.get('/personality-mode', requireOwner, (req, res) => {
  res.json({ tryb: getMetaData().meta.personalityMode, dostepne: VALID_MODES });
});

router.post('/personality-mode', requireOwner, (req, res) => {
  const tryb = String(req.body?.tryb || '').trim().toLowerCase();
  if (!VALID_MODES.includes(tryb)) {
    return res.status(400).json({ error: `Nieznany tryb. Dostepne: ${VALID_MODES.join(', ')}` });
  }
  const data = getMetaData();
  data.meta.personalityMode = tryb;
  memory.save(data);
  res.json({ tryb });
});

export default router;
