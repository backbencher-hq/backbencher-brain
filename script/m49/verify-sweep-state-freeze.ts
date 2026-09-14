// script/m49/verify-sweep-state-freeze.ts — M49 G10: the F5 sweep cannot fork
// its own state, and a lane is measured at its PIN.
//
// Background (found live, 2026-09-14, while re-emitting M14.0.F5 after the W15
// rulings). Two defects in the differential harness, both consequences of the
// same blind spot — the harness trusted a LIVE re-read of the corpus instead of
// the state it had already recorded:
//
//   1. A lane-batch child re-derived the sweep state (corpus pins + sampling +
//      analyzer/oracle source) from `git rev-parse HEAD`, so any corpus repo
//      that committed while the sweep ran made that child journal its lanes
//      under a DIFFERENT state key. The parent then saw them missing and
//      (correctly) refused to emit: `35 lane(s) unmeasured after batching — no
//      evidence written`. Four distinct journal states appeared inside 20
//      minutes, and F5 had to be completed by hand-running slices. `proxicall`,
//      the dart primary corpus, is a symlink to an actively developed 16G
//      checkout, so this was not a rare race — it was the steady state.
//
//   2. Rows and checks are stamped `@<pin>` while the FILES PARSED come from the
//      working tree, so a dirty checkout (34 modified paths in proxicall) was
//      measured and reported as its pin — the artifact claimed a corpus state it
//      had never read.
//
// The rule enforced here is that both are now structural:
//   - the parent reads every pin once and hands the frozen state to its
//     children (M14_SWEEP_STATE / M14_SWEEP_PINS), and only a real child
//     (`--lane-batch=i/n`) may adopt an inherited state;
//   - a lane whose live checkout is not exactly its pin (moved OR dirty) is
//     measured in a detached worktree of that pin, and the substitution is
//     logged and recorded in the evidence (`data.pinDrift`).
//
// The gate drives the resolvers with synthetic inputs (a rule that cannot fail
// is not a rule) and binds them to their call sites by asserting the harness
// source uses them — with a mutated copy proving each wiring assertion can fail.
//
// CLI: bun run script/m49/verify-sweep-state-freeze.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  resolveSweepState,
  resolveSweepPins,
  pinNeedsFrozenTree,
  pinDriftReason,
  measuredInputDirt,
  readCodeInputs,
  sweepWorkRoot,
  SWEEP_STATE_ENV,
  SWEEP_PINS_ENV,
  M14_WORK_ENV,
} from "../m14/differential"
import { execSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const HARNESS = path.join(ROOT, "script", "m14", "differential.ts")

let checks = 0, passed = 0, failed = 0, negatives = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`) }
}
function negative(name: string, ok: boolean, detail = "") { negatives++; check(`${name} [negative]`, ok, detail) }

// ---------------------------------------------------------------------------
// 1. State inheritance (defect 1)
// ---------------------------------------------------------------------------
// Named so the governance auto-pass audit (which rejects a bare truthy literal
// passed to check) can stay blunt: these are INPUTS to the rules under test,
// never the verdict of a check.
const CHILD = true, NOT_CHILD = false, DIRTY = true, CLEAN = false

const PINS = { proxicall: "aaaa1111", "grails-core": "bbbb2222" }
const PARENT_PAYLOAD = JSON.stringify({ proxicall: "cccc3333", "grails-core": "bbbb2222" })

check("a child adopts the parent's state key", resolveSweepState("computed", "inherited", CHILD) === "inherited")
check("a child with no inherited state derives its own", resolveSweepState("computed", undefined, CHILD) === "computed")
check("a non-child never adopts an inherited state", resolveSweepState("computed", "inherited", NOT_CHILD) === "computed")
negative("a stray env var cannot retarget a canonical run",
  resolveSweepState("computed", "inherited", NOT_CHILD) !== "inherited")
negative("the resolver is not the identity function",
  resolveSweepState("computed", "inherited", CHILD) !== resolveSweepState("computed", "inherited", NOT_CHILD))

const inherited = resolveSweepPins(PINS, PARENT_PAYLOAD, CHILD)
check("a child takes the parent's pin for a repo that moved", inherited.proxicall === "cccc3333")
check("a child keeps the parent's pin where it agrees", inherited["grails-core"] === "bbbb2222")
check("a non-child keeps its own live pins", resolveSweepPins(PINS, PARENT_PAYLOAD, NOT_CHILD).proxicall === "aaaa1111")
check("a malformed payload falls back to the live read", resolveSweepPins(PINS, "{not json", CHILD).proxicall === "aaaa1111")
check("a non-object payload falls back to the live read", resolveSweepPins(PINS, "\"nope\"", CHILD).proxicall === "aaaa1111")
// A child must never INVENT a pin for a repo the parent did not read: an
// inherited payload with extra repos cannot add lanes to the sweep's state.
const invented = resolveSweepPins(PINS, JSON.stringify({ proxicall: "cccc3333", "not-a-repo": "deadbeef" }), CHILD)
check("a child cannot be handed a pin for a repo the parent never pinned", !("not-a-repo" in invented))
negative("an inherited pin really does override the live read", inherited.proxicall !== PINS.proxicall)

// ---------------------------------------------------------------------------
// 2. Pin-frozen measurement (defect 2)
// ---------------------------------------------------------------------------
check("clean at its pin measures in place", pinNeedsFrozenTree("aaa", "aaa", CLEAN) === false)
check("a dirty checkout at its pin is measured from the pin", pinNeedsFrozenTree("aaa", "aaa", DIRTY) === true)
check("a moved checkout is measured from the pin", pinNeedsFrozenTree("bbb", "aaa", CLEAN) === true)
check("a moved and dirty checkout is measured from the pin", pinNeedsFrozenTree("bbb", "aaa", DIRTY) === true)
negative("the in-place branch is not unconditional",
  pinNeedsFrozenTree("bbb", "aaa", CLEAN) || pinNeedsFrozenTree("aaa", "aaa", DIRTY))
check("the drift reason names a move", /at bbb/.test(pinDriftReason("bbb", "aaa", CLEAN)))
check("the drift reason names a dirty tree", /dirty/.test(pinDriftReason("aaa", "aaa", DIRTY)))
check("the drift reason says so when there is no drift", pinDriftReason("aaa", "aaa", CLEAN) === "clean at its pin")
negative("the no-drift reason is unreachable when there IS drift",
  pinDriftReason("bbb", "aaa", DIRTY) !== "clean at its pin")

// ---------------------------------------------------------------------------
// 3. Wiring: the resolvers must be what the harness actually uses.
//    Each assertion runs against the real source and a deliberately mutated
//    copy, so a check that cannot fail is itself caught.
// ---------------------------------------------------------------------------
const source = readFileSync(HARNESS, "utf8")
// Comments removed, for rules about what the CODE does. The harness documents
// the defects it fixes by quoting the shapes it removed (`` `/tmp/m14-f5-lane-journal.json` ``),
// so a rule that scans raw text can be satisfied — or tripped — by prose.
const sourceCode = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n")
// Returns the mutated copy, or null when the harness no longer contains the
// pattern at all — which is itself a wiring failure (the matching POSITIVE
// check below fails), reported as such instead of crashing the gate.
const mutate = (from: string, to: string): string | null => (source.includes(from) ? source.replace(from, to) : null)
const breaksWhenMutated = (from: string, to: string, rule: (src: string) => boolean) => {
  const m = mutate(from, to)
  return m !== null && !rule(m)
}
// The child is handed the frozen state through its environment. The harness may
// name the variable or its constant, so both spellings count as wired.
const wiring = (src: string) =>
  (src.includes("[SWEEP_STATE_ENV]: stateKey") || src.includes(`[${SWEEP_STATE_ENV}]: stateKey`))
  && (src.includes("[SWEEP_PINS_ENV]: JSON.stringify(repoPins)") || src.includes(`[${SWEEP_PINS_ENV}]: JSON.stringify(repoPins)`))
check("the parent hands its frozen state to every child", wiring(source))
negative("the child-state wiring rule catches a child spawned without it",
  breaksWhenMutated(`[SWEEP_STATE_ENV]: stateKey`, `[SWEEP_STATE_ENV]: undefined`, wiring))
// The state key itself goes through the resolver rather than the raw hash.
const stateWiring = (src: string) => /resolveSweepState\(\s*\n?\s*sweepStateKey\(/.test(src)
check("the state key is resolved through the child-aware resolver", stateWiring(source))
negative("the state-key wiring rule catches a raw recomputed key",
  breaksWhenMutated("const stateKey = resolveSweepState(\n    sweepStateKey(", "const stateKey = ((sweepStateKey(", stateWiring))
// The child adopts the parent's pins.
const pinWiring = (src: string) => /resolveSweepPins\(repoPins, process\.env\[SWEEP_PINS_ENV\]/.test(src)
check("the child adopts the parent's pins", pinWiring(source))
negative("the pin-inheritance wiring rule catches a child that re-reads HEAD",
  breaksWhenMutated("resolveSweepPins(repoPins, process.env[SWEEP_PINS_ENV], isChildRun)", "repoPins", pinWiring))
// The lane's measurement directory comes from laneRepoDir, not a raw join.
const dirWiring = (src: string) => /const repoDir = laneRepoDir\(langRepo\)/.test(src)
check("the lane's measurement directory comes from the pin-aware resolver", dirWiring(source))
check("no lane measures a raw corpus path", !/const repoDir = path\.join\(CORPUS_ROOT, langRepo\)/.test(source))
negative("the measurement-directory rule catches a raw path",
  breaksWhenMutated("const repoDir = laneRepoDir(langRepo)", "const repoDir = path.join(CORPUS_ROOT, langRepo)", dirWiring))
// The substitution is evidence, not console chatter.
check("pin drift is recorded in the evidence", /^\s*pinDrift,\s*$/m.test(source) && /data: \{\n\s*corpusPins: repoPins,/.test(source))
negative("the pin-drift evidence rule catches a silent substitution",
  breaksWhenMutated("\n      pinDrift,\n", "\n", (src) => /^\s*pinDrift,\s*$/m.test(src)))
// And the pinned trees are scratch: removed once the evidence is written.
check("pinned trees are cleaned up after the evidence write",
  /git worktree remove --force/.test(source) && /\[frozen\] removed/.test(source))
negative("the cleanup rule catches a leak",
  breaksWhenMutated("git worktree remove --force ", "git worktree list ", (src) => /git worktree remove --force/.test(src)))

// ---------------------------------------------------------------------------
// 4. Code-input dirt (defect 3): the artifact names a commit, so the analyzers
//    and the oracle that produced its rows must BE that commit. Found live
//    2026-09-14: the W16 F5 was written by a tree with a 479-line uncommitted
//    edit to the dart analyzer, and it claimed that commit's dart lane at 50.6%
//    unexplained — a number true of no commit. Re-measured on the same pinned
//    corpus with the committed analyzer: 0% unexplained.
// ---------------------------------------------------------------------------
const STATUS = [
  " M src/ast/real-dart-analyzer.ts",      // modified analyzer            -> input
  "?? src/ast/brand-new-analyzer.ts",      // untracked analyzer           -> input
  " M script/m14/spec/javascript-spec-table.json", // spec table           -> input
  "R  src/ast/old-name.ts -> src/ast/new-name.ts", // rename: the NEW path -> input
  " M package.json",                       // dependency set               -> input
  " M script/m14/differential.ts",         // the oracle itself            -> input
  "?? script/m14/tmp/my-scratch-probe.ts", // probe scratch               -> NOT an input
  " M validation/m14/results/M14.0.F5.json", // output                   -> NOT an input
  " M reviews/onboarding.md",              // prose                        -> NOT an input
  "",                                      // blank line                   -> ignored
]
const dirt = measuredInputDirt(STATUS)
check("a modified analyzer is code-input dirt", dirt.includes("src/ast/real-dart-analyzer.ts"))
check("an untracked analyzer is code-input dirt", dirt.includes("src/ast/brand-new-analyzer.ts"))
check("a modified spec table is code-input dirt", dirt.includes("script/m14/spec/javascript-spec-table.json"))
check("a renamed input is dirt under its new path", dirt.includes("src/ast/new-name.ts"))
check("a modified package.json is code-input dirt", dirt.includes("package.json"))
check("a modified oracle is code-input dirt", dirt.includes("script/m14/differential.ts"))
check("probe scratch under script/m14/tmp is not an input", !dirt.some(p => p.startsWith("script/m14/tmp/")))
check("the artifact itself is not an input", !dirt.includes("validation/m14/results/M14.0.F5.json"))
check("prose is not an input", !dirt.includes("reviews/onboarding.md"))
check("a clean status yields no dirt", measuredInputDirt(["", "   "]).length === 0)
check("the filter cannot be vacuous: real inputs are reported", dirt.length >= 6)
negative("the filter is not 'everything is dirt'", !dirt.includes("reviews/onboarding.md"))
negative("a rename is not reported by its OLD path", !dirt.includes("src/ast/old-name.ts"))

// Wiring: the harness must read the dirt, carry it, and refuse to exit 0 on it.
const codeInputsWiring = (src: string) => /const codeInputs = readCodeInputs\(ROOT\)/.test(src)
check("the harness reads the code-input dirt before emitting", codeInputsWiring(source))
negative("the code-input rule catches a harness that never reads it",
  breaksWhenMutated("const codeInputs = readCodeInputs(ROOT)", "const codeInputs = { head: \"\", clean: true, dirty: [] }", codeInputsWiring))
const checkWiring = (src: string) => /id: "differential-code-inputs",[\s\S]{0,260}?status: codeInputs\.clean \? "pass" : "fail"/.test(src)
check("the dirt is a check in the artifact, not console chatter", checkWiring(source))
negative("the check-wiring rule catches an always-pass status",
  breaksWhenMutated('status: codeInputs.clean ? "pass" : "fail"', 'status: "pass"', checkWiring))
const dataWiring = (src: string) => /\n      codeInputs,\n/.test(src)
check("the dirt is recorded as artifact data", dataWiring(source))
negative("the data-wiring rule catches a dropped payload",
  breaksWhenMutated("\n      codeInputs,\n", "\n", dataWiring))
const exitWiring = (src: string) => /DIFFERENTIAL CODE INPUTS DIRTY/.test(src) && /process\.exit\(6\)/.test(src)
check("a dirty measurement cannot exit 0", exitWiring(source))
negative("the exit rule catches a silent dirty run",
  breaksWhenMutated("process.exit(6)", "process.exit(0)", exitWiring))

// 3b. A scoped run must never claim the canonical artifact (W14's fourth
//     harness defect: `--repo X` wrote a 4-check F5 over the canonical 42-lane
//     one, so an inspection erased the release claim). The rule is structural:
//     the scoped branch exits before the emit, and says so in its output.
//     A negative control removes the exit and requires the rule to notice.
const scopedGuard = (src: string) => {
  const i = src.indexOf("if (SCOPED_RUN) {")
  if (i < 0) return false
  const block = src.slice(i, src.indexOf("\n\n", i))
  // The CALL, not the name: the string also appears in prose above the block.
  return block.includes("M14.0.F5 NOT written") && /process\.exit\(/.test(block)
    && src.indexOf("emitEvidence({") > i
}
check("a scoped probe run cannot write the canonical artifact", scopedGuard(source))
negative("the scoped-run rule catches a probe that falls through to the emit",
  breaksWhenMutated("a scoped run is for inspecting lanes, and writing it here would replace that claim with a smaller one.", "", scopedGuard)
  || breaksWhenMutated("process.exit(evaluation.regressions.length || evaluation.perfRegressions.length ? 5 : 0)", "void 0", scopedGuard))

// 5. Durable scratch (defect 4): the resume journal, the cold-pool rotation
//    state and the pinned corpus trees all lived in os.tmpdir(). This machine
//    rebooted twice while a ~2h canonical sweep was in flight and took all three
//    with it — the journal (progress) and the rotation counter, whose loss makes
//    the NEXT sweep draw a different sample than the baseline it is scored
//    against, i.e. correct work reported as movement.
const WORK = "/var/bb-work"
check("an explicit work root is honoured", sweepWorkRoot(WORK, "/tmp") === WORK)
check("an unset work root falls back", sweepWorkRoot(undefined, "/tmp") === "/tmp")
check("a blank work root falls back", sweepWorkRoot("   ", "/tmp") === "/tmp")
negative("the fallback is not unconditional", sweepWorkRoot(WORK, "/tmp") !== "/tmp")
const workWiring = (src: string) =>
  /const WORK_ROOT = sweepWorkRoot\(process\.env\[M14_WORK_ENV\], os\.tmpdir\(\)\)/.test(src)
  && /const LANE_JOURNAL_PREFIX = path\.join\(WORK_ROOT, "m14-f5-lane-journal"\)/.test(src)
  && /const COLD_POOL_STATE = path\.join\(WORK_ROOT, "m14-f5-cold-pool\.json"\)/.test(src)
  && /const FROZEN_ROOT = path\.join\(WORK_ROOT, `m14-frozen-corpus-\$\{stateKey\}`\)/.test(src)
check("journal, rotation state and pinned trees share one work root", workWiring(source))
negative("the work-root rule catches scratch left in tmpdir",
  breaksWhenMutated("const FROZEN_ROOT = path.join(WORK_ROOT,", "const FROZEN_ROOT = path.join(os.tmpdir(),", workWiring))
negative("the work-root rule catches a hardcoded journal path",
  breaksWhenMutated('path.join(WORK_ROOT, "m14-f5-lane-journal")', '"/tmp/m14-f5-lane-journal"', workWiring))
check("no sweep scratch path is hardcoded under /tmp", !/["'`]\/tmp\/m14-f5-/.test(sourceCode))

// 4b. The reader against a REAL repository — the pure filter above says what the
//     paths SHOULD do; this says what `git status` actually reports, so a filter
//     that silently matched nothing could not pass both.
const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "m49-g10-"))
try {
  execSync("git init -q && git config user.email gate@test.invalid && git config user.name gate", { cwd: tmpRepo, stdio: "ignore" })
  fs.mkdirSync(path.join(tmpRepo, "src", "ast"), { recursive: true })
  fs.writeFileSync(path.join(tmpRepo, "src", "ast", "x-analyzer.ts"), "// analyzer\n")
  fs.writeFileSync(path.join(tmpRepo, "notes.md"), "prose\n")
  execSync("git add -A && git commit -qm init", { cwd: tmpRepo, stdio: "ignore" })
  const cleanRead = readCodeInputs(tmpRepo)
  check("a committed, unedited tree reads clean", cleanRead.clean === true && cleanRead.dirty.length === 0)
  check("the reader reports the head it read", /^[0-9a-f]{40}$/.test(cleanRead.head))
  fs.writeFileSync(path.join(tmpRepo, "src", "ast", "x-analyzer.ts"), "// analyzer, edited\n")
  const oneEdit = readCodeInputs(tmpRepo)
  check("an edited analyzer is dirty on a real tree", oneEdit.clean === false && oneEdit.dirty.includes("src/ast/x-analyzer.ts"))
  fs.writeFileSync(path.join(tmpRepo, "src", "ast", "new-analyzer.ts"), "// untracked\n")
  fs.writeFileSync(path.join(tmpRepo, "notes.md"), "prose, edited\n")
  const twoDirty = readCodeInputs(tmpRepo)
  check("an untracked analyzer is dirty on a real tree", twoDirty.dirty.includes("src/ast/new-analyzer.ts"))
  check("edited prose does not make the measurement dirty", !twoDirty.dirty.includes("notes.md"))
  negative("the real-tree reader does not report every modified path",
    twoDirty.dirty.length === 2 && !twoDirty.dirty.includes("notes.md"))
} finally {
  fs.rmSync(tmpRepo, { recursive: true, force: true })
}

console.log(`M49.G10: ${passed}/${checks} checks passed, ${negatives} negative(s) exercised`)
if (failed > 0) {
  console.error(`sweep-state-freeze FAILED:\n  ${failures.join("\n  ")}`)
  process.exitCode = 1
}
