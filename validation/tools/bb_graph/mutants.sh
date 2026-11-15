#!/usr/bin/env bash
# Author: Muhammad Ishaq Khan
# WHAT THIS FILE IS — the red-then-green mutation battery for bb_graph's gates:
# each mutant plants a real defect, the named gate must FAIL, the file is
# restored, and the gate must PASS. A gate that cannot go red is not evidence.
# WHICH TOOL IT SERVES — bb_graph (read, requiresIndex true, modes: graph).
# WHERE ITS EVIDENCE LIVES — validation/tools/bb_graph/logs/mutants/*.log,
# validation/tools/bb_graph/results/mutants.json.
# CONTRACTS IT MUST NOT BREAK — every mutation is reverted from a saved copy and
# the tree is checked clean against the saved copy afterwards; no git command
# mutates the tree.
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
export BB_NO_AUTO_REFRESH=1
export BB_DATA_DIR="$ROOT/validation/tools/bb_graph/bbdata"
LOGS="$ROOT/validation/tools/bb_graph/logs/mutants"
RESULT="$ROOT/validation/tools/bb_graph/results/mutants.json"
HANDLER="src/mcp/tools/bb_graph/handler.ts"
ENGINE="src/intelligence/graph/graph-engine.ts"
TMP="$ROOT/validation/tools/bb_graph/.mutant-backup"
mkdir -p "$LOGS"
cp "$HANDLER" "$TMP.handler"
cp "$ENGINE" "$TMP.engine"
restore() { cp "$TMP.handler" "$HANDLER"; cp "$TMP.engine" "$ENGINE"; }
trap restore EXIT

run_mutant() {
  local id="$1" gate="$2" runner="$3" expected="${4:-fail}"
  local log="$LOGS/$id.log"
  local start=$(date +%s)
  if [ "$runner" = "bun" ]; then
    bun run "$gate" > "$log" 2>&1
  else
    npx tsx "$gate" > "$log" 2>&1
  fi
  local code=$?
  local elapsed=$(( $(date +%s) - start ))
  local verdict="MISSED"
  if [ "$expected" = "fail" ] && [ $code -ne 0 ]; then verdict="CAUGHT"; fi
  if [ "$expected" = "pass" ] && [ $code -eq 0 ]; then verdict="CLEAN"; fi
  echo "{\"id\":\"$id\",\"gate\":\"$gate\",\"runner\":\"$runner\",\"expected\":\"$expected\",\"exit\":$code,\"verdict\":\"$verdict\",\"elapsedSeconds\":$elapsed}" >> "$RESULT.partial"
  echo "  $verdict  $id → $gate (exit $code, ${elapsed}s)"
  return 0
}

: > "$RESULT.partial"

echo "== M1: tier derivation ignores the stored evidenceClass (handler) =="
python3 - "$HANDLER" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("evidenceClass: e.metadata?.evidenceClass ?? null })", "evidenceClass: null })",1)
open(p,'w').write(s)
PY
run_mutant M1-tier-ignores-stored-class script/m28/verify-surface-parity.ts tsx fail
restore

echo "== M2: cascade falls back to the pre-fix range JOIN (engine) =="
python3 - "$ENGINE" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("if (ids !== null && ids !== undefined) return cascadeInlineJoin(ids, column)", "if (false && ids !== null && ids !== undefined) return cascadeInlineJoin(ids, column)",1)
open(p,'w').write(s)
PY
run_mutant M2-cascade-plan-regression script/m65/verify-graph-plan.ts tsx fail
restore

echo "== M3: maxEdges is silently raised to the per-query limit (engine) =="
python3 - "$ENGINE" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old="const maxEdges = Math.max(1, Math.min(Math.floor(options.maxEdges ?? DEFAULT_MAX_TOTAL_EDGES), MAX_TOTAL_EDGES))"
new="const maxEdges = Math.max(DEFAULT_EDGE_QUERY_LIMIT, Math.min(Math.floor(options.maxEdges ?? DEFAULT_MAX_TOTAL_EDGES), MAX_TOTAL_EDGES))"
assert old in s
s=s.replace(old,new,1)
open(p,'w').write(s)
PY
run_mutant M3-maxEdges-not-honored script/verify-graph.ts bun fail
restore

echo "== M4: default kind set narrowed to four kinds (engine) =="
python3 - "$ENGINE" <<'PY'
import sys, re
p=sys.argv[1]; s=open(p).read()
start=s.index("const DEFAULT_REL_TYPES = [")
end=s.index("]", start)+1
s=s[:start]+'const DEFAULT_REL_TYPES = [\n  "calls", "extends", "implements", "instantiates",\n]'+s[end:]
open(p,'w').write(s)
PY
run_mutant M4-edge-kind-default-narrowed script/m65/verify-edge-kind-scoping.ts bun fail
restore

echo "== M5: the unattributed counts are hardcoded instead of measured (engine) =="
python3 - "$ENGINE" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
old="unattributed: countUnattributedRows(raw, projectId, root.id, relTypes, cascadeCache),"
new="unattributed: { callers: 0, callees: 0 },"
assert old in s
s=s.replace(old,new,1)
open(p,'w').write(s)
PY
run_mutant M5-blind-spot-not-counted script/m65/verify-graph-blindspots.ts bun fail
restore

echo "== control: restored tree is clean and the gates are green again =="
if diff -q "$TMP.handler" "$HANDLER" >/dev/null && diff -q "$TMP.engine" "$ENGINE" >/dev/null; then
  echo "{\"id\":\"control-restored\",\"gate\":\"diff\",\"runner\":\"shell\",\"expected\":\"pass\",\"exit\":0,\"verdict\":\"CLEAN\",\"elapsedSeconds\":0}" >> "$RESULT.partial"
  echo "  CLEAN  files restored byte-identically"
else
  echo "{\"id\":\"control-restored\",\"gate\":\"diff\",\"runner\":\"shell\",\"expected\":\"pass\",\"exit\":1,\"verdict\":\"MISSED\",\"elapsedSeconds\":0}" >> "$RESULT.partial"
  echo "  MISSED  restore differs from saved copy"
fi
run_mutant control-green-again script/verify-graph.ts bun pass
restore

python3 - "$RESULT.partial" "$RESULT" <<'PY'
import json, sys, datetime
rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
out={"at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"tool":"bb_graph","mutants":rows,
     "caught":sum(1 for r in rows if r["verdict"]=="CAUGHT"),
     "clean":sum(1 for r in rows if r["verdict"]=="CLEAN"),
     "missed":[r["id"] for r in rows if r["verdict"]=="MISSED"]}
json.dump(out, open(sys.argv[2],"w"), indent=2)
print(f"caught {out['caught']} mutant(s), clean {out['clean']}, missed {len(out['missed'])}")
sys.exit(0 if not out["missed"] else 1)
PY
