// Jeden plik zamiast ponad 50 osobnych zapytan przy starcie: dodatki z loader.js sklejone w pamieci serwera,
// skompresowane raz. Plik ze zlym kodem jest pomijany (zostanie sam, bez psucia reszty), a blad przy
// uruchamianiu jednego dodatku nie zatrzymuje pozostalych.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { Router } from 'express';

const router = Router();
const dir = new URL('../../public/extras/', import.meta.url);

export function buildBundle(readFile = (f) => fs.readFileSync(new URL(f, dir), 'utf8')) {
  const loader = readFile('loader.js');
  const files = [...loader.match(/const FILES = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const parts = [];
  const skipped = [];
  for (const f of files) {
    let src;
    try {
      src = readFile(`${f}.js`);
      new vm.Script(src, { filename: `${f}.js` });
    } catch (e) {
      skipped.push(f);
      console.error(`Paczka: pomijam ${f}.js: ${e.message}`);
      continue;
    }
    parts.push(`try {\n${src}\n} catch (e) { console.error('Dodatek ${f}:', e); }`);
  }
  parts.push(`window.__bundleOk = true;${skipped.length ? ` window.__bundleSkipped = ${JSON.stringify(skipped)};` : ''}`);
  return { body: parts.join('\n;\n'), files, skipped };
}

let cache = null;
function get() {
  if (!cache) {
    const { body } = buildBundle();
    const buf = Buffer.from(body);
    cache = { buf, gz: zlib.gzipSync(buf, { level: 9 }), etag: `"${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}"` };
  }
  return cache;
}

router.get('/extras/bundle.js', (req, res) => {
  const c = get();
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache'); // zawsze sprawdz ETag: po wdrozeniu od razu nowa wersja
  res.setHeader('ETag', c.etag);
  res.setHeader('Vary', 'Accept-Encoding');
  if (req.headers['if-none-match'] === c.etag) return res.status(304).end();
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    res.setHeader('Content-Encoding', 'gzip');
    return res.end(c.gz);
  }
  res.end(c.buf);
});

export default router;
