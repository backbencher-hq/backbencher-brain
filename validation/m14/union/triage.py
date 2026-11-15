import subprocess, difflib
paths = subprocess.run(["git","diff","--name-only","HEAD","1b71d837c","--","src/ast"],capture_output=True,text=True).stdout.split()
def norm(s): return " ".join(s.split())
rows=[]
for p in paths:
    h = subprocess.run(["git","show",f"HEAD:{p}"],capture_output=True,text=True)
    m = subprocess.run(["git","show",f"1b71d837c:{p}"],capture_output=True,text=True)
    if m.returncode: rows.append((p,"MAIN-DELETED",0,0)); continue
    if h.returncode: rows.append((p,"MAIN-ONLY",0,0)); continue
    sm = difflib.SequenceMatcher(None, m.stdout.splitlines(), h.stdout.splitlines(), autojunk=False)
    main_only, head_only = [], []
    for tag,i1,i2,j1,j2 in sm.get_opcodes():
        if tag in ("replace","delete"):
            main_only += [norm(x) for x in m.stdout.splitlines()[i1:i2]]
        if tag in ("replace","insert"):
            head_only += [norm(x) for x in h.stdout.splitlines()[j1:j2]]
    # a main-only line is SUPERSEDED if it has a near-match among HEAD's additions
    unmatched = []
    for a in main_only:
        if not a.strip(): continue
        best = max((difflib.SequenceMatcher(None, a, b).ratio() for b in head_only), default=0)
        if best < 0.6: unmatched.append(a)
    verdict = "HEAD-SUPERSEDES" if not unmatched else "NEEDS-UNION"
    rows.append((p, verdict, len(main_only), len(unmatched), unmatched[:2]))
rows.sort(key=lambda r: (r[1], -(r[3] if len(r)>3 else 0)))
for r in rows:
    if r[1] in ("MAIN-DELETED","MAIN-ONLY"): print(f"{r[1]:16} {r[0]}"); continue
    extra = f"  e.g. {r[4][0][:70]}" if len(r)>4 and r[4] else ""
    print(f"{r[1]:16} main-only {r[2]:>4} · unmatched {r[3]:>4}  {r[0]}{extra}")
from collections import Counter
print(); print(Counter(r[1] for r in rows))
