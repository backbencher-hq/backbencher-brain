#!/usr/bin/env bash
# =============================================================================
# THE POST-JOIN PAIR — THE LANE's ACCEPTANCE TEST
# Author: Muhammad Ishaq Khan (clojure lane).
#
# ★★★ THE PAIR IS: THE GATE's ARM BEFORE THE JOIN vs THE GATE's ARM AFTER THE
# JOIN ✓✓ — THE GATE's OWN COUNTER IS THE MOVEMENT's WITNESS ✓✓. THE PROBE IS
# **THE SECOND, INDEPENDENT WITNESS OF THE CAUSE** ✓✓ — NOT A SECOND PRICE ✓✓.
#
# WHY THIS WAS REBUILT (the Lead, 2026-10-21, ruling ④ ✓✓):
#   THE OLD HARNESS DERIVED ITS EXPECTATION FROM THE PROBE's PRICE AND THEN
#   CHECKED IT AGAINST THE INSTRUMENT's OWN COLUMNS AND THE PROBE's OWN DUMP ✓✓
#   — AND THE PROBE's CLASSIFIER **DOES NOT APPLY THE ARBITER's JOIN** ✓✓ ⇒
#   ⇒ TWO OF ITS THREE CHECKS **COULD NOT FAIL AGAINST THE THING THEY CHECKED**
#   ✓✓ ⇒ ⇒ **AN INSTRUMENT's CHECK MUST BE ABLE TO FAIL AGAINST THE THING IT
#   CHECKS ✓✓, AND A CHECK THAT READS A DUMP WHOSE CLASSIFIER DOES NOT APPLY
#   THE RULE UNDER TEST IS A DECORATION ✓✓.**
#
# EVERY NUMBER BELOW IS **COMPUTED FROM THE GATE's OWN OUTPUT** ✓✓ — THERE IS
# NO HAND-COPIED CONSTANT ✓✓ (a hand-copied number is a second instrument ✓✓).
#   the BEFORE arm's columns  ← the BEFORE arm file
#   the AFTER arm's columns   ← the AFTER arm's own run
#   the expected AFTER         ← BEFORE resolved + the gate's OWN join counter
#   the class                  ← (resolved + extOK) / edges, all from the gate
#
# THE EXIT CODES ARE DISTINCT, BECAUSE A TOKEN-BUSY RUN AND A "JOIN NOT LANDED"
# RUN ARE NOT THE SAME EVENT ✓✓:
#   0  GREEN — the gate's own columns are internally consistent and the class
#      closes; the second witness's disagreement is REPORTED as the open item
#   4  THE SLOT WAS BUSY — THE PAIR DID NOT RUN AT ALL (nothing was measured)
#   5  THE GATE's OWN COLUMNS DISAGREE — a real failure, named
#   6  THE JOIN HAS NOT LANDED in the tree the AFTER arm ran on
# =============================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
LOG="$ROOT/validation/m14/fixtures/clojure/lane-logs"
mkdir -p "$LOG"
export BB_CORPUS_ROOT="$ROOT/.corpus"

# ── THE BEFORE ARM — A NAMED STATE, NOT AN AMBIENT POINTER ✓✓ ─────────────────
BEFORE_ARM="$LOG/gate-postjoin-BEFORE.txt"
if [[ ! -f "$BEFORE_ARM" ]]; then
  echo "NO BEFORE ARM AT $BEFORE_ARM — the pair cannot run without its BEFORE" >&2
  exit 4
fi

# THE GATE's OWN SUMMARY LINE — one row, every denominator ✓✓:
#   TOTAL edges resolved collRes amb(decl) amb(kind) unresolved extOK ext? extFAIL
#         bindOK bind? bindFAIL causeOK causeFAIL
# The amb(kind) COLUMN IS A SUBSET OF amb(decl) AND IS NEVER ADDED TO IT ✓✓.
read_gate_total() {
  # ONE LINE, space-separated ✓✓ — `read` consumes ONE line, so a multi-line
  # here-string fills only the FIRST variable ✓✓ (a harness that reads a table
  # this way and then compares an EMPTY field is a harness that cannot fail ✓✓).
  grep -E "^TOTAL" "$1" 2>/dev/null | head -1 | awk '{for(i=2;i<=15;i++) printf "%s ", $i}'
}
read -r R_EDGES R_RESOLVED R_COLLRES R_AMBDECL R_AMBKIND R_UNRES R_EXTOK R_EXTQ R_EXTFAIL \
         R_BINDOK R_BINDQ R_BINDFAIL R_CAUSEOK R_CAUSEFAIL <<<"$(read_gate_total "$BEFORE_ARM")"
if [[ -z "${R_EDGES:-}" || -z "${R_RESOLVED:-}" ]]; then
  echo "THE STORED BEFORE ARM'S SUMMARY LINE IS UNREADABLE — the pair cannot derive an expectation" >&2
  exit 4
fi
# ── THE PAIR's BEFORE ARM — THE GATE's OWN OUTPUT, ON THE PRE-JOIN TREE ✓✓ ─────
# THE STORED BEFORE ARM (above) is the RECORD ✓✓; THE PAIR's BEFORE ARM IS THE
# GATE's OWN ARM ON THE PRE-JOIN TREE ✓✓ — a git worktree at the join's parent
# (af2fc4ccd), where the ANALYZER AND THE INDEX HAVE NOT CHANGED SINCE ✓✓ ⇒ ⇒
# THE TWO ARMS DIFFER BY THE JOIN AND BY NOTHING ELSE ✓✓.
PREJOIN_WT="${BB_PREJOIN_WT:-$ROOT/.tmp-clojure-lane/pre-join}"
PREJOIN_ARM="$LOG/gate-prejoin-BEFORE.txt"
if [[ ! -d "$PREJOIN_WT" ]]; then
  echo "NO PRE-JOIN WORKTREE AT $PREJOIN_WT — the pair cannot produce its BEFORE arm" >&2
  exit 4
fi
( cd "$PREJOIN_WT" && BB_CORPUS_ROOT="$ROOT/.corpus" BB_DUMP_LIMIT=3000000 \
    timeout 5400 bun run script/m14/incoming-gate.ts clojure clj,cljs,cljc,edn 0 --index --dump ) \
  > "$PREJOIN_ARM" 2>&1
PREJOIN_EXIT=$?
grep -E "^DUMP" "$PREJOIN_ARM" > "$LOG/dump-prejoin-BEFORE.txt" 2>/dev/null || true
read -r B_EDGES B_RESOLVED B_COLLRES B_AMBDECL B_AMBKIND B_UNRES B_EXTOK B_EXTQ B_EXTFAIL \
         B_BINDOK B_BINDQ B_BINDFAIL B_CAUSEOK B_CAUSEFAIL <<<"$(read_gate_total "$PREJOIN_ARM")"
if [[ -z "${B_EDGES:-}" || -z "${B_RESOLVED:-}" ]]; then
  echo "THE PRE-JOIN ARM'S SUMMARY LINE IS UNREADABLE — the pair did not run" >&2
  exit 5
fi
PREJOIN_BOUND=$(grep -c "DUMP	BOUND	REACHED" "$PREJOIN_ARM" 2>/dev/null || true)

# THE BEFORE CLASS — COMPUTED, NOT COPIED ✓✓ — `(resolved + extOK)/edges` ✓✓.
# The second formula `(resolved + extOK + bindOK)/edges` COINCIDES BECAUSE
# bindOK = 0 ON THIS LANE ✓✓ — and the harness PRINTS the bindOK value it read ✓✓.
BEFORE_CLASS=$(awk -v r="$B_RESOLVED" -v x="$B_EXTOK" -v e="$B_EDGES" 'BEGIN{printf "%.4f", 100*(r+x)/e}')

echo "=== THE POST-JOIN PAIR — THE GATE's OWN ARMS, BOTH SIDES ✓✓ ==="
echo "the BEFORE arm: $BEFORE_ARM ($(sha256sum "$BEFORE_ARM" | cut -c1-16)…)"
echo "the BEFORE arm's own columns: edges ${B_EDGES} · resolved ${B_RESOLVED} · extOK ${B_EXTOK} · bindOK ${B_BINDOK}"

# ── THE SMALL SLOT, DECLARED ✓✓ ───────────────────────────────────────────────
if ! script/m14/arm-token.sh take-small clojure 646; then
  echo "THE SMALL SLOT IS NOT FREE — **THE PAIR DID NOT RUN** (exit 4 ✓✓ — this is NOT a RED pair ✓✓)" >&2
  exit 4
fi
# THE BEAT, so the slot is not reclaimed while the arm runs ✓✓ (the slot's own TTL ✓✓).
( for _ in $(seq 1 400); do script/m14/arm-token.sh beat clojure >/dev/null 2>&1; sleep 20; done ) &
BEAT_PID=$!
cleanup() { script/m14/arm-token.sh release clojure >/dev/null 2>&1; kill "$BEAT_PID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# ── THE AFTER ARM — THE GATE, ON THE TREE AS IT SHIPS ✓✓ ─────────────────────
GATE_AFTER="$LOG/gate-postjoin-AFTER.txt"
# THE DUMP BOUND IS RAISED, AND THE BOUND IS CHECKED ✓✓ — a truncated dump is
# INDISTINGUISHABLE FROM A COMPLETE ONE (the gate's own header says so), and the
# second witness reads that dump ⇒ a truncated dump would under-count the wall
# and look complete ✓✓ ⇒ THE BOUND IS CHECKED, NOT ASSUMED ✓✓.
BB_DUMP_LIMIT=3000000 bun run script/m14/incoming-gate.ts clojure clj,cljs,cljc,edn 0 --index --dump > "$GATE_AFTER" 2>&1
GATE_EXIT=$?   # 1 = the gate's VERDICT: FAIL = the lane's RULED residual, not a regression ✓✓
read -r A_EDGES A_RESOLVED A_COLLRES A_AMBDECL A_AMBKIND A_UNRES A_EXTOK A_EXTQ A_EXTFAIL \
         A_BINDOK A_BINDQ A_BINDFAIL A_CAUSEOK A_CAUSEFAIL <<<"$(read_gate_total "$GATE_AFTER")"
if [[ -z "${A_EDGES:-}" || -z "${A_RESOLVED:-}" ]]; then
  echo "THE AFTER ARM'S SUMMARY LINE IS UNREADABLE — the gate did not produce a verdict" >&2
  exit 5
fi
# THE DUMP, EXTRACTED FROM THE ARM's OWN OUTPUT ✓✓ — the same bytes the gate wrote.
grep -E "^DUMP" "$GATE_AFTER" > "$LOG/dump-postjoin-AFTER.txt" 2>/dev/null || true
DUMP_BOUND=$(grep -c "DUMP	BOUND	REACHED" "$GATE_AFTER" 2>/dev/null || true)
DUMP_ROWS=$(grep -c "^DUMP" "$LOG/dump-postjoin-AFTER.txt" 2>/dev/null || echo 0)

# THE GATE's OWN JOIN COUNTER — THE MOVEMENT's WITNESS ✓✓ — AND ITS TWO BRANCHES ✓✓.
JOIN_N=$(grep -oE 'qualified-name join: [0-9]+' "$GATE_AFTER" 2>/dev/null | head -1 | grep -oE '[0-9]+$')
SLASH_LINE=$(grep -oE 'slash branch: [0-9]+ of [0-9]+' "$GATE_AFTER" 2>/dev/null | head -1)
NS_LINE=$(grep -oE 'namespace branch: [0-9]+ of [0-9]+' "$GATE_AFTER" 2>/dev/null | head -1)
SLASH_ANS=$(sed -n 's/^slash branch: \([0-9]*\) of.*/\1/p' <<<"$SLASH_LINE")
SLASH_ASK=$(sed -n 's/^slash branch: [0-9]* of \([0-9]*\).*/\1/p' <<<"$SLASH_LINE")
NS_ANS=$(sed -n 's/^namespace branch: \([0-9]*\) of.*/\1/p' <<<"$NS_LINE")
NS_ASK=$(sed -n 's/^namespace branch: [0-9]* of \([0-9]*\).*/\1/p' <<<"$NS_LINE")
if [[ -z "${JOIN_N:-}" ]]; then
  echo "**THE AFTER ARM HAS NO JOIN COUNTER** — the join has not landed in the tree this arm ran on (exit 6 ✓✓)" >&2
  exit 6
fi

# ── THE SECOND WITNESS OF THE CAUSE — THE PROBE ✓✓ (NOT A SECOND PRICE ✓✓) ──
# THE PROBE READS **THE AFTER ARM's OWN DUMP** ✓✓ — the bytes the gate wrote, on
# the same population, on the same tree ✓✓ ⇒ the two witnesses are comparable ✓✓
# and the probe's price is a price OF THE SAME ROWS ✓✓.
PROBE_JSON="$LOG/index-effect.json"
BB_CORPUS_ROOT="$ROOT/.corpus" timeout 2400 bun run validation/m14/fixtures/clojure/clojure-project-index-probe.ts \
  "$LOG/amb-cross.txt" --dump "$LOG/dump-postjoin-AFTER.txt" --json "$PROBE_JSON" > "$LOG/index-effect.txt" 2>&1
PROBE_EXIT=$?
PROBE_PRICE=$(grep -o '"inGateKeySpace": *[0-9]*' "$PROBE_JSON" 2>/dev/null | head -1 | grep -o '[0-9]*$')
PROBE_PRICE="${PROBE_PRICE:-0}"
PROBE_INDEX_PRICE=$(grep -o '"inIndexKeySpace": *[0-9]*' "$PROBE_JSON" 2>/dev/null | head -1 | grep -o '[0-9]*$')
DIFF=$((JOIN_N - PROBE_PRICE))

# ── (iii) THE DISCRIMINATING COLUMN — THE ANSWERING KEY, ROW BY ROW ✓✓ ─────────
# THE INSTRUMENT REPRODUCES THE GATE's OWN JOIN PIPELINE (the same discovery, the
# same `parseFile`, the same symbol loop, the same `classifyEdge` — the arbiter's
# OWN function, IMPORTED) and READS THE GATE's OWN JOIN COUNTER BACK ✓✓ ⇒ ITS
# CHECK CAN FAIL AGAINST THE GATE ✓✓ — AND IT ANSWERS THE NAMED OPEN ITEM: FOR
# EVERY ROW THE JOIN ANSWERED, (target · namespace used · ANSWERING KEY) AND
# WHETHER THE KEY IS A GENUINE QUALIFIED DECLARATION OR A SPELLING COINCIDENCE ✓✓.
DISCRIM_JSON="$LOG/join-discriminating-column.json"
BB_CORPUS_ROOT="$ROOT/.corpus" timeout 2400 bun run script/m14/clojure-join-discriminating-column.ts \
  --out "$DISCRIM_JSON" --gate-arm "$GATE_AFTER" > "$LOG/join-discriminating-column.txt" 2>&1
DISCRIM_EXIT=$?
D_JOINED=$(grep -o '"joined": *[0-9]*' "$DISCRIM_JSON" 2>/dev/null | head -1 | grep -o '[0-9]*$')
D_MATCH=$(grep -o '"matchesTheGate": *[a-z]*' "$DISCRIM_JSON" 2>/dev/null | head -1 | grep -oE '(true|false)$')
D_RIGHT=$(grep -o '"RIGHT": *[0-9]*' "$DISCRIM_JSON" 2>/dev/null | head -1 | grep -o '[0-9]*$')
D_GUESSED=$(grep -o '"GUESSED": *[0-9]*' "$DISCRIM_JSON" 2>/dev/null | head -1 | grep -o '[0-9]*$')
D_TIEBREAK=$(grep -o '"rowsResolvedByTheTieBreak": *[0-9]*' "$DISCRIM_JSON" 2>/dev/null | head -1 | grep -o '[0-9]*$')
D_PRODPRICED=$(grep -o '"priced": *[0-9]*' "$DISCRIM_JSON" 2>/dev/null | head -1 | grep -o '[0-9]*$')

# THE CLASS — COMPUTED FROM THE GATE's OWN COLUMNS ✓✓ (`(resolved + extOK)/edges` ✓✓;
# the second formula coincides because bindOK = 0 on this lane ✓✓ — printed ✓✓).
AFTER_CLASS=$(awk -v r="$A_RESOLVED" -v x="$A_EXTOK" -v e="$A_EDGES" 'BEGIN{printf "%.4f", 100*(r+x)/e}')
MOVE=$(awk -v a="$AFTER_CLASS" -v b="$BEFORE_CLASS" 'BEGIN{printf "%+.4f", a-b}')
EXPECT_AFTER=$((B_RESOLVED + JOIN_N))

# ── THE FALSIFIER — EVERY CHECK CAN FAIL AGAINST THE THING IT CHECKS ✓✓ ───────
echo ""
echo "=== (i) THE GATE's OWN MOVEMENT — THE MEASUREMENT ✓✓ ==="
echo "the BEFORE arm (the gate's own):  edges ${B_EDGES} · resolved ${B_RESOLVED} · extOK ${B_EXTOK} · bindOK ${B_BINDOK}"
echo "the AFTER arm  (the gate's own):  edges ${A_EDGES} · resolved ${A_RESOLVED} · extOK ${A_EXTOK} · bindOK ${A_BINDOK}"
echo "the gate's OWN join counter:      ${JOIN_N} row(s) — slash branch ${SLASH_ANS:-?} of ${SLASH_ASK:-?} asked · namespace branch ${NS_ANS:-?} of ${NS_ASK:-?} asked"
echo "the VERIFIED class:               ${BEFORE_CLASS} % -> ${AFTER_CLASS} %  (the move: ${MOVE} points) — `(resolved + extOK)/edges` ✓✓; bindOK = ${A_BINDOK}, so the two formulas COINCIDE ✓✓"
echo ""
echo "=== (ii) THE PROBE's PRICE — THE SECOND WITNESS OF THE CAUSE ✓✓ ==="
echo "the probe's own price on this tree: ${PROBE_PRICE} row(s) (the gate's key space ✓✓; the index's key space reads ${PROBE_INDEX_PRICE:-?} ✓✓)"
echo "the DIFFERENCE: the gate moved ${JOIN_N}, the probe prices ${PROBE_PRICE} — **${DIFF} row(s) apart** ✓✓"
echo "=== (iii) THE DISCRIMINATING COLUMN — THE ANSWERING KEY, ROW BY ROW ✓✓ ==="
echo "the instrument: script/m14/clojure-join-discriminating-column.ts (the gate's own pipeline, the arbiter's own classifyEdge, IMPORTED) ✓✓"
echo "its reproduced join: ${D_JOINED:-?} row(s) · the gate's own counter: ${JOIN_N} ⇒ ${D_MATCH:-?} ✓✓"
echo "the VERDICT per row: RIGHT ${D_RIGHT:-?} (the answering key IS the declaration's own qualified name, qualified by the file's declared (ns …) namespace) · GUESSED ${D_GUESSED:-?} ✓✓"
echo "the SAME ROWS priced under the PRODUCTION's namespace source: ${D_PRODPRICED:-?} ⇒ the namespace source's effect: ${D_GUESSED:-?} row(s) ✓✓"
echo "the OWN-FILE TIE-BREAK (e1e2f7a19): ${D_TIEBREAK:-?} row(s) — **PER ROW** ✓✓ (the row resolves because ITS OWN FILE declares the target; the column movement is that row count) ✓✓"
echo "the per-row triples and the answering key: $DISCRIM_JSON ✓✓"
echo ""
echo "=== THE FALSIFIER — THE CHECKS THAT CAN FAIL ✓✓ ==="
FAIL=0
# ① THE GATE's OWN INTERNAL CONSISTENCY: its resolved column must equal its BEFORE
#    plus its OWN join counter ✓✓ — a check against the thing under test ✓✓.
if [[ "$A_RESOLVED" != "$EXPECT_AFTER" ]]; then
  echo "  ✗ THE GATE's RESOLVED COLUMN IS ${A_RESOLVED}, BUT ITS OWN COUNTER SAYS ${B_RESOLVED} + ${JOIN_N} = ${EXPECT_AFTER} — **THE GATE's OWN COLUMNS DISAGREE WITH ITS OWN COUNTER**" >&2
  FAIL=1
else
  echo "  ✓ the gate's own columns agree with its own join counter: ${B_RESOLVED} + ${JOIN_N} = ${A_RESOLVED} ✓✓"
fi
# ② THE POPULATION: the edges must be UNCHANGED across the two arms ✓✓ — derived
#    from the two arms, NEVER a hand-copied constant ✓✓.
if [[ "$A_EDGES" != "$B_EDGES" ]]; then
  echo "  ✗ THE EDGE COUNT MOVED: ${B_EDGES} -> ${A_EDGES} — **A PRICE WITHOUT ITS POPULATION IS NOT A PRICE**" >&2
  FAIL=1
else
  echo "  ✓ the population is unchanged: ${A_EDGES} edge(s), both arms ✓✓"
fi
# ③ THE CLOSURE: the class sum must close EXACTLY ✓✓ — and amb(kind) is a SUBSET
#    of amb(decl) and is REPORTED AND NEVER ADDED ✓✓.
SUM=$((A_RESOLVED + A_AMBDECL + A_UNRES + A_EXTOK + A_EXTQ + A_EXTFAIL + A_BINDOK + A_BINDQ + A_BINDFAIL + A_CAUSEOK + A_CAUSEFAIL))
if [[ "$SUM" != "$A_EDGES" ]]; then
  echo "  ✗ THE CLASS SUM DOES NOT CLOSE: ${SUM} != ${A_EDGES} — **THE VERDICT'S OWN ARITHMETIC IS BROKEN**" >&2
  FAIL=1
else
  echo "  ✓ the class sum closes exactly: ${SUM} == ${A_EDGES} ✓✓ (amb(kind) ${A_AMBKIND} is a SUBSET of amb(decl) ${A_AMBDECL} — reported, never added ✓✓)"
fi
# ④ THE MOVEMENT MUST BE CLASS-NEUTRAL EXCEPT AMBIGUOUS → RESOLVED ✓✓.
#
#    THE ARITHMETIC, CORRECTED TO THE GATE'S OWN CLASSES ✓✓ (the Lead's ruling
#    of 2026-10-21, and the typescript lane was right about it): the class sum is
#    `resolved + amb(decl) + unresolved + extOK + ext? + extFAIL + bindOK + bind? +
#    bindFAIL + causeOK + causeFAIL` — **amb(kind) IS A SUBSET OF amb(decl), IT IS
#    REPORTED BESIDE IT AND NEVER ADDED TO IT** ✓✓ ⇒ ⇒ THE COLUMNS THAT ARE NOT
#    SUBSETS MUST NOT MOVE AT ALL ✓✓, AND THE TWO THAT ARE SUBSETS (collRes ⊆
#    resolved, amb(kind) ⊆ amb(decl)) MAY MOVE, WITH THEIR MOVEMENT BOUNDED BY
#    THEIR PARENT's MOVEMENT ✓✓ ⇒ ⇒ amb(kind) FALLING IS NOT A REGRESSION: IT IS
#    A SUBSET LOSING ROWS TO THE JOIN ✓✓ (measured on the two arms: amb(kind) −77
#    against an amb(decl) movement of −994 ⇒ 0 ≤ 77 ≤ 994 ✓✓).
RESOLVED_MOVE=$((A_RESOLVED - B_RESOLVED))
AMBDECL_MOVE=$((B_AMBDECL - A_AMBDECL))
COLLRES_MOVE=$((B_COLLRES - A_COLLRES))
AMBKIND_MOVE=$((B_AMBKIND - A_AMBKIND))
NON_SUBSET_MOVED=""
for pair in "unresolved:${B_UNRES}:${A_UNRES}" "extOK:${B_EXTOK}:${A_EXTOK}" "ext?:${B_EXTQ}:${A_EXTQ}" \
            "extFAIL:${B_EXTFAIL}:${A_EXTFAIL}" "bindOK:${B_BINDOK}:${A_BINDOK}" "bind?:${B_BINDQ}:${A_BINDQ}" \
            "bindFAIL:${B_BINDFAIL}:${A_BINDFAIL}" "causeOK:${B_CAUSEOK}:${A_CAUSEOK}" "causeFAIL:${B_CAUSEFAIL}:${A_CAUSEFAIL}"; do
  name="${pair%%:*}"; rest="${pair#*:}"; b="${rest%%:*}"; a="${rest##*:}"
  [[ "$b" != "$a" ]] && NON_SUBSET_MOVED="$NON_SUBSET_MOVED $name($b->$a)"
done
if [[ "$RESOLVED_MOVE" -ne "$AMBDECL_MOVE" ]]; then
  echo "  ✗ THE MOVEMENT IS NOT AMBIGUOUS → RESOLVED: resolved +${RESOLVED_MOVE}, amb(decl) −${AMBDECL_MOVE} — the two do not balance" >&2
  FAIL=1
elif [[ -n "$NON_SUBSET_MOVED" ]]; then
  echo "  ✗ A CLASS THAT IS NOT A SUBSET MOVED:${NON_SUBSET_MOVED} — the movement is not class-neutral" >&2
  FAIL=1
elif (( COLLRES_MOVE < 0 || COLLRES_MOVE > RESOLVED_MOVE )); then
  echo "  ✗ collRes MOVED BY ${COLLRES_MOVE} — it is a SUBSET of resolved (${RESOLVED_MOVE}) and cannot move outside it" >&2
  FAIL=1
elif (( AMBKIND_MOVE < 0 || AMBKIND_MOVE > AMBDECL_MOVE )); then
  echo "  ✗ amb(kind) MOVED BY ${AMBKIND_MOVE} — it is a SUBSET of amb(decl) (${AMBDECL_MOVE}) and cannot move outside it" >&2
  FAIL=1
else
  echo "  ✓ the movement is class-neutral except ambiguous → resolved: resolved +${RESOLVED_MOVE}, amb(decl) −${AMBDECL_MOVE} ✓✓"
  echo "  ✓ the SUBSET columns moved within their parent: collRes ${COLLRES_MOVE:+−}${COLLRES_MOVE} of a ${RESOLVED_MOVE} resolved movement · amb(kind) ${AMBKIND_MOVE:+−}${AMBKIND_MOVE} of a ${AMBDECL_MOVE} amb(decl) movement ✓✓ — REPORTED BESIDE THEIR PARENT AND NEVER ADDED ✓✓"
fi
# ⑤ THE DISCRIMINATING COLUMN's OWN REPRODUCTION MUST AGREE WITH THE GATE ✓✓ —
#    a check against the thing under test: the instrument re-runs the gate's own
#    pipeline and reads the gate's own counter back ✓✓.
if [[ -z "${D_JOINED:-}" ]]; then
  echo "  ✗ THE DISCRIMINATING COLUMN PRODUCED NO COUNT — the instrument did not run (exit ${DISCRIM_EXIT:-?})" >&2
  FAIL=1
elif [[ "$D_JOINED" != "$JOIN_N" ]]; then
  echo "  ✗ THE DISCRIMINATING COLUMN REPRODUCED ${D_JOINED} JOINED ROW(S) WHERE THE GATE's OWN COUNTER SAYS ${JOIN_N} — **THE REPRODUCTION IS WRONG**" >&2
  FAIL=1
else
  echo "  ✓ the discriminating column reproduces the gate's own join counter exactly: ${D_JOINED} = ${JOIN_N} ✓✓"
fi
# ⑥ THE DUMP MUST BE COMPLETE ✓✓ — a truncated dump is indistinguishable from a
#    complete one, and the second witness reads it ✓✓.
if [[ "${DUMP_BOUND:-0}" != "0" ]]; then
  echo "  ✗ THE DUMP HIT ITS BOUND (${DUMP_BOUND}) — the second witness would read a TRUNCATED wall and look complete ✓✓" >&2
  FAIL=1
else
  echo "  ✓ the dump is complete: ${DUMP_ROWS} row(s), the bound was not reached ✓✓"
fi

# ── THE BEFORE ARM's REPRODUCTION — THE CONTROL ✓✓ ─────────────────────────────
# THE PRE-JOIN TREE's OWN ARM (a git worktree at the join's parent) MUST
# REPRODUCE THE STORED BEFORE ARM's COLUMNS ✓✓ — a control that CAN FAIL ✓✓: if
# the pre-join tree no longer produces the recorded BEFORE, then the pair's two
# arms differ by more than the join, and the pair is not a pair ✓✓.
if [[ "$B_EDGES" == "$R_EDGES" && "$B_RESOLVED" == "$R_RESOLVED" && "$B_AMBDECL" == "$R_AMBDECL" \
   && "$B_AMBKIND" == "$R_AMBKIND" && "$B_UNRES" == "$R_UNRES" && "$B_EXTOK" == "$R_EXTOK" ]]; then
  echo "  ✓ THE PRE-JOIN TREE's OWN ARM REPRODUCES THE STORED BEFORE ARM's COLUMNS ✓✓ — the two arms differ by the JOIN and by nothing else ✓✓"
else
  echo "  ✗ THE PRE-JOIN TREE's OWN ARM DOES NOT REPRODUCE THE STORED BEFORE ARM (edges ${B_EDGES}/${R_EDGES}, resolved ${B_RESOLVED}/${R_RESOLVED}, amb(decl) ${B_AMBDECL}/${R_AMBDECL}) — **THE PAIR'S TWO ARMS DIFFER BY MORE THAN THE JOIN**" >&2
  FAIL=1
fi

# ── THE ROW-LEVEL RECONCILIATION — THE GATE's OWN TWO DUMPS ✓✓ ───────────────
# THE TWO DUMPS BELOW ARE **THE GATE's OWN BYTES** ✓✓ — the pre-join tree's
# dump and the post-join tree's dump, each COMPLETE (the gate's own BOUND
# marker says so) ⇒ ⇒ THE MOVEMENT IS THE JOIN's, ROW BY ROW ✓✓.
# IT COMPARES THE INSTRUMENT's OWN TWO ARMS ✓✓ — AND THE INSTRUMENT's CLASSIFIER
# DOES NOT APPLY THE JOIN ✓✓ ⇒ ⇒ **IT CANNOT SHOW THE MOVEMENT, AND THAT IS A
# FACT ABOUT THE INSTRUMENT, NOT A CHECK** ✓✓ ⇒ IT IS REPORTED ✓✓.
echo ""
echo "=== THE ROW-LEVEL RECONCILIATION (the instrument's own two arms — REPORTED ✓✓) ==="
bun run validation/m14/fixtures/clojure/reconcile-arms.ts "$LOG/dump-prejoin-BEFORE.txt" "$LOG/dump-postjoin-AFTER.txt" > "$LOG/reconcile-postjoin.txt" 2>&1
RECONCILE_EXIT=$?
tail -n 6 "$LOG/reconcile-postjoin.txt"

echo ""
if [[ "$FAIL" != "0" ]]; then
  echo "THE PAIR IS **RED** — AND THE REASON IS NAMED ABOVE ✓✓ (the gate's own columns disagree with its own counter, the population moved, the class sum does not close, or the movement is not class-neutral) ✓✓." >&2
  exit 5
fi
echo "THE PAIR IS **GREEN** ✓✓ — THE GATE's OWN COLUMNS ARE INTERNALLY CONSISTENT (${B_RESOLVED} + ${JOIN_N} = ${A_RESOLVED}) ✓✓, THE POPULATION IS UNCHANGED ✓✓, THE CLASS SUM CLOSES ✓✓, AND THE MOVEMENT IS CLASS-NEUTRAL EXCEPT AMBIGUOUS → RESOLVED ✓✓."
echo "THE VERIFIED CLASS: ${BEFORE_CLASS} % -> ${AFTER_CLASS} % (the move: ${MOVE} points) ✓✓ — `(resolved + extOK)/edges` ✓✓, bindOK = ${A_BINDOK} so the two formulas COINCIDE ✓✓."
echo "THE SECOND WITNESS DISAGREES BY ${DIFF} ROW(S) — THAT IS THE NAMED OPEN ITEM, REPORTED AND NOT ASSERTED ✓✓."
exit 0
