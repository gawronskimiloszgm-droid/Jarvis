import test, { after } from 'node:test';
import assert from 'node:assert/strict';

process.env.PRINTER_URL = 'http://drukarka.local';
delete process.env.PRINTER_API_KEY;
const memory = await import('../server/memory/memory.js');
const printer = await import('../server/home/printer.js');
const { addPrint, queueSummary, watchPrinter, runPrintTool } = await import('../server/extras/printq.js');

const before = JSON.parse(JSON.stringify(memory.load()));
delete memory.load().printQueue;
delete memory.load().printerLast;
after(() => memory.save(before));

const json = (data, status = 200) => ({ ok: status < 300, status, json: async () => data, headers: new Map([['content-type', 'application/json']]) });

test('bez klucza to Moonraker; stan z print_stats i postepu', async () => {
  assert.equal(printer.isConfigured(), true);
  assert.equal(printer.printerType(), 'moonraker');
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/printer\/objects\/query\?print_stats&virtual_sdcard$/);
    return json({ result: { status: { print_stats: { state: 'printing', filename: 'uchwyt.gcode', print_duration: 1800 }, virtual_sdcard: { progress: 0.25 } } } });
  };
  assert.deepEqual(await printer.jobStatus(), { state: 'printing', fileName: 'uchwyt.gcode', progressPct: 25, printTimeLeftSec: 5400 });
  globalThis.fetch = async () => {
    throw new Error('siec');
  };
  assert.deepEqual(await printer.jobStatus(), { state: 'offline' });
});

test('OctoPrint z kluczem: ten sam ksztalt stanu', async () => {
  process.env.PRINTER_API_KEY = 'k';
  globalThis.fetch = async (url, o) => {
    assert.equal(o.headers['X-Api-Key'], 'k');
    return json({ state: 'Printing', job: { file: { name: 'a.gcode' } }, progress: { completion: 42.4, printTimeLeft: 600 } });
  };
  assert.equal(printer.printerType(), 'octoprint');
  assert.deepEqual(await printer.jobStatus(), { state: 'printing', fileName: 'a.gcode', progressPct: 42, printTimeLeftSec: 600 });
  delete process.env.PRINTER_API_KEY;
});

test('kolejka: dodawanie, podsumowanie z kopiami', () => {
  addPrint({ name: 'Uchwyt', minutes: 90, grams: 30, copies: 2 });
  addPrint({ name: 'Dystans', minutes: 15, grams: 4 });
  assert.equal(addPrint({ name: '' }), null);
  assert.deepEqual(queueSummary(), { count: 2, minutes: 195, grams: 64, next: 'Uchwyt' });
});

test('koniec druku: wpis drukujacy oznaczony jako gotowy, przerwany jako nieudany', async () => {
  const q = memory.load().printQueue;
  q[0].status = 'drukuje';
  await watchPrinter(async () => ({ state: 'printing', fileName: 'uchwyt.gcode' }));
  const ev = await watchPrinter(async () => ({ state: 'finished', fileName: 'uchwyt.gcode' }));
  assert.match(ev, /Wydruk zakończony: uchwyt.gcode/);
  assert.equal(q[0].status, 'gotowe');
  q[1].status = 'drukuje';
  await watchPrinter(async () => ({ state: 'printing', fileName: 'd.gcode' }));
  assert.equal(await watchPrinter(async () => ({ state: 'offline' })), null, 'chwilowy brak polaczenia to nie koniec druku');
  assert.match(await watchPrinter(async () => ({ state: 'error', fileName: 'd.gcode' })), /przerwany/);
  assert.equal(q[1].status, 'nieudane');
  assert.equal(await watchPrinter(async () => ({ state: 'idle' })), null);
});

test('glos: stan drukarki i dopisanie do kolejki', async () => {
  globalThis.fetch = async () => json({ result: { status: { print_stats: { state: 'standby' }, virtual_sdcard: { progress: 0 } } } });
  const r = await runPrintTool('drukarka', {});
  assert.equal(r.drukarka.stan, 'idle');
  assert.match((await runPrintTool('drukarka', { dodaj: 'uchwyt na latarke' })).dodano, /latarke/);
  assert.equal(await runPrintTool('inne', {}), undefined);
});
