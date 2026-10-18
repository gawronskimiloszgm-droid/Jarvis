// System Bezpieczeństwa E.D.I.T.H. (Even Dead I'm The Hero)
// Zarządza uprawnieniami, weryfikacją komend i bezpiecznym wykonywaniem skryptów.

const SAFE_ACTIONS = new Set([
  'otworz-spotify',
  'pobudka',
  'otworz-youtube-music',
  'otworz-przegladarke',
  'otworz-discord',
  'otworz-teams',
  'otworz-slack',
  'otworz-vscode',
  'otworz-eksplorator',
  'otworz-aplikacje',
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
  'zamknij-proces',
  'lista-procesow',
  'pokaz-pulpit',
  'uspij-komputer',
  'restart-komputera',
  'wylacz-komputer',
  'zapisz-plik',
  'dopisz-do-pliku',
  'czytaj-plik',
  'lista-plikow',
  'otworz-folder-jarvisa',
  'wlacz-edith',
  'wlacz-jarvis',
  'skan-bezpieczenstwa',
  'sterowanie-siecia',
  'pisz-tekst',
  'skrot-klawiszowy'
]);

// Krytyczne reguły blokowania destrukcyjnych akcji systemowych
const CRITICAL_BLOCK_RULES = [
  { re: /\bformat\s+[a-z]:/i, reason: 'E.D.I.T.H.: Wykryto próbę sformatowania partycji dyskowej.' },
  { re: /\bdiskpart\b|\bclean\s+all\b/i, reason: 'E.D.I.T.H.: Wykryto próbę czyszczenia struktury dysków.' },
  { re: /\brm\s+(-[a-z]*f[a-z]*\s+)?(-[a-z]*r[a-z]*\s+)?\/(\s|$)/i, reason: 'E.D.I.T.H.: Wykryto próbę usunięcia katalogu głównego systemu.' },
  { re: /remove-item[\s\S]{0,80}-recurse[\s\S]{0,40}[a-z]:\\/i, reason: 'E.D.I.T.H.: Rekursywne kasowanie struktur dyskowych zablokowane.' },
  { re: /\b(del|erase)\s+\/[a-z]*s[a-z]*\s+[a-z]:\\/i, reason: 'E.D.I.T.H.: Masowe wymazywanie plików wstrzymane.' },
  { re: /\brmdir\s+\/s\b|\brd\s+\/s\b/i, reason: 'E.D.I.T.H.: Wykryto próbę usunięcia folderów systemowych.' },
  { re: /\bcipher\s+\/w\b/i, reason: 'E.D.I.T.H.: Trwałe czyszczenie wolnej przestrzeni dyskowej zablokowane.' },
  { re: /\bbcdedit\b|\bbootrec\b/i, reason: 'E.D.I.T.H.: Wykryto próbę modyfikacji sektora rozruchowego (BCD/MBR).' },
  { re: /disable(realtimemonitoring)?|set-mppreference[\s\S]{0,80}-disable/i, reason: 'E.D.I.T.H.: Ochrona antywirusowa Windows Defender nie może zostać wyłączona.' },
  { re: /netsh\s+advfirewall[\s\S]{0,40}\boff\b/i, reason: 'E.D.I.T.H.: Wyłączenie zapory sieciowej zablokowane.' },
  { re: /\breg\s+delete\s+hklm\b/i, reason: 'E.D.I.T.H.: Modyfikacja kluczy rejestru systemowego HKLM zablokowana.' },
  { re: /\b(mimikatz|sekurlsa|procdump|lazagne)\b/i, reason: 'E.D.I.T.H.: Wykryto narzędzie zagrażające poświadczeniom systemowym.' },
  { re: /:\(\)\s*\{/, reason: 'E.D.I.T.H.: Wykryto próbę wykonania bomby widelcowej (fork bomb).' }
];

// Reguły wymagające potwierdzenia użytkownika przez protokół E.D.I.T.H.
const SENSITIVE_COMMAND_PATTERNS = [
  { re: /\b(shutdown|restart-computer|stop-computer)\b/i, warning: 'Wyłączenie lub restart systemu' },
  { re: /\bStop-Process\b|\btaskkill\b/i, warning: 'Wymuszone zamknięcie procesu' },
  { re: /Remove-Item\b|\bdel\b|\berase\b/i, warning: 'Usunięcie określonych plików' },
  { re: /Set-ExecutionPolicy\b/i, warning: 'Zmiana polityki wykonywania skryptów' }
];

function judge(action, command = '', options = {}) {
  const name = String(action || '').trim();
  const text = String(command || '').trim();
  const confirmedByEdith = Boolean(options.confirmedByEdith);

  // 1. Sprawdzenie nazwanej akcji
  if (name && name !== 'polecenie') {
    if (!SAFE_ACTIONS.has(name)) {
      return { allow: false, action: name, reason: 'E.D.I.T.H.: Nieznana lub niezarejestrowana akcja systemowa.' };
    }

    // Akcje zasilania wymagają potwerdzenia
    if (['wylacz-komputer', 'restart-komputera'].includes(name) && !confirmedByEdith) {
      return {
        allow: false,
        requiresConfirmation: true,
        action: name,
        warning: `Czy na pewno chcesz wykonać: ${name}?`,
        reason: 'E.D.I.T.H. wymaga potwierdzenia operacji na zasilaniu komputera.'
      };
    }

    return { allow: true, action: name };
  }

  // 2. Sprawdzenie dowolego polecenia systemowego
  if (!text) return { allow: false, action: 'polecenie', reason: 'E.D.I.T.H.: Otrzymano puste polecenie.' };
  if (text.length > 4000) return { allow: false, action: 'polecenie', reason: 'E.D.I.T.H.: Polecenie przekracza bezpieczny limit długości.' };

  // Weryfikacja pod kątem komend zabronionych
  for (const rule of CRITICAL_BLOCK_RULES) {
    if (rule.re.test(text)) {
      return { allow: false, action: 'polecenie', reason: rule.reason, command: text.slice(0, 240) };
    }
  }

  // Weryfikacja akcji wrażliwych - wymagających potwierdzenia
  if (!confirmedByEdith) {
    for (const pattern of SENSITIVE_COMMAND_PATTERNS) {
      if (pattern.re.test(text)) {
        return {
          allow: false,
          requiresConfirmation: true,
          action: 'polecenie',
          warning: pattern.warning,
          reason: `E.D.I.T.H.: Wykryto potencjalnie wrażliwą komendę (${pattern.warning}). Wymagana autoryzacja.`
        };
      }
    }
  }

  return { allow: true, action: 'polecenie' };
}

module.exports = { judge, SAFE_ACTIONS };
