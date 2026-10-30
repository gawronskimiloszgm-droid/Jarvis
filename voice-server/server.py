"""Lokalny syntezator glosu Jarvisa (Chatterbox Multilingual, MIT).

Dajesz probke glosu (10-30 s czystej mowy), a serwer czyta dowolny tekst tym glosem, takze po polsku.
Dziala tylko na tym komputerze: nasluch wylacznie na 127.0.0.1, zadnych danych na zewnatrz
(jednorazowo pobiera model z Hugging Face).

Zgodny z formatami, ktore zna aplikacja:  POST /tts_to_audio/  oraz  POST /v1/audio/speech
Pozostale: GET /health, GET /voices, POST /voice?name=jarvis, GET|POST /settings, POST /unload

Model zajmuje pamiec karty graficznej, wiec po dluzszej bezczynnosci jest zwalniany
(np. na czas grania) i wraca sam przy nastepnym zdaniu.
"""
import hashlib
import io
import json
import os
import re
import subprocess
import threading
import time
from pathlib import Path

HOME = Path(os.environ.get("JARVIS_VOICE_HOME") or Path(__file__).resolve().parent)
os.environ.setdefault("HF_HOME", str(HOME / "hf"))
SAMPLES = HOME / "samples"
CACHE = HOME / "cache"
SETTINGS_FILE = HOME / "settings.json"
SAMPLES.mkdir(parents=True, exist_ok=True)
CACHE.mkdir(parents=True, exist_ok=True)

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse, Response  # noqa: E402

try:
    from num2words import num2words
except ImportError:
    num2words = None

PORT = int(os.environ.get("JARVIS_VOICE_PORT", "8020"))
IDLE_UNLOAD_SEC = int(os.environ.get("JARVIS_VOICE_IDLE", "1800"))
CACHE_MAX_FILES = 400
MIN_CHUNK = 28  # krotsze fragmenty model przeklamuje
LANGS = {"pl", "en", "de", "fr", "es", "it", "pt", "ru", "nl", "sv", "no", "da", "fi", "el", "tr", "ar", "he", "hi", "ja", "ko", "ms", "sw", "zh"}
# Parametry syntezy. cfg_weight=0 ogranicza obcy akcent, gdy probka jest w innym jezyku niz tekst.
DEFAULTS = {"voice": "jarvis", "language": "pl", "exaggeration": 0.35, "cfg_weight": 0.25, "temperature": 0.6}

app = FastAPI(title="Jarvis Voice")
# Tylko aplikacja Jarvisa: inne strony otwarte w przegladarce nie moga korzystac z serwera.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(https://jarvis-u4vw\.onrender\.com|https?://(localhost|127\.0\.0\.1)(:\d+)?)$",
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    allow_private_network=True,
)

lock = threading.RLock()
model = None
device = None
conds_for = None
warmed = False
state = {"loading": False, "error": None, "last_use": 0.0, "last_rtf": None, "load_sec": None}


def load_settings():
    try:
        return {**DEFAULTS, **json.loads(SETTINGS_FILE.read_text("utf-8"))}
    except (OSError, ValueError):
        return dict(DEFAULTS)


settings = load_settings()


def save_settings():
    SETTINGS_FILE.write_text(json.dumps(settings, ensure_ascii=False, indent=1), "utf-8")


def ensure_model():
    """Wczytuje model przy pierwszym uzyciu (albo po zwolnieniu)."""
    global model, device, conds_for
    with lock:
        if model is not None:
            return model
        state["loading"] = True
        state["error"] = None
        started = time.time()
        try:
            import torch
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS

            device = "cuda" if torch.cuda.is_available() else "cpu"
            model = ChatterboxMultilingualTTS.from_pretrained(device=torch.device(device))
            conds_for = None
            state["load_sec"] = round(time.time() - started, 1)
            return model
        except Exception as e:  # pokazujemy powod w /health i w odpowiedzi
            state["error"] = f"{type(e).__name__}: {e}"
            raise
        finally:
            state["loading"] = False


def unload():
    global model, conds_for, warmed
    with lock:
        if model is None:
            return False
        model = None
        warmed = False
        conds_for = None
        import gc

        import torch

        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        return True


def idle_watch():
    while True:
        time.sleep(30)
        if IDLE_UNLOAD_SEC > 0 and model is not None and time.time() - state["last_use"] > IDLE_UNLOAD_SEC:
            unload()


threading.Thread(target=idle_watch, daemon=True).start()


# ---------- przygotowanie tekstu ----------
def spell_numbers(text, lang):
    if not num2words:
        return text

    def rep(m):
        raw = m.group(0).replace(",", ".")
        try:
            return num2words(float(raw) if "." in raw else int(raw), lang=lang)
        except (NotImplementedError, ValueError, OverflowError):
            return m.group(0)

    return re.sub(r"\d+(?:[.,]\d+)?", rep, text)


UNITS_PL = [(r"(\d)\s*°C", r"\1 stopni Celsjusza"), (r"(\d)\s*°", r"\1 stopni"), (r"(\d)\s*%", r"\1 procent"), (r"(\d)\s*zł\b", r"\1 złotych"), (r"(\d)\s*km/h", r"\1 kilometrów na godzinę"), (r"(\d)\s*GB\b", r"\1 gigabajtów")]


def normalize(text, lang):
    t = str(text or "")
    t = re.sub(r"\[[A-ZĄĆĘŁŃÓŚŹŻ]+:[^\]]*\]", " ", t)  # znaczniki akcji
    t = re.sub(r"https?://\S+", " link ", t)
    t = re.sub(r"[*_`#>|~]+", " ", t)  # markdown
    t = re.sub(r"[\U0001F000-\U0001FAFF☀-➿]", " ", t)  # emoji i symbole
    if lang == "pl":
        for a, b in UNITS_PL:
            t = re.sub(a, b, t)
        t = re.sub(r"\bJ\.?A\.?R\.?V\.?I\.?S\.?", "Jarvis", t)
    t = spell_numbers(t, lang)
    return re.sub(r"\s+", " ", t).strip()


def split_sentences(text, limit=240):
    """Model najlepiej czyta krotkie fragmenty; dluzsze zdania tniemy na przecinkach, potem na spacjach."""
    out = []
    for s in re.split(r"(?<=[.!?…])\s+", text):
        s = s.strip()
        while len(s) > limit:
            cut = max(s.rfind(", ", 0, limit), s.rfind("; ", 0, limit), s.rfind(" - ", 0, limit))
            if cut < limit // 3:
                cut = s.rfind(" ", 0, limit)
            if cut <= 0:
                cut = limit
            out.append(s[: cut + 1].strip())
            s = s[cut + 1 :].strip()
        if s:
            out.append(s)
    merged = []
    for s in out:
        if merged and (len(merged[-1]) < MIN_CHUNK or len(s) < MIN_CHUNK) and len(merged[-1]) + len(s) < limit:
            merged[-1] = f"{merged[-1]} {s}"
        else:
            merged.append(s)
    return merged


# ---------- synteza ----------
def voice_path(name):
    safe = re.sub(r"[^\w.-]+", "_", str(name or settings["voice"]))
    safe = safe[:-4] if safe.lower().endswith(".wav") else safe
    p = SAMPLES / f"{safe}.wav"
    if not p.exists():
        raise HTTPException(404, f'Brak probki glosu "{safe}". Wgraj ja w Ustawieniach (Syntezator glosu).')
    return p


def synth_wav(text, voice=None, language=None):
    lang = language if language in LANGS else settings["language"]
    path = voice_path(voice)
    clean = normalize(text, lang)
    if not clean:
        raise HTTPException(400, "Brak tekstu do odczytania.")
    params = f"{path.stem}|{path.stat().st_mtime}|{lang}|{settings['exaggeration']}|{settings['cfg_weight']}|{settings['temperature']}|{clean}"
    key = hashlib.sha1(params.encode("utf-8")).hexdigest()
    cached = CACHE / f"{key}.wav"
    if cached.exists():
        state["last_use"] = time.time()
        cached.touch()
        return cached.read_bytes(), {"cached": True}

    global conds_for
    with lock:
        m = ensure_model()
        started = time.time()
        import torch

        cond_key = (str(path), path.stat().st_mtime, settings["exaggeration"])
        if conds_for != cond_key:
            m.prepare_conditionals(str(path), exaggeration=settings["exaggeration"])
            conds_for = cond_key
        chunks = []
        gap = np.zeros(int(m.sr * 0.18), dtype=np.float32)
        with torch.inference_mode():
            for part in split_sentences(clean):
                wav = m.generate(part, language_id=lang, exaggeration=settings["exaggeration"], cfg_weight=settings["cfg_weight"], temperature=settings["temperature"])
                chunks += [wav.squeeze().detach().cpu().numpy().astype(np.float32), gap]
        audio = np.concatenate(chunks[:-1]) if chunks else gap
        sr = m.sr
        took = time.time() - started
        state["last_use"] = time.time()
        state["last_rtf"] = round(took / max(0.1, len(audio) / sr), 2)

    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV", subtype="PCM_16")
    data = buf.getvalue()
    cached.write_bytes(data)
    files = sorted(CACHE.glob("*.wav"), key=lambda f: f.stat().st_mtime)
    for f in files[: max(0, len(files) - CACHE_MAX_FILES)]:
        f.unlink(missing_ok=True)
    return data, {"cached": False, "took": round(took, 2), "rtf": state["last_rtf"]}


def wav_response(data, meta):
    headers = {"X-Voice-Cached": str(meta.get("cached")), "X-Voice-Rtf": str(meta.get("rtf", "")), "Access-Control-Expose-Headers": "X-Voice-Cached, X-Voice-Rtf"}
    return Response(data, media_type="audio/wav", headers=headers)


# ---------- trasy ----------
@app.get("/health")
def health():
    gpu = None
    if model is not None:  # torch wczytujemy dopiero z modelem - sam serwer ma byc lekki
        import torch

        if torch.cuda.is_available():
            gpu = {"name": torch.cuda.get_device_name(0), "usedMB": round(torch.cuda.memory_reserved(0) / 1048576)}
    voices = sorted(p.stem for p in SAMPLES.glob("*.wav"))
    return {
        "ok": True,
        "engine": "chatterbox-multilingual",
        "loaded": model is not None,
        "loading": state["loading"],
        "error": state["error"],
        "device": device,
        "gpu": gpu,
        "voices": voices,
        "settings": settings,
        "lastRtf": state["last_rtf"],
        "loadSec": state["load_sec"],
    }


@app.get("/voices")
def voices():
    return {"voices": sorted(p.stem for p in SAMPLES.glob("*.wav")), "current": settings["voice"]}


@app.post("/voice")
async def upload_voice(request: Request, name: str = "jarvis"):
    """Dowolny plik audio/wideo -> czysta probka: mono 24 kHz, bez ciszy, wyrownana glosnosc, maks. 30 s."""
    global conds_for
    body = await request.body()
    if len(body) < 2000:
        raise HTTPException(400, "Plik jest za maly.")
    if len(body) > 200 * 1024 * 1024:
        raise HTTPException(400, "Plik jest za duzy (maks. 200 MB).")
    safe = re.sub(r"[^\w-]+", "_", name)[:40] or "jarvis"
    tmp = SAMPLES / f"_{safe}.upload"
    out = SAMPLES / f"{safe}.wav"
    tmp.write_bytes(body)
    try:
        flt = "silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_duration=0.6:stop_threshold=-45dB,loudnorm=I=-20:TP=-2:LRA=11"
        r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(tmp), "-vn", "-ac", "1", "-ar", "24000", "-af", flt, "-t", "30", str(out)], capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            raise HTTPException(400, f"Nie udalo sie odczytac pliku audio: {r.stderr.strip()[:200]}")
    except FileNotFoundError:
        raise HTTPException(500, "Brak programu ffmpeg na tym komputerze.")
    finally:
        tmp.unlink(missing_ok=True)
    info = sf.info(str(out))
    if info.duration < 3:
        out.unlink(missing_ok=True)
        raise HTTPException(400, f"Po usunieciu ciszy zostalo tylko {info.duration:.1f} s mowy. Potrzeba co najmniej 3 s (najlepiej 10-30 s).")
    settings["voice"] = safe
    save_settings()
    conds_for = None
    note = "Krotka probka - dluzsza (10-30 s) brzmi lepiej." if info.duration < 8 else None
    return {"ok": True, "name": safe, "duration": round(info.duration, 1), "note": note}


@app.get("/settings")
def get_settings():
    return settings


@app.post("/settings")
async def set_settings(request: Request):
    b = await request.json()
    if b.get("language") in LANGS:
        settings["language"] = b["language"]
    if b.get("voice"):
        voice_path(b["voice"])
        settings["voice"] = re.sub(r"[^\w-]+", "_", b["voice"])
    for k, lo, hi in (("exaggeration", 0.25, 1.5), ("cfg_weight", 0.0, 1.0), ("temperature", 0.1, 1.5)):
        if isinstance(b.get(k), (int, float)):
            settings[k] = max(lo, min(hi, float(b[k])))
    save_settings()
    return settings


@app.post("/unload")
def unload_route():
    return {"ok": True, "unloaded": unload()}


@app.post("/warmup")
def warmup():
    global conds_for, warmed
    m = ensure_model()
    state["last_use"] = time.time()
    if warmed:  # juz rozgrzany: nie zajmujemy karty, zaraz moze przyjsc prawdziwe zdanie
        return {"ok": True, "loadSec": state["load_sec"]}
    path = voice_path(None)
    with lock:
        cond_key = (str(path), path.stat().st_mtime, settings["exaggeration"])
        if conds_for != cond_key:
            m.prepare_conditionals(str(path), exaggeration=settings["exaggeration"])
            conds_for = cond_key
        for text in ("Wszystkie systemy działają prawidłowo, sir.", "Sprawdziłem to przed chwilą i wygląda na to, że wszystko jest w porządku."):
            m.generate(text, language_id=settings["language"], exaggeration=settings["exaggeration"], cfg_weight=settings["cfg_weight"], temperature=settings["temperature"])
        warmed = True
    state["last_use"] = time.time()
    return {"ok": True, "loadSec": state["load_sec"]}


@app.post("/tts_to_audio/")
async def tts_xtts(request: Request):
    b = await request.json()
    voice = b.get("speaker_wav") or settings["voice"]
    if not (SAMPLES / f"{Path(str(voice)).stem}.wav").exists():
        voice = settings["voice"]
    return speak(b.get("text"), voice, b.get("language"))


@app.post("/v1/audio/speech")
async def tts_openai(request: Request):
    b = await request.json()
    voice = b.get("voice") or settings["voice"]
    if not (SAMPLES / f"{Path(str(voice)).stem}.wav").exists():
        voice = settings["voice"]
    return speak(b.get("input"), voice, b.get("language"))


def speak(text, voice, language):
    try:
        data, meta = synth_wav(text, voice, language)
    except HTTPException:
        raise
    except Exception as e:
        return JSONResponse({"error": f"{type(e).__name__}: {e}"}, status_code=500)
    return wav_response(data, meta)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
