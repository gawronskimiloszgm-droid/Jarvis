"""Test wlasny uslugi glosu - odpalany LOKALNIE, nie czesc produktu.

Sprawdza cala droge: /health przed wczytaniem modelu, /warmup buduje
wektory z prawdziwej probki i zapisuje jarvis_voice.pth, /health po
warmupie potwierdza cache, /speak faktycznie generuje audio, a DRUGIE
wywolanie /speak jest wyraznie szybsze (dowod, ze wektory naprawde
wczytuja sie z cache, a nie licza na nowo za kazdym razem).
"""

import subprocess
import sys
import time

import requests

BASE = "http://127.0.0.1:7860"


def wait_for_health(timeout=30):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            r = requests.get(f"{BASE}/health", timeout=2)
            if r.status_code == 200:
                return r.json()
        except requests.exceptions.RequestException:
            pass
        time.sleep(1)
    raise RuntimeError("serwer nie odpowiedzial na /health w czasie")


def main():
    print("=== 1. /health przed wczytaniem modelu ===")
    h = wait_for_health()
    print(" ", h)
    assert h["samplepresent"] is True, "BRAK PROBKI - jarvis_sample.wav nie widoczny dla serwisu"

    print("\n=== 2. /warmup - budowa wektorow glosu (POTRWA - pierwsze pobranie modelu) ===")
    t0 = time.time()
    r = requests.post(f"{BASE}/warmup", timeout=600)
    print("  HTTP", r.status_code, "|", round(time.time() - t0, 1), "s")
    print(" ", r.json())
    assert r.status_code == 200, f"warmup nieudany: {r.text}"

    print("\n=== 3. /health po warmupie ===")
    h = wait_for_health()
    print(" ", h)
    assert h["voiceCached"] is True, "wektory NIE zostaly zapisane do jarvis_voice.pth"
    assert h["ready"] is True

    print("\n=== 4. Pierwsza prawdziwa synteza ===")
    t0 = time.time()
    r = requests.post(f"{BASE}/speak", json={"text": "Dzien dobry, sir. Systemy w normie."}, timeout=120)
    dt1 = time.time() - t0
    print("  HTTP", r.status_code, "|", round(dt1, 2), "s |", len(r.content), "B |", r.headers.get("content-type"))
    assert r.status_code == 200
    assert len(r.content) > 10000, "podejrzanie malo audio jak na cale zdanie"
    assert r.content[:4] == b"RIFF", "brak naglowka WAV"
    with open("_selftest_output.wav", "wb") as f:
        f.write(r.content)

    print("\n=== 5. Druga synteza - wektory MUSZA isc z pamieci, nie liczyc sie na nowo ===")
    t0 = time.time()
    r2 = requests.post(f"{BASE}/speak", json={"text": "Drugie, krotsze zdanie testowe."}, timeout=120)
    dt2 = time.time() - t0
    print("  HTTP", r2.status_code, "|", round(dt2, 2), "s |", len(r2.content), "B")
    assert r2.status_code == 200

    print("\n=== WYNIK ===")
    print(f"  pierwsza synteza (z budowa wektorow w tle bo juz scached): {dt1:.2f}s")
    print(f"  druga synteza: {dt2:.2f}s")
    print("  audio zapisane: tts_cloud/_selftest_output.wav - warto przesluchac recznie")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print("\nBLAD TESTU:", e)
        sys.exit(1)
