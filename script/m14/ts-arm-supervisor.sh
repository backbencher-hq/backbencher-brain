#!/usr/bin/env bash
# TS ARM SUPERVISOR — the typescript lane's whole-population arm, and the `--both` plan.
#
# WHAT THIS IS. One plan, TWO VIEWS OF ONE POPULATION, and the two views are compared.
#
#   VIEW 1 (the shipping view)  `incoming-gate.ts typescript ts,tsx,mts,cts 0 --index`
#        — the population PRODUCTION actually parses, served from the repo index.
#   VIEW 2 (the fresh-parse view) the same command WITHOUT `--index`
#        — every admitted file parsed again from its bytes.
#
# ⇒⇒⇒ WHY TWO VIEWS AND NOT ONE. The dart lane measured a defect in the fleet's own index cache:
# it was keyed on a file COUNT and a max mtime, and TWO CHUNKS OF THE SAME REPOSITORY HAVE THE
# SAME COUNT AND OFTEN THE SAME NEWEST MTIME — so chunk 5 of a repository could be served chunk 3's
# index, and a population arm would have measured a MIXTURE OF SLICES while every chunk reported
# itself as indexed. ⇒⇒⇒ **A COUNT IS NOT AN IDENTITY.** ⇒⇒⇒ ⇒⇒⇒ The fix is a digest of the FILE
# SET carried in the file's name; and the DETECTOR is a second view of the same population: if the
# index-served view and the fresh-parse view DISAGREE, the cache served the wrong slice. ⇒⇒⇒ ⇒⇒⇒
# **THE SHIPPING GATE AND THE TWIN ARE TWO VIEWS OF ONE POPULATION, AND TWO VIEWS OF ONE POPULATION
# ARE WHAT A CLOSURE IS MADE OF.**
#
# ⇒⇒⇒ AND A FAILING VERDICT IS A COMPLETED ARM. The gate exits 1 when the VERDICT is FAIL, and a
# failing verdict is the EXPECTED state for this lane (the residual is large; clause 1 cannot pass
# over a whole corpus). ⇒⇒⇒ **THE SUPERVISOR RESTARTS ON THE ONE CONDITION THAT MEANS THE RUN DID
# NOT FINISH — the arm log gained no `VERDICT:` line — AND NOT ON A NON-ZERO EXIT.**
#
# THE HEARTBEAT IS NOT THIS SCRIPT'S JOB. The token's beat daemon is a separate harness background
# job (`arm-token.sh loop typescript`), because a daemon's START is not a daemon's RUNNING, and a
# detached child of a finishing shell is not a daemon at all.
#
# USAGE:   bash script/m14/ts-arm-supervisor.sh      (run this AS A BACKGROUND JOB)
# ARTIFACTS (all under .tmp-ts/, gitignored, never cited in a page):
#   armC-head.log        VIEW 1 — the gate over the index-served population
#   armD-freshparse.log  VIEW 2 — the gate over the same population, parsed fresh
#   arm-driver.log       every run's start, exit, and every restart
set -u

ROOT="$HOME/mcp/backbencher-brain"
LOG1="$ROOT/.tmp-ts/armC-head.log"
LOG2="$ROOT/.tmp-ts/armD-freshparse.log"
DRV="$ROOT/.tmp-ts/arm-driver.log"
LANE="typescript"
LANG="typescript"
EXT="ts,tsx,mts,cts"

mkdir -p "$ROOT/.tmp-ts"
: > "$LOG1"
: > "$LOG2"
: > "$DRV"

run_gate() {
  # $1 = log file, $2... = gate flags
  local log="$1"; shift
  (
    cd "$ROOT" || exit 9
    BB_CORPUS_ROOT="$ROOT/.corpus" bun run script/m14/incoming-gate.ts "$LANG" "$EXT" 0 "$@"
  ) >> "$log" 2>&1
}

# ONE RUN, AND THE COMPLETION TEST: did THIS run add a VERDICT line? A gate that ran to the end
# always prints one; a gate that died mid-run does not, and THAT is what a restart is for.
run_once() {
  local label="$1"; local log="$2"; shift 2
  local n=0
  while :; do
    n=$((n + 1))
    local before; before=$(wc -c < "$log")
    echo "=== $label RUN $n START $(date -Is) flags: $* ===" >> "$DRV"
    run_gate "$log" "$@"
    local rc=$?
    echo "=== $label RUN $n EXIT rc=$rc $(date -Is) ===" >> "$DRV"
    if tail -c +$((before + 1)) "$log" | grep -q '^VERDICT: '; then
      echo "=== $label COMPLETE after run $n (rc=$rc — a FAILING VERDICT IS A COMPLETED ARM) $(date -Is) ===" >> "$DRV"
      return 0
    fi
    echo "=== $label RUN $n DID NOT COMPLETE (no VERDICT line) — RESTARTING $(date -Is) ===" >> "$DRV"
    sleep 3
  done
}

run_once "VIEW1-INDEX" "$LOG1" --index
run_once "VIEW2-FRESHPARSE" "$LOG2"

echo "=== BOTH VIEWS DONE — comparing $(date -Is) ===" >> "$DRV"
(
  cd "$ROOT" || exit 9
  bun run script/m14/ts-arm-compare.ts "$LOG1" --against "$LOG2"
) > "$ROOT/.tmp-ts/arm-compare-both.txt" 2>&1
echo "=== COMPARISON EXIT $? $(date -Is) ===" >> "$DRV"
echo "=== SUPERVISOR DONE $(date -Is) ===" >> "$DRV"
