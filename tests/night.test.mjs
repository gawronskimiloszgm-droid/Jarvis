import test, { after } from 'node:test';
import assert from 'node:assert/strict';

const memory = await import('../server/memory/memory.js');
const N = await import('../server/extras/night.js');
const { lifeAdd } = await import('../server/extras/life.js');
const { LIFE_TOOL_NAMES } = await import('../server/extras/lifevoice.js');

const before = JSON.parse(JSON.stringify(memory.load()));
delete memory.load().night;
memory.load().life = {};
after(() => memory.save(before));

// Czwartek 26.11.2026 i piatek 27.11.2026 (zima, UTC+1).
const THU_2200 = Date.UTC(2026, 10, 26, 21, 0);
const FRI_0600 = Date.UTC(2026, 10, 27, 5, 0);
const SAT_0700 = Date.UTC(2026, 10, 28, 6, 0);

test('harmonogram: wylaczony nie dzwoni, dni robocze, godzina w czasie warszawskim, tez latem', () => {
  assert.equal(N.nextCall(THU_2200, { ...N.wakeSettings(), enabled: false }), null);
  const s = { enabled: true, time: '06:00', days: [1, 2, 3, 4, 5], sleepFrom: '22:30' };
  assert.equal(N.nextCall(THU_2200, s), FRI_0600);
  // Po piatkowym telefonie nastepny dopiero w poniedzialek 30.11.
  assert.equal(N.nextCall(FRI_0600, s), Date.UTC(2026, 10, 30, 5, 0));
  assert.equal(N.nextCall(FRI_0600, { ...s, days: [6] }), Date.UTC(2026, 10, 28, 5, 0));
  // Lipiec: UTC+2.
  assert.equal(N.nextCall(Date.UTC(2026, 6, 1, 12, 0), { ...s, days: [4] }), Date.UTC(2026, 6, 2, 4, 0));
  // Noc zaczyna sie wczoraj o 22:30.
  assert.equal(N.nightStart(FRI_0600, s), Date.UTC(2026, 10, 26, 21, 30));
});

const mail = (id, hoursBefore, subject, from) => ({ id, threadId: `t${id}`, subject, from, date: new Date(FRI_0600 - hoursBefore * 3600000).toUTCString(), snippet: subject });

test('praca w nocy: tylko maile z nocy, kategorie, nastroj, szkice do zatwierdzenia (nic nie wysyla)', async () => {
  const sent = [];
  const gmail = {
    isOAuthConfigured: () => true,
    isConnected: () => true,
    listRecentInboxMessages: async () => [mail('1', 2, 'Gdzie moja faktura?!', 'Jan Kowalski <jan@x.pl>'), mail('2', 3, 'Spotkanie w piątek', '"Anna" <anna@x.pl>'), mail('3', 4, 'Promocja', 'sklep@x.pl'), mail('4', 20, 'Stary mail', 'stary@x.pl')],
    sendPlainTextMessage: async (m) => sent.push(m),
  };
  const triage = {
    classifyMessages: async (list) => list.map((m) => ({ ...m, kategoria: m.id === '1' ? 'pilny' : m.id === '2' ? 'odpowiedz' : 'spam', streszczenie: `o: ${m.subject}`, nastroj: m.id === '1' ? 'zdenerwowany' : 'neutralny' })),
    draftReply: async (item) => ({ draft: `Odp: ${item.subject}`, to: item.from, subject: `Re: ${item.subject}`, threadId: item.threadId }),
  };
  const since = Date.UTC(2026, 10, 26, 21, 30);
  const w = await N.nightWork({ since, deps: { gmail, triage } });
  assert.equal(w.mail.count, 3, 'mail sprzed nocy pominiety');
  assert.deepEqual(w.mail.byCat, { pilny: 1, odpowiedz: 1, info: 0, spam: 1 });
  assert.deepEqual(w.mail.angry.map((x) => x.from), ['Jan Kowalski']);
  const drafts = memory.load().night.drafts;
  assert.equal(drafts.length, 2);
  assert.ok(drafts.every((d) => d.status === 'czeka'));
  assert.equal(drafts[0].angry, true);
  assert.equal(sent.length, 0, 'nic nie wyslane');
});

test('raport: maile, kto jest zly, szkice, alarmy z nocy i odprawa; spokojna noc', async () => {
  memory.load().night.work.at = FRI_0600 - 3600000;
  memory.load().night.settings = { ...N.wakeSettings(), sleepFrom: '22:30' };
  const realNow = Date.now;
  lifeAdd('journal', { text: 'E.D.I.T.H.: zablokowano nieznany skrypt', kind: 'manual' });
  memory.load().life.journal[0].kind = 'alert';
  memory.load().life.journal[0].at = FRI_0600 - 2 * 3600000;
  const r = await N.nightReport({ now: FRI_0600, deps: { buildBrief: async () => 'Pogoda w Warszawie: 2°C.' } });
  Date.now = realNow;
  assert.match(r.text, /^W nocy przyszły 3 maile: 1 pilny, 1 czeka na odpowiedź, 1 reklama\. Przygotowałem 2 szkice odpowiedzi, czekają/);
  assert.deepEqual([N.pl(1, 'mail', 'maile', 'maili'), N.pl(4, 'mail', 'maile', 'maili'), N.pl(5, 'mail', 'maile', 'maili'), N.pl(12, 'mail', 'maile', 'maili'), N.pl(22, 'mail', 'maile', 'maili')], ['1 mail', '4 maile', '5 maili', '12 maili', '22 maile']);
  assert.match(r.text, /Ktoś jest niezadowolony: Jan Kowalski \(Gdzie moja faktura\?!\)/);
  assert.match(r.text, /Alarmy w nocy: \d\d:\d\d E\.D\.I\.T\.H\.: zablokowano/);
  assert.match(r.text, /Pogoda w Warszawie: 2°C\.$/);
  assert.equal(r.quiet, false);
  // Noc bez maili i alarmow.
  memory.load().night.work = { at: FRI_0600 - 3600000, mail: { count: 0, byCat: {}, urgent: [], angry: [], needReply: [] } };
  memory.load().life.journal = [];
  const q = await N.nightReport({ now: FRI_0600, deps: { buildBrief: async () => '' } });
  assert.equal(q.quiet, true);
  assert.match(q.text, /W nocy nie przyszedł żaden mail\. Od 22:30 nic nie wymagało Twojej uwagi\./);
});

test('dzwonienie raz dziennie w oknie po godzinie pobudki, nie w weekend', async () => {
  N.wakeSettings({ enabled: true, time: '06:00', days: [1, 2, 3, 4, 5], nightWork: false });
  assert.equal(await N.fireIfDue(FRI_0600 - 60000), null, 'przed godzina');
  const id = await N.fireIfDue(FRI_0600 + 60000);
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.equal(await N.fireIfDue(FRI_0600 + 5 * 60000), null, 'drugi raz tego dnia nie');
  assert.equal(await N.fireIfDue(SAT_0700), null, 'sobota poza dniami');
  assert.equal(N.answerCall(id), true);
  // Budzik w aplikacji na Androida: serwer nie dzwoni drugi raz.
  N.wakeSettings({ enabled: true, nativeAlarm: true });
  delete memory.load().night.callDay;
  assert.equal(await N.fireIfDue(FRI_0600 + 60000), 'telefon');
  N.wakeSettings({ enabled: false, nativeAlarm: false });
});

test('narzedzia glosowe', async () => {
  assert.ok(['raport_nocny', 'poranny_telefon'].every((n) => LIFE_TOOL_NAMES.includes(n)));
  const { runLifeTool } = await import('../server/extras/lifevoice.js');
  const r = await runLifeTool('poranny_telefon', { godzina: '05:45', dni: [1, 3, 5] });
  assert.deepEqual([r.godzina, r.dni, r.wlaczony], ['05:45', [1, 3, 5], true]);
  assert.ok(r.nastepny);
  N.wakeSettings({ enabled: false });
});
