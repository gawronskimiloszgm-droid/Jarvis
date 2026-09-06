// Funkcja 24: relacje miedzy osobami (rodzina, znajomi) jako osobna
// struktura - lista osob ze slownikiem relacji do wlasciciela i miedzy soba,
// pod nowym kluczem data.people. Kazda osoba dostaje tez wezel w grafie
// wiedzy (knowledgeGraph.js), zeby dalo sie ja polaczyc z miejscami/rzeczami,
// nie tylko z wlascicielem - ale brak grafu nie moze zablokowac dodania
// osoby, wiec to tylko "najlepszy wysilek" (try/catch).

import express from 'express';
import { nanoid } from 'nanoid';
import { load, save } from './memory.js';
import { ensureNamespace, snapshotVersion } from './knowledgeStore.js';
import { requireOwner } from './auth.js';
import { addNode, addEdge } from './knowledgeGraph.js';

export function addPerson(name, relationToOwner = '', notes = '') {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const data = ensureNamespace(load());
  snapshotVersion('dodanie osoby');
  const person = {
    id: nanoid(8),
    name: clean,
    relationToOwner: String(relationToOwner || '').trim(),
    notes: String(notes || '').trim(),
    relations: [],
    nodeId: null,
    createdAt: Date.now(),
  };
  data.people.push(person);
  save(data);
  try {
    const node = addNode('osoba', clean, person.relationToOwner);
    if (node) {
      person.nodeId = node.id;
      save(data);
    }
  } catch {
    /* graf to dodatek - brak wezla nie moze zablokowac dodania osoby */
  }
  return person;
}

export function getPeople() {
  return ensureNamespace(load()).people;
}

export function removePerson(id) {
  const data = ensureNamespace(load());
  if (!data.people.some((p) => p.id === id)) return false;
  snapshotVersion('usuniecie osoby');
  data.people = data.people.filter((p) => p.id !== id);
  for (const p of data.people) {
    p.relations = (p.relations || []).filter((r) => r.personId !== id);
  }
  save(data);
  return true;
}

const router = express.Router();

router.get('/api/people', requireOwner, (req, res) => {
  res.json(getPeople());
});

router.post('/api/people', requireOwner, (req, res) => {
  const { name, relationToOwner, notes } = req.body || {};
  const person = addPerson(name, relationToOwner, notes);
  if (!person) return res.status(400).json({ error: 'Podaj imie/nazwe osoby.' });
  res.json(person);
});

router.delete('/api/people/:id', requireOwner, (req, res) => {
  const ok = removePerson(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Nie ma osoby o tym id.' });
  res.json({ ok: true });
});

router.post('/api/people/:id/relations', requireOwner, (req, res) => {
  const { personId, relation } = req.body || {};
  const clean = String(relation || '').trim();
  if (!clean) return res.status(400).json({ error: 'Podaj relacje.' });
  const data = ensureNamespace(load());
  const person = data.people.find((p) => p.id === req.params.id);
  const other = data.people.find((p) => p.id === personId);
  if (!person || !other) return res.status(404).json({ error: 'Obie osoby musza istniec.' });
  snapshotVersion('dodanie relacji miedzy osobami');
  person.relations = person.relations || [];
  person.relations.push({ personId, relation: clean });
  save(data);
  if (person.nodeId && other.nodeId) {
    try {
      addEdge(person.nodeId, other.nodeId, clean);
    } catch {
      /* opcjonalne odzwierciedlenie w grafie */
    }
  }
  res.json(person);
});

router.delete('/api/people/:id/relations/:personId', requireOwner, (req, res) => {
  const data = ensureNamespace(load());
  const person = data.people.find((p) => p.id === req.params.id);
  if (!person) return res.status(404).json({ error: 'Nie ma osoby o tym id.' });
  snapshotVersion('usuniecie relacji miedzy osobami');
  person.relations = (person.relations || []).filter((r) => r.personId !== req.params.personId);
  save(data);
  res.json(person);
});

export const relationsRouter = router;
