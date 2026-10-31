# Makes tests/parity.json: random cases answered by the ORIGINAL Python tool (whymismatch.py), so the JavaScript port can be checked against it.
import sys, json, random
sys.path.insert(0, "/tmp/claude-0/-home-claude/db71df49-c532-5666-9cce-c2aa36521d14/scratchpad/lab/whymismatch")
from whymismatch import explain, _val
from decimal import Decimal
def canon(f):
    s = format(Decimal(f.numerator) / Decimal(f.denominator), "f")
    if "." in s: s = s.rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s
rng = random.Random(11); cases = []
def corrupt(e):
    e = list(e); i = rng.randrange(len(e)); s = e[i]; k = rng.choice(["swap", "digit", "dup", "sign", "drop", "dec", "ins"])
    ds = [j for j, c in enumerate(s) if c.isdigit()]
    if k == "swap" and len(s) > 1: j = rng.randrange(len(s) - 1); e[i] = s[:j] + s[j + 1] + s[j] + s[j + 2:]
    elif k == "digit": j = rng.choice(ds); e[i] = s[:j] + rng.choice("0123456789") + s[j + 1:]
    elif k == "dup": e.append(s)
    elif k == "sign": e[i] = "-" + s if not s.startswith("-") else s[1:]
    elif k == "drop": e.pop(i)
    elif k == "dec": e[i] = s + "0"
    else: j = rng.randrange(len(s) + 1); e[i] = s[:j] + rng.choice("0123456789") + s[j:]
    return e
for _ in range(500):
    n = rng.choice([3, 5, 8, 15]); money = rng.random() < .5
    orig = [f"{rng.randint(1, 99999)/100:.2f}" if money else str(rng.randint(1, 999)) for _ in range(n)]
    total = format(sum(Decimal(x) for x in orig), "f")
    bad = corrupt(orig)
    if rng.random() < .3: bad = corrupt(bad)
    try:
        D, hyp = explain(bad, total)
    except Exception: continue
    cases.append({"entries": bad, "total": total, "difference": canon(D),
                  "cands": sorted([[h[1], sorted(canon(x) for x in h[3])] for h in hyp if h[1] != "an entry is missing from the list"])})
json.dump(cases, open("/tmp/claude-0/-home-claude/db71df49-c532-5666-9cce-c2aa36521d14/scratchpad/balance-calc/tests/parity.json", "w"))
print(len(cases), "cases written;", sum(len(c["cands"]) for c in cases), "candidate answers in total")
