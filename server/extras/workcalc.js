// Kalkulatory warsztatowe dla glosu i czatu: ASG, elektronika, gwinty. Liczby z public/extras/workkit.js.
import fs from 'node:fs';

export const WorkKit = (() => {
  const mod = { exports: {} };
  new Function('module', fs.readFileSync(new URL('../../public/extras/workkit.js', import.meta.url), 'utf8'))(mod);
  return mod.exports;
})();

const n = (v) => (v == null || v === '' ? undefined : Number(v));

export const WORK_TOOLS = [
  {
    name: 'energia_asg',
    description: 'Energia kulki ASG z predkosci (fps albo m/s) i masy kulki w gramach, porownanie z typowymi limitami pol oraz predkosc przy innej kulce.',
    parameters: { type: 'object', properties: { fps: { type: 'number' }, ms: { type: 'number' }, kulka_g: { type: 'number' }, inna_kulka_g: { type: 'number' } } },
  },
  {
    name: 'repliki_osiagi',
    description: 'Osiagi repliki elektrycznej: przelozenie z zebow zebatek (pary "napedzana/napedzajaca"), szacowana szybkostrzelnosc z obrotow silnika oraz czas pracy akumulatora (mAh, pobor w A).',
    parameters: { type: 'object', properties: { zebatki: { type: 'string', description: 'np. "30/10, 24/12, 40/12.5"' }, przelozenie: { type: 'number' }, obroty: { type: 'number' }, mah: { type: 'number' }, pobor_a: { type: 'number' } } },
  },
  {
    name: 'elektronika',
    description: 'Elektronika: prawo Ohma (dwie z U, I, R, P), rezystor do diody LED (zasilanie, napiecie diody, prad mA, ile diod), paski rezystora (kolory po przecinku albo wartosc w omach) i dzielnik napiecia (U, R1, R2).',
    parameters: { type: 'object', properties: { typ: { type: 'string', enum: ['ohm', 'led', 'paski', 'dzielnik'] }, U: { type: 'number' }, I: { type: 'number' }, R: { type: 'number' }, P: { type: 'number' }, zasilanie: { type: 'number' }, vf: { type: 'number' }, ma: { type: 'number' }, ile: { type: 'number' }, kolory: { type: 'string' }, R1: { type: 'number' }, R2: { type: 'number' } }, required: ['typ'] },
  },
  {
    name: 'gwint',
    description: 'Gwint metryczny (np. M3, M8): skok, wiertlo pod gwint, otwor przelotowy, otwor do wkretu w druku 3D i pod wtapiana tulejke.',
    parameters: { type: 'object', properties: { rozmiar: { type: 'string' } }, required: ['rozmiar'] },
  },
];

export const WORK_VOICE_PROMPT = '- Warsztat: energia_asg (dzule, fps, limity pol: to tylko typowe wartosci, kazde pole ma swoje), repliki_osiagi (przelozenie, szybkostrzelnosc, akumulator), elektronika (Ohm, LED, paski rezystora, dzielnik), gwint. Licz zawsze nimi, nie z glowy.';

export function runWorkTool(name, a = {}) {
  switch (name) {
    case 'energia_asg': {
      const g = n(a.kulka_g) || 0.2;
      const e = WorkKit.bbEnergy({ fps: n(a.fps), ms: n(a.ms), g });
      if (!e) return { error: 'podaj predkosc w fps albo m/s' };
      const out = { dzule: e.joule, fps: e.fps, ms: e.ms, kulka_g: g, limity: WorkKit.limitsFor(e.joule).map((l) => `${l.name} ${l.joule} J: ${l.ok ? 'miesci sie' : 'za duzo'}`), uwaga: 'limity sa typowe, sprawdz regulamin swojego pola' };
      if (n(a.inna_kulka_g)) {
        const o = WorkKit.sameEnergyFps(e.fps, g, n(a.inna_kulka_g));
        out.na_innej_kulce = `${a.inna_kulka_g} g: ok. ${o.fps} fps przy tej samej energii`;
      }
      return out;
    }
    case 'repliki_osiagi': {
      const pairs = String(a.zebatki || '').split(/;|,\s+/).map((p) => p.split('/').map((x) => Number(x.trim().replace(',', '.')))).filter((p) => p.length === 2);
      const ratio = n(a.przelozenie) || WorkKit.gearRatio(pairs);
      const out = {};
      if (ratio) out.przelozenie = `${ratio}:1`;
      if (ratio && n(a.obroty)) out.szybkostrzelnosc = `ok. ${WorkKit.rof({ rpm: n(a.obroty), ratio })} strzalow/s (szacunek, zalezy od sprezyny i akumulatora)`;
      if (n(a.mah)) {
        const b = WorkKit.battery({ mAh: n(a.mah), amps: n(a.pobor_a) || 15 });
        out.akumulator = `${b.minutes} min ciaglego ognia, ok. ${b.shots} strzalow`;
      }
      return Object.keys(out).length ? out : { error: 'podaj zebatki albo przelozenie, obroty silnika lub pojemnosc akumulatora' };
    }
    case 'elektronika': {
      if (a.typ === 'ohm') return WorkKit.ohm({ U: n(a.U), I: n(a.I), R: n(a.R), P: n(a.P) }) || { error: 'podaj dwie wartosci z U, I, R, P' };
      if (a.typ === 'led') return WorkKit.ledResistor({ supply: n(a.zasilanie), vf: n(a.vf) || 2, mA: n(a.ma) || 20, count: n(a.ile) || 1 });
      if (a.typ === 'dzielnik') return WorkKit.divider({ U: n(a.U), R1: n(a.R1), R2: n(a.R2) }) || { error: 'podaj U, R1 i R2' };
      if (a.typ === 'paski') {
        if (a.kolory) return WorkKit.bandsToOhms(String(a.kolory).split(/[,\s]+/).filter(Boolean)) || { error: 'nie rozpoznaje kolorow' };
        const b = WorkKit.ohmsToBands(n(a.R));
        return b ? { paski: b.join(', ') } : { error: 'podaj kolory albo wartosc R w omach (od 1)' };
      }
      return { error: 'nieznany typ' };
    }
    case 'gwint':
      return WorkKit.thread(a.rozmiar) || { error: 'znam gwinty M2-M20 zwykle' };
    default:
      return undefined;
  }
}
