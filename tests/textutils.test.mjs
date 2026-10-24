import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chunkText, rankChunks, tokenize } from '../server/extras/textutils.js';

const require = createRequire(import.meta.url);
const { isSensitivePath } = require('../desktop/sensitivePaths.js');

test('chunkText: krotki tekst to jeden fragment, pusty to zero', () => {
  assert.deepEqual(chunkText('Ala ma kota.'), ['Ala ma kota.']);
  assert.deepEqual(chunkText('   '), []);
});

test('chunkText: dlugi tekst jest ciety na akapitach i nie traci tresci', () => {
  const t = Array.from({ length: 60 }, (_, i) => `Akapit ${i}. ${'slowo '.repeat(60)}`).join('\n\n');
  const chunks = chunkText(t, 1500, 100);
  assert.ok(chunks.length > 5);
  assert.ok(chunks.every((c) => c.length <= 1600));
  for (let i = 0; i < 60; i++) assert.ok(chunks.some((c) => c.includes(`Akapit ${i}.`)), `brak akapitu ${i}`);
});

test('rankChunks: znajduje fragment z odpowiedzia mimo fleksji', () => {
  const chunks = [
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
    'Termin platnosci umowy wynosi 30 dni od dostarczenia faktury.',
    'Zupelnie inny temat: pogoda i wakacje nad morzem.',
  ];
  assert.equal(rankChunks(chunks, 'jaki jest termin platnosci tej umowy?', 1)[0], 1);
  assert.equal(rankChunks(chunks, 'wakacje nad morzem', 1)[0], 2);
});

test('tokenize: bez polskich znakow, bez slow-wypelniaczy', () => {
  assert.ok(tokenize('Łódź i okolice').includes('lodz'));
  assert.ok(!tokenize('to jest na').length);
});

test('isSensitivePath: poswiadczenia zablokowane, zwykle dokumenty nie', () => {
  for (const p of ['C:\\Users\\Eryk\\.ssh\\id_rsa', 'C:\\app\\.env', 'C:\\Users\\x\\AppData\\Roaming\\Microsoft\\Credentials\\a', '/home/u/.aws/credentials', 'C:\\Windows\\System32\\config\\SAM']) {
    assert.equal(isSensitivePath(p), true, p);
  }
  for (const p of ['C:\\Users\\Eryk\\Documents\\umowa.pdf', 'D:\\env\\notes.txt', 'C:\\projekty\\sshclient\\readme.md']) {
    assert.equal(isSensitivePath(p), false, p);
  }
});
