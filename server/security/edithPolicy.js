// WYGENEROWANE z desktop/edithPolicy.js przez scripts/sync-policy.cjs - nie edytuj
// recznie (serwer nie moze importowac CommonJS z aplikacji desktopowej).

export const SAFE_ACTIONS = new Set([
  'otworz-spotify',
  'otworz-link',
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
  'skrot-klawiszowy',
  'kliknij-na-ekranie',
  'lista-okien',
  'przelacz-okno',
  'wczytaj-plik-pc',
  'lista-elementow',
  'kliknij-element',
  'wpisz-w-element',
  'szukaj-plikow',
  'skan-autostartu',
  'polaczenia-sieciowe',
  'defender-status',
  'defender-skan',
  'zawies-proces',
  'wznow-proces',
  'ukladaj-okno',
  'schowek-odczyt',
  'schowek-zapis',
  'schowek-historia',
  'zadania-lista',
  'zadania-dodaj',
  'zadania-usun',
  'telemetria',
  'czas-pracy',
  'czas-pracy-ustaw',
  'bateria',
  'proces-dziala',
  'zrzut-maly',
  'zaznacz-ekran',
  'aktywne-okno',
  'stan-gry'
]);

// Akcje, ktore niczego nie zmieniaja w systemie (tylko czytaja/patrza/liczą).
// Tryb "tylko podglad" przepuszcza WYLACZNIE te.
export const READ_ONLY = new Set([
  'lista-procesow', 'lista-okien', 'lista-elementow', 'lista-plikow', 'czytaj-plik', 'wczytaj-plik-pc',
  'szukaj-plikow', 'skan-bezpieczenstwa', 'skan-autostartu', 'polaczenia-sieciowe', 'defender-status',
  'zrzut-i-opisz', 'schowek-odczyt', 'schowek-historia', 'zadania-lista', 'telemetria', 'czas-pracy', 'bateria', 'proces-dziala', 'zrzut-maly', 'zaznacz-ekran', 'aktywne-okno', 'stan-gry', 'wlacz-edith', 'wlacz-jarvis'
]);

const MODES = ['podglad', 'pytaj', 'zaufany'];

// Akcje, ktore zawsze wymagaja wyraznego potwierdzenia ("tak"/"potwierdzam"
// od uzytkownika), nawet gdy sa na liscie dozwolonych - bo sa nieodwracalne
// albo latwo je wywolac przez pomylke/przeslyszenie (np. zle zrozumiana
// nazwa procesu). Zasilanie bylo tu juz wczesniej; dolaczamy zabicie
// procesu (moze ubic cos innego niz uzytkownik mial na mysli) i wylaczenie
// sieci (odcina tez Jarvisa/Edith od swiata, dopoki ktos tego nie wlaczy
// z powrotem recznie).
const CONFIRM_ALWAYS = new Set(['wylacz-komputer', 'restart-komputera', 'zamknij-proces', 'zawies-proces']);

function describeAction(name, params = {}) {
  const extra = Object.entries(params || {}).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${k}=${String(v).slice(0, 60)}`).join(', ');
  if (!['zamknij-proces', 'sterowanie-siecia'].includes(name)) return `Wykonanie: ${name}${extra ? ` (${extra})` : ''}`;
  if (name === 'zamknij-proces') return `Zamkniecie procesu "${params.nazwa || params.process || '?'}"`;
  if (name === 'sterowanie-siecia') return 'Wylaczenie karty sieciowej';
  return `Wykonanie: ${name}`;
}

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

export function judge(action, command = '', options = {}, params = {}) {
  const name = String(action || '').trim();
  const text = String(command || '').trim();
  const confirmedByEdith = Boolean(options.confirmedByEdith);
  // Tryb uprawnien wybrany przez uzytkownika (panel E.D.I.T.H.):
  //  podglad - tylko odczyt, wszystko, co zmienia stan, jest zablokowane
  //  pytaj   - kazda zmiana wymaga jawnego "tak"
  //  zaufany - domyslnie: pytamy tylko o rzeczy nieodwracalne/ryzykowne
  const mode = MODES.includes(options.mode) ? options.mode : 'zaufany';

  // 1. Sprawdzenie nazwanej akcji
  if (name && name !== 'polecenie') {
    if (!SAFE_ACTIONS.has(name)) {
      return { allow: false, action: name, reason: 'E.D.I.T.H.: Nieznana lub niezarejestrowana akcja systemowa.' };
    }

    // Nieodwracalne albo latwe do pomylenia przez przeslyszenie - zawsze
    // pytamy, nawet jesli sama nazwa akcji jest na liscie dozwolonych.
    // "sterowanie-siecia" tylko przy WYLACZANIU - wlaczenie z powrotem nie
    // szkodzi, a bez tego wyjatku Jarvis nie moglby sam odblokowac sieci,
    // ktora wczesniej na prosbe wylaczyl.
    if (mode === 'podglad' && !READ_ONLY.has(name)) {
      return { allow: false, action: name, reason: 'E.D.I.T.H.: tryb "tylko podglad" - ta akcja zmieniłaby stan komputera.' };
    }

    const needsConfirm =
      CONFIRM_ALWAYS.has(name) ||
      (name === 'sterowanie-siecia' && params.wlacz === false) ||
      (mode === 'pytaj' && !READ_ONLY.has(name));

    if (needsConfirm && !confirmedByEdith) {
      return {
        allow: false,
        requiresConfirmation: true,
        action: name,
        warning: describeAction(name, params),
        reason: 'E.D.I.T.H. wymaga wyraznego potwierdzenia tej operacji.'
      };
    }

    return { allow: true, action: name };
  }

  // 2. Sprawdzenie dowolego polecenia systemowego
  if (mode === 'podglad') return { allow: false, action: 'polecenie', reason: 'E.D.I.T.H.: tryb "tylko podglad" - polecenia systemowe sa wylaczone.' };
  if (!text) return { allow: false, action: 'polecenie', reason: 'E.D.I.T.H.: Otrzymano puste polecenie.' };
  if (text.length > 4000) return { allow: false, action: 'polecenie', reason: 'E.D.I.T.H.: Polecenie przekracza bezpieczny limit długości.' };

  // Weryfikacja pod kątem komend zabronionych
  for (const rule of CRITICAL_BLOCK_RULES) {
    if (rule.re.test(text)) {
      return { allow: false, action: 'polecenie', reason: rule.reason, command: text.slice(0, 240) };
    }
  }

  // Weryfikacja akcji wrażliwych - wymagających potwierdzenia
  if (!confirmedByEdith && mode === 'pytaj') {
    return { allow: false, requiresConfirmation: true, action: 'polecenie', warning: 'Polecenie systemowe', reason: 'E.D.I.T.H.: tryb "pytaj o wszystko" - kazde polecenie wymaga potwierdzenia.' };
  }
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

