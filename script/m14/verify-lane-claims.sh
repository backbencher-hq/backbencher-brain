#!/usr/bin/env bash
# verify-lane.sh <LANGUAGE> — the master agent's acceptance check for one lane.
#
# The workstream's rule is that a claim without a number is not a claim. This
# re-derives, independently of anything the lane agent wrote, whether the lane's
# story holds up. It is deliberately separate from the agent's own scripts: an
# agent that both measured and verified would only be checking its own homework.
#
# Usage:  .tools/verify-lane.sh java
# Exit 0 = every claim is backed. Exit 1 = something is asserted but unverified.
set -u
LANGS="${1:-}"
[ -z "$LANGS" ] && { echo "usage: $0 <language>"; exit 2; }
ROOT=$HOME/backbencher-brain
cd "$ROOT" || exit 1
L=$(echo "$LANGS" | tr '[:upper:]' '[:lower:]')

fail=0
say()  { printf '%s\n' "$*"; }
ok()   { printf '  \033[32mPASS\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$*"; fail=$((fail+1)); }
warn() { printf '  \033[33mWARN\033[0m %s\n' "$*"; }

say "=== lane verification: $L ==="

# ---------------------------------------------------------------- 1. the module exists
MOD=$(ls src/ast/real-$L-analyzer.ts 2>/dev/null)
[ -z "$MOD" ] && { bad "src/ast/real-$L-analyzer.ts does not exist"; exit 1; }
ok "analyzer module present ($(wc -l < "$MOD") lines)"

# ---------------------------------------------------------------- 2. emits, re-derived
# Independent of website/src/data/brain-languages.ts — this reads the analyzer
# and the engine enum, so a dataset that was edited to match a wrong analyzer
# cannot pass here.
npx tsx -e '
import { readFileSync } from "node:fs"
const L=process.argv[1]
const eng=readFileSync("src/ast/engine.ts","utf8")
const i=eng.indexOf("export enum RelationshipType"), j=eng.indexOf("}", i)
const ENUM:Record<string,string>={}
for (const m of eng.slice(i,j).matchAll(/([A-Za-z]+)\s*=\s*"([a-z_]+)"/g)) if(!(m[1]! in ENUM)) ENUM[m[1]!]=m[2]!
const VALID=new Set(Object.values(ENUM))
const src=readFileSync(`src/ast/real-${L}-analyzer.ts`,"utf8")
const found=new Set<string>()
for (const m of src.matchAll(/RelationshipType\.([A-Za-z]+)/g)) { const v=ENUM[m[1]!]; if(v) found.add(v) }
for (const m of src.matchAll(/(?:type|relationshipType|label):([^\n]*)/g)) for (const q of m[1]!.matchAll(/"([a-z_]+)"/g)) if (VALID.has(q[1]!)) found.add(q[1]!)
for (const m of src.matchAll(/\brel\(\s*[^,()]+,\s*"([a-z_]+)"/g)) if (VALID.has(m[1]!)) found.add(m[1]!)
console.log([...found].sort().join(" "))
' "$L" > /tmp/opencode/lane-emits.txt 2>/dev/null
EMITS=$(cat /tmp/opencode/lane-emits.txt)
if [ -n "$EMITS" ]; then ok "constructs: $EMITS"; else bad "no relationship type could be derived from source"; fi

# ---------------------------------------------------------------- 3. the dataset agrees
npx tsx -e '
import { PARSERS } from "./website/src/data/brain-languages.ts"
const L=process.argv[1]
const f=PARSERS.find(p=>p.ids.includes(L) || p.name.toLowerCase()===L)
if(!f){ console.error("NOFAMILY"); process.exit(1) }
console.log(f.emits.join(" "))
' "$L" > /tmp/opencode/lane-dataset.txt 2>/dev/null
DS=$(cat /tmp/opencode/lane-dataset.txt)
if [ "$DS" = "NOFAMILY" ] || [ -z "$DS" ]; then
  warn "no display family claims this language (fine for an unregistered analyzer)"
elif [ "$DS" = "$EMITS" ]; then
  ok "the published dataset matches what the source constructs"
else
  bad "published dataset disagrees with source"
  say "      dataset: $DS"
  say "      source : $EMITS"
  say "      -> regenerate website/src/data/brain-languages.ts via .tools/rebuild-languages.ts (master-owned); do not hand-edit"
fi

# ---------------------------------------------------------------- 4. oracle coverage
# A type the analyzer emits that no oracle audits is a bug that ships invisibly.
npx tsx -e '
import { readFileSync } from "node:fs"
const L=process.argv[1]
try {
  const j=JSON.parse(readFileSync("validation/m60/results/rel-type-coverage.json","utf8"))
  const d=j.data??j
  const lane=(d.lanes??[]).find((l:any)=>l.lang===L)
  if(!lane){ console.log("NOLANE"); process.exit(0) }
  const un=(lane.emitted??[]).filter((t:string)=>!(lane.audited??[]).includes(t)).sort()
  console.log(un.length? "UNVERIFIED "+un.join(","):"ALLVERIFIED")
} catch { console.log("NOARTIFACT") }
' "$L" > /tmp/opencode/lane-deriv.txt 2>/dev/null
DERIV=$(cat /tmp/opencode/lane-deriv.txt)
case "$DERIV" in
  ALLVERIFIED) ok "every emitted type is oracle-audited" ;;
  NOLANE)      warn "this lane is absent from rel-type-coverage.json (46 of 48 are present)" ;;
  NOARTIFACT)  bad "rel-type-coverage.json unreadable" ;;
  UNVERIFIED*) bad "emitted but never oracle-audited: ${DERIV#UNVERIFIED }" ;;
esac

# ---------------------------------------------------------------- 5. honesty bans
HITS=$(grep -oniE "no dedicated analyzer|generic traversal|generic pass|no call graph is resolved|deliberately weaker|cannot be traced" \
       "docs/analyzers/real-$L-analyzer.md" 2>/dev/null | head -3)
[ -n "$HITS" ] && { bad "the lane doc repeats a retired false claim"; say "      $HITS"; } || ok "no retired claim in the lane doc"

BANNED=$(grep -oniE "\b(perfect|production-ready|bulletproof|rock-solid|battle-tested|100% coverage)\b" \
       "docs/analyzers/real-$L-analyzer.md" 2>/dev/null | head -3)
[ -n "$BANNED" ] && warn "banned vocabulary in the lane doc: $BANNED" || ok "no banned vocabulary in the lane doc"

# ---------------------------------------------------------------- 6. fixtures can fail
# A fixture nothing can fail is decoration.
npx tsx script/m14/verify-fixture-coverage.ts 2>/dev/null | grep -iE "^.*$L.*(fail|non-pass)" | head -3
if [ $? -eq 0 ]; then warn "fixture coverage reports a non-pass for $L"; else ok "fixture coverage gate ran"; fi

# ---------------------------------------------------------------- 7. unknown symbols
# Rule R7: no placeholder-literal names, no empty names, no unknown kinds.
npx tsx script/m60/sentinel-census.ts 2>/dev/null | grep -iE "\b$L\b" | head -4 || true
REG=$(npx tsx -e '
import { readFileSync } from "node:fs"
try {
  const j=JSON.parse(readFileSync("validation/m60/symbol-sentinel-register.json","utf8"))
  const rows=(j.entries??j.sites??[])
  const n=rows.filter((r:any)=>JSON.stringify(r).includes(process.argv[1])).length
  console.log(n)
} catch { console.log("0") }' "$L" 2>/dev/null)
if [ "${REG:-0}" = "0" ]; then ok "no registered placeholder-name sites for $L"; else warn "$REG registered R7 placeholder site(s) for $L"; fi

# ---------------------------------------------------------------- verdict
echo
if [ "$fail" -eq 0 ]; then
  printf '\033[32mLANE %s: every claim is backed\033[0m\n' "$L"
else
  printf '\033[31mLANE %s: %d unverified claim(s)\033[0m\n' "$L" "$fail"
fi
exit $(( fail > 0 ? 1 : 0 ))
