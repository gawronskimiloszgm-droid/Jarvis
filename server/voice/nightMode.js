// Tryb szeptu / cichej odpowiedzi w nocy - czysta funkcja czasu, zadnego
// stanu do trzymania. server/tts.js NIE jest tu edytowany (zakaz), ale
// moglby zaimportowac recommendedVoiceProfile() i zastosowac ja przy
// syntezie - patrz raport koncowy co dokladnie dopiac i gdzie.

import express from 'express';

const QUIET_START_HOUR = Number(process.env.NIGHT_MODE_START_HOUR || 22); // od 22:00
const QUIET_END_HOUR = Number(process.env.NIGHT_MODE_END_HOUR || 7); // do 7:00

function warsawHour(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    hour: '2-digit',
    hour12: false,
  });
  return Number(fmt.format(now));
}

function isQuietHour(hour) {
  // Okno przechodzi przez polnoc (np. 22 -> 7), wiec zwykle porownanie
  // "start <= hour <= end" by nie zadzialalo.
  if (QUIET_START_HOUR === QUIET_END_HOUR) return false;
  if (QUIET_START_HOUR < QUIET_END_HOUR) return hour >= QUIET_START_HOUR && hour < QUIET_END_HOUR;
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

/**
 * Sugerowany profil glosu TTS na podstawie aktualnej godziny (czas
 * warszawski). volume to wspolczynnik 0-1 do pomnozenia przez docelowa
 * glosnosc odtwarzania po stronie klienta.
 */
export function recommendedVoiceProfile(now = new Date()) {
  const hour = warsawHour(now);
  const quiet = isQuietHour(hour);
  return {
    quietHours: quiet,
    volume: quiet ? 0.55 : 1.0,
    // Podpowiedz dla ewentualnej prozodii TTS (patrz TTS_PITCH/TTS_RATE
    // w server/tts.js) - wolniej i nizej brzmi bardziej "szeptem" niz samo
    // sciszenie.
    rateHint: quiet ? '-20%' : '-8%',
    pitchHint: quiet ? '-12%' : '-7%',
    reason: quiet
      ? `pora nocna (${QUIET_START_HOUR}:00-${QUIET_END_HOUR}:00) - sugerowana cichsza odpowiedz`
      : 'pora dzienna - standardowa glosnosc',
  };
}

export const router = express.Router();

router.get('/api/voice/night-mode', (req, res) => {
  res.json(recommendedVoiceProfile());
});

export default router;
