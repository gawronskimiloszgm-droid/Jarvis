import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { judge as serverJudge, SAFE_ACTIONS as serverSafe } from '../server/security/edithPolicy.js';

const require = createRequire(import.meta.url);
const desktop = require('../desktop/edithPolicy.js');

test('desktop i serwer maja identyczna liste dozwolonych akcji', () => {
  assert.deepEqual([...desktop.SAFE_ACTIONS].sort(), [...serverSafe].sort());
});

for (const [label, judge] of [['desktop', desktop.judge], ['serwer', serverJudge]]) {
  test(`${label}: nieznana akcja jest blokowana`, () => {
    assert.equal(judge('nie-ma-takiej').allow, false);
  });

  test(`${label}: zwykla akcja przechodzi`, () => {
    assert.equal(judge('otworz-spotify').allow, true);
    assert.equal(judge('otworz-aplikacje', '', {}, { nazwa: 'notepad' }).allow, true);
  });

  test(`${label}: zamkniecie procesu i zasilanie wymagaja potwierdzenia`, () => {
    for (const name of ['zamknij-proces', 'wylacz-komputer', 'restart-komputera']) {
      const v = judge(name, '', {}, { nazwa: 'x.exe' });
      assert.equal(v.allow, false, name);
      assert.equal(v.requiresConfirmation, true, name);
      assert.equal(judge(name, '', { confirmedByEdith: true }, { nazwa: 'x.exe' }).allow, true, `${name} po potwierdzeniu`);
    }
  });

  test(`${label}: wylaczenie sieci pyta, wlaczenie nie`, () => {
    assert.equal(judge('sterowanie-siecia', '', {}, { wlacz: false }).requiresConfirmation, true);
    assert.equal(judge('sterowanie-siecia', '', {}, { wlacz: true }).allow, true);
  });

  test(`${label}: grozne polecenia sa blokowane na stale`, () => {
    for (const cmd of ['format c:', 'Set-MpPreference -DisableRealtimeMonitoring $true', 'netsh advfirewall set allprofiles state off', 'mimikatz', 'bcdedit /set x y']) {
      const v = judge('polecenie', cmd);
      assert.equal(v.allow, false, cmd);
      assert.ok(!v.requiresConfirmation, `${cmd} nie moze byc "do potwierdzenia"`);
    }
  });

  test(`${label}: ryzykowne, ale odwracalne polecenia pytaja o zgode`, () => {
    for (const cmd of ['taskkill /IM notepad.exe /F', 'Remove-Item C:\temp\a.txt', 'shutdown /s']) {
      const v = judge('polecenie', cmd);
      assert.equal(v.requiresConfirmation, true, cmd);
      assert.equal(judge('polecenie', cmd, { confirmedByEdith: true }).allow, true, `${cmd} po zgodzie`);
    }
  });

  test(`${label}: puste i zbyt dlugie polecenie`, () => {
    assert.equal(judge('polecenie', '').allow, false);
    assert.equal(judge('polecenie', 'a'.repeat(5000)).allow, false);
    assert.equal(judge('polecenie', 'Get-ChildItem').allow, true);
  });
}

// --- tryby uprawnien ---
import { READ_ONLY as serverReadOnly } from '../server/security/edithPolicy.js';

test('READ_ONLY identyczne po obu stronach i zawiera sie w SAFE_ACTIONS', () => {
  assert.deepEqual([...desktop.READ_ONLY].sort(), [...serverReadOnly].sort());
  for (const a of desktop.READ_ONLY) assert.ok(desktop.SAFE_ACTIONS.has(a), a);
});

for (const [label, judge] of [['desktop', desktop.judge], ['serwer', serverJudge]]) {
  test(`${label}: tryb "podglad" przepuszcza tylko odczyt`, () => {
    const o = { mode: 'podglad' };
    assert.equal(judge('szukaj-plikow', '', o, { zapytanie: 'x' }).allow, true);
    assert.equal(judge('lista-procesow', '', o).allow, true);
    assert.equal(judge('otworz-aplikacje', '', o, { nazwa: 'notepad' }).allow, false);
    assert.equal(judge('glosniej', '', o).allow, false);
    assert.equal(judge('polecenie', 'Get-ChildItem', o).allow, false);
  });

  test(`${label}: tryb "pytaj" wymaga zgody na zmiany, nie na odczyt`, () => {
    const o = { mode: 'pytaj' };
    assert.equal(judge('lista-okien', '', o).allow, true);
    const v = judge('otworz-spotify', '', o);
    assert.equal(v.requiresConfirmation, true);
    assert.equal(judge('otworz-spotify', '', { ...o, confirmedByEdith: true }).allow, true);
    assert.equal(judge('polecenie', 'Get-ChildItem', o).requiresConfirmation, true);
  });

  test(`${label}: blokady krytyczne dzialaja w KAZDYM trybie`, () => {
    for (const mode of ['podglad', 'pytaj', 'zaufany']) {
      const v = judge('polecenie', 'format c:', { mode, confirmedByEdith: true });
      assert.equal(v.allow, false, mode);
    }
  });

  test(`${label}: nieznany tryb spada do "zaufany"`, () => {
    assert.equal(judge('otworz-spotify', '', { mode: 'cokolwiek' }).allow, true);
  });

  test(`${label}: zawieszenie procesu wymaga potwierdzenia`, () => {
    assert.equal(judge('zawies-proces', '', {}, { nazwa: 'x.exe' }).requiresConfirmation, true);
  });
}
