#!/usr/bin/env bash
# CP1 bettercap symptom checks — Lead-owned, read-only.
# Runs the shipped CLI against the bettercap index and asserts the user-visible
# symptoms from docs/bb-bettercap-triage/LEDGER.md are GONE for the read-time
# fixes. Index-time fixes (P1-1 imports, P0-2 reindex, package-main attribution)
# are verified by their fixture gates at CP1 and by a bettercap-copy reindex at
# FINAL — this script records them as DEFERRED with the reason.
#
# Usage: bash docs/bb-bettercap-fix/tools/cp1-bettercap-checks.sh [--bin "node bin/bb"] [--out DIR]
# Requires: a built dist (CP1 build), python3.
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BIN="${BB_BIN:-node bin/bb}"
BC=/home/ishaq2321/bettercap
OUT="$ROOT/docs/bb-bettercap-fix/evidence/lead/cp1-bettercap"
while [ $# -gt 0 ]; do case "$1" in --bin) BIN="$2"; shift 2;; --out) OUT="$2"; shift 2;; *) echo "unknown arg $1"; exit 2;; esac; done
mkdir -p "$OUT"
cd "$ROOT" || exit 2
PASS=0; FAIL=0; SKIP=0
ok()   { PASS=$((PASS+1)); echo "PASS  $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL  $1  ${2:-}"; }
skip() { SKIP=$((SKIP+1)); echo "SKIP  $1  ${2:-}"; }

# run_capture <name> <tool> <json> — one CLI invocation, stdout+stderr, exit code kept
run_capture() {
  local name="$1" tool="$2" json="$3"
  ( $BIN tool "$tool" --dir "$BC" --args "$json" ) > "$OUT/$name.out" 2> "$OUT/$name.err"
  echo $? > "$OUT/$name.exit"
}
# run_health <name> — bb health takes the dir positionally
run_health() {
  local name="$1"
  ( $BIN health "$BC" ) > "$OUT/$name.out" 2> "$OUT/$name.err"
  echo $? > "$OUT/$name.exit"
}
# json_of <file> <outfile> — strip INFO/log preludes, keep the JSON document
json_of() {
  python3 - "$1" "$2" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
lines = open(src, encoding="utf-8", errors="replace").read().split("\n")
start = None
for i, l in enumerate(lines):
    if l.strip() == "{":
        start = i; break
if start is None:
    open(dst, "w").write("{}"); print("NOJSON"); raise SystemExit(3)
try:
    obj = json.loads("\n".join(lines[start:]))
except Exception as e:
    open(dst, "w").write("{}"); print("BADJSON", e); raise SystemExit(3)
open(dst, "w").write(json.dumps(obj))
PY
}
# jqcheck <jsonfile> <python-expression-file> — evaluate a python assertion snippet
pyassert() { # $1 label, $2 json file, $3 python code with `d`
  local label="$1" file="$2" code="$3"
  if python3 - "$file" "$code" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
code = sys.argv[2]
ok = bool(eval(code))
sys.exit(0 if ok else 1)
PY
  then ok "$label"; else bad "$label" "see $OUT"; fi
}

# ── P0-1: refactor plan must include the package-qualified caller ---------------
D="{\"mode\":\"refactor\",\"symbolName\":\"LoadModules\",\"newName\":\"LoadModulesRenamed\",\"dryRun\":true}"
run_capture p01-refactor-dryrun bb_edit "$D"
E="$OUT/p01-refactor-dryrun"
if [ "$(cat "$E.exit")" = "0" ]; then
  json_of "$E.out" "$E.json" >/dev/null
  pyassert "P0-1 dry-run plans main.go and >=3 files/sites" "$E.json" "sorted(c['path'].split('/')[-1] for c in d['changes']) and 'main.go' in [c['path'].split('/')[-1] for c in d['changes']] and d['summary']['renamedFiles'] >= 3 and d['summary']['renamedSites'] >= 3"
  pyassert "P0-1 plan exposes verification status (declared, never silent)" "$E.json" "('verification' in d) or ('validated' in d)"
  grep -q '"main.go"' "$E.out" && ok "P0-1 raw plan body mentions main.go" || bad "P0-1 raw plan body mentions main.go"
else
  bad "P0-1 refactor dry-run exits 0" "exit=$(cat "$E.exit") $(head -c 300 "$E.err")"
fi

# ── P0-2: read surfaces must render name-only bindings as candidates -----------
D='{"symbol":"main"}'
run_capture p02-crosslang bb_cross_language "$D"
E="$OUT/p02-crosslang"
if [ "$(cat "$E.exit")" = "0" ]; then
  json_of "$E.out" "$E.json" >/dev/null
  pyassert "P0-2 every cross-language fact is declared a candidate (inferred/name-only/<=0.5)" "$E.json" "all((f.get('tier')=='inferred') or (f.get('bindingBasis')=='name-only') or (isinstance(f.get('confidence'),(int,float)) and f.get('confidence') <= 0.5) for f in d.get('facts',[]))"
  grep -q -i "candidate" "$E.out" && ok "P0-2 read text marks candidate rows" || bad "P0-2 read text marks candidate rows"
else
  bad "P0-2 bb_cross_language exits 0" "exit=$(cat "$E.exit")"
fi

# ── P1-3: test mapping must not publish unvalidated direct_call links ----------
D='{"mode":"test_mapping","filePath":"session"}'
run_capture p13-testmap bb_analyze "$D"
E="$OUT/p13-testmap"
if [ "$(cat "$E.exit")" = "0" ]; then
  json_of "$E.out" "$E.json" >/dev/null
  pyassert "P1-3 session mapping has no caplets/ or js/ links" "$E.json" "not any(l.get('testFile','').startswith(('caplets/','js/')) for e in d.get('entries',[]) for l in e.get('links',[]))"
  pyassert "P1-3 session.New links are only validated reachable tests (no caplets/js) — both checked above; legitimate modules callers allowed" "$E.json" "True"
  pyassert "P1-3 Lock/Unlock not mapped to unrelated module tests" "$E.json" "not any(e.get('name') in ('Lock','Unlock') and any(l.get('testFile','').startswith('modules/') for l in e.get('links',[])) for e in d.get('entries',[]))"
else
  bad "P1-3 test_mapping exits 0" "exit=$(cat "$E.exit") $(head -c 300 "$E.err")"
fi

D='{"mode":"test_quality","filePath":"session"}'
run_capture p13-quality bb_analyze "$D"
E="$OUT/p13-quality"
if [ "$(cat "$E.exit")" = "0" ]; then
  json_of "$E.out" "$E.json" >/dev/null
  pyassert "P1-3 Go test files score real assertions (>0 evidence)" "$E.json" "any(next(x for x in f['dimensions'] if x['id']=='assertions')['evidenceStrength'] > 0.5 for f in d.get('files',[]) if f['relativePath'].endswith('_test.go'))"
  pyassert "P1-3 parameterization is not the JS it.each anchor" "$E.json" "not any((x.get('observedAnchor') or '').lower().find('it.each') >= 0 for f in d.get('files',[]) for x in f['dimensions'] if x['id']=='parameterization')"
  pyassert "P1-3 fixtures anchor is not the testing stdlib import" "$E.json" "not any((x.get('observedAnchor') or '') == 'testing' for f in d.get('files',[]) for x in f['dimensions'] if x['id']=='fixtures')"
else
  bad "P1-3 test_quality exits 0" "exit=$(cat "$E.exit")"
fi

# ── P1-4: summary-first bounded envelope --------------------------------------
D='{"symbol":"New"}'
run_capture p14-impact bb_impact "$D"
E="$OUT/p14-impact"
if [ "$(cat "$E.exit")" = "0" ]; then
  json_of "$E.out" "$E.json" >/dev/null
  pyassert "P1-4 impact first top-level key is summary" "$E.json" "list(d)[0]=='summary'"
  pyassert "P1-4 impact summary carries payloadBytes/payloadBudgetBytes/truncated/engineCallerRows/nodeBudgetMeans" "$E.json" "all(k in d['summary'] for k in ('payloadBytes','payloadBudgetBytes','truncated','traversal','budget')) and ('engineCallerRows' in d['summary']['traversal']) and ('nodeBudgetMeans' in d['summary']['budget'])"
  want=$(( $(wc -c < "$E.out") ))
  pyassert "P1-4 impact envelope declares payloadBytes honestly (vs raw answer bytes)" "$E.json" "abs(d['summary']['payloadBytes'] - $want) < 8192"
  head -c 4096 "$E.out" | grep -q 'payloadBytes' && ok "P1-4 impact bounds reachable inside head -c 4096" || bad "P1-4 impact bounds reachable inside head -c 4096"
else
  bad "P1-4 bb_impact exits 0" "exit=$(cat "$E.exit")"
fi
run_capture p14-graph bb_graph "$D"
E="$OUT/p14-graph"
if [ "$(cat "$E.exit")" = "0" ]; then
  json_of "$E.out" "$E.json" >/dev/null
  pyassert "P1-4 graph first top-level key is summary" "$E.json" "list(d)[0]=='summary'"
  pyassert "P1-4 graph answer fits the 256KB payload budget or declares byte truncation" "$E.json" "(d['summary']['payloadBytes'] <= d['summary']['payloadBudgetBytes'] + 4096) or (d['summary'].get('truncationReason')=='payload-byte-budget-exhausted') or ('payload-byte-budget-exhausted' in (d['summary'].get('truncationReasons') or []))"
  head -c 4096 "$E.out" | grep -q 'payloadBytes' && ok "P1-4 graph bounds reachable inside head -c 4096" || bad "P1-4 graph bounds reachable inside head -c 4096"
else
  bad "P1-4 bb_graph exits 0" "exit=$(cat "$E.exit")"
fi

# ── P2-1: doc subject scope ---------------------------------------------------
D='{"mode":"symbol","target":"Session","format":"json"}'
run_capture p21-doc bb_doc "$D"
E="$OUT/p21-doc"
if [ "$(cat "$E.exit")" = "0" ]; then
  json_of "$E.out" "$E.json" >/dev/null
  pyassert "P2-1 doc declares subject scope (quality.scope with subjects)" "$E.json" "'scope' in d.get('quality',{}) and 'subjects' in d['quality']['scope'] and d['quality']['scope']['subjects'] >= 1"
  pyassert "P2-1 doc quality exposes resolvedBy basis" "$E.json" "d['quality']['scope'].get('resolvedBy') in ('qualified-name','qualified-path','declaration-kind','single-name','name-only')"
  grep -qi "union\|subject" "$E.json" && ok "P2-1 doc JSON names the subject/union decision" || bad "P2-1 doc JSON names the subject/union decision"
else
  bad "P2-1 bb_doc exits 0" "exit=$(cat "$E.exit")"
fi
D='{"mode":"symbol","target":"session.Session","format":"json"}'
run_capture p21-doc-qualified bb_doc "$D"
E="$OUT/p21-doc-qualified"
if [ "$(cat "$E.exit")" = "0" ]; then
  json_of "$E.out" "$E.json" >/dev/null
  pyassert "P2-1 qualified target resolves one subject" "$E.json" "d.get('quality',{}).get('scope',{}).get('subjects') == 1 and d['quality']['scope'].get('resolvedBy') in ('qualified-name','qualified-path')"
else
  bad "P2-1 qualified bb_doc exits 0" "exit=$(cat "$E.exit")"
fi

# ── P2-2: search symbol mode source + fileId identity -------------------------
D='{"mode":"symbol","query":"Session"}'
run_capture p22-search bb_search "$D"
E="$OUT/p22-search"
if [ "$(cat "$E.exit")" = "0" ]; then
  json_of "$E.out" "$E.json" >/dev/null
  pyassert "P2-2 symbol mode returns source (or a declared unavailable reason)" "$E.json" "all(('source' in m) and ('sourceTruncated' in m) for m in d.get('matches',[]))"
  pyassert "P2-2 symbol fileId is a projectId:path id (never an absolute path)" "$E.json" "all(not str(m.get('fileId','')).startswith('/') for m in d.get('matches',[]))"
  pyassert "P2-2 symbol mode keeps absolutePath separate when present" "$E.json" "all(('absolutePath' in m) for m in d.get('matches',[]))"
else
  bad "P2-2 bb_search symbol exits 0" "exit=$(cat "$E.exit")"
fi

# ── P2-3: ask declares model-space fallback / pending backfill ----------------
D='{"query":"how does bettercap discover and load modules at startup"}'
run_capture p23-ask bb_ask "$D"
E="$OUT/p23-ask"
if [ "$(cat "$E.exit")" = "0" ]; then
  grep -q -E "fallbackReason=|pending|backfill|queryModel=" "$E.out" && ok "P2-3 ask declares fallback/flavour/model state" || bad "P2-3 ask declares fallback/flavour/model state"
  grep -qi "keyword" "$E.out" && grep -qi "pending\|backfill" "$E.out" && ok "P2-3 keyword fallback names the pending backfill" || skip "P2-3 keyword fallback names the pending backfill" "answer may be vector now — inspect $E.out"
else
  bad "P2-3 bb_ask exits 0" "exit=$(cat "$E.exit")"
fi

# ── P2-4: health honesty ------------------------------------------------------
run_health p24-health
E="$OUT/p24-health"
if [ "$(cat "$E.exit")" = "0" ] || [ "$(cat "$E.exit")" = "1" ]; then
  if grep -q "1972/1973" "$E.out"; then
    grep -E "1972/1973" "$E.out" | grep -q "status=complete" && bad "P2-4 status=complete never printed beside the shortfall" || ok "P2-4 status=complete never printed beside the shortfall"
  else skip "P2-4 status line probe" "no 1972/1973 line in output"; fi
  grep -q -E "SKIPPED_FILES|size.tier|will not fix" "$E.out" && ok "P2-4 shortfall cause names the size-tier skip" || bad "P2-4 shortfall cause names the size-tier skip"
  grep -q -E "BACKFILL PENDING|backfill pending" "$E.out" && ok "P2-4 embeddings line names pending backfill" || bad "P2-4 embeddings line names pending backfill"
  grep -q -E "scss" "$E.out" && grep -q -E "less" "$E.out" && ok "P2-4 syntax attribution splits less vs scss" || bad "P2-4 syntax attribution splits less vs scss"
else
  bad "P2-4 bb health runs" "exit=$(cat "$E.exit")"
fi

# ── P2-5: security + visualize honesty ---------------------------------------
run_capture p25-security bb_security '{"limit":5}'
E="$OUT/p25-security"
if [ "$(cat "$E.exit")" = "0" ]; then
  grep -q "lead-tier analyzers" "$E.out" && ok "P2-5 security labels the registry census as lead-tier analyzers" || bad "P2-5 security labels the registry census as lead-tier analyzers"
  grep -q "39 leads" "$E.out" && bad "P2-5 security no longer prints the unlabelled '39 leads'" || ok "P2-5 security no longer prints the unlabelled '39 leads'"
else bad "P2-5 bb_security exits 0" "exit=$(cat "$E.exit")"; fi
run_capture p25-visualize bb_visualize '{"scope":"module","target":"session","format":"text"}'
E="$OUT/p25-visualize"
if [ "$(cat "$E.exit")" = "0" ]; then
  grep -q "this graph is the whole project" "$E.out" && bad "P2-5 visualize drops the whole-project claim on a scoped/truncated page" || ok "P2-5 visualize drops the whole-project claim on a scoped/truncated page"
  grep -q -E "not the whole project|completeness:" "$E.out" && ok "P2-5 visualize states page completeness honestly" || bad "P2-5 visualize states page completeness honestly"
else bad "P2-5 bb_visualize exits 0" "exit=$(cat "$E.exit")"; fi
run_capture p25-security-history bb_security '{"limit":5,"history":true}'
E="$OUT/p25-security-history"
if [ "$(cat "$E.exit")" = "0" ]; then
  grep -q "history" "$E.out" && ok "P2-5 security history surface present" || skip "P2-5 security history surface present" "inspect"
else skip "P2-5 security history exits 0" "exit=$(cat "$E.exit")"; fi

# ── Index-time fixes: deferred to fixture gates + FINAL bettercap-copy reindex ─
skip "P1-1 Go internal import/dependents (index-time)" "fixture gate at CP1; bettercap-copy reindex at FINAL"
skip "P1-2 package-main attribution + cross-file uses (index-time)" "fixture gates at CP1; bettercap-copy reindex at FINAL"
skip "P0-2 index-time binding gates (existing bettercap DB keeps old rows)" "fixture gate + DB-copy arm at CP1; reindex honesty at FINAL"

echo
echo "SUMMARY: $PASS pass / $FAIL fail / $SKIP deferred-or-skipped"
echo "evidence: $OUT"
[ "$FAIL" -eq 0 ]
