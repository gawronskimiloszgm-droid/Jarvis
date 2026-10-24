import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { cleanSteps } from '../server/extras/macros.js';
import { REMOTE_ALLOWED } from '../server/extras/remote.js';
import { judge, READ_ONLY, SAFE_ACTIONS } from '../server/security/edithPolicy.js';

const require = createRequire(import.meta.url);

test('makra: kroki sa czyszczone, a parametry splaszczone', () => {
  const steps = cleanSteps([
    { akcja: 'pisz-tekst', params: { tekst: 'hej {{arg}}', x: { a: 1 }, n: 3 } },
    { akcja: 'Zla Nazwa' },
    { akcja: 'glosniej' },
    null,
  ]);
  assert.deepEqual(steps, [{ akcja: 'pisz-tekst', params: { tekst: 'hej {{arg}}', n: 3 } }, { akcja: 'glosniej' }]);
  assert.deepEqual(cleanSteps('nie tablica'), []);
});

test('pilot: zdalnie tylko waska lista akcji, bez zabijania procesow i plikow', () => {
  for (const forbidden of ['zamknij-proces', 'zawies-proces', 'zapisz-plik', 'czytaj-plik', 'polecenie', 'sterowanie-siecia']) {
    assert.equal(REMOTE_ALLOWED.has(forbidden), false, forbidden);
  }
  for (const a of REMOTE_ALLOWED) assert.ok(SAFE_ACTIONS.has(a), `${a} musi byc znana polityce`);
});

test('polityka: nowe akcje odczytu przechodza w trybie podgladu, zmiana ustawien nie', () => {
  for (const a of ['telemetria', 'czas-pracy', 'bateria', 'proces-dziala']) {
    assert.ok(READ_ONLY.has(a), a);
    assert.equal(judge(a, '', { mode: 'podglad' }, {}).allow, true, a);
  }
  assert.ok(!READ_ONLY.has('czas-pracy-ustaw'));
  assert.equal(judge('czas-pracy-ustaw', '', { mode: 'podglad' }, {}).allow, false);
});

test('polityka desktop i serwer sa zsynchronizowane', () => {
  const desktop = require('../desktop/edithPolicy.js');
  assert.deepEqual([...desktop.SAFE_ACTIONS].sort(), [...SAFE_ACTIONS].sort());
  assert.deepEqual([...desktop.READ_ONLY].sort(), [...READ_ONLY].sort());
});

test('patrol: stale reguly ryzyka wykrywaja koparke, RDP i brak pelnego skanu', () => {
  const { riskFindings, exeOf } = require('../desktop/patrol.js');
  assert.equal(exeOf('"C:\\Program Files\\X\\x.exe" --auto'), 'C:\\Program Files\\X\\x.exe');
  assert.equal(exeOf('C:\\Tools\\y.exe /s'), 'C:\\Tools\\y.exe');
  const f = riskFindings(
    [
      { where: 'Rejestr', name: 'XMRig helper', command: '"C:\\nope\\xmrig.exe"' },
      { where: 'Rejestr', name: 'Setup', command: '"C:\\Users\\a\\Downloads\\setup.exe"' },
      { where: 'Rejestr', name: 'Stary', command: '"C:\\nie\\ma\\stary.exe"' },
    ],
    { status: { lastFullScan: '' } },
    { rdp: true, listening: true }
  );
  const keys = f.map((x) => x.key);
  assert.ok(keys.includes('miner:XMRig helper'));
  assert.ok(keys.includes('rdp'));
  assert.ok(keys.includes('fullscan'));
  assert.ok(keys.includes('orphans'));
  assert.equal(f.find((x) => x.key === 'miner:XMRig helper').level, 'info'); // pliku nie ma
});
