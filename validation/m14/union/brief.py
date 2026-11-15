import subprocess, sys, difflib
for p in sys.argv[1:]:
    h = subprocess.run(["git","show",f"HEAD:{p}"],capture_output=True,text=True)
    m = subprocess.run(["git","show",f"origin/main:{p}"],capture_output=True,text=True)
    if m.returncode: print(f"### {p}: MAIN-DELETED"); continue
    open(".tmp-merge/m.txt","w").write(m.stdout); open(".tmp-merge/h.txt","w").write(h.stdout)
    out = subprocess.run(["diff","-u",".tmp-merge/m.txt",".tmp-merge/h.txt"],capture_output=True,text=True).stdout
    hunks=[]; cur=None
    for ln in out.splitlines():
        if ln.startswith("@@"): cur={"h":ln,"body":[]}; hunks.append(cur)
        elif cur is not None: cur["body"].append(ln)
    repl=[x for x in hunks if any(l.startswith("+") for l in x["body"]) and any(l.startswith("-") for l in x["body"])]
    print(f"### {p}  (main {len(m.stdout.splitlines())} / HEAD {len(h.stdout.splitlines())} · repl {len(repl)} of {len(hunks)})")
    for x in repl[:5]:
        print(f"  {x['h'][:70]}")
        shown=0
        for l in x["body"]:
            if l[:1] in "+-" and shown<5: print("   ", l[:120]); shown+=1
