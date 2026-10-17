// #130: Przypomnienie o waznosci paszportu/dowodu.
//
// Prosty CRUD dokumentow (nazwa + data waznosci) w namespace uzytkownika,
// plus funkcja zwracajaca te, ktorym waznosc konczy sie w ciagu 90 dni.
// Integracja z JUZ istniejacym memory.addReminder (nie edytujemy memory.js,
// tylko go importujemy) - przypomnienie tworzone jest RAZ, gdy dokument
// wpada w okno 90 dni, zeby nie zasypywac przypomnieniami przy kazdym cyklu.

import * as memory from '../memory/memory.js';
import * as bus from '../core/bus.js';
import { loadTravel, saveTravel, newId } from './store.js';

const WARNING_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export function listDocuments() {
  return loadTravel().travel.documents;
}

export function addDocument({ name, expiresAt }) {
  const clean = String(name || '').trim();
  const date = String(expiresAt || '').trim();
  if (!clean) throw new Error('Podaj nazwe dokumentu (np. "paszport").');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Podaj date waznosci w formacie RRRR-MM-DD.');

  const data = loadTravel();
  const doc = {
    id: newId(),
    name: clean,
    expiresAt: date,
    reminderCreated: false,
    createdAt: Date.now(),
  };
  data.travel.documents.push(doc);
  saveTravel(data);
  return doc;
}

export function removeDocument(id) {
  const data = loadTravel();
  data.travel.documents = data.travel.documents.filter((d) => d.id !== id);
  saveTravel(data);
  return data.travel.documents;
}

/** Dokumenty, ktorych waznosc konczy sie w ciagu `days` dni (domyslnie 90). */
export function listExpiringSoon(days = WARNING_DAYS) {
  const now = Date.now();
  const horizon = now + days * DAY_MS;
  return loadTravel().travel.documents.filter((d) => {
    const t = new Date(d.expiresAt).getTime();
    return Number.isFinite(t) && t >= now && t <= horizon;
  });
}

/**
 * Dla kazdego dokumentu wpadajacego w okno 90 dni, ktory jeszcze nie ma
 * utworzonego przypomnienia, tworzy je przez memory.addReminder i oznacza
 * jako obsluzony. Idempotentne - bezpieczne do wolania cyklicznie.
 */
export function syncReminders() {
  const data = loadTravel();
  const now = Date.now();
  const horizon = now + WARNING_DAYS * DAY_MS;
  let created = 0;

  for (const doc of data.travel.documents) {
    if (doc.reminderCreated) continue;
    const expiresMs = new Date(doc.expiresAt).getTime();
    if (!Number.isFinite(expiresMs) || expiresMs < now || expiresMs > horizon) continue;

    const daysLeft = Math.max(0, Math.round((expiresMs - now) / DAY_MS));
    memory.addReminder(`Dokument "${doc.name}" traci waznosc ${doc.expiresAt} (za ${daysLeft} dni) - czas na odnowienie.`, new Date().toISOString());
    doc.reminderCreated = true;
    created++;

    bus.publish('travel', 'document.expiring', `Dokument "${doc.name}" traci waznosc ${doc.expiresAt} - dodano przypomnienie.`, {
      level: 'warn',
      speak: true,
      data: { id: doc.id },
    });
  }

  if (created) saveTravel(data);
  return { created };
}
