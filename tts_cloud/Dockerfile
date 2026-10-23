# Obraz pod HuggingFace Spaces (Docker SDK).
FROM python:3.10-slim

# libsndfile jest wymagany przez soundfile/librosa do wczytania probki WAV,
# a ffmpeg do konwersji formatow wejsciowych.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libsndfile1 git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# torch w wersji CPU instalujemy PRZED reszta, zeby pip nie sciagnal
# wariantu z CUDA (~2.5 GB) jako zaleznosci coqui-tts.
RUN pip install --no-cache-dir torch==2.5.1 torchaudio==2.5.1 \
    --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Licencja modelu XTTS-v2 (Coqui Public Model License) wymaga zgody przy
# pobraniu. Bez tego pobranie modelu zatrzymuje sie na pytaniu w konsoli,
# a w kontenerze nie ma kto na nie odpowiedziec.
ENV COQUI_TOS_AGREED=1

# HuggingFace Spaces uruchamia kontener jako uzytkownik bez prawa zapisu
# do katalogow systemowych - model i wektory musza isc tam, gdzie wolno.
ENV HOME=/app
ENV TTS_HOME=/app/.cache
ENV NUMBA_CACHE_DIR=/tmp

COPY app.py .
COPY jarvis_sample.wav* ./

EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
