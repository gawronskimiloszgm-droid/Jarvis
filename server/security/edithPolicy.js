// Wspolna polityka E.D.I.T.H. Trzyma sie z dala od powloki: albo przepuszcza,
// albo twardo blokuje. Te same zasady sa powtorzone w desktop/edithPolicy.js
// (aplikacja komputerowa nie moze polegac tylko na serwerze).

export const SAFE_ACTIONS = new Set([
  'otworz-spotify',
  'pobudka',
  'otworz-youtube-music',
  'otworz-przegladarke',
  'otworz-discord',
  'otworz-teams',
  'otworz-slack',
  'otworz-vscode',
  'otworz-eksplorator',
  'zablokuj-ekran',
  'glosniej',
  'ciszej',
  'wycisz',
  'odtworz-pauza',
  'nastepny-utwor',
  'poprzedni-utwor',
  'zrzut-ekranu',
  'zrzut-i-opisz',
  'zamknij-okno',
  'pokaz-pulpit',
  'uspij-komputer',
  'zapisz-plik',
  'dopisz-do-pliku',
  'czytaj-plik',
  'lista-plikow',
  'otworz-folder-jarvisa',
  'wlacz-edith',
  'wlacz-jarvis',
  'skan-bezpieczenstwa',
]);

const BLOCK_RULES = [
  { re: /\bformat\s+[a-z]:/i, reason: 'Proba formatowania dysku.' },
  { re: /\bdiskpart\b|\bclean\s+all\b/i, reason: 'Proba czyszczenia dysku.' },
  { re: /\brm\s+(-[a-z]*f[a-z]*\s+)?(-[a-z]*r[a-z]*\s+)?\/(\s|$)/i, reason: 'Proba kasowania calego systemu.' },
  { re: /remove-item[\s\S]{0,80}-recurse[\s\S]{0,40}[a-z]:\\/i, reason: 'Proba rekursywnego kasowania dysku.' },
  { re: /\b(del|erase)\s+\/[a-z]*s[a-z]*\s+[a-z]:\\/i, reason: 'Proba masowego kasowania plikow.' },
  { re: /\brmdir\s+\/s\b|\brd\s+\/s\b/i, reason: 'Proba kasowania calych folderow systemowych.' },
  { re: /\bcipher\s+\/w\b/i, reason: 'Proba trwalego wycierania dysku.' },
  { re: /\bbcdedit\b|\bbootrec\b/i, reason: 'Proba zmiany uruchamiania systemu.' },
  { re: /disable(realtimemonitoring)?|set-mppreference[\s\S]{0,80}-disable/i, reason: 'Proba wylaczenia ochrony antywirusowej.' },
  { re: /netsh\s+advfirewall[\s\S]{0,40}\boff\b/i, reason: 'Proba wylaczenia zapory.' },
  { re: /\breg\s+delete\s+hklm\b/i, reason: 'Proba kasowania rejestru systemu.' },
  { re: /\b(invoke-expression|iex)\b/i, reason: 'Proba uruchomienia ukrytego skryptu.' },
  { re: /(iwr|invoke-webrequest|curl|wget)[\s\S]{0,120}\|\s*(iex|invoke-expression|bash|sh|powershell)\b/i, reason: 'Proba pobrania i od razu uruchomienia kodu z internetu.' },
  { re: /\b(mimikatz|sekurlsa|procdump|lazagne)\b/i, reason: 'Proba kradziezy hasel.' },
  { re: /\b(shutdown|restart-computer|stop-computer)\b/i, reason: 'Proba wylaczenia albo restartu komputera.' },
  { re: /\bmkfs\b|\bdd\s+if=/i, reason: 'Proba nadpisania dysku.' },
  { re: /:\(\)\s*\{/, reason: 'Proba zapetlenia systemu.' },
  { re: /[a-z]:\\windows|[a-z]:\\program files|\/etc\/|\/usr\/|\/bin\/|\/system\b/i, reason: 'Polecenie dotyka plikow systemu, nie Twoich.' },
];

export function judge(action, command) {
  const name = String(action || '').trim();
  if (name && name !== 'polecenie') {
    if (SAFE_ACTIONS.has(name)) return { allow: true, action: name };
    return { allow: false, action: name, reason: 'Nieznana akcja. E.D.I.T.H. ja zablokowala.' };
  }

  const text = String(command || '').trim();
  if (!text) return { allow: false, action: 'polecenie', reason: 'Puste polecenie.' };
  if (text.length > 2000) return { allow: false, action: 'polecenie', reason: 'Polecenie jest za dlugie.' };

  for (const rule of BLOCK_RULES) {
    if (rule.re.test(text)) {
      return { allow: false, action: 'polecenie', reason: rule.reason, command: text.slice(0, 240) };
    }
  }
  return { allow: true, action: 'polecenie' };
}
