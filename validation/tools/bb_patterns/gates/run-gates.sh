#!/usr/bin/env bash
# Phase A gate runner for bb_patterns. Runs every verifier that references this
# tool from the working tree, sequentially, recording command, exit code and
# duration. Logs are the raw evidence; the JSON table is built from them.
set -u
cd /home/ishaq2321/mcp/backbencher-brain || exit 1
# The sandbox HOME is read-only: every gate that indexes a tmpdir fixture would
# otherwise fail on ~/.bb. Redirect the data dir (db + index lock) into the
# lane's evidence tree so the gate environment is writable and isolated.
export BB_DATA_DIR=/home/ishaq2321/mcp/backbencher-brain/validation/tools/bb_patterns/bbdata
export BB_NO_AUTO_REFRESH=1
OUT=validation/tools/bb_patterns/gates
LOGS=$OUT/logs
mkdir -p "$LOGS"
HEAD_SHA=$(git rev-parse HEAD)
echo "HEAD before: $HEAD_SHA"
echo "[" > "$OUT/gate-table.tmp.json"
first=1
run() {
  local name="$1"; shift
  local cmd=("$@")
  local start end code dur log
  start=$(date +%s%3N)
  "${cmd[@]}" > "$LOGS/$name.log" 2>&1
  code=$?
  end=$(date +%s%3N)
  dur=$((end - start))
  local sha
  sha=$(sha256sum "$LOGS/$name.log" | cut -d' ' -f1)
  echo "  -> $name exit=$code dur=${dur}ms"
  if [ $first -eq 0 ]; then echo "," >> "$OUT/gate-table.tmp.json"; fi
  first=0
  python3 - "$name" "$code" "$dur" "$sha" "${cmd[*]}" >> "$OUT/gate-table.tmp.json" <<'PY'
import json,sys
name,code,dur,sha,cmd = sys.argv[1],int(sys.argv[2]),int(sys.argv[3]),sys.argv[4],sys.argv[5]
print(json.dumps({"gate":name,"command":cmd,"exitCode":code,"durationMs":dur,"logSha256":sha,"log":f"validation/tools/bb_patterns/gates/logs/{name}.log"}))
PY
  echo "$name $code $dur" >> "$OUT/exit-codes.txt"
}

: > "$OUT/exit-codes.txt"

run verify-patterns bun run script/verify-patterns.ts
run m13-patterns-orphans bun run script/m13/verify-patterns-orphans.ts
run m13-patterns-rules bun run script/m13/verify-patterns-rules.ts
run m13-patterns-contract bun run script/m13/verify-patterns-contract.ts
run m13-patterns-docs bun run script/m13/verify-patterns-docs.ts
run m13-patterns-e2e-corpus bun run script/m13/verify-patterns-e2e-corpus.ts
run m15-patterns-deep bun run script/m15/verify-patterns-deep.ts
run m20-patterns-parameter-scan bun run script/m20/verify-patterns-parameter-scan.ts
run m20-patterns-orphan-semantics bun run script/m20/verify-patterns-orphan-semantics.ts
run m20-patterns-pagination-history bun run script/m20/verify-patterns-pagination-history.ts
run m57-t3-scope-all bun run script/m57/verify-t3-scope-all.ts
run m64-patterns-evidence-gate bun run script/m64/verify-patterns-evidence-gate.ts
run m64-gate-selftest bun run script/m64/verify-gate-selftest.ts
run m65-rules-budget-and-gates bun run script/m65/verify-rules-budget-and-gates.ts
run m65-rules-gate-selftest bun run script/m65/verify-rules-gate-selftest.ts
run m69-page-class-representation bun run script/m69/verify-patterns-page-class-representation.ts
run m16-docs-truth bun run script/m16/verify-docs-truth.ts
run m15-registry-handlers bun run script/m15/verify-registry-handlers.ts

echo "]" >> "$OUT/gate-table.tmp.json"
python3 - <<'PY'
import json
p="validation/tools/bb_patterns/gates/gate-table.tmp.json"
data=json.load(open(p))
import datetime
out={"schemaVersion":1,"tool":"bb_patterns","generatedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),
     "currentCommit":__import__("subprocess").check_output(["git","rev-parse","HEAD"],text=True).strip(),
     "note":"exit codes are process exit codes; logs are the raw output and the sha256 pins them",
     "gates":data,
     "passed":sum(1 for g in data if g["exitCode"]==0),
     "failed":sum(1 for g in data if g["exitCode"]!=0)}
json.dump(out,open("validation/tools/bb_patterns/gates/GATE-TABLE.json","w"),indent=2)
open("validation/tools/bb_patterns/gates/GATE-TABLE.json","a").write("\n")
PY
rm -f "$OUT/gate-table.tmp.json"
echo "DONE"
