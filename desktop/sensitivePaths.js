// Miejsca, z ktorych Jarvis nie czyta plikow nawet na wyrazna prosbe:
// klucze SSH/chmur, magazyny hasel i ciasteczka przegladarek, rejestr
// systemowy, pliki .env. Osobny plik, zeby dalo sie go testowac bez Electrona.

const SEP = '[\\\\/]';

const SENSITIVE_PATH = new RegExp(
  [
    `${SEP}\\.(ssh|aws|gnupg|azure|kube)(${SEP}|$)`,
    `${SEP}microsoft${SEP}(credentials|protect|vault)(${SEP}|$)`,
    `${SEP}windows${SEP}system32${SEP}config(${SEP}|$)`,
    'ntuser\\.dat',
    `(^|${SEP})id_(rsa|ed25519|ecdsa)`,
    'login data$',
    `${SEP}cookies$`,
    `${SEP}\\.env(\\.[a-z]+)?$`,
    'wallet\\.dat$',
  ].join('|'),
  'i'
);

module.exports = { SENSITIVE_PATH, isSensitivePath: (p) => SENSITIVE_PATH.test(String(p)) };
