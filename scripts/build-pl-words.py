"""Buduje slownik przywracania polskich znakow (public/extras/plwords.js) z listy czestosci slow.

Uzycie: python scripts/build-pl-words.py sciezka/pl_50k.txt
Zrodlo listy: github.com/hermitdave/FrequencyWords (content/2018/pl/pl_50k.txt).
Slowo trafia do slownika, gdy forma z ogonkami jest wyraznie czestsza niz ta sama forma bez ogonkow.
"""
import json
import sys
from pathlib import Path

TABLE = str.maketrans("ąćęłńóśźż", "acelnoszz")
MAX_WORDS = 14000
RATIO = 25
# Dwa poprawne slowa rozne znaczeniowo: tu lista czestosci nie wystarcza.
AMBIGUOUS = {"ze", "za", "sad", "lad", "pas", "kat", "mas", "tek", "las", "lek", "ser", "dan", "wiec", "tez", "bak", "pac", "pal", "moc", "los", "rak", "nos", "bok", "kos", "wal", "zal", "zoo", "pan", "pani", "pana", "panie", "gora", "cala", "cale", "ladu", "para", "pare", "maja", "mam", "sie"}
FORCE = {"tez": "też", "sie": "się", "wiec": "więc", "zal": "żal", "cala": "cała", "cale": "całe", "gora": "góra", "pare": "parę", "zas": "zaś"}

src = Path(sys.argv[1])
freq = {}
for line in src.read_text("utf-8").splitlines():
    w, _, n = line.partition(" ")
    if w.isalpha() and n.isdigit():
        freq[w] = int(n)

best = {}
for w, n in freq.items():
    plain = w.translate(TABLE)
    if plain == w or len(w) < 2:
        continue
    if plain in AMBIGUOUS:
        continue
    if n < RATIO * freq.get(plain, 0):
        continue
    if plain not in best or n > freq[best[plain]]:
        best[plain] = w

words = sorted(best.values(), key=lambda w: -freq[w])[:MAX_WORDS]

# Slownictwo samej aplikacji: slowa z naszych tekstow i promptow, ktorych brakuje wsrod najczestszych,
# szukane w pelnej liscie (argument 2).
if len(sys.argv) > 2:
    import re

    full = {}
    for line in Path(sys.argv[2]).read_text("utf-8").splitlines():
        w, _, n = line.partition(" ")
        if w.isalpha() and n.isdigit():
            full[w] = int(n)
    fbest = {}
    for w, n in full.items():
        plain = w.translate(TABLE)
        if plain != w and plain not in AMBIGUOUS and n >= RATIO * full.get(plain, 0) and (plain not in fbest or n > full[fbest[plain]]):
            fbest[plain] = w
    root = Path(__file__).resolve().parent.parent
    seen = set()
    for f in [*root.glob("server/**/*.js"), *root.glob("public/**/*.js"), *root.glob("desktop/*.js"), *root.glob("public/*.html"), *root.glob("desktop/*.html")]:
        if "plwords" in f.name or "node_modules" in str(f):
            continue
        seen |= {t.lower() for t in re.findall(r"[A-Za-z]{3,}", f.read_text("utf-8", errors="ignore"))}
    have = {w.translate(TABLE) for w in words}
    extra = sorted(fbest[t] for t in seen if t in fbest and t not in have)
    words += extra
    print("slownictwo aplikacji:", len(extra))
words += [v for v in FORCE.values() if v not in words]
out = Path(__file__).resolve().parent.parent / "public" / "extras" / "plwords.js"
body = json.dumps(" ".join(words), ensure_ascii=False)
out.write_text(
    "// Wygenerowane przez scripts/build-pl-words.py: slowa z polskimi znakami, najczestsze pierwsze.\n"
    "(function (root) {\n  root.PL_WORDS = " + body + ";\n})(typeof globalThis !== 'undefined' ? globalThis : this);\n",
    "utf-8",
)
print(len(words), "slow,", out.stat().st_size // 1024, "KB")
