#!/usr/bin/env bash
# M14 ONTOLOGY — LUA. The two-run determinism comparison, end to end.
#
# WHY THIS EXISTS. `parseFile` is not deterministic, and the aggregate's advice —
# shard the census so WASM state cannot accumulate — turns out NOT to be
# sufficient: two sharded runs over a provably identical draw still disagree, and
# script/m60/lua-nondeterminism.ts shows why. 12 of 3,252 files return pool-worker's
# regex `extractFallback` output in one run and parse normally in the next, and a
# fallback file contributes 0 symbols and 0 relationships. So every count in
# docs/analyzers/real-lua-analyzer.md is a single-run observation, and this script
# is what makes that claim checkable rather than asserted.
#
# It prints the two runs side by side and the per-type delta. A reader who reruns it
# and gets a THIRD set of numbers has reproduced the finding, not failed to.
#
# Usage: bash validation/m60/lua-trace.sh
set -u
LANE="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-/tmp/opencode/lua-lane/trace}"
SHARDS=8
cd "$LANE" || exit 1

echo "=== draw identity ==="
echo "both runs must print the same drawDigest; a different digest means the corpus changed"
mkdir -p "$OUT"

for pass in t1 t2; do
  echo
  echo "=== pass $pass: $SHARDS shards, sequential (a lane-private outdir; the wave-2")
  echo "    incident was a SQLite write collision from two lanes resolving one DB path) ==="
  rm -rf "$OUT/$pass"
  mkdir -p "$OUT/$pass"
  for i in $(seq 0 $((SHARDS - 1))); do
    npx tsx script/m60/lua-wave2-audit.ts --shard "$i/$SHARDS" --outdir "$OUT/$pass" 2>&1 \
      | grep -v 'BB-PARSE-ERR' | tail -1
  done
  npx tsx script/m60/lua-wave2-audit.ts --merge --outdir "$OUT/$pass" --label "$pass" 2>&1 | tail -16
done

echo
echo "=== per-file digests over two passes: which files are nondeterministic? ==="
for p in a b; do
  for i in $(seq 0 $((SHARDS - 1))); do
    npx tsx script/m60/lua-nondeterminism.ts --pass "$p" --shard "$i" 2>&1 \
      | grep -v 'BB-PARSE-ERR' | tail -1
  done
done
python3 - <<'PY'
import json, glob
for p in ('a', 'b'):
    files, digests = {}, set()
    for f in sorted(glob.glob('/tmp/opencode/lua-lane/nondet/part-%s-*.json' % p)):
        j = json.load(open(f)); files.update(j['files']); digests.add(j['drawDigest'])
    json.dump({'drawDigest': sorted(digests)[0], 'pass': p, 'files': files},
              open('/tmp/opencode/lua-lane/nondet/pass-%s.json' % p, 'w'))
PY
npx tsx script/m60/lua-nondeterminism.ts --diff

echo
echo "=== the two runs, side by side ==="
python3 - "$OUT" <<'PY'
import json, sys
out = sys.argv[1]
a = json.load(open(f'{out}/t1/merged-t1.json'))
b = json.load(open(f'{out}/t2/merged-t2.json'))
print(f"drawDigest identical: {a['drawDigests'] == b['drawDigests']}  ({a['drawDigests'][0][:16]} / {b['drawDigests'][0][:16]})")
print(f"{'type':14}{'run1':>9}{'run2':>9}{'delta':>9}{'delta%':>9}")
tot1 = tot2 = 0
for t in sorted(a['totals']):
    x, y = a['totals'][t], b['totals'][t]
    tot1 += x; tot2 += y
    pct = (y - x) / x * 100 if x else 0.0
    print(f"{t:14}{x:>9}{y:>9}{y-x:>+9}{pct:>+8.2f}%")
print(f"{'TOTAL':14}{tot1:>9}{tot2:>9}{tot2-tot1:>+9}{(tot2-tot1)/tot1*100:>+8.2f}%")
print(f"symbols          {a['symbols']:>6}{b['symbols']:>9}{b['symbols']-a['symbols']:>+9}")
print()
print("A per-type delta that is not zero is the finding, not a defect in the census:")
print("§5 of docs/analyzers/real-lua-analyzer.md names the 12 files responsible.")
PY