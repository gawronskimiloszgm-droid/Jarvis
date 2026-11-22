import test, { after } from 'node:test';
import assert from 'node:assert/strict';

process.env.HEVY_API_KEY = 'testowy-klucz';
const memory = await import('../server/memory/memory.js');
const hevy = await import('../server/extras/hevy.js');
const { lifeList, lifeAdd, warsawDay } = await import('../server/extras/life.js');
const { FitKit } = await import('../server/extras/fitness.js');
const { runLifeTool, LIFE_TOOL_NAMES } = await import('../server/extras/lifevoice.js');

const before = JSON.parse(JSON.stringify(memory.load()));
memory.load().life = {};
delete memory.load().hevy;
after(() => {
  memory.save(before);
  delete process.env.HEVY_API_KEY;
});

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
// Trening w formacie Hevy: [tytul, id szablonu, [[kg, powt, typ], ...]].
function workout(id, daysAgo, title, exercises, { routine = 'r1', minutes = 60 } = {}) {
  const start = Date.now() - daysAgo * DAY;
  return {
    id, title, routine_id: routine, start_time: iso(start), end_time: iso(start + minutes * 60000), updated_at: iso(start + minutes * 60000),
    exercises: exercises.map(([t, tid, sets], i) => ({ index: i, title: t, exercise_template_id: tid, sets: sets.map(([kg, reps, type = 'normal'], j) => ({ index: j, type, weight_kg: kg, reps })) })),
  };
}
const TEMPLATES = { B1: 'chest', S1: 'quadriceps', P1: 'lats', C1: 'cardio' };
const calls = [];
let server = { workouts: [], events: [], body: [] };
const json = (data, status = 200) => ({ ok: status < 300, status, json: async () => data });
globalThis.fetch = async (url, opts) => {
  const u = new URL(String(url));
  calls.push(u.pathname + u.search);
  assert.equal(opts.headers['api-key'], 'testowy-klucz');
  if (u.pathname === '/v1/user/info') return json({ data: { name: 'Eryk', username: 'eryk', is_pro: true, weight_unit: 'kg' } });
  if (u.pathname === '/v1/workouts') {
    const page = Number(u.searchParams.get('page'));
    const list = [...server.workouts].sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
    return json({ page, page_count: Math.max(1, Math.ceil(list.length / 10)), workouts: list.slice((page - 1) * 10, page * 10) });
  }
  if (u.pathname === '/v1/workouts/events') return json({ page: 1, page_count: 1, events: server.events });
  if (u.pathname.startsWith('/v1/exercise_templates/')) {
    const id = u.pathname.split('/').pop();
    return TEMPLATES[id] ? json({ id, title: id, primary_muscle_group: TEMPLATES[id] }) : json({}, 404);
  }
  if (u.pathname === '/v1/routines') return json({ page: 1, page_count: 1, routines: server.routines || [] });
  if (u.pathname === '/v1/body_measurements') return json({ page: 1, page_count: 1, body_measurements: server.body });
  return json({}, 404);
};

test('pierwsza synchronizacja: historia bez powiadomien, rozgrzewki pominiete, partie z szablonow', async () => {
  server.workouts = [
    workout('w1', 14, 'Push', [['Bench Press (Barbell)', 'B1', [[20, 10, 'warmup'], [80, 8], [80, 8], [80, 7]]], ['Squat (Barbell)', 'S1', [[100, 5], [100, 5]]]]),
    workout('w2', 7, 'Push', [['Bench Press (Barbell)', 'B1', [[82.5, 8], [82.5, 7]]], ['Pull Up', 'P1', [[0, 8], [0, 7]]]]),
  ];
  server.body = [{ date: warsawDay(-3), weight_kg: 81.2 }];
  const r = await hevy.hevySync();
  assert.equal(r.ok, true);
  assert.equal(r.initial, true);
  assert.equal(r.added, 2);
  assert.deepEqual(r.notes, []);
  const sets = lifeList('sets');
  assert.equal(sets.length, 9, 'rozgrzewka nie trafia do serii');
  assert.ok(sets.every((s) => s.src === 'hevy' && s.wid));
  assert.equal(sets.find((s) => s.ex === 'Squat (Barbell)').mg, 'nogi');
  assert.equal(FitKit.partOf(sets.find((s) => s.ex === 'Pull Up')), 'plecy');
  assert.equal(lifeList('body')[0].kg, 81.2);
  assert.equal(hevy.hevyStatus().user.name, 'Eryk');
  assert.ok(calls.some((c) => c.startsWith('/v1/workouts?page=1&pageSize=10')));
});

test('nowy trening z wydarzen: opis z rekordem, postepem i zmiana objetosci, wpis w dzienniku', async () => {
  const w3 = workout('w3', 0.1, 'Push', [['Bench Press (Barbell)', 'B1', [[85, 8], [85, 8]]], ['Pull Up', 'P1', [[0, 10], [0, 9]]], ['Treadmill', 'C1', []]], { minutes: 70 });
  w3.exercises[2].sets = [{ index: 0, type: 'normal', distance_meters: 3000, duration_seconds: 900 }];
  server.events = [{ type: 'updated', workout: w3 }];
  const r = await hevy.hevySync();
  assert.equal(r.ok, true);
  assert.equal(r.added, 1);
  assert.ok(calls.some((c) => c.startsWith('/v1/workouts/events?since=')));
  const text = r.notes[0];
  assert.match(text, /^Push \(\d\d\.\d\d, 70 min\): 5 serii/);
  assert.match(text, /Rekordy: Bench Press \(Barbell\) 85 kg × 8 \(było 82,5 kg\)/);
  assert.match(text, /Pull Up 10 powt\. \(było 8 powt\.\)/);
  assert.doesNotMatch(text, /Mocniej/, 'rekord nie powtarza sie w "mocniej"');
  assert.match(text, /\+\d+% względem poprzedniego/);
  assert.match(text, /Cardio: Treadmill 3 km 15 min/);
  const journal = lifeList('journal');
  assert.match(journal[0].text, /^Hevy: Push/);
});

test('edycja i usuniecie treningu w Hevy podmienia serie, nie dubluje', async () => {
  const w3 = workout('w3', 0.1, 'Push', [['Bench Press (Barbell)', 'B1', [[85, 8]]]], { minutes: 70 });
  server.events = [{ type: 'updated', workout: w3 }, { type: 'deleted', id: 'w1' }];
  const r = await hevy.hevySync();
  assert.equal(r.updated, 1);
  assert.equal(r.removed, 1);
  assert.equal(r.added, 0);
  const sets = lifeList('sets');
  assert.equal(sets.filter((s) => s.wid === 'w3').length, 1);
  assert.equal(sets.filter((s) => s.wid === 'w1').length, 0);
  assert.equal(hevy.hevyStatus().workouts, 2);
});

test('postep cwiczenia po polsku i ogolny bilans', () => {
  const sets = lifeList('sets');
  assert.equal(hevy.findExercise('wyciskanie na ławce', sets), 'bench press barbell');
  assert.equal(hevy.findExercise('podciąganie', sets), 'pull up');
  assert.equal(hevy.findExercise('martwy ciąg', sets), null);
  const p = hevy.exerciseProgress(sets, 'wyciskanie', { weeks: 4 });
  assert.equal(p.sessions, 2);
  assert.ok(p.change > 0);
  assert.match(p.text, /Bench Press \(Barbell\): 2 sesji w 4 tyg\., szacowany 1RM/);
  const o = hevy.overallProgress(hevy.hevyStatus() && memory.load().hevy.workouts, sets);
  assert.equal(o.workouts, 2);
  assert.match(o.text, /^Ostatnie 4 tygodnie: 2 treningów/);
});

test('narzedzia glosowe i blad klucza', async () => {
  assert.ok(['hevy_trening', 'hevy_postep', 'hevy_synchronizuj'].every((n) => LIFE_TOOL_NAMES.includes(n)));
  const last = await runLifeTool('hevy_trening', {});
  assert.match(last.opis, /^Push/);
  const prog = await runLifeTool('hevy_postep', { cwiczenie: 'bench press' });
  assert.match(prog.opis, /Bench Press/);
  const saved = globalThis.fetch;
  globalThis.fetch = async () => json({ error: 'Unauthorized' }, 401);
  const r = await runLifeTool('hevy_synchronizuj', {});
  assert.match(r.error, /odrzuca klucz/);
  assert.equal(await hevy.maybeHevySync(Date.now() + 30 * 60000), null, 'po odrzuconym kluczu nie ponawia od razu');
  globalThis.fetch = saved;
});

test('bez klucza nic nie wysyla', async () => {
  delete process.env.HEVY_API_KEY;
  assert.equal(await hevy.maybeHevySync(), null);
  assert.match((await runLifeTool('hevy_synchronizuj', {})).error, /HEVY_API_KEY/);
  process.env.HEVY_API_KEY = 'testowy-klucz';
});

test('serie z modulu Trening bez Hevy dalej licza partie z nazwy', () => {
  const s = lifeAdd('sets', { ex: 'Przysiad', kg: 100, reps: 5, day: warsawDay(), src: 'reczne', mg: 'plecy' });
  assert.equal(s.src, undefined);
  assert.equal(FitKit.partOf(s), 'nogi');
});

test('webhook: zly token 404, dobry od razu 200 i pobiera zmiany przez API', async () => {
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use(hevy.default);
  const srv = app.listen(0);
  const port = srv.address().port;
  const realFetch = (await import('node:http')).request;
  const post = (path) => new Promise((resolve, reject) => {
    const req = realFetch({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => resolve(res.statusCode));
    req.on('error', reject);
    req.end('{"workoutId":"w9"}');
  });
  try {
    assert.equal(await post('/api/hevy/webhook/zly-token'), 404);
    const token = hevy.webhookToken();
    assert.equal(token.length, 32);
    assert.equal(hevy.hevyStatus().webhookPath, `/api/hevy/webhook/${token}`);
    server.events = [{ type: 'updated', workout: workout('w9', 0.05, 'Legs', [['Squat (Barbell)', 'S1', [[110, 5]]]]) }];
    assert.equal(await post(`/api/hevy/webhook/${token}`), 200);
    for (let i = 0; i < 40 && !memory.load().hevy.workouts.some((w) => w.id === 'w9'); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(memory.load().hevy.workouts.some((w) => w.id === 'w9'), 'trening z webhooka zapisany');
    assert.ok(hevy.hevyStatus().webhookAt > 0);
  } finally {
    srv.close();
  }
});

test('rutyny z Hevy: plan dnia to rutyna po ostatnio zrobionej, z ciezarami z historii', async () => {
  const { fitSummary } = await import('../server/extras/fitness.js');
  server.routines = [
    { id: 'r1', title: 'Push', folder_id: 7, exercises: [{ title: 'Bench Press (Barbell)', sets: [{ type: 'warmup', reps: 10 }, { type: 'normal', rep_range: { start: 6, end: 10 } }, { type: 'normal', rep_range: { start: 6, end: 10 } }] }] },
    { id: 'r2', title: 'Pull', folder_id: 7, exercises: [{ title: 'Pull Up', sets: [{ type: 'normal', reps: 8 }, { type: 'normal', reps: 8 }, { type: 'normal', reps: 8 }] }, { title: 'Plank', sets: [{ type: 'normal', duration_seconds: 60 }] }] },
  ];
  server.events = [];
  memory.load().hevy.routinesAt = 0;
  assert.equal((await hevy.hevySync()).ok, true);
  assert.deepEqual(memory.load().hevy.routines[0].ex, [['Bench Press (Barbell)', 2, '6-10']]);
  // Ostatni trening z rutyna r1 to Push (w3 i w9 maja routine r1), wiec dzis Pull.
  const s = fitSummary();
  assert.equal(s.plan.program, 'Hevy');
  assert.equal(s.plan.name, 'Pull');
  assert.deepEqual(s.plan.ex, [['Pull Up', 3, '8'], ['Plank', 1, '60 s']]);
  assert.ok(s.planLoads['Pull Up'], 'podpowiedz z historii podciagania');
  assert.equal(hevy.nextRoutine([], []), null);
});
