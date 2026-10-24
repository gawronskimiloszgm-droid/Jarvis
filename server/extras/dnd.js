// Tryb "nie przeszkadzac" - maly modul-lisc (importuje tylko pamiec), zeby
// briefing, warstwa proaktywna i rozmowa na zywo mogly go sprawdzac bez
// ryzyka cyklicznych importow.

import * as memory from '../memory/memory.js';

export function dndState() {
  const d = memory.load().dnd || {};
  const active = Boolean(d.until && d.until > Date.now());
  return { active, until: active ? d.until : null, textOnly: Boolean(d.textOnly) };
}

export function isDnd() {
  return dndState().active;
}

export function setDnd(minutes, textOnly = true) {
  const data = memory.load();
  const m = Number(minutes);
  data.dnd = Number.isFinite(m) && m > 0 ? { until: Date.now() + Math.min(m, 24 * 60) * 60000, textOnly: textOnly !== false } : { until: null, textOnly: false };
  memory.save(data);
  return dndState();
}
