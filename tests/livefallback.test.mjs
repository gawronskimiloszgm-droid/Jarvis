import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveChoice, liveModelChain, toolsForModel, LIVE_MODEL_NEW, LIVE_MODEL_OLD, SAFE_VOICE } from '../server/voice/liveFallback.js';

const fresh = (voices = ['Orion', SAFE_VOICE]) => createLiveChoice({ models: liveModelChain(), voices });

test('nowy model jest pierwszy, a stary zostaje zapasem', () => {
  assert.deepEqual(liveModelChain(), [LIVE_MODEL_NEW, LIVE_MODEL_OLD]);
  assert.deepEqual(liveModelChain('inny'), ['inny', LIVE_MODEL_NEW, LIVE_MODEL_OLD]);
  assert.deepEqual(liveModelChain(LIVE_MODEL_OLD), [LIVE_MODEL_NEW, LIVE_MODEL_OLD]);
});

test('narzedzia na nowym modelu blokuja, a na starym nic sie nie zmienia', () => {
  const tools = [{ functionDeclarations: [{ name: 'a' }] }];
  assert.equal(toolsForModel(tools, LIVE_MODEL_NEW)[0].functionDeclarations[0].behavior, 'BLOCKING');
  assert.equal(toolsForModel(tools, LIVE_MODEL_OLD), tools);
  assert.equal(tools[0].functionDeclarations[0].behavior, undefined);
});

test('odrzucony model przechodzi na zapas, a gdy i ten padnie, wraca na nowy', () => {
  const c = fresh();
  assert.equal(c.rejected(), 'model');
  assert.equal(c.model(), LIVE_MODEL_OLD);
  c.rejected();
  assert.equal(c.model(), LIVE_MODEL_NEW);
});

test('odrzucenie przy wlasnym glosie najpierw zdejmuje glos', () => {
  const c = fresh(['Puck', 'Orion', SAFE_VOICE]);
  assert.equal(c.rejected({ customVoice: true }), 'voice');
  assert.equal(c.voice(), 'Orion');
  assert.equal(c.model(), LIVE_MODEL_NEW);
  assert.equal(c.rejected({ customVoice: true }), 'model');
});

test('cisza z tekstem odpowiedzi: najpierw inny glos, potem stary model', () => {
  const c = fresh();
  assert.equal(c.turnEnded({ userText: 'czesc', assistantText: 'witaj' }), 'voice');
  assert.equal(c.voice(), SAFE_VOICE);
  assert.equal(c.turnEnded({ userText: 'czesc', assistantText: 'witaj' }), 'model');
  assert.equal(c.model(), LIVE_MODEL_OLD);
  assert.equal(c.voice(), 'Orion');
});

test('jedna tura bez odpowiedzi to moze byc swiadome milczenie', () => {
  const c = fresh();
  assert.equal(c.turnEnded({ userText: 'do kogos innego' }), null);
  assert.equal(c.voice(), 'Orion');
  assert.equal(c.turnEnded({ userText: 'halo' }), 'voice');
});

test('gdy glos raz zagral, cisza niczego nie przelacza', () => {
  const c = fresh();
  c.audio();
  assert.equal(c.turnEnded({ assistantText: 'x' }), null);
  assert.equal(c.turnEnded({ assistantText: 'x' }), null);
  assert.equal(c.voice(), 'Orion');
  assert.equal(c.model(), LIVE_MODEL_NEW);
});

test('tura bez zadnego tekstu sie nie liczy', () => {
  const c = fresh();
  for (let i = 0; i < 5; i++) assert.equal(c.turnEnded({}), null);
});

test('cisza na wszystkim nie krazy w nieskonczonosc', () => {
  const c = fresh();
  const steps = [];
  for (let i = 0; i < 30; i++) steps.push(c.turnEnded({ assistantText: 'x' }));
  assert.ok(steps.filter(Boolean).length <= 4, steps.join());
  assert.equal(steps.at(-1), null);
});

test('E.D.I.T.H. z jednym glosem przechodzi od razu na zapasowy model', () => {
  const c = createLiveChoice({ models: liveModelChain(), voices: ['Kore'] });
  assert.equal(c.turnEnded({ assistantText: 'x' }), 'model');
  assert.equal(c.voice(), 'Kore');
});
