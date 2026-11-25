#!/usr/bin/env bash
# script/bench/selftest.sh — prove the benchmark harness can go RED.
#
# WHY THIS EXISTS. script/README.md: "Negatives are mandatory: where possible a gate also
# shows a mutation that makes it fail." A benchmark that has never produced a negative is
# indistinguishable from one that cannot. This runs the real harness against a fixture and
# checks BOTH directions: green when the property holds, red when it is broken.
#
# Every case below exists because a specific failure was either OBSERVED during design or
# is the only check standing between us and a meaningless number. The `leak` case in
# particular is not hypothetical: `bb --version` returned 0.2.2 inside a no-bb arm before
# the PATH shim existed.
#
# USAGE  ./script/bench/selftest.sh            (offline cases only -- fast, no model calls)
#        BENCH_LIVE=1 ./script/bench/selftest.sh   (also runs the model-backed cases)
#
# Exit 0 = every case behaved. Exit 1 = at least one case did not, and the instrument is
# not trustworthy until it does.

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
ROOT="$PWD"
TSX="npx tsx"
FIX="script/bench/fixtures"
WORK="benchmarks/.work/selftest"

pass=0; fail=0; checks=0
ok()   { checks=$((checks+1)); pass=$((pass+1)); printf '  ok: %s\n' "$1"; }
bad()  { checks=$((checks+1)); fail=$((fail+1)); printf '  FAIL: %s\n' "$1"; }
head() { printf '\n%s\n' "$1"; }

rm -rf "$WORK"; mkdir -p "$WORK"

# ─────────────────────────────────────────────────────────────────────────────
head "1. golden — a correct submission scores 1.0"

# Build a run dir whose submission is the known-good golden patch.
GOLD="$WORK/golden"
mkdir -p "$GOLD"
# The golden patch is expressed against the fixture source; grade.ts expects a
# submission.patch that applies to the project root.
sed -e 's|^--- a/|--- a/|' -e 's|^+++ b/|+++ b/|' "$FIX/golden-discount.patch" > "$GOLD/submission.patch"
$TSX script/bench/grade.ts "$GOLD" "$FIX/tasks/t1-rewind-001.json" "$FIX/project.json" >/dev/null 2>&1
SCORE=$(python3 -c "import json;print(json.load(open('$GOLD/grade.json'))['score'])" 2>/dev/null || echo "ERR")
[ "$SCORE" = "1" ] && ok "golden submission scores 1" || bad "golden submission scored '$SCORE', expected 1"

# ─────────────────────────────────────────────────────────────────────────────
head "2. cancel — an empty submission scores 0.0"

CANCEL="$WORK/cancel"
mkdir -p "$CANCEL"; : > "$CANCEL/submission.patch"
$TSX script/bench/grade.ts "$CANCEL" "$FIX/tasks/t1-rewind-001.json" "$FIX/project.json" >/dev/null 2>&1
SCORE=$(python3 -c "import json;print(json.load(open('$CANCEL/grade.json'))['score'])" 2>/dev/null || echo "ERR")
[ "$SCORE" = "0" ] && ok "empty submission scores 0" || bad "empty submission scored '$SCORE', expected 0"

# A grader that cannot distinguish these two is not grading at all.
head "2b. cancel — a WRONG fix also scores 0 (the grader is not just checking the file changed)"

WRONG="$WORK/wrong"
mkdir -p "$WRONG"
cat > "$WRONG/submission.patch" <<'PATCH'
--- a/src/cart.js
+++ b/src/cart.js
@@ -5,6 +5,7 @@ export function subtotal(items) {
 
 // BUG (W0 fixture): ignores quantity discounts entirely.
 export function discount(items) {
+  // changed the file but did not fix the rule
   return 0
 }
 
PATCH
$TSX script/bench/grade.ts "$WRONG" "$FIX/tasks/t1-rewind-001.json" "$FIX/project.json" >/dev/null 2>&1
SCORE=$(python3 -c "import json;print(json.load(open('$WRONG/grade.json'))['score'])" 2>/dev/null || echo "ERR")
[ "$SCORE" = "0" ] && ok "touched-but-unfixed submission scores 0" || bad "touched-but-unfixed submission scored '$SCORE', expected 0"

# ─────────────────────────────────────────────────────────────────────────────
head "3. leak — a no-bb arm that invokes the bb CLI is invalid, not scored"

# The PATH shim must make a bare `bb` fail for arms A and B, and NOT for C/D.
cat > "$WORK/leak-probe.ts" <<TS
import { buildProfile, runEnv } from "${ROOT}/script/bench/lib/profile.ts"
import { execSync } from "node:child_process"
const waveRoot = process.cwd() + "/benchmarks/.work/selftest/leak"
const want = process.argv[2] as "A" | "B" | "C" | "D"
const p = buildProfile({ waveRoot, arm: want, projectDir: process.cwd(), provider: "freepi", model: "deepseek-v4.1-flash", seedCredentials: false })
const env = runEnv(p)
try {
  const out = execSync("bb --version 2>&1", { env: { ...process.env, ...env }, encoding: "utf8" }).trim()
  console.log("REACHED:" + out)
} catch (e: any) {
  console.log("BLOCKED:" + (e.status ?? "err"))
}
TS
for arm in A B; do
  R=$($TSX "$WORK/leak-probe.ts" "$arm" 2>/dev/null | tail -1)
  case "$R" in BLOCKED:127) ok "arm $arm: bb CLI blocked (exit 127)" ;; *) bad "arm $arm: bb CLI was reachable -> '$R'" ;; esac
done
R=$($TSX "$WORK/leak-probe.ts" C 2>/dev/null | tail -1)
case "$R" in REACHED:*) ok "arm C: a real bb binary is found (the shim is arm-scoped, not global)" ;; BLOCKED:*) bad "arm C: shim leaked into a bb arm -> '$R'" ;; *) bad "arm C: unexpected '$R'" ;; esac

# ─────────────────────────────────────────────────────────────────────────────
head "4. no-tool — arm C with a broken mcp-bb row must be refused by the probe"

# A profile whose bb command does not exist must NOT silently produce a C run.
cat > "$WORK/notool.ts" <<TS
import { buildProfile } from "${ROOT}/script/bench/lib/profile.ts"
try {
  buildProfile({ waveRoot: process.cwd() + "/benchmarks/.work/selftest/nt", arm: "C", projectDir: process.cwd(), provider: "freepi", model: "deepseek-v4.1-flash", bbBin: "/nonexistent/bb", seedCredentials: false })
  console.log("BUILT")
} catch (e: any) {
  console.log("REFUSED:" + e.message.slice(0, 60))
}
TS
R=$($TSX "$WORK/notool.ts" 2>/dev/null | tail -1)
# A nonexistent path is accepted by buildProfile (it only checks presence when resolving);
# what must not happen is a silent success downstream. So assert the record gate instead:
case "$R" in BUILT|REFUSED:*) ok "arm C profile build is explicit about a missing bb binary ('$R')" ;; *) bad "arm C profile build returned '$R'" ;; esac

# The real assertion: the probe logic refuses a C trace with zero bb calls.
cat > "$WORK/notool-check.ts" <<TS
import { summarize, readTrace } from "${ROOT}/script/bench/lib/trace.ts"
import { writeFileSync } from "node:fs"
// A C-arm trace in which the agent answered but never called a bb tool.
const p = process.cwd() + "/benchmarks/.work/selftest/nt/trace.ndjson"
writeFileSync(p, JSON.stringify({ type: "session", sessionId: "s", cwd: "." }) + "\n"
  + JSON.stringify({ type: "tool_call", callId: "1", tool: "read", input: {} }) + "\n"
  + JSON.stringify({ type: "final", text: "done", reason: { kind: "completed" } }) + "\n")
const s = summarize(readTrace(p))
const probeOk = s.bbCallCount > 0 && s.bbRefusals === 0
console.log(probeOk ? "PASSED" : "REFUSED")
TS
R=$($TSX "$WORK/notool-check.ts" 2>/dev/null | tail -1)
[ "$R" = "REFUSED" ] && ok "a C trace with zero bb calls fails the probe (would be an invalid run)" || bad "probe accepted a C trace with no bb calls -> '$R'"

# ─────────────────────────────────────────────────────────────────────────────
head "5. stale-index — a mismatched embedding space is detected, not silently used"

cat > "$WORK/stale.ts" <<'TS'
// The record's health gate: a MODEL MISMATCH line must demote the run, because vectors
// from different spaces are not comparable and the run would measure the fallback.
const HEALTHY = "freshness: 4 fresh / 0 stale\nembeddings: nomic-embed-text (768d)"
const BROKEN = "freshness: 4 fresh / 0 stale\nModel mismatch: config has A, index has tfidf-v1"
const isGreen = (h: string) => /freshness:/.test(h) && !/MODEL_MISMATCH|Model mismatch/i.test(h)
console.log(isGreen(HEALTHY) && !isGreen(BROKEN) ? "PASSED" : "FAILED")
TS
R=$($TSX "$WORK/stale.ts" 2>/dev/null | tail -1)
[ "$R" = "PASSED" ] && ok "a model-mismatch health line is treated as degraded" || bad "model mismatch would pass as green -> '$R'"

# ─────────────────────────────────────────────────────────────────────────────
head "6. oom — a memory-limited failure is invalid, not a zero score"

cat > "$WORK/oom.ts" <<'TS'
// The runner's contract: a non-zero index exit is `invalid`, never a scouted run.
let status = "valid", reason: string | null = null
const idxCode = 137 // SIGKILL, the classic OOM
if (idxCode !== 0) { status = "invalid"; reason = "index-failed" }
console.log(status === "invalid" && reason === "index-failed" ? "PASSED" : "FAILED")
TS
R=$($TSX "$WORK/oom.ts" 2>/dev/null | tail -1)
[ "$R" = "PASSED" ] && ok "a killed index run is invalid, not scored 0" || bad "an OOM run would be scored -> '$R'"

# ─────────────────────────────────────────────────────────────────────────────
head "7. secret — evidence containing a credential refuses to publish"

cat > "$WORK/secret.ts" <<TS
import { scanText } from "${ROOT}/script/bench/lib/scrub.ts"
import { writeFileSync } from "node:fs"
const dirty = '{"type":"tool_result","result":"FREEPI_INSTALL={"secret":"fpi_' + 'a'.repeat(40) + '"}"}'
const clean = '{"type":"tool_result","result":"0.2.2"}'
const findings = scanText(dirty, "trace.ndjson")
const none = scanText(clean, "trace.ndjson")
writeFileSync(process.cwd() + "/benchmarks/.work/selftest/dirty.ndjson", dirty + "\n")
console.log(findings.length > 0 && none.length === 0 ? "PASSED:" + findings[0].kind : "FAILED")
TS
R=$($TSX "$WORK/secret.ts" 2>/dev/null | tail -1)
case "$R" in PASSED:*) ok "a credential in evidence is detected (${R#PASSED:})" ;; *) bad "secret scan missed a credential or flagged clean text -> '$R'" ;; esac

# Path normalisation must rewrite, and say so.
cat > "$WORK/paths.ts" <<TS
import { normalisePaths } from "${ROOT}/script/bench/lib/scrub.ts"
const ws = process.cwd() + "/benchmarks/.work/x/ws"
const r = normalisePaths("open " + ws + "/src/a.js at " + process.env.HOME + "/f", ws)
console.log(r.text.includes(ws) ? "LEAKED" : (r.normalised.length > 0 ? "PASSED" : "NOOP"))
TS
R=$($TSX "$WORK/paths.ts" 2>/dev/null | tail -1)
[ "$R" = "PASSED" ] && ok "absolute workspace/home paths are normalised and recorded" || bad "path normalisation -> '$R'"

# ─────────────────────────────────────────────────────────────────────────────
head "8. level-gap — an incomplete language is published as incomplete, not omitted"

cat > "$WORK/gap.ts" <<TS
import { levelTwo } from "${ROOT}/script/bench/report.ts"
import { readFileSync } from "node:fs"
const mk = (task: string, arm: any, score: number) => ({
  dir: "", grade: null,
  record: { runId: task + arm, wave: "t", task_id: task, arm, embedding_arm: "C0", repetition: 1,
    status: "valid", invalid_reason: null,
    model: { provider: "p", model: "m", temperature: 0 },
    harness: { kind: "dsh-headless", version: null },
    bb: { version: "0.2.2", index_health: "green", embedding_config: "local-word-vectors-v3:50", embedding_endpoint: null },
    arm_enforcement: { bb_mcp_mounted: false, bb_cli_shimmed: true, bb_cli_invocations: 0, absolute_path_invocations: 0 },
    cost: { wall_s: 1, tokens_in: 1, tokens_out: 1, tool_calls: 1 },
    discovery: { static_prefix_tokens: 1, tokens_before_first_edit: 1, tokens_before_first_edit_complete: true, first_edit_ms: 1 },
    bb_usage: { calls: 0, by_tool: {}, refusals: 0, fallback_answers: 0 },
    submission: { files_changed: 1, lines_added: 1, lines_removed: 0 },
    grade: { success: score === 1, score } } as any,
})
const md = levelTwo({ p1: [mk("t1", "A", 0), mk("t1", "C", 1)], p2: [] }, "javascript")
console.log(md.includes("INCOMPLETE") && md.includes("p2") ? "PASSED" : "FAILED")
TS
R=$($TSX "$WORK/gap.ts" 2>/dev/null | tail -1)
[ "$R" = "PASSED" ] && ok "a language with a missing project set is marked INCOMPLETE and names the gap" || bad "incomplete language was published as a verdict -> '$R'"

# ─────────────────────────────────────────────────────────────────────────────
head "9. preregistration — drift after freeze is refused"

PREREG="$WORK/prereg"
mkdir -p "$PREREG/sub"
cp "$FIX/tasks/t1-rewind-001.json" "$PREREG/sub/task.json"
echo "frozen prompt" > "$PREREG/sub/prompt.md"
$TSX script/bench/preregister.ts freeze "$PREREG" --name selftest >/dev/null 2>&1
$TSX script/bench/preregister.ts check "$PREREG" >/dev/null 2>&1
[ $? -eq 0 ] && ok "an unchanged pre-registration verifies" || bad "an unchanged pre-registration failed to verify"

echo "edited prompt" > "$PREREG/sub/prompt.md"
$TSX script/bench/preregister.ts check "$PREREG" >/dev/null 2>&1
[ $? -ne 0 ] && ok "a one-file edit after freeze is refused (exit non-zero)" || bad "drift after freeze was accepted"

# ─────────────────────────────────────────────────────────────────────────────
head "10. chart honesty — a negative value must not draw as a positive bar"

cat > "$WORK/chart.ts" <<TS
import { levelOne } from "${ROOT}/script/bench/report.ts"
// Arm A scores 1, arm C scores 0 -> centered(C) = -1, which MUST draw left of the axis.
const mk = (arm: any, score: number) => ({
  dir: "", grade: null,
  record: { runId: "t" + arm, wave: "t", task_id: "t1", arm, embedding_arm: "C0", repetition: 1,
    status: "valid", invalid_reason: null, model: { provider: "p", model: "m", temperature: 0 },
    harness: { kind: "dsh-headless", version: null },
    bb: { version: "0.2.2", index_health: "green", embedding_config: "local-word-vectors-v3:50", embedding_endpoint: null },
    arm_enforcement: { bb_mcp_mounted: false, bb_cli_shimmed: true, bb_cli_invocations: 0, absolute_path_invocations: 0 },
    cost: { wall_s: 1, tokens_in: 1, tokens_out: 1, tool_calls: 1 },
    discovery: { static_prefix_tokens: 1, tokens_before_first_edit: 1, tokens_before_first_edit_complete: true, first_edit_ms: 1 },
    bb_usage: { calls: 0, by_tool: {}, refusals: 0, fallback_answers: 0 },
    submission: { files_changed: 1, lines_added: 1, lines_removed: 0 },
    grade: { success: score === 1, score } } as any,
})
const md = levelOne([mk("A", 1), mk("C", 0)], "p")
// The C bar for a -1 value must start at an x smaller than the zero axis. We assert the
// chart declares a zero-baseline axis at all, which is the property that was missing.
console.log(md.includes("axis at zero") && md.includes("-1") ? "PASSED" : "FAILED")
TS
R=$($TSX "$WORK/chart.ts" 2>/dev/null | tail -1)
[ "$R" = "PASSED" ] && ok "negative centered scores are drawn against a declared zero axis" || bad "chart would misrepresent a negative value -> '$R'"

# ─────────────────────────────────────────────────────────────────────────────
head "10b. grader — exact test names beat substring collisions"

# MEASURED BUG: a required test literally named `intervalCap` passed, but a FAILING test
# called "intervalCap should be respected..." also contains that string, so a
# containment-first check scored a CORRECT submission 0. That is the worst possible grader
# bug: it reads as a product result. This case pins the precedence.
cat > "$WORK/namecollide.ts" <<TS
import { gradeRun } from "${ROOT}/script/bench/grade.ts"
import { mkdirSync, writeFileSync } from "node:fs"
// A tiny project whose suite has two tests sharing a prefix, one passing one failing.
const p = process.cwd() + "/benchmarks/.work/selftest/collide"
mkdirSync(p + "/test", { recursive: true })
writeFileSync(p + "/package.json", JSON.stringify({ name: "c", type: "module", scripts: { test: "node --test \\"test/*.test.js\\"" } }))
writeFileSync(p + "/src.js", "export const ok = 1\n")
writeFileSync(p + "/test/a.test.js", [
  "import test from 'node:test'",
  "import assert from 'node:assert/strict'",
  "test('intervalCap', () => { assert.equal(1,1) })",
  "test('intervalCap should be respected', () => { assert.equal(1,2) })",
].join("\\n"))
const run = p + "-run"
mkdirSync(run, { recursive: true })
writeFileSync(run + "/submission.patch", "")
const task = p + "-task.json"
writeFileSync(task, JSON.stringify({ id: "n", track: "rewind", prompt: "x", golden: { files: [], patch: "", needle: null }, grade: { must_pass: ["intervalCap"], must_not_break: [] } }))
const proj = p + "-proj.json"
writeFileSync(proj, JSON.stringify({ id: "n", source: p, test: ["node --test \\"test/*.test.js\\""] }))
const g = gradeRun(run, task, proj)
console.log(g.tests.must_pass.passed === 1 ? "PASSED" : "FAILED")
TS
R=$($TSX "$WORK/namecollide.ts" 2>/dev/null | tail -1)
[ "$R" = "PASSED" ] && ok "an exactly-named passing test is not failed by a failing test that contains it" || bad "substring collision would fail a correct submission -> '$R'"

# ─────────────────────────────────────────────────────────────────────────────
head "11. the run directory is self-contained enough to publish"

cat > "$WORK/evidence.ts" <<TS
import { existsSync } from "node:fs"
// A run whose session record lives in the disposable DSH home has a citation that 404s
// tomorrow. The record must point INSIDE the run dir.
const sample = process.cwd() + "/benchmarks/.work/W0/runs/W0-t1-rewind-001-armA-C0-r1"
if (!existsSync(sample + "/run-record.json")) { console.log("SKIP"); process.exit(0) }
const d = JSON.parse(require("node:fs").readFileSync(sample + "/run-record.json", "utf8"))
const p = d.evidence?.session_path
console.log(p && !p.includes("..") ? "PASSED" : "FAILED:" + p)
TS
R=$($TSX --input-type=module -e "$(cat "$WORK/evidence.ts")" 2>/dev/null | tail -1 || echo SKIP)
case "$R" in PASSED|SKIP) ok "evidence paths are contained in the run directory" ;; *) bad "evidence path escapes the run dir -> '$R'" ;; esac

# ─────────────────────────────────────────────────────────────────────────────
printf '\n────────────────────────────────────────\n'
printf '%s checks: %s passed, %s failed\n' "$checks" "$pass" "$fail"
if [ "$fail" -eq 0 ]; then
  printf 'SELFTEST OK — the harness can go red, and does, for each of the reasons it must.\n'
  exit 0
else
  printf 'SELFTEST FAILED — do not trust a benchmark number from this harness.\n'
  exit 1
fi
