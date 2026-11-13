import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as memory from '../server/memory/memory.js';
import { logSets, fitProfile, runFitTool, FitKit } from '../server/extras/fitness.js';
import { coachBriefLine, coachNudges, coachWeekText, startWorkout, runCoachTool } from '../server/extras/coach.js';
import { warsawDay, lifeAdd } from '../server/extras/life.js';
import { buildBrief } from '../server/core/briefing.js';

const before = JSON.parse(JSON.stringify(memory.load()));
memory.load().life = {};
delete memory.load().fitProfile;
delete memory.load().coachNudges;
after(() => memory.save(before));

// Godzina w Warszawie jako Date: przypomnienia zaleza od pory dnia.
const at = (hour, weekday = 3) => {
  const d = new Date();
  for (let i = 0; i < 8 && new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', weekday: 'short' }).format(d) !== ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday]; i++) d.setUTCDate(d.getUTCDate() + 1);
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', hour12: false }).format(d));
  d.setUTCHours(d.getUTCHours() + (hour - h));
  return d;
};

test('bez danych treningowych trener milczy', () => {
  assert.equal(coachBriefLine('morning'), '');
  assert.deepEqual(coachNudges(at(17)), []);
});

test('odprawa: plan dnia rano, bilans wieczorem', async () => {
  const old = warsawDay(-5);
  lifeAdd('sets', { ex: 'Przysiad', kg: 100, reps: 5, day: old });
  fitProfile({ age: 25, height: 180, playlist: 'GYM' });
  await runFitTool('masa_ciala', { kg: 80 });
  const m = coachBriefLine('morning');
  assert.match(m, /Trening: dziś Push/);
  assert.match(m, /5 dni temu/);
  assert.match(m, /kcal i \d+ g białka/);
  assert.equal(coachBriefLine('evening'), '');
  await runFitTool('posilek', { opis: 'obiad', kcal: 700, bialko: 30 });
  assert.match(coachBriefLine('evening'), /700\/\d+ kcal, 30\/\d+ g białka/);
  const brief = await buildBrief('morning');
  assert.match(String(brief.text || brief), /Trening: dziś Push/);
});

test('przypomnienia: przerwa w treningach po poludniu, bialko wieczorem, tydzien w niedziele', () => {
  const afternoon = coachNudges(at(17));
  assert.equal(afternoon.length, 1);
  assert.match(afternoon[0][2], /Ostatni trening 5 dni temu/);
  const evening = coachNudges(at(20));
  assert.equal(evening[0][1], 'Białko');
  assert.ok(coachNudges(at(20, 0)).some(([k]) => k.endsWith('coach-week')));
  assert.deepEqual(coachNudges(at(10)), []);
});

test('zaniedbana partia, gdy treningi sa regularne', () => {
  logSets({ ex: 'Wyciskanie na ławce', kg: 80, reps: 8 });
  // Plecy 10 dni temu, nogi 5 dni temu: przypomnienie tylko o plecach (od 7 dni).
  lifeAdd('sets', { ex: 'Podciąganie', kg: 0, reps: 8, day: warsawDay(-10) });
  const n = coachNudges(at(17));
  assert.equal(n.length, 1);
  assert.equal(n[0][2], 'plecy: 10 dni bez treningu. Warto wpleść to w najbliższą sesję.');
});

test('podsumowanie tygodnia i start treningu z playlista', async () => {
  const w = coachWeekText();
  assert.match(w.text, /treningi: 2\/3/);
  let asked = null;
  const memSpotify = memory.load().spotifyRefreshToken;
  memory.load().spotifyRefreshToken = 'x';
  process.env.SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || 'id';
  process.env.SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || 's';
  const r = await startWorkout({ playMore: { playPlaylist: async (n) => { asked = n; return { name: 'GYM 💀' }; } } });
  memory.load().spotifyRefreshToken = memSpotify;
  assert.match(r.plan, /Push/);
  assert.ok(r.cwiczenia.length >= 4);
  assert.equal(r.klient.action, 'trening-start');
  if (r.muzyka) assert.equal(asked, 'GYM');
  assert.equal((await runCoachTool('tydzien_treningowy', {})).rekordy.length, 0);
  assert.equal(await runCoachTool('nie', {}), undefined);
  assert.equal(FitKit.planDay('ppl', 0).name, 'Push');
});
