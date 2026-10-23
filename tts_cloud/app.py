"""Mikroserwis syntezy mowy z klonowaniem glosu (XTTS-v2).

Osobna usluga, bo model wazy ~2 GB i potrzebuje Pythona z torchem -
nie ma jak trzymac tego w aplikacji Node na darmowym Render.

KLUCZOWA OPTYMALIZACJA (spec I.3): wektory glosu liczymy RAZ z probki
jarvis_sample.wav i zapisujemy na dysk jako jarvis_voice.pth. Kazde
kolejne wywolanie wczytuje gotowe wektory z pamieci procesu zamiast
ponownie parsowac i analizowac plik audio. Roznica jest zasadnicza:
ekstrakcja wektorow to najdrozsza czesc calego procesu, a wynik jest
zawsze taki sam - probka sie nie zmienia.

Uruchomienie lokalne:
    pip install -r requirements.txt
    python app.py

Wdrozenie: HuggingFace Spaces (Docker) - patrz Dockerfile i README.
"""

from __future__ import annotations

import io
import os
import time
import wave
from pathlib import Path
from typing import Optional

import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).parent
SAMPLE_PATH = Path(os.environ.get("JARVIS_VOICE_SAMPLE", BASE_DIR / "jarvis_sample.wav"))
EMBEDDING_PATH = Path(os.environ.get("JARVIS_VOICE_EMBEDDING", BASE_DIR / "jarvis_voice.pth"))
MODEL_NAME = os.environ.get("XTTS_MODEL", "tts_models/multilingual/multi-dataset/xtts_v2")
DEFAULT_LANGUAGE = os.environ.get("TTS_LANGUAGE", "pl")
API_TOKEN = os.environ.get("TTS_API_TOKEN", "")

app = FastAPI(title="J.A.R.V.I.S. Voice", version="1.0.0")


class VoiceEngine:
    """Model XTTS-v2 wraz z zapamietanymi wektorami glosu.

    Wczytywany leniwie przy pierwszym zapytaniu, a nie przy starcie -
    dzieki temu kontener wstaje od razu i endpoint /health odpowiada,
    nawet gdy model dopiero sie sciaga.
    """

    def __init__(self) -> None:
        self._model = None
        self._gpt_cond_latent: Optional[torch.Tensor] = None
        self._speaker_embedding: Optional[torch.Tensor] = None
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        self._load_error: Optional[str] = None

    @property
    def device(self) -> str:
        return self._device

    @property
    def ready(self) -> bool:
        return self._model is not None and self._speaker_embedding is not None

    @property
    def load_error(self) -> Optional[str]:
        return self._load_error

    def _load_model(self) -> None:
        if self._model is not None:
            return
        # Import lokalny: biblioteka ciagnie torch i zajmuje kilkanascie
        # sekund na import, wiec nie robimy tego przy starcie procesu.
        from TTS.tts.configs.xtts_config import XttsConfig
        from TTS.tts.models.xtts import Xtts
        from TTS.utils.manage import ModelManager

        manager = ModelManager()
        model_path, _, _ = manager.download_model(MODEL_NAME)

        config = XttsConfig()
        config.load_json(str(Path(model_path) / "config.json"))
        model = Xtts.init_from_config(config)
        model.load_checkpoint(config, checkpoint_dir=str(model_path), eval=True)
        model.to(self._device)
        self._model = model

    def _load_or_build_embedding(self) -> None:
        """Wczytuje wektory glosu z dysku albo liczy je raz i zapisuje."""
        if self._speaker_embedding is not None:
            return

        if EMBEDDING_PATH.exists():
            cached = torch.load(EMBEDDING_PATH, map_location=self._device)
            self._gpt_cond_latent = cached["gpt_cond_latent"].to(self._device)
            self._speaker_embedding = cached["speaker_embedding"].to(self._device)
            return

        if not SAMPLE_PATH.exists():
            raise FileNotFoundError(
                f"Brak probki glosu: {SAMPLE_PATH}. "
                "Wgraj 10-30 sekund czystego nagrania (mono, bez muzyki i szumu)."
            )

        # To jest ta kosztowna operacja, ktora robimy dokladnie raz.
        gpt_cond_latent, speaker_embedding = self._model.get_conditioning_latents(
            audio_path=[str(SAMPLE_PATH)]
        )
        torch.save(
            {"gpt_cond_latent": gpt_cond_latent.cpu(), "speaker_embedding": speaker_embedding.cpu()},
            EMBEDDING_PATH,
        )
        self._gpt_cond_latent = gpt_cond_latent.to(self._device)
        self._speaker_embedding = speaker_embedding.to(self._device)

    def ensure_ready(self) -> None:
        try:
            self._load_model()
            self._load_or_build_embedding()
            self._load_error = None
        except Exception as exc:  # zapamietujemy powod, /health go pokaze
            self._load_error = str(exc)
            raise

    def stream_pcm(self, text: str, language: str):
        """Generator kawalkow PCM 16-bit. Pierwszy kawalek wychodzi, zanim
        model dokonczy cale zdanie - to jest ten 'audio streaming' ze spec."""
        self.ensure_ready()
        chunks = self._model.inference_stream(
            text,
            language,
            self._gpt_cond_latent,
            self._speaker_embedding,
        )
        for chunk in chunks:
            audio = chunk.squeeze().detach().cpu().numpy()
            # XTTS zwraca float32 w zakresie [-1, 1]; WAV chce int16.
            clipped = audio.clip(-1.0, 1.0)
            yield (clipped * 32767).astype("<i2").tobytes()


engine = VoiceEngine()


def wav_header(sample_rate: int = 24000, channels: int = 1, bits: int = 16) -> bytes:
    """Naglowek WAV dla strumienia o NIEZNANEJ dlugosci.

    Przy strumieniowaniu nie wiemy z gory, ile bajtow audio powstanie, wiec
    w polach rozmiaru wpisujemy maksimum. Odtwarzacze strumieniowe (w tym
    <audio> w przegladarce) czytaja do konca polaczenia i to im wystarcza.
    """
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    header = io.BytesIO()
    header.write(b"RIFF")
    header.write((0xFFFFFFFF).to_bytes(4, "little"))
    header.write(b"WAVE")
    header.write(b"fmt ")
    header.write((16).to_bytes(4, "little"))
    header.write((1).to_bytes(2, "little"))
    header.write((channels).to_bytes(2, "little"))
    header.write((sample_rate).to_bytes(4, "little"))
    header.write((byte_rate).to_bytes(4, "little"))
    header.write((block_align).to_bytes(2, "little"))
    header.write((bits).to_bytes(2, "little"))
    header.write(b"data")
    header.write((0xFFFFFFFF).to_bytes(4, "little"))
    return header.getvalue()


class SpeakRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    language: str = Field(default=DEFAULT_LANGUAGE, max_length=5)
    token: str = Field(default="")


def check_token(provided: str) -> None:
    """Usluga stoi pod publicznym adresem, wiec bez tokenu kazdy moglby
    generowac mowe na koszt wlasciciela. Pusty TTS_API_TOKEN wylacza
    kontrole (wygodne lokalnie, niewskazane w chmurze)."""
    if API_TOKEN and provided != API_TOKEN:
        raise HTTPException(status_code=401, detail="Nieprawidlowy token.")


@app.get("/health")
def health() -> dict:
    return {
        "status": "online",
        "device": engine.device,
        "modelLoaded": engine._model is not None,
        "voiceCached": EMBEDDING_PATH.exists(),
        "samplepresent": SAMPLE_PATH.exists(),
        "ready": engine.ready,
        "lastError": engine.load_error,
    }


@app.post("/warmup")
def warmup() -> dict:
    """Wymuszenie wczytania modelu i wektorow - do wywolania raz po
    wdrozeniu, zeby pierwsze prawdziwe zapytanie nie czekalo minuty."""
    started = time.time()
    try:
        engine.ensure_ready()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"ready": True, "seconds": round(time.time() - started, 1), "device": engine.device}


@app.post("/speak")
def speak(req: SpeakRequest):
    check_token(req.token)

    def generate():
        yield wav_header()
        for pcm in engine.stream_pcm(req.text, req.language):
            yield pcm

    try:
        # Sprawdzamy gotowosc PRZED otwarciem strumienia - inaczej blad
        # wyladowalby w srodku odpowiedzi 200 i klient dostalby uciety WAV
        # zamiast czytelnego kodu bledu.
        engine.ensure_ready()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Silnik glosu niegotowy: {exc}")

    return StreamingResponse(generate(), media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 7860)))
