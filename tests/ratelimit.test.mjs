import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, guestLimit } from '../server/core/ratelimit.js';

test('limit: blokuje po przekroczeniu i odblokowuje po czasie', () => {
  const l = createLimiter({ windowMs: 1000, max: 2 });
  assert.equal(l.blocked('a', 0), false);
  assert.equal(l.hit('a', 0).ok, true);
  assert.equal(l.hit('a', 10).ok, true);
  assert.equal(l.blocked('a', 20), true);
  assert.equal(l.hit('a', 20).ok, false);
  assert.equal(l.hit('b', 20).ok, true, 'inny adres ma osobny licznik');
  assert.equal(l.retryAfter('a', 500), 1);
  assert.equal(l.blocked('a', 1500), false);
  l.hit('c', 0);
  l.hit('c', 0);
  l.reset('c');
  assert.equal(l.blocked('c', 1), false);
});

test('limit: pamiec nie rosnie bez konca', () => {
  const l = createLimiter({ windowMs: 10, max: 1, maxKeys: 50 });
  for (let i = 0; i < 500; i++) l.hit(`ip${i}`, i * 100);
  assert.equal(l.blocked('ip499', 49900), true);
});

test('limit gosci: wlasciciel bez limitu, gosc dostaje 429', () => {
  const mw = guestLimit({ windowMs: 1000, max: 1, isOwner: (r) => r.owner });
  const run = (req) => {
    let code = null;
    let passed = false;
    const res = { setHeader() {}, status(c) { code = c; return this; }, json() {} };
    mw(req, res, () => (passed = true));
    return { code, passed };
  };
  assert.equal(run({ ip: 'x' }).passed, true);
  assert.equal(run({ ip: 'x' }).code, 429);
  assert.equal(run({ ip: 'x', owner: true }).passed, true);
});
