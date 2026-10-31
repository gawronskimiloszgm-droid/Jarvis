// Prosty limit zapytan w pamieci procesu (jeden proces na Renderze, wiec to wystarcza).
// Liczy zdarzenia w oknie czasu dla klucza, zwykle adresu IP.
export function createLimiter({ windowMs, max, maxKeys = 5000 }) {
  const hits = new Map();
  const sweep = (now) => {
    if (hits.size <= maxKeys) return;
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
  };
  const cur = (key, now) => {
    const e = hits.get(key);
    return !e || now - e.start > windowMs ? null : e;
  };
  return {
    /** Czy klucz jest juz zablokowany (nie zlicza). */
    blocked(key, now = Date.now()) {
      const e = cur(key, now);
      return Boolean(e && e.count >= max);
    },
    /** Zlicza zdarzenie; zwraca { ok, retryAfter } (sekundy). */
    hit(key, now = Date.now()) {
      let e = cur(key, now);
      if (!e) {
        e = { start: now, count: 0 };
        hits.set(key, e);
        sweep(now);
      }
      e.count++;
      return { ok: e.count <= max, retryAfter: Math.ceil((e.start + windowMs - now) / 1000) };
    },
    retryAfter(key, now = Date.now()) {
      const e = cur(key, now);
      return e ? Math.ceil((e.start + windowMs - now) / 1000) : 0;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

/** Middleware dla publicznych tras kosztujacych limit AI: wlasciciel bez limitu, gosc wedlug IP. */
export function guestLimit({ windowMs, max, isOwner, message = 'Za dużo zapytań. Spróbuj za chwilę.' }) {
  const lim = createLimiter({ windowMs, max });
  return (req, res, next) => {
    if (isOwner(req)) return next();
    const r = lim.hit(req.ip || 'x');
    if (r.ok) return next();
    res.setHeader('Retry-After', String(r.retryAfter));
    res.status(429).json({ error: message });
  };
}
