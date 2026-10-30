// Nowe moduly "zycia" dla glosu (narzedzia Gemini Live) i czatu (znaczniki w odpowiedzi):
// zakupy, woda, nastroj, dziennik, nawyki, cele, tablica, notatki, zakladki, odliczanie,
// kalkulator, przeliczanie jednostek i losowanie. Logika liczb pochodzi z public/extras/toolkit.js.
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { lifeAdd, lifeList, lifeDaily, lifeToggleHabit, lifeWeekSummary, warsawDay } from './life.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto; // Node 18: toolkit.js korzysta z globalnego crypto

const toolkit = (() => {
  try {
    const mod = { exports: {} };
    new Function('module', fs.readFileSync(new URL('../../public/extras/toolkit.js', import.meta.url), 'utf8'))(mod);
    return mod.exports;
  } catch {
    return null;
  }
})();

const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const items = (v) => String(v || '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, 30);

export const LIFE_TOOLS = [
  {
    name: 'dodaj_zakupy',
    description: 'Dodaj pozycje do listy zakupow (np. "dopisz mleko i chleb do zakupow"). Kilka pozycji rozdziel przecinkami.',
    parameters: { type: 'object', properties: { pozycje: { type: 'string', description: 'np. "mleko, chleb, jajka"' } }, required: ['pozycje'] },
  },
  {
    name: 'lista_zakupow',
    description: 'Odczytaj, co jest jeszcze do kupienia na liscie zakupow.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'woda',
    description: 'Zapisz wypite szklanki wody dzisiaj (domyslnie 1) albo sprawdz ile wypito (szklanki=0).',
    parameters: { type: 'object', properties: { szklanki: { type: 'number', description: 'Ile szklanek dodac; ujemna odejmuje, 0 tylko odczyt.' } } },
  },
  {
    name: 'nastroj',
    description: 'Zapisz nastroj wlasciciela na dzis w skali 1-5 (1 fatalny, 5 swietny).',
    parameters: { type: 'object', properties: { ocena: { type: 'number' } }, required: ['ocena'] },
  },
  {
    name: 'wpis_dziennika',
    description: 'Dopisz wpis do dziennika (osi czasu dnia): wspomnienie, mysl, wydarzenie.',
    parameters: { type: 'object', properties: { tekst: { type: 'string' } }, required: ['tekst'] },
  },
  {
    name: 'odhacz_nawyk',
    description: 'Odhacz (albo cofnij) nawyk na dzis po fragmencie jego nazwy, np. "bieganie". Zwraca aktualna serie dni.',
    parameters: { type: 'object', properties: { nazwa: { type: 'string' } }, required: ['nazwa'] },
  },
  {
    name: 'dodaj_cel',
    description: 'Dodaj cel (z opcjonalna wartoscia docelowa, jednostka i terminem).',
    parameters: {
      type: 'object',
      properties: { tekst: { type: 'string' }, cel: { type: 'number' }, jednostka: { type: 'string' }, termin: { type: 'string', description: 'RRRR-MM-DD' } },
      required: ['tekst'],
    },
  },
  {
    name: 'dodaj_odliczanie',
    description: 'Dodaj odliczanie do daty (urlop, egzamin, wydarzenie).',
    parameters: { type: 'object', properties: { nazwa: { type: 'string' }, data: { type: 'string', description: 'RRRR-MM-DD' } }, required: ['nazwa', 'data'] },
  },
  {
    name: 'karta_na_tablice',
    description: 'Dodaj karte na tablice kanban (kolumna: todo, doing albo done).',
    parameters: { type: 'object', properties: { tekst: { type: 'string' }, kolumna: { type: 'string', enum: ['todo', 'doing', 'done'] } }, required: ['tekst'] },
  },
  {
    name: 'szybka_notatka',
    description: 'Zapisz krotka notatke-mysl (inna niz notatki z rozmow).',
    parameters: { type: 'object', properties: { tekst: { type: 'string' } }, required: ['tekst'] },
  },
  {
    name: 'dodaj_zakladke',
    description: 'Zapisz link w zakladkach.',
    parameters: { type: 'object', properties: { url: { type: 'string' }, tytul: { type: 'string' } }, required: ['url'] },
  },
  {
    name: 'policz',
    description: 'Policz wyrazenie albo przelicz jednostki. Wyrazenie: "(12+8)*3", "sqrt(144)", "20% z 150". Jednostki: "5 kg na lb", "100 c na f", "10 km na mi". Zawsze uzywaj tego do liczb zamiast liczyc w glowie.',
    parameters: { type: 'object', properties: { wyrazenie: { type: 'string' } }, required: ['wyrazenie'] },
  },
  {
    name: 'podsumowanie_tygodnia',
    description: 'Krotkie podsumowanie ostatnich 7 dni: woda, nawyki, dziennik, nastroj, tablica.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'podsumowanie_dnia',
    description: 'Podsumowanie dzisiejszego dnia z danych: woda, nastroj, nawyki, wpisy dziennika, zakupy i tablica. Uzyj na pytanie "jak mi minal dzien", "co dzis zrobilem".',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'co_nowego',
    description: 'Lista nowych funkcji aplikacji z ostatniej aktualizacji (changelog) - na pytanie "co nowego", "co umiesz teraz".',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'zegar_swiata',
    description: 'Podaj aktualna godzine w danym miescie lub strefie (np. Tokio, Nowy Jork, Londyn).',
    parameters: { type: 'object', properties: { miasto: { type: 'string' } }, required: ['miasto'] },
  },
  {
    name: 'losuj',
    description: 'Rzut koscia (k6, k20...), moneta albo wybor jednej opcji z listy.',
    parameters: {
      type: 'object',
      properties: { rodzaj: { type: 'string', enum: ['kostka', 'moneta', 'wybor'] }, scianki: { type: 'number' }, opcje: { type: 'string', description: 'Dla wyboru: opcje po przecinku.' } },
      required: ['rodzaj'],
    },
  },
];

const CHANGELOG = [
  'Holo-kamera: obraz z kamery na calym ekranie pod hologramem, gesty dloni w calym interfejsie',
  'Jarvis widzi, co dzieje sie w aplikacji, i sam na to reaguje',
  'Hologram: szesc stylow tla, lewitujace panele, smuga kursora, fale, pochylanie kart',
  'Podglad 3D: tryb holo, skaner, wymiary, ciecie, pomiar, biblioteka projektow, porownanie',
  'Ponad 50 widzetow na Pulpicie z wlasnym ukladem',
  'Nowe moduly: dziennik, zakupy, nawyki, cele, tablica, zakladki, fiszki, planer, tlumacz, zegary swiata, statystyki, galeria, Holo-stol',
  'Paleta polecen z kalkulatorem, przeliczeniami i szybkim dodawaniem',
  'Desktop: nakladka HUD, szybkie przechwytywanie, skroty globalne, tryb kina',
  'Telefon: gesty, wibracje, pasek szybkich akcji, tryb jednej reki, OLED',
];

export const LIFE_TOOL_NAMES = LIFE_TOOLS.map((t) => t.name);

export const LIFE_VOICE_PROMPT = `- Moduly zycia: dodaj_zakupy / lista_zakupow (zakupy), woda (szklanki wody), nastroj (1-5), wpis_dziennika, odhacz_nawyk (zwraca serie), dodaj_cel, dodaj_odliczanie, karta_na_tablice, szybka_notatka, dodaj_zakladke. Wolaj je od razu, gdy uzytkownik o to prosi, i potwierdz jednym zdaniem. policz: ZAWSZE do rachunkow i przeliczen jednostek. losuj: kostka, moneta, wybor z listy. podsumowanie_tygodnia: zwiezle statystyki z 7 dni. zegar_swiata: ktora godzina w innym miescie. podsumowanie_dnia: jak minal dzien z danych. co_nowego: lista nowosci.`;

export async function runLifeTool(name, args = {}) {
  switch (name) {
    case 'dodaj_zakupy': {
      const list = items(args.pozycje);
      const added = list.filter((t) => lifeAdd('shopping', { text: t })).length;
      return added ? { ok: true, dodano: added } : { error: 'brak pozycji' };
    }
    case 'lista_zakupow': {
      const todo = lifeList('shopping').filter((x) => !x.done).map((x) => x.text);
      return { do_kupienia: todo, liczba: todo.length };
    }
    case 'woda': {
      const n = args.szklanki == null ? 1 : Number(args.szklanki);
      return { ok: true, ...lifeDaily(n ? { waterDelta: n } : {}) };
    }
    case 'nastroj': {
      const v = Number(args.ocena);
      if (!(v >= 1 && v <= 5)) return { error: 'ocena 1-5' };
      return { ok: true, ...lifeDaily({ mood: v }) };
    }
    case 'wpis_dziennika':
      return lifeAdd('journal', { text: str(args.tekst, 600), kind: 'manual' }) ? { ok: true } : { error: 'pusty wpis' };
    case 'odhacz_nawyk': {
      const r = lifeToggleHabit(args.nazwa);
      return r ? { ok: true, ...r } : { error: 'nie ma takiego nawyku - zalozy go uzytkownik w module Nawyki' };
    }
    case 'dodaj_cel':
      return lifeAdd('goals', { text: str(args.tekst, 140), target: args.cel, unit: args.jednostka, due: args.termin }) ? { ok: true } : { error: 'pusty cel' };
    case 'dodaj_odliczanie':
      return lifeAdd('countdowns', { name: str(args.nazwa, 80), date: str(args.data, 10) }) ? { ok: true } : { error: 'potrzebna nazwa i data RRRR-MM-DD' };
    case 'karta_na_tablice':
      return lifeAdd('kanban', { text: str(args.tekst, 160), col: args.kolumna }) ? { ok: true } : { error: 'pusta karta' };
    case 'szybka_notatka':
      return lifeAdd('quicknotes', { text: str(args.tekst, 1200) }) ? { ok: true } : { error: 'pusta notatka' };
    case 'dodaj_zakladke':
      return lifeAdd('bookmarks', { url: str(args.url, 500), title: str(args.tytul, 120) }) ? { ok: true } : { error: 'to nie jest adres http(s)' };
    case 'policz': {
      if (!toolkit) return { error: 'kalkulator niedostepny' };
      const q = str(args.wyrazenie, 200);
      try {
        const c = toolkit.parseConvert(q);
        if (c) return { wynik: c.result, opis: `${c.value} ${c.from} = ${c.result} ${c.to}` };
      } catch {
        /* to nie jednostki */
      }
      try {
        return { wynik: toolkit.calc(q) };
      } catch (e) {
        return { error: e.message };
      }
    }
    case 'podsumowanie_dnia': {
      const day = warsawDay();
      const d = lifeDaily({}, day);
      const habits = lifeList('habits');
      const wpisy = lifeList('journal').filter((e) => new Date(e.at).toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' }) === day);
      return {
        dzien: day,
        woda: d.water,
        nastroj: d.mood || 'nie podano',
        nawyki_zrobione: habits.filter((h) => h.days.includes(day)).map((h) => h.name),
        nawyki_zostalo: habits.filter((h) => !h.days.includes(day)).map((h) => h.name),
        wpisy_dziennika: wpisy.length,
        ostatnie_wpisy: wpisy.slice(0, 5).map((e) => e.text.slice(0, 80)),
        do_kupienia: lifeList('shopping').filter((x) => !x.done).length,
        karty_w_toku: lifeList('kanban').filter((k) => k.col === 'doing').map((k) => k.text),
      };
    }
    case 'co_nowego':
      return { wersja: '0.7.0', nowosci: CHANGELOG };
    case 'podsumowanie_tygodnia':
      return { podsumowanie: lifeWeekSummary() };
    case 'zegar_swiata': {
      if (!toolkit) return { error: 'zegar niedostepny' };
      const ZONES = { warszawa: 'Europe/Warsaw', londyn: 'Europe/London', 'nowy jork': 'America/New_York', 'los angeles': 'America/Los_Angeles', tokio: 'Asia/Tokyo', sydney: 'Australia/Sydney', dubaj: 'Asia/Dubai', pekin: 'Asia/Shanghai', kair: 'Africa/Cairo', paryz: 'Europe/Paris', berlin: 'Europe/Berlin', moskwa: 'Europe/Moscow', singapur: 'Asia/Singapore', 'sao paulo': 'America/Sao_Paulo' };
      const key = String(args.miasto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').trim();
      const tz = ZONES[key] || (/^[A-Za-z_]+\/[A-Za-z_]+$/.test(String(args.miasto)) ? String(args.miasto) : null);
      if (!tz) return { error: 'nieznane miasto', znane: Object.keys(ZONES) };
      try {
        return { miasto: args.miasto, czas: toolkit.timeIn(tz) };
      } catch {
        return { error: 'nieznana strefa' };
      }
    }
    case 'losuj': {
      if (!toolkit) return { error: 'losowanie niedostepne' };
      if (args.rodzaj === 'moneta') return { wynik: toolkit.coin() };
      if (args.rodzaj === 'wybor') {
        const o = items(args.opcje);
        return o.length > 1 ? { wynik: o[Math.floor(Math.random() * o.length)] } : { error: 'podaj co najmniej dwie opcje' };
      }
      const n = Math.max(2, Math.min(1000, Math.round(Number(args.scianki) || 6)));
      return { wynik: toolkit.dice(n, 1)[0], scianki: n };
    }
    default:
      return undefined;
  }
}

// ---------- czat: znaczniki w odpowiedzi modelu ----------
const R = (tag) => new RegExp(`\\[${tag}:\\s*([^\\]]+)\\]`, 'gi');
export const LIFE_TAGS = {
  ZAKUPY: R('ZAKUPY'),
  WODA: R('WODA'),
  NASTROJ: R('NASTROJ'),
  DZIENNIK: R('DZIENNIK'),
  NAWYK: R('NAWYK'),
  CEL: R('CEL'),
  NOTATKA: R('NOTATKA'),
  TABLICA: R('TABLICA'),
};
export const LIFE_TAG_PATTERNS = Object.values(LIFE_TAGS);

export const LIFE_TAG_PROMPT = `- [ZAKUPY: mleko, chleb] - dopisanie pozycji do listy zakupow (kilka po przecinku).
- [WODA: 1] - zapis wypitych szklanek wody dzisiaj (liczba; domyslnie 1).
- [NASTROJ: 4] - nastroj na dzis w skali 1-5, gdy uzytkownik sam o nim mowi.
- [DZIENNIK: tresc] - wpis do dziennika, gdy uzytkownik prosi "zapisz w dzienniku".
- [NAWYK: nazwa] - odhaczenie nawyku na dzis (np. bieganie).
- [CEL: tresc] - nowy cel; [NOTATKA: tresc] - szybka notatka; [TABLICA: tresc] - karta na tablice kanban.`;

export function persistLifeTags(rawFull) {
  const each = (re, fn) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(rawFull))) fn(m[1].trim());
  };
  each(LIFE_TAGS.ZAKUPY, (v) => items(v).forEach((t) => lifeAdd('shopping', { text: t })));
  each(LIFE_TAGS.WODA, (v) => lifeDaily({ waterDelta: Math.max(-10, Math.min(10, parseInt(v, 10) || 1)) }));
  each(LIFE_TAGS.NASTROJ, (v) => {
    const n = parseInt(v, 10);
    if (n >= 1 && n <= 5) lifeDaily({ mood: n });
  });
  each(LIFE_TAGS.DZIENNIK, (v) => lifeAdd('journal', { text: v, kind: 'manual' }));
  each(LIFE_TAGS.NAWYK, (v) => lifeToggleHabit(v));
  each(LIFE_TAGS.CEL, (v) => lifeAdd('goals', { text: v }));
  each(LIFE_TAGS.NOTATKA, (v) => lifeAdd('quicknotes', { text: v }));
  each(LIFE_TAGS.TABLICA, (v) => lifeAdd('kanban', { text: v }));
}

export { warsawDay };
