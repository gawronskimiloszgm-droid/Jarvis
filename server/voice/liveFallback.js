// Wybor modelu i glosu rozmowy na zywo, z zejsciem na zapas.
//
// Google wylacza gemini-3.1-flash-live-preview 17 listopada 2026, a zamiennik ma
// inne zachowania. Dwie awarie wygladaja tu zupelnie inaczej:
// - model odrzucony: polaczenie zamyka sie, zanim przyjdzie jakakolwiek wiadomosc,
// - nieznany glos: sesja wstaje normalnie i nic nie gra (zmierzone wczesniej na
//   zywym API), wiec bez tego pilnowania rozmowa bylaby po prostu cicha.

export const LIVE_MODEL_NEW = 'gemini-3.8-live';
export const LIVE_MODEL_OLD = 'gemini-3.1-flash-live-preview';
// Na liscie glosow w dokumentacji, w przeciwienstwie do domyslnego Oriona.
export const SAFE_VOICE = 'Orus';

// Stary model zapisany w ustawieniach serwera nie moze blokowac nowego: po wylaczeniu zostalaby cisza.
export const liveModelChain = (fromEnv) => [...new Set([fromEnv && fromEnv !== LIVE_MODEL_OLD ? fromEnv : LIVE_MODEL_NEW, LIVE_MODEL_NEW, LIVE_MODEL_OLD])];

/** Stary model uruchamia narzedzia tylko blokujaco. Nowy domyslnie w tle, a Jarvis czeka na ich wynik, zeby o nim powiedziec. */
export function toolsForModel(tools, model) {
  if (model === LIVE_MODEL_OLD) return tools;
  return tools.map((t) => (t.functionDeclarations ? { ...t, functionDeclarations: t.functionDeclarations.map((f) => ({ ...f, behavior: 'BLOCKING' })) } : t));
}

export function createLiveChoice({ models, voices }) {
  const voiceList = [...new Set(voices.filter(Boolean))];
  let modelAt = 0;
  let voiceAt = 0;
  let verified = false; // ta para model + glos juz raz zagrala
  let audioThisTurn = false;
  let quietTurns = 0;
  let silenceSteps = 0;
  const stepLimit = voiceList.length * models.length;

  const nextModel = () => {
    modelAt = (modelAt + 1) % models.length;
    voiceAt = 0;
    verified = false;
    quietTurns = 0;
  };

  return {
    model: () => models[modelAt],
    voice: () => voiceList[voiceAt] ?? null,
    audio() {
      audioThisTurn = true;
      verified = true;
      quietTurns = 0;
    },
    /** Polaczenie zamknelo sie przed pierwsza wiadomoscia. Glos wybrany przez uzytkownika pada pierwszy, bo tak bywalo. */
    rejected({ customVoice = false } = {}) {
      if (customVoice && voiceAt === 0 && voiceList.length > 1) {
        voiceAt = 1;
        return 'voice';
      }
      nextModel();
      return 'model';
    },
    /**
     * Koniec tury. Zwraca 'voice' albo 'model', gdy trzeba przepiac sesje. Tura bez dzwieku, ale z
     * tekstem odpowiedzi, to pewna cisza. Bez tekstu moze to byc swiadome milczenie modelu, wiec
     * dopiero druga taka tura z rzedu sie liczy.
     */
    turnEnded({ userText = '', assistantText = '' } = {}) {
      const played = audioThisTurn;
      audioThisTurn = false;
      if (played || verified || (!userText && !assistantText)) return null;
      quietTurns++;
      if (!assistantText && quietTurns < 2) return null;
      quietTurns = 0;
      if (silenceSteps >= stepLimit) return null; // wszystko sprawdzone: nie krecimy sie w kolko
      silenceSteps++;
      if (voiceAt < voiceList.length - 1) {
        voiceAt++;
        return 'voice';
      }
      if (models.length < 2) return null;
      nextModel();
      return 'model';
    },
  };
}
