import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as memory from '../server/memory/memory.js';
import { logSets, fitSummary, fitProfile, runFitTool, persistFitTags, FIT_TOOLS, FIT_TAGS, FIT_TAG_PROMPT } from '../server/extras/fitness.js';
import { LIFE_TOOLS, LIFE_TAG_PROMPT } from '../server/extras/lifevoice.js';

// Testy dzialaja na pamieci procesu: na koniec przywracamy to, co bylo, zeby nie zostawic smieci.
const before = JSON.parse(JSON.stringify(memory.load()));
memory.load().life = {};
delete memory.load().fitProfile;
after(() => memory.save(before));

test('seria: zapis, przerwa dla ekranu i rekord dopiero od drugiego razu', () => {
  const first = logSets({ ex: 'Przysiad', kg: 100, reps: 5 });
  assert.equal(first.ok, true);
  assert.equal(first.pierwszy_raz, true);
  assert.equal(first.rekord, null);
  assert.deepEqual(first.klient, { action: 'trening-przerwa', params: { sekundy: 120, cwiczenie: 'Przysiad' } });
  const pr = logSets({ ex: 'przysiad', kg: 110, reps: 5, sets: 2 });
  assert.match(pr.rekord, /rekord ciezaru/);
  assert.equal(pr.serii_dzis, 3);
  assert.match(logSets({ ex: '', reps: 5 }).error, /cwiczenie/);
});

test('podsumowanie: dzisiejsze serie, podpowiedz i objetosc', () => {
  const s = fitSummary();
  assert.equal(s.today.length, 3);
  assert.equal(s.suggestions[0].kg, 110);
  assert.equal(s.week.nogi.sets, 3);
  assert.equal(s.plan.name, 'Push');
  assert.equal(s.energy, null, 'bez profilu nie ma celu kalorii');
});

test('profil ogranicza wartosci i liczy cel kalorii po wadze', async () => {
  const p = fitProfile({ age: 25, height: 180, activity: 9, program: 'nie-ma', rest: 5, goal: 'masa' });
  assert.equal(p.activity, 2);
  assert.equal(p.program, 'ppl');
  assert.equal(p.rest, 15);
  await runFitTool('masa_ciala', { kg: 80 });
  await runFitTool('masa_ciala', { kg: 79.5 });
  const s = fitSummary();
  assert.equal(s.weight.count, 1, 'drugi pomiar tego samego dnia zastepuje pierwszy');
  assert.equal(s.weight.last, 79.5);
  assert.ok(s.energy.kcal > s.energy.tdee);
});

test('narzedzia glosowe: talerze, rundy, posilek, sen, bilans', async () => {
  assert.equal((await runFitTool('talerze', { kg: 100 })).na_strone, '25 + 15');
  assert.ok((await runFitTool('talerze', { kg: 100, rozgrzewka: true })).rozgrzewka.length >= 3);
  assert.match((await runFitTool('talerze', { kg: 10 })).error, /sztanga/);
  const r = await runFitTool('rundy', { rundy: 99, praca_s: 5 });
  assert.equal(r.klient.action, 'trening-rundy');
  assert.equal(r.rundy, 30);
  assert.equal(r.praca_s, 10);
  const meal = await runFitTool('posilek', { opis: 'kurczak z ryzem', kcal: 650, bialko: 45 });
  assert.equal(meal.dzis_kcal, 650);
  assert.equal(meal.cel_ustawiony, true);
  assert.equal((await runFitTool('sen', { od: '23:30', do: '07:00' })).godzin, 7.5);
  assert.match((await runFitTool('sen', {})).error, /godziny/);
  const b = await runFitTool('bilans_dnia', {});
  assert.equal(b.kcal, 650);
  assert.equal(b.sen_ostatni, 7.5);
  assert.equal(await runFitTool('nie_ma_takiego', {}), undefined);
});

test('informacje o cwiczeniu i ogolne', async () => {
  const ex = await runFitTool('trening_info', { cwiczenie: 'PRZYSIAD' });
  assert.equal(ex.rekord_kg, 110);
  assert.equal(ex.ostatnio.serie.length, 3);
  assert.match((await runFitTool('trening_info', { cwiczenie: 'wioslowanie' })).info, /brak/);
  const all = await runFitTool('trening_info', {});
  assert.match(all.plan_na_dzis, /Push/);
  assert.equal(all.dni_od_partii.nogi, 0);
});

test('znaczniki czatu zapisuja dane', () => {
  persistFitTags('Zapisane. [SERIA: 3 serie po 10 podciąganie] [WAGA: 79,0] [POSILEK: owsianka | 450 | 20] [SEN: 6,5]');
  const s = fitSummary();
  assert.equal(s.today.filter((x) => /podci/i.test(x.ex)).length, 3);
  assert.equal(s.weight.last, 79);
  assert.equal(s.intake.kcal, 1100);
  for (const tag of Object.keys(FIT_TAGS)) assert.ok(FIT_TAG_PROMPT.includes(`[${tag}:`));
  assert.ok(LIFE_TAG_PROMPT.includes('[SERIA:'));
});

test('narzedzia trafiaja na liste narzedzi glosowych bez powtorzen', () => {
  const names = LIFE_TOOLS.map((t) => t.name);
  for (const t of FIT_TOOLS) assert.ok(names.includes(t.name));
  assert.equal(new Set(names).size, names.length);
});
