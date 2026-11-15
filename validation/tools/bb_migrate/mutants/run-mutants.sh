#!/usr/bin/env bash
# Planted-defect controls for bb_migrate's gates: each mutant changes one rule the
# gate claims to protect, the gate must FAIL, and the file is restored byte-for-byte
# and the gate re-run to PASS. Nothing is committed with a mutant applied.
set -u
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"
MUT="validation/tools/bb_migrate/mutants"
LOG="validation/tools/bb_migrate/logs"
export BB_DATA_DIR="$ROOT/validation/tools/bb_migrate/bbdata"
export BB_NO_AUTO_REFRESH=1
results="[]"

apply() { cp "$1" "$MUT/backup-$(basename "$1")"; }
restore() { cp "$MUT/backup-$(basename "$1")" "$1"; rm -f "$MUT/backup-$(basename "$1")"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }

mutant() {
  local id="$1" file="$2" gate="$3" command="$4" label="$5"
  local before after mutant_sha exit_red exit_green
  before=$(sha "$file")
  apply "$file"
  eval "$5"
  mutant_sha=$(sha "$file")
  eval "$command" > "$LOG/mutant-${id}-red.log" 2>&1
  exit_red=$?
  restore "$file"
  after=$(sha "$file")
  eval "$command" > "$LOG/mutant-${id}-green.log" 2>&1
  exit_green=$?
  results=$(node -e '
    const [id,file,gate,label,before,mutant,after,red,green] = process.argv.slice(1)
    const rows = JSON.parse(process.argv[10] ?? "[]")
    rows.push({ id, file, gate, label, shaBefore: before, shaMutant: mutant, shaRestored: after, restoredExactly: before === after, exitRed: Number(red), exitGreen: Number(green), redIsFailure: Number(red) !== 0, greenIsPass: Number(green) === 0 })
    console.log(JSON.stringify(rows))
  ' "$id" "$file" "$gate" "$label" "$before" "$mutant_sha" "$after" "$exit_red" "$exit_green" "$results")
  echo "mutant $id: red=$exit_red green=$exit_green restored=$([ "$before" = "$after" ] && echo yes || echo NO)"
}

echo "== M1: read-write open reintroduced in the handler"
mutant "readonly" "src/mcp/tools/bb_migrate/handler.ts" "m13/verify-migrate-accuracy.ts" \
  "npx tsx script/m13/verify-migrate-accuracy.ts" \
  "python3 - <<'PY'
p='src/mcp/tools/bb_migrate/handler.ts'
s=open(p).read()
s=s.replace('BrainDatabase.getRawInstance(projectId as any, { readonly: true })','BrainDatabase.getRawInstance(projectId as any)',1)
open(p,'w').write(s)
PY"

echo "== M2: dependency order emitted reversed"
mutant "order" "src/intelligence/migration/migration-engine.ts" "m13/verify-migrate-accuracy.ts" \
  "npx tsx script/m13/verify-migrate-accuracy.ts" \
  "python3 - <<'PY'
p='src/intelligence/migration/migration-engine.ts'
s=open(p).read()
s=s.replace('    order.push(current)','    order.unshift(current)',1)
open(p,'w').write(s)
PY"

echo "== M3: a reachable dictionary key declared unreachable"
mutant "dictionary-stale" "script/m20/verify-migration-dictionary.ts" "m20/verify-migration-dictionary.ts" \
  "bun run script/m20/verify-migration-dictionary.ts" \
  "python3 - <<'PY'
p='script/m20/verify-migration-dictionary.ts'
s=open(p).read()
s=s.replace('const DECLARED_UNREACHABLE_ROWS: Readonly<Record<string, string>> = {','const DECLARED_UNREACHABLE_ROWS: Readonly<Record<string, string>> = {\n  axios: \"planted stale declaration: axios is a reachable npm package name.\",',1)
open(p,'w').write(s)
PY"

echo "== M4: MCP child environment no longer forwards BB_DATA_DIR"
mutant "e2e-env" "script/m13/verify-migrate-e2e-corpus.ts" "m13/verify-migrate-e2e-corpus.ts" \
  "bun run script/m13/verify-migrate-e2e-corpus.ts" \
  "python3 - <<'PY'
import re
p='script/m13/verify-migrate-e2e-corpus.ts'
s=open(p).read()
s=re.sub(r\"\n      env: \{ \.\.\.process\.env, BB_DATA_DIR: process\.env\.BB_DATA_DIR!, BB_NO_AUTO_REFRESH: \\\"1\\\" \} as Record<string, string>,\", \"\", s)
open(p,'w').write(s)
PY"

echo "== M5: duplicate-component dedupe removed"
mutant "dedupe" "src/intelligence/migration/migration-engine.ts" "m65/verify-migrate-selectors.ts" \
  "bun run script/m65/verify-migrate-selectors.ts" \
  "python3 - <<'PY'
p='src/intelligence/migration/migration-engine.ts'
s=open(p).read()
s=s.replace('    if (seenPlanned.has(selection.symbolId)) { deduplicated++; continue }','',1)
open(p,'w').write(s)
PY"

echo "== M6: bounded load removed (every name match loaded)"
mutant "bounded-load" "src/intelligence/migration/migration-engine.ts" "m65/verify-migrate-latency.ts" \
  "bun run script/m65/verify-migrate-latency.ts" \
  "python3 - <<'PY'
p='src/intelligence/migration/migration-engine.ts'
s=open(p).read()
s=s.replace('  const loadedSymbols = resolved.symbols.filter((symbol) => selectedSymbolIds.has(symbol.id))','  const loadedSymbols = resolved.symbols',1)
open(p,'w').write(s)
PY"

node -e 'const rows=JSON.parse(process.argv[1]); require("fs").writeFileSync("validation/tools/bb_migrate/mutants/RED-GREEN.json", JSON.stringify({ schemaVersion: 1, tool: "bb_migrate", generatedAt: new Date().toISOString(), mutants: rows, allKilled: rows.every((row) => row.redIsFailure && row.greenIsPass && row.restoredExactly) }, null, 1)); console.log("mutants:", rows.length, "all killed:", rows.every((row) => row.redIsFailure && row.greenIsPass && row.restoredExactly))' "$results"
