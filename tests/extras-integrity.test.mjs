import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../public/', import.meta.url);
const loader = fs.readFileSync(new URL('extras/loader.js', root), 'utf8');
const files = [...loader.match(/const FILES = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('loader: kazdy wymieniony dodatek istnieje i ma poprawna skladnie', () => {
  assert.ok(files.length >= 40, `za malo dodatkow: ${files.length}`);
  assert.equal(new Set(files).size, files.length, 'powtorzone pliki w loaderze');
  for (const f of files) {
    const url = new URL(`extras/${f}.js`, root);
    assert.ok(fs.existsSync(url), `brak pliku extras/${f}.js`);
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(url, 'utf8'), { filename: `${f}.js` }), `blad skladni w ${f}.js`);
  }
});

test('index.html i app.js maja poprawna skladnie, a cad-view tez', () => {
  for (const f of ['app.js', 'cad-view.js', 'edith.js', 'sfx.js']) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(new URL(f, root), 'utf8'), { filename: f }), `blad skladni w ${f}`);
  }
});

test('moduly klienta rejestruja unikalne identyfikatory', () => {
  const ids = [];
  for (const f of files) {
    const src = fs.readFileSync(new URL(`extras/${f}.js`, root), 'utf8');
    for (const m of src.matchAll(/(?:UI\.register\(\{\s*id:|\bmod\()\s*'([a-z0-9-]+)'/g)) ids.push(m[1]);
  }
  assert.ok(ids.length >= 15, `zarejestrowano tylko ${ids.length} modulow`);
  assert.equal(new Set(ids).size, ids.length, `powtorzone moduly: ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
});

test('lista nocnej rozbudowy ma co najmniej 200 punktow', () => {
  const doc = fs.readFileSync(new URL('../docs/NOC-200.md', import.meta.url), 'utf8');
  const items = doc.match(/^\d+\. \[[ x~]\]/gm) || [];
  assert.ok(items.length >= 200, `tylko ${items.length} punktow`);
});
