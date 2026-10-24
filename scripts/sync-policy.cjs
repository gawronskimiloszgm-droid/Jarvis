// Generuje server/security/edithPolicy.js (ESM) z desktop/edithPolicy.js
// (CommonJS) - jedno zrodlo prawdy. Uruchom po kazdej zmianie polityki:
//   node scripts/sync-policy.cjs
const fs = require('fs');
let d = fs.readFileSync('desktop/edithPolicy.js', 'utf8').replace(/\r\n/g, '\n');
d = d.replace('const SAFE_ACTIONS = new Set([', 'export const SAFE_ACTIONS = new Set([');
d = d.replace('const READ_ONLY = new Set([', 'export const READ_ONLY = new Set([');
d = d.replace('function judge(', 'export function judge(');
d = d.replace(/\nmodule\.exports = \{[^}]*\};?\n?$/, '\n');
d = d.replace(/^\/\/ System Bezpiecze[^\n]*\n\/\/ Zarz[^\n]*\n/, '// WYGENEROWANE z desktop/edithPolicy.js przez scripts/sync-policy.cjs - nie edytuj\n// recznie (serwer nie moze importowac CommonJS z aplikacji desktopowej).\n');
fs.writeFileSync('server/security/edithPolicy.js', d);
console.log('server/security/edithPolicy.js zsynchronizowany');
