import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// activity.js to skrypt przegladarkowy - uruchamiamy go z minimalnymi atrapami.
function load({ live = false, level = 'zywo' } = {}) {
  const sent = [];
  const said = [];
  const handlers = {};
  const store = { 'jarvis.react': level };
  const UI = {
    isLive: () => live,
    liveSend: (o) => sent.push(o),
    pushSaid: (w, t) => said.push(t),
    speak: () => {},
  };
  const window = {
    JarvisUI: UI,
    addEventListener: (n, f) => ((handlers[n] = handlers[n] || []).push(f)),
    dispatchEvent: () => {},
  };
  const ctx = {
    window,
    document: { body: { classList: { contains: () => false } } },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v) },
    CustomEvent: class { constructor(n, o) { this.type = n; this.detail = o?.detail; } },
    setTimeout: (f) => { f(); return 0; },
    Date,
  };
  vm.runInNewContext(fs.readFileSync(new URL('../public/extras/activity.js', import.meta.url), 'utf8'), ctx);
  return { UI, sent, said, fire: (n, detail) => (handlers[n] || []).forEach((f) => f({ detail })) };
}

test('decyzja: wylaczone, cisza, kino i tempo blokuja reakcje', () => {
  const { UI } = load();
  const d = UI.activity._decide;
  const base = { lvl: 'zywo', now: 100000, lastAt: 0, important: true, dnd: false, cinema: false, isLive: false, busy: false };
  assert.equal(d(base).react, true);
  assert.equal(d({ ...base, lvl: 'off' }).react, false);
  assert.equal(d({ ...base, dnd: true }).react, false);
  assert.equal(d({ ...base, cinema: true }).react, false);
  assert.equal(d({ ...base, lastAt: 95000 }).react, false);
  assert.equal(d({ ...base, lvl: 'rzadko', important: false }).react, false);
  assert.equal(d({ ...base, isLive: true }).via, 'live');
});

test('poza rozmowa: otwarcie grafu daje kwestie Jarvisa, drugie otwarcie juz nie', () => {
  const { UI, said, fire } = load();
  fire('jarvis:module', { id: 'graph', title: 'Graf wiedzy' });
  assert.equal(said.length, 1);
  assert.match(said[0], /Graf wiedzy/);
  fire('jarvis:module', { id: 'graph', title: 'Graf wiedzy' });
  assert.equal(said.length, 1);
  assert.equal(UI.activity.recent().length, 1); // ten sam tekst tuz po sobie nie dubluje wpisu
});

test('w rozmowie na zywo: zdarzenia ida jako cicha notatka, wazne jako reakcja', () => {
  const { UI, sent } = load({ live: true });
  UI.activity.emit('dane', 'Dodano do zakupow: mleko');
  assert.ok(sent.some((m) => m.type === 'note' && m.text.startsWith('[UI]') && m.text.includes('mleko')));
  assert.ok(!sent.some((m) => m.type === 'react'));
  UI.activity.emit('graf', 'Wybrano pojecie Entropia', { react: true });
  assert.ok(sent.some((m) => m.type === 'react' && m.text.includes('Entropia')));
});

test('recent: format do kontekstu czatu', () => {
  const { UI } = load({ level: 'off' });
  UI.activity.emit('modul', 'Otwarto Pulpit');
  assert.match(UI.activity.recent(5)[0], /modul: Otwarto Pulpit$/);
});
