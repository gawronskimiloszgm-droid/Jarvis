// Wspolne pomoce dla nadbudowy pamieci (graf wiedzy, wygasanie faktow,
// wersjonowanie) - zeby knowledgeGraph.js, factLifecycle.js, relations.js,
// episodicMemory.js, memorySearch.js i memoryExport.js nie duplikowaly tej
// samej inicjalizacji stanu i tego samego mechanizmu cofania zmian.
//
// Zgodnie z zasadami tej operacji: memory.js NIE jest edytowany. Wszystkie
// nowe klucze najwyzszego poziomu (knowledgeGraph, factMeta, people,
// episodes, episodeSummaries, memoryVersions) dokladane sa tutaj, do
// zwyklego obiektu zwracanego przez load().

import { load, save } from './memory.js';

export const CATEGORIES = ['zdrowie', 'praca', 'hobby', 'rodzina', 'finanse', 'inne'];

const MAX_VERSIONS = 20;

export function normalizeFactKey(text) {
  return String(text || '').trim().toLowerCase();
}

export function ensureNamespace(data) {
  if (!data.knowledgeGraph) data.knowledgeGraph = { nodes: [], edges: [] };
  if (!data.factMeta) data.factMeta = {};
  if (!data.people) data.people = [];
  if (!data.episodes) data.episodes = [];
  if (!data.episodeSummaries) data.episodeSummaries = {};
  if (!data.memoryVersions) data.memoryVersions = [];
  return data;
}

// factMeta trzyma albo prawdziwy wpis {text, category, confidence, ...},
// albo znacznik-alias {aliasOf: klucz} - patrz factLifecycle.js po
// wyjasnienie, dlaczego przeformulowany fakt musi wskazywac na oryginal
// zamiast dostawac wlasny, pusty wpis.
export function resolveMetaEntry(factMeta, text) {
  const key = normalizeFactKey(text);
  let entry = factMeta[key];
  if (entry && entry.aliasOf) entry = factMeta[entry.aliasOf];
  return entry || null;
}

// Podobienstwo Jaccard po slowach - jedyny obserwowalny sposob na wykrycie
// "tego samego faktu powiedzianego inaczej": memory.addFacts() po cichu
// odrzuca WYLACZNIE doslowne duplikaty (patrz memory.js), wiec przeformulowanie
// trafia do facts jako nowy, osobny string i inaczej umknieloby wzmacnianiu
// pewnosci (confidence).
export function similarity(a, b) {
  const wa = new Set(normalizeFactKey(a).split(/\s+/).filter(Boolean));
  const wb = new Set(normalizeFactKey(b).split(/\s+/).filter(Boolean));
  if (wa.size < 3 || wb.size < 3) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter += 1;
  const union = new Set([...wa, ...wb]).size;
  return union ? inter / union : 0;
}

// Migawka stanu SPRZED zmiany - wolaj TUZ PRZED mutacja. load() zwraca ten
// sam obiekt trzymany w pamieci procesu (bez klonowania), wiec wywolanie po
// mutacji zapisaloby juz zmieniony stan i undo nic by nie cofnal.
export function snapshotVersion(reason) {
  const data = load();
  ensureNamespace(data);
  data.memoryVersions.push({
    at: Date.now(),
    reason: String(reason || ''),
    snapshot: {
      facts: JSON.parse(JSON.stringify(data.facts || [])),
      knowledgeGraph: JSON.parse(JSON.stringify(data.knowledgeGraph)),
      factMeta: JSON.parse(JSON.stringify(data.factMeta)),
      people: JSON.parse(JSON.stringify(data.people)),
    },
  });
  if (data.memoryVersions.length > MAX_VERSIONS) {
    data.memoryVersions = data.memoryVersions.slice(-MAX_VERSIONS);
  }
  save(data);
}

export function listVersions() {
  const data = ensureNamespace(load());
  return data.memoryVersions.map((v, index) => ({ index, at: v.at, reason: v.reason }));
}

// Epizody (episodes/episodeSummaries) CELOWO nie wchodza do migawki - to
// dziennik zdarzen dopisywany z bus.js, a nie recznie edytowany stan, wiec
// cofanie faktow/grafu/osob nie powinno kasowac historii dnia.
export function undoLastVersion() {
  const data = ensureNamespace(load());
  const last = data.memoryVersions.pop();
  if (!last) return null;
  data.facts = last.snapshot.facts;
  data.knowledgeGraph = last.snapshot.knowledgeGraph;
  data.factMeta = last.snapshot.factMeta;
  data.people = last.snapshot.people;
  save(data);
  return last;
}
