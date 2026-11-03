import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pc = require('../desktop/pcPlus.js');
const { judge } = require('../desktop/edithPolicy.js');

test('duze pliki: kolejnosc, rozmiar, stare pliki i glebokosc', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-dl-'));
  fs.writeFileSync(path.join(dir, 'maly.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'duzy.bin'), Buffer.alloc(3 * 1048576));
  fs.mkdirSync(path.join(dir, 'a', 'b', 'c'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a', 'sredni.bin'), Buffer.alloc(1048576));
  fs.writeFileSync(path.join(dir, 'a', 'b', 'c', 'za-gleboko.bin'), Buffer.alloc(5 * 1048576));
  const old = Date.now() / 1000 - 200 * 86400;
  fs.utimesSync(path.join(dir, 'maly.txt'), old, old);
  const r = await pc.bigFiles({ dir, depth: 2 });
  assert.deepEqual(r.biggest.map((f) => f.name), ['duzy.bin', path.join('a', 'sredni.bin'), 'maly.txt']);
  assert.equal(r.biggest[0].mb, 3);
  assert.equal(r.oldCount, 1);
  assert.equal(r.count, 3);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal((await pc.bigFiles({ dir: path.join(dir, 'nie-ma') })).count, 0);
});

test('dyski: liczby sa sensowne', async () => {
  const d = await pc.disks();
  assert.ok(d.length >= 1);
  for (const x of d) assert.ok(x.totalGb > 0 && x.freeGb <= x.totalGb, JSON.stringify(x));
});

test('przypinanie: tytul tylko jako tekst, a polityka wpuszcza nowe akcje', () => {
  const s = pc.pinScript("x'; Stop-Computer; '", true);
  assert.ok(s.includes("'x''; Stop-Computer; '''"));
  assert.match(s, /IntPtr\]::new\(-1\)/);
  assert.match(pc.pinScript('a', false), /IntPtr\]::new\(-2\)/);
  for (const a of ['duze-pliki', 'dyski', 'otworz-pobrane', 'przypnij-okno', 'lista-akcji']) assert.equal(judge(a).allow, true, a);
});
