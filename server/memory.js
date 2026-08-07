import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ facts: [], history: [] }, null, 2));
  }
}

export function load() {
  ensureStore();
  return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
}

export function save(data) {
  ensureStore();
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
}

export function addFacts(newFacts) {
  if (!newFacts || !newFacts.length) return load();
  const data = load();
  for (const fact of newFacts) {
    const clean = String(fact).trim();
    if (!clean) continue;
    if (!data.facts.some((f) => f.toLowerCase() === clean.toLowerCase())) {
      data.facts.push(clean);
    }
  }
  save(data);
  return data;
}

export function appendHistory(role, content) {
  const data = load();
  data.history.push({ role, content, ts: Date.now() });
  const MAX_HISTORY = 40;
  if (data.history.length > MAX_HISTORY) {
    data.history = data.history.slice(-MAX_HISTORY);
  }
  save(data);
  return data;
}

export function getRecentHistory(limit = 20) {
  const data = load();
  return data.history.slice(-limit);
}

export function getFacts() {
  return load().facts;
}

export function removeFact(index) {
  const data = load();
  if (index >= 0 && index < data.facts.length) {
    data.facts.splice(index, 1);
    save(data);
  }
  return data;
}

