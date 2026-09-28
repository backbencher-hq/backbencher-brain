/**
 * M14.0.F5 — Differential Corpus Harness
 *
 * Second-opinion verification on real repositories. For a seeded sample of
 * files from a pinned corpus repo:
 *   1. Derive TREE TRUTH directly from the wasm parse tree.
 *   2. Run the real analyzer on the same file.
 *   3. Diff BOTH directions:
 *        tree -> analyzer : silent drops become visible and counted
 *        analyzer -> tree : fabricated/mislabelled edges become visible
 *
 * Target matching tolerates FQN vs last-segment; label matching is exact.
 *
 * CLI: bun run script/m14/differential.ts [--repo <name>] [--sample N] [--no-batch]
 *
 * Canonical full sweeps run the lanes as child processes (fresh wasm module per
 * batch, `--lane-batch=i/n` internally) because one module cannot survive all
 * 42 lanes; `--no-batch` runs them in-process (diagnosis only — it is the mode
 * that aborts).
 */
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { createHash } from "crypto"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { execSync, spawnSync } from "child_process"
import { deriveNimEdges } from "./nim-truth-oracle"
import { PHP_BUILTINS } from "../../src/ast/real-php-analyzer"
// M14.6 perl wave: the builtin set and the reason-code vocabulary are IMPORTED
// from the analyzer, never re-typed here — one rule for both sides, so a
// builtin added to the analyzer cannot read as a phantom call on the truth
// side (the #917/#919 precedent, applied to a language whose builtin gap was
// 10 words wide and produced phantom `say`/`system` edges).
import { PERL_BUILTINS, perlArgumentNodes, perlWordValues } from "../../src/ast/real-perl-analyzer"
import { RUBY_BUILTINS, RAILS_MACRO_METHODS, isRubyStaticSuperclassName } from "../../src/ast/real-ruby-analyzer"
import { PYTHON_BUILTINS } from "../../src/ast/real-python-analyzer"
import { CLOJURE_CORE_BUILTINS } from "../../src/ast/real-clojure-analyzer"
import { csharpMemberDeclaredTypeText, csharpResolveTargetTypedNew, csharpTypeNameText, csharpDeclaredTypeRefs, csharpUsingDirectiveTarget } from "../../src/ast/real-csharp-analyzer"
import { phpDeclaredTypeRefs, phpStaticIncludePath, phpStaticCallableName } from "../../src/ast/real-php-analyzer"
// #917: the macro-wrapped-heading SHAPE RULE is imported from the analyzer —
// one rule for both sides, never a re-implementation (see isWrappedHeadingName).
import {
  macroWrappedHeadingShape,
  wrappedBodyAfter,
  declarationHeaderPresent,
  declarationSpecifierRunBefore,
} from "../../src/ast/real-c-analyzer"
// #919: the cpp macro-declared-body SHAPE RULE is imported from the analyzer for
// the same reason — one rule, two sides (see the cpp oracle's mirror).
import { CPP_BUILTIN_TYPE_KEYWORDS, macroDeclaredBody, qualifiedDeclaratorLeaf, templateWrappedDeclaratorName } from "../../src/ast/real-cpp-analyzer"

function loadAvg1(): number {
  try { return parseFloat(fs.readFileSync("/proc/loadavg", "utf8").split(" ")[0] ?? "0") } catch { return 0 }
}

/**
 * M49 G5: identity of the file set a lane actually drew.
 *
 * The improvement-forcing gate compares per-lane missing/unexplained counts
 * against a pinned baseline, and `evaluateDifferential`'s `comparable` only
 * ever compared the SAMPLE SIZE. `#760`'s cold-pool rotation deliberately
 * draws never-sampled files each wave, so after a rotation those counts are
 * measured on a different file set than the baseline's — which is how five
 * genuine new-sample javascript findings and nineteen typescript ones were
 * reported as `DIFFERENTIAL REGRESSION`. Recording a hash of the drawn set
 * makes the two cases distinguishable instead of assumed identical.
 *
 * Corpus-relative paths, sorted, so the hash is stable across checkouts and
 * across the order the pool happens to return.
 */
/**
 * THE PIN — ONE implementation, called by the canonical sweep and, with an
 * explicit opt-in, by a scoped one-lane run. Two copies would drift, and this
 * function decides what every later run is allowed to regress against.
 *
 * What it deliberately does NOT do, because each of these is a way a pin could
 * launder a problem into an allowance:
 *   - it pins ONLY lanes whose own parity is clean. A lane carrying its own
 *     missing/unexplained is SKIPPED and named in the output; pinning it would
 *     bake a real anomaly into the number a later run is scored against (#870,
 *     cpp's uses@0). Heuristic counts do NOT block a pin: they are declared
 *     low-confidence edges, and drift on an UNPINNED lane is exactly the false
 *     positive a pin removes.
 *   - it MERGES into the previous counts rather than replacing them, so pinning
 *     one lane never erases another lane's recorded floor.
 *   - it records WHICH files produced each row (`sampleSetHash`), so a later
 *     cold-pool rotation reads as `resampled` for triage rather than as a
 *     regression on a different draw (M49 G5).
 *   - it records the LOAD the rows were measured under, so a later breach can
 *     be told apart from a busy machine and a perf row can be REFUSED scoring
 *     rather than misread (#871).
 */
function writeBaselinePin(
  current: Record<string, any>,
  currentSecond: Record<string, any>,
  sliceCount: number,
  provenance: string,
  loadAvgStart: number,
): void {
  const previous = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : {}
  const clean: Record<string, any> = {}
  const hashes: Record<string, string> = { ...(previous.hashes ?? {}) }
  const pinSkipped: string[] = []
  for (const [k, v] of Object.entries<any>({ ...current, ...currentSecond })) {
    if ((v.missing ?? 0) > 0 || (v.unexplained ?? 0) > 0) {
      pinSkipped.push(`${k} (missing=${v.missing ?? 0} unexplained=${v.unexplained ?? 0})`)
      continue
    }
    clean[k] = { missing: v.missing, unexplained: v.unexplained, heuristic: v.heuristic, perf: v.perf }
    if (v.sampleHash) { clean[k].sampleSetHash = v.sampleHash; hashes[k] = v.sampleHash }
  }
  const merged = {
    samplePerLang: SAMPLE_PER_LANG,
    loadContext: { loadAvgStart, loadAvgEnd: loadAvg1(), sliceCount },
    counts: { ...(previous.counts ?? previous), ...clean },
    hashes,
    // WHICH run last wrote each provenance class, so a reader can tell a floor
    // pinned by the full sweep from one pinned by a single-lane run.
    pinProvenance: { ...(previous.pinProvenance ?? {}), [provenance]: new Date().toISOString() },
  }
  fs.writeFileSync(BASELINE, JSON.stringify(merged, null, 2) + "\n")
  console.log(`differential baseline updated (${provenance}): ${Object.keys(clean).length} lane(s) pinned; drawn file sets pinned: ${Object.keys(hashes).length}`)
  if (pinSkipped.length > 0) console.log(`differential baseline: NOT PINNED — ${pinSkipped.join(", ")} — a lane carrying its own missing/unexplained is never pinned (pinning would bury the anomaly; see #870)`)
}

export function sampleSetHash(relPaths: string[]): string {
  return createHash("sha256").update([...relPaths].sort().join("\n")).digest("hex").slice(0, 16)
}

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")

// Hoisted from main() so the pin (module scope) and main share ONE baseline path —
// two spellings of the file would let the pin write somewhere the gate never reads.
const BASELINE = path.join(ROOT, "validation", "m14", "differential-baseline.json")
// Overridable because the shared corpus set is per-lane: java, groovy, kotlin
// and javascript all map to `grails-core`, and it is not present under the
// shared root any more, because the corpus was restored into the XML workdir at
// its pinned revision instead. A lane that cannot name where its own corpus
// lives cannot record a floor, and the alternative — hard-coding one workdir's
// path into shared code — would make the other 20 lanes depend on it.
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
// Crash-resume journal for full sweeps: each completed lane is persisted
// immediately (see the per-lane write in the sweep loop). Cleared after a
// successful final evidence emit.
//
// M49 W11: the journal is addressed by SWEEP STATE, not one global path.
// It used to be the fixed `/tmp/m14-f5-lane-journal.json`, so a lane measured
// in one checkout (or against a different corpus pin, or different analyzer
// code) was resumed verbatim into an unrelated run — and the row carried no
// corpus pin or analyzer revision, so the reuse was undetectable. Combined
// with the dead-parser failure mode (a lane that derived ZERO truth edges was
// journaled as a finished 0/0 lane) that let a fabricated row become durable
// state in FRESH evidence. A lane is only reusable when the state that
// produced it matches: corpus pins + the analyzer/oracle source that derived
// it. Different state ⇒ a different journal file ⇒ nothing to resume.
// M49 W17: WHERE the sweep's scratch lives is a correctness property, not a
// preference. Three files carry a sweep's identity across runs and restarts —
// the resume journal, the cold-pool rotation state, and the pinned corpus
// trees — and all three lived in `os.tmpdir()`. This machine rebooted twice
// while a canonical sweep was in flight (a ~2h run), and systemd's tmp recovery
// took all three with it: the measured lanes were gone, the rotation counter
// reset (so the next sweep drew a DIFFERENT sample than the baseline it would
// be compared against, which reports as movement), and nothing said so. A
// durable `BB_M14_WORK` is now the sweep's scratch root; the default is
// unchanged, so a machine with a persistent /tmp behaves exactly as before.
export const M14_WORK_ENV = "BB_M14_WORK"
export function sweepWorkRoot(env: string | undefined, fallback: string): string {
  const v = (env ?? "").trim()
  return v || fallback
}
const WORK_ROOT = sweepWorkRoot(process.env[M14_WORK_ENV], os.tmpdir())
const LANE_JOURNAL_PREFIX = path.join(WORK_ROOT, "m14-f5-lane-journal")
function sweepStateKey(repoPins: Record<string, string>, sampling: string): string {
  const h = createHash("sha256")
  for (const repo of Object.keys(repoPins).sort()) h.update(`${repo}@${repoPins[repo]}\n`)
  // Sampling is part of the state: a 3-file row is NOT a 60-file row. Without
  // this, a crashed 3-file run's journal would be resumed by the next
  // canonical 60-file sweep and shrink the measurement silently.
  h.update(sampling + "\n")
  const srcDir = path.join(ROOT, "src", "ast")
  const files = fs.readdirSync(srcDir).filter((f: string) => f.endsWith(".ts")).sort()
  for (const f of files) h.update(createHash("sha256").update(fs.readFileSync(path.join(srcDir, f))).digest("hex"))
  h.update(createHash("sha256").update(fs.readFileSync(path.join(ROOT, "script", "m14", "differential.ts"))).digest("hex"))
  return h.digest("hex").slice(0, 16)
}

// ---------------------------------------------------------------------------
// M49 W16: the parent's sweep state is the ONLY authority, and a lane is
// measured at its PIN.
//
// Two harness defects found live while re-emitting F5 (2026-09-14). Both made a
// canonical sweep impossible to finish on this checkout, because `proxicall` —
// the dart primary corpus — is a symlink to an actively developed 16G project
// ($HOME/ProxiCall) whose HEAD moved five times during one sweep:
//
//   1. STATE FORKED PER CHILD. The journal is addressed by sweep state (pins +
//      sampling + the analyzer/oracle source that derived it), and every
//      lane-batch child RE-DERIVED that state from a live `git rev-parse HEAD`.
//      A child started after a corpus commit therefore journaled its lanes
//      under a different state, and the parent — correctly refusing to emit
//      evidence from a partial sweep — aborted with `35 lane(s) unmeasured
//      after batching`. Four distinct journal states were observed in 20
//      minutes, and F5 had to be completed by hand-running slices. The parent
//      reads every pin ONCE, before any child starts, and now hands that frozen
//      state down (M14_SWEEP_STATE / M14_SWEEP_PINS).
//
//   2. THE PIN WAS NOT WHAT GOT MEASURED. Rows and checks are stamped
//      `@<pin>` from `git rev-parse HEAD`, while the FILES PARSED came from the
//      working tree — so a dirty checkout (34 modified paths in proxicall) was
//      measured and reported as its pin. Measured content now follows the pin:
//      when the live checkout is not exactly the pin (moved, or dirty) the lane
//      is measured in a detached worktree OF that pin, and the substitution is
//      logged and recorded in the evidence. A clean checkout at its pin is
//      measured in place, exactly as before.
// ---------------------------------------------------------------------------
export const SWEEP_STATE_ENV = "M14_SWEEP_STATE"
export const SWEEP_PINS_ENV = "M14_SWEEP_PINS"

/** A lane-batch child adopts its parent's frozen state; everything else derives
 *  its own. A stray env var must never retarget a canonical run, so the
 *  inherited value is honoured only for a real child (`--lane-batch=i/n`). */
export function resolveSweepState(computed: string, envState: string | undefined, isChild: boolean): string {
  return isChild && envState ? envState : computed
}

/** The parent's pins win for every repo the parent pinned; a child never
 *  invents a pin for a repo the parent did not read, and a malformed or absent
 *  payload falls back to the live read. */
export function resolveSweepPins(computed: Record<string, string>, envPins: string | undefined, isChild: boolean): Record<string, string> {
  if (!isChild || !envPins) return computed
  let parsed: any
  try { parsed = JSON.parse(envPins) } catch { return computed }
  if (!parsed || typeof parsed !== "object") return computed
  const out: Record<string, string> = { ...computed }
  for (const repo of Object.keys(out)) {
    if (typeof parsed[repo] === "string" && parsed[repo]) out[repo] = parsed[repo]
  }
  return out
}

/** Measure the live checkout in place only when it IS the pin: same commit and
 *  no uncommitted paths (tracked or untracked — both change what gets parsed). */
export function pinNeedsFrozenTree(head: string, pin: string, dirty: boolean): boolean {
  return head !== pin || dirty
}

/** Why the live checkout is not the pin, for the log line, so a substitution is
 *  never silent. */
export function pinDriftReason(head: string, pin: string, dirty: boolean): string {
  const parts: string[] = []
  if (head !== pin) parts.push(`at ${head.slice(0, 10)}`)
  if (dirty) parts.push("dirty working tree")
  return parts.length ? parts.join(" + ") : "clean at its pin"
}

// ---------------------------------------------------------------------------
// M49 W16 (defect 3): THE CODE SIDE OF THE SAME LIE.
//
// Defect 2 froze the CONTENT measured (corpus repos are read at their pin). It
// left the CODE alone: rows are stamped `@<commit>` and the artifact records
// `regeneratedAtCommit`, both read from `git rev-parse HEAD`, while the analyzers
// and the oracle that produced those rows came from whatever the working tree
// held. Found live 2026-09-14: the W16 F5 was written by a tree carrying a
// 479-line uncommitted edit to `src/ast/real-dart-analyzer.ts`, and the artifact
// claimed that commit's dart lane at 50.6% unexplained — a number true of no
// commit at all. Re-measured on the same pinned corpus with the committed
// analyzer: 0% unexplained. The artifact was the only thing wrong, and it was
// wrong in the most expensive direction (it accused working code).
//
// The rule: a measurement may only claim a commit when every file that can
// change a lane's rows IS that commit. Modified, added, deleted and renamed
// paths all count — an untracked analyzer is as invisible to the commit hash as
// a modified one. `script/m14/tmp/` is scratch (probe scripts are not inputs to
// any lane) and `validation/` is output, so neither can make a sweep dirty.
// ---------------------------------------------------------------------------
export const MEASURED_INPUT_ROOTS = ["src/", "script/m14/spec/"] as const
export const MEASURED_INPUT_FILES = [
  "script/m14/differential.ts",
  "script/m14/evidence-harness.ts",
  "package.json",
  "tsconfig.json",
] as const

/** Paths that can change what a lane measures, out of a `git status --porcelain`
 *  line set. Pure, so a gate can prove the filter discriminates without a
 *  dirty tree. */
export function measuredInputDirt(statusLines: string[]): string[] {
  const out: string[] = []
  for (const raw of statusLines) {
    if (!raw.trim()) continue
    const body = raw.slice(3).trim() // XY<space>PATH
    // A rename carries both sides (`R  old -> new`): the NEW path is the input.
    const p = body.includes(" -> ") ? body.split(" -> ").pop()!.trim() : body
    const path = p.replace(/^"|"$/g, "")
    if (path.startsWith("script/m14/tmp/")) continue
    const root = MEASURED_INPUT_ROOTS.find(r => path.startsWith(r))
    if (root) { out.push(path); continue }
    if (MEASURED_INPUT_FILES.includes(path as any)) { out.push(path); continue }
    if (path.startsWith("bun.lock")) { out.push(path); continue }
  }
  return [...new Set(out)].sort()
}

export interface CodeInputs {
  head: string
  clean: boolean
  dirty: string[]
}

/** Read the tree's code-input dirt in the directory that will run the lanes. */
export function readCodeInputs(root: string): CodeInputs {
  const head = execSync("git rev-parse HEAD", { cwd: root }).toString().trim()
  let lines: string[] = []
  try {
    lines = execSync("git status --porcelain --untracked-files=normal", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString().split("\n")
  } catch {
    // Cannot read the tree: that is not evidence of a clean one.
    return { head, clean: false, dirty: ["<git status unreadable>"] }
  }
  const dirty = measuredInputDirt(lines)
  return { head, clean: dirty.length === 0, dirty }
}
// Per-language corpus routing: each language runs against a repo that
// ACTUALLY CONTAINS it. The previous single-repo default (grails-core) gave
// vacuous 0-file "pass" rows for php/ruby/etc (nothing to verify — logged as
// `files=0`), and the single-pin corpusPins emission silently DISCARDED the
// historical multi-repo pin set on every run. Default now sweeps one honest
// repo per language; --repo <name> still restricts to a single repo.
export const LANG_REPOS: Record<string, string> = {
  // XML's corpus is restored under the xml workdir, not CORPUS_ROOT, so the
  // lane is run with an explicit --repo. Naming grails-core here anyway keeps
  // the mapping honest about WHICH corpus the floor is measured on: the
  // baseline row is keyed `grails-core:xml` and that key has to mean one repo.
  xml: "grails-core",
  java: "grails-core",
  groovy: "grails-core",
  kotlin: "Exposed",
  scala: "scala3",
  typescript: "vue-core",
  javascript: "grails-core",
  vue: "element-plus",
  svelte: "svelte",
  c: "sqlite",
  cpp: "fmt",
  rust: "ripgrep",
  go: "go-tools",
  zig: "zig",
  csharp: "powershell",
  dart: "proxicall",
  swift: "swift-nio",
  objc: "sdwebimage",
  php: "phpunit",
  ruby: "rake",
  python: "cython",
  haskell: "cabal",
  elixir: "elixir",
  erlang: "rebar3",
  // F5-cert wave (CLJ): the clojure/clojure checkout (pin 2cea6925) was
  // already present as java's second corpus; it becomes clojure's primary.
  clojure: "clojure",
  // F5 wave (CLEAN): Clyde (109 icl/dcl) is the lane's primary corpus.
  clean: "Clyde",
  // M14.6 perl: mojo IS the M12 pinned perl corpus (validation/m12/corpus-manifest.json
  // perl.corpusTarget = "mojo", revision 93f59174), so the differential audits the
  // same files the pinned ground truth was audited on.
  perl: "mojo",
  // M60 VB wave (2026-09-27): `DISMTools` is the second opinion for the vb
  // lane. Chosen to be a different SHAPE and not just a different project: P3D
  // is a game with hand-written modules, DISMTools is a Windows Forms authoring
  // tool whose .vb surface is dominated by designer-generated code --
  // `Handles` wiring, `My Project` assembly files, and Forms `ApplicationEvents`
  // -- so a defect that only fires on a designer shape cannot hide in the primary.
  vb: "DISMTools",
  // M60 HCL wave (2026-09-26). `terraform` is the M12 pinned HCL target
  // (validation/m12/corpus-manifest.json) and is ALSO go's second corpus, so the
  // checkout does double duty: 2,363 tracked .tf/.tfvars/.hcl files at db4eef4.
  hcl: "terraform",
  // NIM wave (2026-09-27): the Nim compiler + the whole standard library. Every
  // construct the analyzer must know appears under compiler/ or lib/, and it is the
  // language's own reference implementation rather than a user of it.
  nim: "nim",
  // M60 VB wave (2026-09-27). `P3D-Legacy` is the lane's primary: 1,880 tracked
  // .vb files of a real Windows Forms codebase, the largest VB.NET-dominant
  // corpus available. `DISMTools` is the second opinion and is deliberately a
  // DIFFERENT shape — a Windows Forms authoring tool rather than a game, so its
  // designer-generated files, its `My Project` assembly files and its
  // Forms-Designer `Handles` wiring are shapes P3D does not contain.
  vb: "P3D-Legacy",
}
// M37.16 two-corpus gate (second-opinion hardening): every gated language runs
// the SAME analyzer-vs-oracle differential on a SECOND, independent real corpus
// in the default sweep, so a defect with zero occurrences in the primary repo
// (SWIFTD18 class — multi-binding in swift-nio had 0 sites) is exercised by a
// different codebase's dialect. Rows are keyed repo:lang in the baseline/current
// maps exactly like the primary rows, so regressions on EITHER corpus block
// release. Each repo is an independent git checkout under CORPUS_ROOT whose
// pin is recorded in corpusPins.
export const SECOND_CORPUS: Record<string, string> = {
  java: "clojure",
  groovy: "geb",
  kotlin: "kotlinx-coroutines",
  scala: "cats-effect",
  typescript: "element-plus",
  javascript: "lodash",
  vue: "vue-element-admin",
  svelte: "shadcn-svelte",
  c: "jq",
  cpp: "nlohmann-json",
  rust: "cargo",
  go: "terraform",
  zig: "zls",
  csharp: "fsharp",
  dart: "dart-http",
  swift: "alamofire",
  objc: "afnetworking",
  php: "phpmyadmin",
  ruby: "rack",
  python: "requests",
  haskell: "hledger",
  elixir: "phoenix",
  // ER wave (M14 #275 obligation 2): OTP is the second Erlang corpus — the
  // elixir repo's 45 .erl files (compiler front-end only) were ruled
  // insufficient as a second opinion. Shallow clone at a pinned commit under
  // CORPUS_ROOT; pin recorded in corpusPins at lane time.
  erlang: "otp",
  // F5-cert wave (CLJ): userland second corpus — clj-kondo (445 clj/cljc/
  // cljs files, shallow clone @703a44cc) exercises dialect the core repo
  // does not (transducer-heavy, cljs interop, tooling macros).
  clojure: "clj-kondo",
  // M60 HCL wave: tf-aws-components is an independent, much larger corpus
  // (1,809 files at 1f74a96) written in a different Terraform idiom from
  // terraform's own tree — module-per-component, deep variable objects — which
  // is what a second opinion has to be for. Same checkout serves as go's
  // primary? no: go's primary is go-tools; terraform is go's SECOND corpus.
  hcl: "tf-aws-components",
  // F5 wave (CLEAN): clean-stdlib (74 icl/dcl) is an independent corpus —
  // the compiler's own standard library, a different dialect from Clyde
  // (tooling). NOTE: 312 total Clean files on this box is short of the
  // family's 900-file standard; disclosed, not hidden.
  clean: "clean-stdlib",
  // NIM second corpus: a general-purpose 2D graphics library — operator overloads,
  // variant objects, generic containers and heavy proc/iterator use, a dialect the
  // compiler+stdlib corpus does not exercise.
  nim: "pixie",
  // M14.6 perl: plack is an independent corpus with a different dialect profile —
  // PSGI middleware, no Moose, heavy filehandles — so a defect with zero sites in
  // mojo (a Mojo-flavoured codebase) is still exercised.
  perl: "plack",
}
const REPO = process.argv.includes("--repo") ? process.argv[process.argv.indexOf("--repo") + 1] : undefined
const SAMPLE_PER_LANG = process.argv.includes("--sample") ? parseInt(process.argv[process.argv.indexOf("--sample") + 1]) : 60
/**
 * `--pin-baseline`: let a SCOPED run write `differential-baseline.json`.
 *
 * WHY IT EXISTS. `--lang a,b` was added so ONE lane could be re-measured and its
 * own artifact emitted without running the whole set — and it was wired
 * everywhere EXCEPT the pin, which sits past the scoped guard's `process.exit`.
 * So a lane whose corpora are the only ones present on the machine could be
 * measured, audited, and still not have its floor recorded: `completeness-inventory`
 * sections E and F read that floor, and they read it as `n/a` no matter how clean
 * the lane was. Measured on the HCL lane, whose two corpora are present and
 * whose 100 %/0-unexplained rows were reproducible on demand.
 *
 * It is a separate flag from `--update-baseline` so the default is unchanged: a
 * probe still writes nothing, and only an explicit request writes the registry.
 */
const PIN_BASELINE_FROM_SCOPE = process.argv.includes("--pin-baseline")
// M60 groovy lane (2026-09-25): the lane's DISCOVERY cap must never truncate a
// full-extent draw. It read `if (files.length > 4000) return` — an early return
// that abandons the whole directory — so on grails-core the groovy+gradle pool
// was a DIRECTORY-ORDER PREFIX of the corpus: 4,014 files of 6,931, with 2,917
// hidden (2,762 `.groovy`, 155 `.gradle`, and the hidden head is `src/test/**`
// spec source). `--sample 100000`, whose entire purpose is to measure every
// file, reported `files=4014` as if that WERE the corpus, and the same hash on
// a widened `ext` looked like agreement when it was the cap. The constant is a
// memory/time bound for the canonical 60-file draw, where 4,000 files is 66x
// the draw and the bound costs nothing; it must therefore scale with the draw
// rather than be a constant. Measured with script/m14/tmp/gr-scan-cap.ts.
const DISCOVERY_CAP = Math.max(4000, SAMPLE_PER_LANG)
// M60 (functional/clean lane): `--lang a,b` restricts the sweep to those
// languages' (lang, repo) pairs — primary AND second corpus — so ONE lane can be
// re-measured (and its own artifact emitted) without running the whole set.
//
// Measured gap: the harness had no such scope even though its own #943 note
// refers to `--repo cython --lang python` as a one-lane probe — `--repo` routes
// EVERY language at one repo, so that run measured python only by accident of
// routing and could not see python's second corpus at all.
const ONLY_LANGS = (() => {
  const i = process.argv.indexOf("--lang")
  if (i < 0 || i + 1 >= process.argv.length) return null
  const set = process.argv[i + 1].split(",").map(s => s.trim()).filter(Boolean)
  return set.length > 0 ? set : null
})()
// M49 W11 (Defect 3): the sweep cannot finish inside ONE wasm module. Every
// lane constructs a Parser in the fixed-size web-tree-sitter heap and the
// module degrades after ~19-31 lanes — then `new ParserClass()` aborts with
// `RuntimeError: Out of bounds call_indirect`, and BEFORE it aborts it can
// return empty trees (which is how a dead parser became a clean 0/0 lane).
// Caching the grammar and freeing the parser per lane (W10) reduced the rate
// but not the outcome: no full sweep ever reached its evidence write, which is
// why M14.0.F5 stayed the one pre-#761 `__LEGACY__` artifact.
//
// The fix is to give each lane group a FRESH module: canonical sweeps run the
// lanes as child processes of this same file (`--lane-batch=i/n`), each
// measuring only its slice and journaling each lane, after which this parent
// resumes every lane from the state-keyed journal and owns the evidence write
// and the baseline gate. Batch size is capped well below the measured
// degradation point, and BB_F5_BATCH_SIZE exists so the cap can be exercised.
const LANE_BATCH_ARG = process.argv.find(a => a.startsWith("--lane-batch="))
const CHILD_SLICE = (() => {
  if (!LANE_BATCH_ARG) return null
  const [i, n] = LANE_BATCH_ARG.split("=")[1].split("/").map(Number)
  if (!Number.isInteger(i) || !Number.isInteger(n) || n < 1 || i < 0 || i >= n) {
    throw new Error(`differential: bad --lane-batch=${LANE_BATCH_ARG.split("=")[1]} (want i/n with 0 <= i < n)`)
  }
  return { i, n }
})()
const NO_BATCH = process.argv.includes("--no-batch")
const BATCH_SIZE = process.env.BB_F5_BATCH_SIZE ? parseInt(process.env.BB_F5_BATCH_SIZE) : 8

// The ROUTER's spelling of a lane's language, for extensions the router decides
// by CONTENT (see `routeByContent`). src/ast/language-detection.ts is the one
// registry that admits a file to an analyzer, so it is the one this harness has
// to agree with rather than a second opinion kept here.
const ROUTER_LANGUAGE: Record<string, string> = { objc: "objective-c" }
const extOf = (name: string): string => name.slice(name.lastIndexOf(".") + 1).toLowerCase()

export const LANGS: Record<string, { wasm: string; analyzerFile: string; className: string; ext: string; routeByContent?: readonly string[] }> = {
  // XML, and the only lane whose `ext` is seven globs rather than one. The
  // wired grammar names XML documents; `.xsd`/`.dtd`/`.xsl`/`.xslt`/`.svg`/
  // `.rng` are all XML documents, and a lane that measured only `*.xml` would
  // grade the minority of a real corpus and report it as the whole — which is
  // what the doc's old "154 tracked *.xml/*.xsd files" figure did.
  //
  // `svg` is 155 of grails-core's 314 (146 xml + 9 xsd + 4 dtd + 155 svg), so
  // omitting it drops HALF the corpus while every number still looks sane.
  //
  // `wsdl` is deliberately ABSENT. The engine does not claim it: the manifest
  // records 805 `.wsdl` as unrouted under the M60 #913 ruling to refuse rather
  // than claim, because the wired grammar does not declare that file type. A
  // lane listing `wsdl` would grade files no analyzer ever sees, and would score
  // the lane on a population the rest of the system excludes on purpose.
  // `routeByContent` is deliberately ABSENT: `svg` and `xsl` are content-routed,
  // and the router's decision is the one that decides which analyzer runs, so
  // the lane takes every one of the seven and lets the router hand it to xml.
  xml: { wasm: "tree-sitter-xml.wasm", analyzerFile: "real-xml-analyzer", className: "RealXmlAnalyzer", ext: "xml,xsd,dtd,xsl,xslt,svg,rng" },
  javascript: { wasm: "tree-sitter-javascript.wasm", analyzerFile: "real-javascript-analyzer", className: "RealJavaScriptAnalyzer", ext: "js" },
      typescript: { wasm: "tree-sitter-typescript.wasm", analyzerFile: "real-typescript-analyzer", className: "RealTypeScriptAnalyzer", ext: "ts" },
  kotlin: { wasm: "tree-sitter-kotlin.wasm", analyzerFile: "real-kotlin-analyzer", className: "RealKotlinAnalyzer", ext: "kt" },
  // M60 VB wave. `ext` is `vb`, which is what language-detection.ts routes, and
  // `wasm` is the GRAMMAR's name rather than the language's -- the lane reads
  // tree-sitter-vbnet, and the pin's `wired` field names the same file, so a swap
  // of the wasm here is a swap the pin catches.
  vb: { wasm: "tree-sitter-vbnet.wasm", analyzerFile: "real-vb-analyzer", className: "RealVbAnalyzer", ext: "vb" },
  scala: { wasm: "tree-sitter-scala.wasm", analyzerFile: "real-scala-analyzer", className: "RealScalaAnalyzer", ext: "scala" },
  java: { wasm: "tree-sitter-java.wasm", analyzerFile: "real-java-analyzer", className: "RealJavaAnalyzer", ext: "java" },
  // M60 groovy universe (2026-09-25): `ext` read "groovy", so the Gradle DSL —
  // which the ROUTER has mapped to this lane since M49 W21 (#850) precisely
  // because it is the largest real-world Groovy surface — was outside every F5
  // row, depth draw and fixture. grails-core alone holds 454 `.gradle` files
  // against 6,564 `.groovy`; unlike objc's headers this needs no content guard,
  // because the router decides `.gradle` by NAME.
  groovy: { wasm: "tree-sitter-groovy.wasm", analyzerFile: "real-groovy-analyzer", className: "RealGroovyAnalyzer", ext: "groovy,gradle" },
  vue: { wasm: "tree-sitter-vue.wasm", analyzerFile: "real-vue-analyzer", className: "RealVueAnalyzer", ext: "vue" },
  svelte: { wasm: "tree-sitter-svelte.wasm", analyzerFile: "real-svelte-analyzer", className: "RealSvelteAnalyzer", ext: "svelte" },
  // `ext` is the lane's SAMPLING UNIVERSE, and for cpp it read "cc,h" until the
  // M37.19 family round (2026-09-25): .cpp — the most common C++ extension — and
  // .hpp were invisible to every F5 draw. Three other declarations in this repo
  // disagree with that string and all three are authoritative: the product's own
  // indexer (`parallel-indexer.ts` accepts .c/.h/.cpp/.hpp/.cc/.cxx and maps
  // cpp -> "cpp"), the M12 corpus census (`verify-corpus-census.ts`, cpp:
  // [.cc, .cpp, .h, .hpp]) and the fixture harness (`run-fixtures.ts`, ext "cpp"
  // — every cpp fixture is a .cpp file). Measured consequence on the second
  // corpus: `--repo nlohmann-json` drew 17 files out of 497, so the lane's
  // deepest measurement was fmt's 73 and the family's own 200-file floor was
  // unreachable for cpp through no fault of the analyzer. The canonical F5 row
  // recorded at fdbf069f was drawn under the old string and is not comparable to
  // a re-run in the .cpp-inclusive universe.
  cpp: { wasm: "tree-sitter-cpp.wasm", analyzerFile: "real-cpp-analyzer", className: "RealCppAnalyzer", ext: "cc,cpp,cxx,h,hpp" },
  c: { wasm: "tree-sitter-c.wasm", analyzerFile: "real-c-analyzer", className: "RealCAnalyzer", ext: "c" },
  rust: { wasm: "tree-sitter-rust.wasm", analyzerFile: "real-rust-analyzer", className: "RealRustAnalyzer", ext: "rs" },
  go: { wasm: "tree-sitter-go.wasm", analyzerFile: "real-go-analyzer", className: "RealGoAnalyzer", ext: "go" },
  zig: { wasm: "tree-sitter-zig.wasm", analyzerFile: "real-zig-analyzer", className: "RealZigAnalyzer", ext: "zig" },
  // NIM wave (2026-09-27). `ext` carries all three extensions the pinned grammar
  // declares (tree-sitter.json -> file-types ["nimble","nims","nim"]) minus the
  // .nimble manifest, which language-detection.ts does NOT route to nim and which
  // is therefore not swept: claiming a corpus the router would skip is the inert-
  // pin class #884 documents.
  nim: { wasm: "tree-sitter-nim.wasm", analyzerFile: "real-nim-analyzer", className: "RealNimAnalyzer", ext: "nim,nims" },
  csharp: { wasm: "tree-sitter-c_sharp.wasm", analyzerFile: "real-csharp-analyzer", className: "RealCSharpAnalyzer", ext: "cs" },
  dart: { wasm: "tree-sitter-dart.wasm", analyzerFile: "real-dart-analyzer", className: "RealDartAnalyzer", ext: "dart" },
  swift: { wasm: "tree-sitter-swift.wasm", analyzerFile: "real-swift-analyzer", className: "RealSwiftAnalyzer", ext: "swift" },
  // M60 objc headers (2026-09-25): `ext` is the lane's sampling universe and it
  // read "m" — so the header half of the language was outside every F5 row,
  // depth draw and fixture, while production DOES hand the analyzer those files.
  // `h` joins it, but under `routeByContent`: the extension is decided by the
  // router's sniff, not by its name (see the admission rule in `scan`).
  objc: { wasm: "tree-sitter-objc.wasm", analyzerFile: "real-objective-c-analyzer", className: "RealObjectiveCAnalyzer", ext: "m,h", routeByContent: ["h"] },
  php: { wasm: "tree-sitter-php.wasm", analyzerFile: "real-php-analyzer", className: "RealPhpAnalyzer", ext: "php" },
  ruby: { wasm: "tree-sitter-ruby.wasm", analyzerFile: "real-ruby-analyzer", className: "RealRubyAnalyzer", ext: "rb" },
  python: { wasm: "tree-sitter-python.wasm", analyzerFile: "real-python-analyzer", className: "RealPythonAnalyzer", ext: "py" },
  haskell: { wasm: "tree-sitter-haskell.wasm", analyzerFile: "real-haskell-analyzer", className: "RealHaskellAnalyzer", ext: "hs" },
  elixir: { wasm: "tree-sitter-elixir.wasm", analyzerFile: "real-elixir-analyzer", className: "RealElixirAnalyzer", ext: "ex,exs" },
  erlang: { wasm: "tree-sitter-erlang.wasm", analyzerFile: "real-erlang-analyzer", className: "RealErlangAnalyzer", ext: "erl" },
  clojure: { wasm: "tree-sitter-clojure.wasm", analyzerFile: "real-clojure-analyzer", className: "RealClojureAnalyzer", ext: "clj,cljc,cljs" },
  // F5 wave (CLEAN): tree-sitter-clean v1.2.7 (pinned sha
  // 9ea8525dcbd441b237b3d475b0ccd39a0d36d7fbe5937dce3daaa85d5e6097ec).
  clean: { wasm: "tree-sitter-clean.wasm", analyzerFile: "real-clean-analyzer", className: "RealCleanAnalyzer", ext: "icl,dcl" },
  // M14.6 perl wave (2026-09-26): perl had NO lane at all — 25 gated languages,
  // perl absent — so its F5 differential was unmeasured while the completion
  // matrix still read `diff: n/a`. `ext` is the sampling universe and it must
  // carry the whole production surface: production routes .pl/.pm/.t/.perl
  // (language-detection.ts) and the corpora hold .PL (build scripts) too.
  // M14.6 perl: `ext` read "pm,pl,t,PL" while production's router
  // (src/ast/language-detection.ts:42) maps ONLY pl|pm|t|perl to perl, so the
  // lane was measuring one file per mojo/plack that production never hands the
  // analyzer — and the 7-corpus census (which uses production's exact set)
  // said 274/225 where this said 275/226, a 32-edge delta nobody could
  // explain from the artifacts. Measuring a superset is safe; measuring a
  // DIFFERENT surface than the one in production is not, because every perl
  // number then describes a file set that does not exist at runtime. Aligned
  // to production; the census, this lane and the fixture lane now agree.
  perl: { wasm: "tree-sitter-perl.wasm", analyzerFile: "real-perl-analyzer", className: "RealPerlAnalyzer", ext: "pm,pl,t" },
  // SQL wave (2026-09-26): sql was ABSENT from every M14 surface — no entry in
  // this map, no directory in validation/m14/fixtures/, no mutants in
  // mutate-analyzer.ts, no sql-completeness.json in spec/, and no per-analyzer
  // lane in the m12 differential beyond 34 hand-audited facts over 63 lines of
  // fixture. So its F5 differential was unmeasured while the completion matrix
  // read `diff: n/a` — a lane that looks absent rather than broken.
  // `ext` is the sampling universe and must carry the WHOLE production surface:
  // language-detection.ts routes .sql/.psql/.ddl, and the ProxiCall corpus also
  // holds .SQL.
  sql: { wasm: "tree-sitter-sql.wasm", analyzerFile: "real-sql-analyzer", className: "RealSqlAnalyzer", ext: "sql,psql,ddl,SQL" },
  // M60 HCL wave (2026-09-26): hcl was ABSENT from every M14 surface, exactly as
  // sql was — no entry in this map, no directory in validation/m14/fixtures/,
  // no mutants, no spec/hcl-completeness.json, and no F5 row, so its completion
  // cell read `n/a` while the lane's own corpus differential measured 94.2%
  // reference recall. `ext` carries the WHOLE production surface:
  // language-detection.ts routes .tf/.tfvars/.tofu/.hcl, and the corpora hold
  // .pkr.hcl (packer) and .boilerplate terragrunt templates besides.
  hcl: { wasm: "tree-sitter-hcl.wasm", analyzerFile: "real-hcl-analyzer", className: "RealHclAnalyzer", ext: "tf,tfvars,hcl,tofu" },
}

function seededPick<T>(items: T[], n: number, seedStr: string): T[] {
  let h = 2166136261
  for (const c of seedStr) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
  const idx = items.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h + i), 2246822519)
    const j = Math.abs(h) % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx.slice(0, n).map(i => items[i])
}
// M49 #760 (process gate): deterministic sampling = deterministic blind spot.
// `Spring.subscribe -> Readable.subscribe` (ts .d.ts interface heritage) stayed
// invisible for waves because the SAME 60 files were drawn every run. Each lane
// now prefers files never sampled before (the cold pool), deterministically
// seeded per rotation counter — reproducible, but every wave sees fresh files.
// Cumulative coverage is tracked in the cold-pool state file; the gate fails if
// a corpus's cumulative coverage stalls (no new files in N waves = the pool is
// exhausted = sample >= corpus, fine) or the state file is missing on a
// canonical run (silent revert to the old blind behavior).
const COLD_POOL_STATE = path.join(WORK_ROOT, "m14-f5-cold-pool.json")
function loadColdPool(): { seen: Record<string, string[]>; rotations: Record<string, number> } {
  try { return JSON.parse(fs.readFileSync(COLD_POOL_STATE, "utf8")) } catch { return { seen: {}, rotations: {} } }
}
function saveColdPool(state: { seen: Record<string, string[]>; rotations: Record<string, number> }): void {
  fs.mkdirSync(path.dirname(COLD_POOL_STATE), { recursive: true })
  fs.writeFileSync(COLD_POOL_STATE, JSON.stringify(state, null, 2))
}
// M60 (dart depth): a lane measured in a FROZEN tree must key its pool on the
// CORPUS-relative path, not the path it happened to be measured at.
//
// Why this was a defect, measured: when the live corpus checkout is dirty or
// moved, `--repo X` measures a detached worktree of the pin
// (/tmp/m14-frozen-corpus-<hash>/X), and the pool recorded those absolute paths.
// Every run freezes a NEW directory, so every file looked NEVER-SAMPLED, every
// run drew 100% "fresh" files, and the pool grew without bound (proxicall:dart
// held 5,942 paths for a 2,211-file corpus, under four different freeze
// prefixes). The #760 guarantee — "each lane prefers files never sampled before,
// deterministically seeded per rotation" — was therefore VOID on precisely the
// corpora that need it, and the log line that exists to disclose sampling
// (`[cold-pool] N/M fresh`) certified a freshness that did not exist. That is
// how a "full extent" can be claimed twice while covering different halves.
//
// `poolKey` is the corpus-relative path, so a frozen measurement and an in-place
// one describe the same file.
function coldPoolPick<T>(items: T[], n: number, laneKey: string, poolKey?: (it: T) => string): { picked: T[]; coldCount: number; total: number; rotation: number } {
  const state = loadColdPool()
  // BB_F5_FREEZE_POOL replays ONE wave instead of advancing it. The cold-pool
  // rotation is deliberate (#760: deterministic sampling is a deterministic blind
  // spot, so each wave draws never-sampled files) — which means two runs draw
  // DIFFERENT files, and any before/after number is then a comparison of two
  // different file sets. That is not a small caveat: while measuring the VB lane
  // the sample hash changed every run (74a3b425 -> 0c3b2d53 -> 09c70a41 ->
  // 11611103) and coverage appeared to move 98.4% -> 92.4% with no code change in
  // between. Freeze the pool to compare; leave it off for a coverage run.
  const freeze = process.env.BB_F5_FREEZE_POOL === "1"
  const seen = new Set<string>(state.seen[laneKey] ?? [])
  const rotation = freeze ? (state.rotations[laneKey] ?? 1) : (state.rotations[laneKey] ?? 0) + 1
  const paths = items.map((it) => poolKey
    ? poolKey(it)
    : String((it as any).path ?? (it as any).filePath ?? (it as any).file ?? it))
  const freshIdx: number[] = []
  const warmIdx: number[] = []
  // Membership accepts EITHER spelling: the pool holds absolute paths written
  // before this fix (every in-place lane, whose absolute path IS its identity —
  // those lanes must not be reset), and corpus-relative keys written from here
  // on (the only spelling that means anything for a frozen tree).
  const rawPaths = items.map((it) => String((it as any).path ?? (it as any).filePath ?? (it as any).file ?? it))
  for (let i = 0; i < items.length; i++) (seen.has(paths[i]) || seen.has(rawPaths[i]) ? warmIdx : freshIdx).push(i)
  const coldFresh = seededPick(freshIdx.map((i) => items[i]), Math.min(n, freshIdx.length), `${laneKey}:rot${rotation}:fresh`)
  const coldWarm = seededPick(warmIdx.map((i) => items[i]), n - coldFresh.length, `${laneKey}:rot${rotation}:warm`)
  const picked = [...coldFresh, ...coldWarm]
  const pickedPaths = picked.map((it) => String((it as any).path ?? (it as any).filePath ?? (it as any).file ?? it))
  const record = poolKey ? picked.map((it) => poolKey(it)) : pickedPaths
  if (!freeze) {
    state.seen[laneKey] = [...new Set([...(state.seen[laneKey] ?? []), ...record])]
    state.rotations[laneKey] = rotation
    saveColdPool(state)
  }
  return { picked, coldCount: coldFresh.length, total: items.length, rotation }
}
function lastSegment(name: string): string {
  const parts = name.split(/::|\./).filter(Boolean)
  return parts[parts.length - 1] ?? name
}

// ---------------------------------------------------------------------- R10
// rust #798: the impl-target NAME surface. Both rust oracles below need the
// same two answers the analyzer gives (real-rust-analyzer.ts:
// `nominalTypeNode` / `implTypeSymbolName` / `implSelfTypeName`), so they are
// written once here rather than twice — the drift class this program keeps
// paying for.
//
// WHY THEY ARE TWO ANSWERS. The OLD rule took `typeNode.text` verbatim, so
// `impl Trait for &mut ProcessBuilder` published the source TEXT `&mut
// ProcessBuilder` as a name — on the impl symbol, on the `implements` edge's
// source, and (through `Self`) on every `references` target inside the block.
// The differential is STRUCTURALLY BLIND to it because its truth derives from
// the same rule: both sides spelled the fabrication identically and every
// per-edge gate read green. The M60 target-spelling census convicted it instead
// (6 `references` targets over 2 files).
//
// A reference/pointer/parenthesized wrapper does not change what a type is
// NAMED, so it is transparent; a type with no nominal name at all (a slice
// `[u8]`, a tuple `(T, U)`, a unit, a never type, a fn pointer, `dyn Trait`,
// `<T as Trait>::Assoc`) has no name to publish and each caller takes the
// honest state — the analyzer's declared synthetic `anonymous_impl` for the
// impl SYMBOL, and ABSENCE for `Self` resolution.
function rustNominalTypeNode(t: any): any {
  let cur: any = t
  for (let guard = 0; cur && guard < 16; guard++) {
    const ty = cur.type
    if (ty === "reference_type" || ty === "pointer_type" || ty === "parenthesized_type") {
      const inner = cur.childForFieldName?.("type") ?? cur.namedChild(cur.namedChildCount - 1)
      if (!inner) return null
      cur = inner
      continue
    }
    break
  }
  if (!cur) return null
  const ty = cur.type
  if (ty === "type_identifier" || ty === "primitive_type" || ty === "scoped_type_identifier" || ty === "generic_type") return cur
  return null
}

/** The impl SYMBOL's name: generics stripped, path qualification PRESERVED
 *  (`std::io::Error` stays qualified — the deferred ctor filter reads in-file
 *  symbol names, so flattening a foreign `io::Error` to `Error` would make
 *  `Error::new()` look like a local construction). */
function rustImplSymbolName(t: any): string | null {
  const n = rustNominalTypeNode(t)
  if (!n) return null
  const text = String(n.text ?? "")
  const lt = text.indexOf("<")
  return (lt >= 0 ? text.slice(0, lt) : text) || null
}

/** The name `Self` resolves to: the unwrapped type's LEAF (`Error` for
 *  `std::io::Error`), or `null` when the type has no nominal name. */
function rustImplSelfTypeName(t: any): string | null {
  const n = rustNominalTypeNode(t)
  if (!n) return null
  const text = String(n.text ?? "")
  const lt = text.indexOf("<")
  const base = lt >= 0 ? text.slice(0, lt) : text
  return base.split("::").filter(Boolean).pop() || null
}
export function normTarget(t: string): string {
  // scala type args use square brackets; multi-line constructs can leave a
  // trailing unbalanced "[" in raw-text targets (List[ -> List)
  return lastSegment(t.replace(/<.*$/, "").replace(/\[.*$/, "").trim())
}
// M60 oracle sharpness (2026-09-25; report-only behind BB_F5_STRICT=1). The
// coverage match below is `label + normTarget(target)`, and normTarget is the
// LAST SEGMENT: the qualifier is discarded, so a truth row can be satisfied by an
// unrelated analyzer edge that happens to share its leaf. That is not
// hypothetical — the groovy lane's anonymous-body defect was PUBLISHED as 2
// MISSING rows when 4 rows were missing, because the truth's
// `anonymous_X.decode -> X.decode` was matched by the analyzer's
// `IdentityDecoder.decode -> PropertyDecoder.decode`. These helpers re-match on
// the target AS WRITTEN (generics/args stripped, qualifier kept) so the sharper
// question can be asked of EVERY lane without moving any published number: the
// flag adds counters and a report line, never a gate, and a run without it emits
// a byte-identical artifact. Evidence: reviews/m60-oracle-sharpness.md, whose
// instrument is falsified on the known case before any 0-count is believed.
export const strictTargetText = (t: string): string => String(t ?? "").replace(/<.*$/, "").replace(/\[.*$/, "").trim()
export const strictKey = (label: string, target: string): string => `${label}|${strictTargetText(target)}`
export const qualifierOf = (t: string): string => {
  const parts = strictTargetText(t).split(".").filter(Boolean)
  return parts.length > 1 ? parts.slice(0, -1).join(".") : ""
}
const BB_F5_STRICT = !!process.env.BB_F5_STRICT
// The sharpness pass is arithmetic, so it can be CHECKED while it runs instead
// of trusted: `sharpnessInvariants` is asserted per repo and any breach is
// printed, because an instrument that cannot fail is not evidence. The three
// identities are exact, not approximate:
//   (A) every truth row is either strictly covered or strictly missing;
//   (B) a strict miss with NO same-leaf analyzer row is by definition a row the
//       published rule ALSO missed — so the two counts must agree, and a
//       disagreement means the pass read a different `truth`/`rels` than the
//       published loops did;
//   (C) the masked subset cannot exceed the hidden one.
export function sharpnessInvariants(s: { truth: number; covered: number; missing: number; hidden: number; hard: number; publishedMissing: number }): string[] {
  const bad: string[] = []
  if (s.covered + s.missing !== s.truth) bad.push(`A: covered ${s.covered} + missing ${s.missing} != truth ${s.truth}`)
  if (s.missing - s.hidden !== s.publishedMissing) bad.push(`B: missing ${s.missing} - hidden ${s.hidden} != published missing ${s.publishedMissing}`)
  if (s.hard > s.hidden) bad.push(`C: hard ${s.hard} > hidden ${s.hidden}`)
  return bad
}

interface TreeEdge { label: string; from: string; target: string }

// Vue template component-usage oracle: every element start_tag NOT in an
// independently-written core-HTML/SVG set is a component usage. The set
// below is written from the HTML spec, deliberately NOT copied from the
// analyzer's list, so disagreements surface as missing/unexplained.
const ORACLE_HTML_TAGS = new Set(["a","abbr","address","area","article","aside","audio","b","base","bdi","bdo","blockquote","body","br","button","canvas","caption","cite","code","col","colgroup","data","datalist","dd","del","details","dfn","dialog","div","dl","dt","em","embed","fieldset","figcaption","figure","footer","form","h1","h2","h3","h4","h5","h6","head","header","hgroup","hr","html","i","iframe","img","input","ins","kbd","label","legend","li","link","main","map","mark","menu","meta","meter","nav","noscript","object","ol","optgroup","option","output","p","picture","pre","progress","q","rp","rt","ruby","s","samp","script","search","section","select","slot","small","source","span","strong","style","sub","summary","sup","table","tbody","td","template","textarea","tfoot","th","thead","time","title","tr","track","u","ul","var","video","wbr","svg","path","g","rect","circle","ellipse","line","polyline","polygon","text","tspan","use","defs","stop","view","linearGradient","radialGradient","clipPath","mask","pattern","marker","symbol"])
function deriveVueComponentUsages(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "script_element" || n.type === "style_element") continue
    if (n.type === "element" || n.type === "self_closing_tag") {
      // tag_name lives INSIDE start_tag/self_closing_tag, not on the
      // element node itself.
      const container = n.namedChildren.find((c: any) => c.type === "start_tag" || c.type === "self_closing_tag")
      const tag = container?.namedChildren.find((c: any) => c.type === "tag_name")
      const name = tag?.text
      // vue framework builtins are rendering primitives, not components
      const VUE_BUILTINS = new Set(["component", "transition", "transition-group", "keep-alive", "teleport", "suspense", "fragment"])
      if (name && !ORACLE_HTML_TAGS.has(name) && !VUE_BUILTINS.has(name) && !seen.has(name)) {
        seen.add(name)
        edges.push({ label: "instantiates", from: "(expr)", target: name })
      }
      if (n.type === "self_closing_tag") continue
    }
    for (let k = 0; k < n.namedChildCount; k++) stack.push(n.namedChild(k))
  }
  return edges
}

// Svelte template component-usage oracle (independent HTML-core set;
// svelte:* and slot are framework primitives).
// M37.21 #611 svelte template-snippet truth: {#snippet name(...)} declares a
// callable; {@render name(...)} invokes it. The analyzer emits calls at the
// render site (render_tag branch); the embedded-JS oracle can't see template
// constructs, so this companion derives the SAME contract from the template:
// every render_tag target that matches a declared snippet is calls truth.
// Render targets with NO matching snippet are component-internal bindings
// (e.g. `children` from the $props() destructure) — not independently
// derivable as calls, so the oracle stays silent on them (they are covered
// by the analyzer's render_tag contract, not fabricated).
export function deriveSvelteSnippetCalls(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const snippets = new Set<string>()
  const renders: string[] = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "snippet_definition") {
      // {#snippet name(args)} — the name is the first identifier child
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && (c.type === "identifier" || c.type === "fragment_reference")) { snippets.add(c.text); break }
        if (c && c.type === "snippet_start_tag") {
          const tn = c.namedChildren?.find((x: any) => x.type === "identifier" || x.type === "snippet_name")
          if (tn) { snippets.add(tn.text); break }
        }
      }
    }
    if (n.type === "render_tag") {
      // render_tag content is opaque text — scan the identifier leaf
      const text = n.text.replace("{@render", "").trim()
      let end = 0
      while (end < text.length && /[A-Za-z0-9_$]/.test(text.slice(0, end + 1))) end++
      if (end > 0) renders.push(text.slice(0, end))
    }
    for (let k = 0; k < n.namedChildCount; k++) stack.push(n.namedChild(k))
  }
  for (const r of renders) {
    if (snippets.has(r) && !seen.has(r)) { seen.add(r); edges.push({ label: "calls", from: "(expr)", target: r }) }
  }
  return edges
}

// M49 W13: the DYNAMIC component/element target is mirrored here too.
// `<svelte:component this={X}/>` (and `this={X}` on `svelte:element`) names its
// component through an attribute, so the tag-name walk above never sees it -
// and both tags sit in VUE_STYLE_BUILTINS, so the pre-fix oracle emitted
// nothing for the construct while the analyzer's H2 rule emitted
// `instantiates X`. That asymmetry surfaced as the one unexplained edge W12's
// 400-file svelte measurement left open (corpus file:
// packages/svelte/tests/runtime-legacy/samples/event-handler-shorthand-dynamic-component/main.svelte).
// The analyzer's gates are mirrored exactly, because a superset here would
// trade an unexplained edge for a fabrication: the target must be a bare
// identifier that is an IMPORT BINDING. The analyzer also skips a target that
// resolves to a declared MEMBER (that case carries a `uses` edge instead) — but
// an ES module cannot both import and declare the same name, so a name that is
// import-bound can never trip that second gate, and a name that is not
// import-bound is rejected by this one. One gate, no dead branch.
export function deriveSvelteComponentUsages(
  root: any,
  importBindings?: Set<string>,
): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const VUE_STYLE_BUILTINS = new Set(["slot","svelte:component","svelte:self","svelte:element","svelte:window","svelte:document","svelte:body","svelte:head","svelte:options","svelte:fragment","svelte:boundary"])
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "script_element" || n.type === "style_element") continue
    if (n.type === "element" || n.type === "self_closing_tag") {
      const container = n.namedChildren.find((c: any) => c.type === "start_tag" || c.type === "self_closing_tag")
      const tag = container?.namedChildren.find((c: any) => c.type === "tag_name")
      const name = tag?.text
      if (name === "svelte:component" || name === "svelte:element") {
        const thisTag =
          n.namedChildren.find((c: any) => c.type === "start_tag") ??
          n.namedChildren.find((c: any) => c.type === "self_closing_tag")
        if (thisTag) {
          for (let i = 0; i < thisTag.namedChildCount; i++) {
            const attr = thisTag.namedChild(i)
            if (!attr || attr.type !== "attribute") continue
            const attrName = attr.namedChildren.find((c: any) => c.type === "attribute_name")
            if (attrName?.text !== "this") continue
            const valueNode =
              attr.namedChildren.find((c: any) => c.type === "expression") ??
              attr.namedChild(attr.namedChildCount - 1)
            if (!valueNode) continue
            let vt = String(valueNode.text).trim()
            if (vt.startsWith("{") && vt.endsWith("}")) vt = vt.slice(1, -1).trim()
            if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(vt)) continue
            if (!importBindings?.has(vt)) continue
            if (seen.has(vt)) continue
            seen.add(vt)
            edges.push({ label: "instantiates", from: "(expr)", target: vt })
          }
        }
      }
      if (name && !ORACLE_HTML_TAGS.has(name) && !VUE_STYLE_BUILTINS.has(name) && !seen.has(name)) {
        seen.add(name)
        edges.push({ label: "instantiates", from: "(expr)", target: name })
      }
    }
    for (let k = 0; k < n.namedChildCount; k++) stack.push(n.namedChild(k))
  }
  return edges
}

// M49 W12 svelte measurement blocker: this function created a FRESH Parser
// (and re-read both grammars) on every CALL, and the svelte/vue lanes call it
// twice per file (calls truth + structural truth) — four wasm allocations per
// file against a fixed-size heap. Measured 2026-09-13: `--repo svelte
// --sample 400` died at `RuntimeError: Out of bounds call_indirect
// (_ts_parser_new_wasm)` INSIDE this function, so an SFC lane could never be
// measured past the canonical 60-file rotation. Parsers are stateless between
// parses, so they are built once and reused (the same fix the per-language
// grammar cache above applies to lane parsers).
let EMBEDDED_SCRIPT_PARSERS: { js: any; ts: any; tsx: any } | null = null
export async function embeddedScriptParsers(): Promise<{ js: any; ts: any; tsx: any }> {
  if (EMBEDDED_SCRIPT_PARSERS) return EMBEDDED_SCRIPT_PARSERS
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const Lang = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const mk = async (wasm: string) => {
    const l = await Lang.load(fs.readFileSync(path.join(ROOT, "wasm", wasm)))
    const p = new P()
    p.setLanguage(l)
    return p
  }
  const parser = await mk("tree-sitter-javascript.wasm")
  const tsParser = await mk("tree-sitter-typescript.wasm")
  // #906: the JSX-capable grammar. Without it a `<script lang="tsx">` block is
  // parsed as JavaScript, where JSX recovers as relational expressions.
  const tsxParser = await mk("tree-sitter-tsx.wasm")
  EMBEDDED_SCRIPT_PARSERS = { js: parser, ts: tsParser, tsx: tsxParser }
  return EMBEDDED_SCRIPT_PARSERS
}

// Embedded-script truth for SFC languages.
//
// M49.#906: block extraction and grammar dispatch come from the ENGINE
// (`ASTEngine.extractSfcScriptBlocks` + its three-way `ts`/`tsx`/`js`
// dispatch), not from a second implementation here. The old local version had
// two defects that together were the whole of #906, and both were measured on
// element-plus's `<script lang="tsx" setup>` docs examples (probe:
// script/m14/tmp/vue906-probe.ts):
//
//   its lang test was /lang=["']ts["']/, which does NOT match `lang="tsx"`, so
//   a tsx block went to the JAVASCRIPT grammar — the same defect class #903
//   fixed in the analyzer, still live on the truth side; and
//   with no tsx parser at all, a JSX-bearing block had no way to be represented.
//
// Measured consequence per file (js parse -> tsx parse): ERROR nodes 23 -> 0 /
// 20 -> 0 / 25 -> 0; fabricated calls to `key`, `return`, `string`, `if` (all
// four are JSX recovery artifacts, none is a call in the source) appear only in
// the js parse; real calls (`generateColumns`, `generateData`, `Array.from`,
// `.map`) are present only in the tsx parse.
//
// Sharing the engine's extraction is not a loosening: WHICH grammar parses an
// SFC block is an input property of the pipeline, not a claim either side makes,
// and the analyzer receives exactly these trees. The truth derivation over them
// (deriveTypeScriptEdges) stays independent.
export async function deriveEmbeddedScriptTrees(root: any, content: string, lang: string): Promise<any[]> {
  const { js: parser, ts: tsParser, tsx: tsxParser } = await embeddedScriptParsers()
  const out: any[] = []
  const eng = await import("../../src/ast/engine")
  const blocks = (eng as any).ASTEngine.extractSfcScriptBlocks(root, content) as {
    body: string
    lang: string
  }[]
  for (const block of blocks) {
    if (!block.body || block.body.trim().length === 0) continue
    try {
      // the engine's own dispatch: `ts` -> typescript, `tsx` -> tsx, else js
      const sub = block.lang === "ts" ? tsParser : block.lang === "tsx" ? tsxParser : parser
      out.push(sub.parse(block.body).rootNode)
    } catch {
      /* a block the grammar refuses outright contributes no truth */
    }
  }
  return out
}

// C call-truth: a call_expression with an IDENTIFIER callee is an
// independently derivable call edge (function pointers excluded - opaque).
// M37.9 cpp oracle: independently re-derive the analyzer's CALLS and member-
// read USES truth so the fmt differential actually audits the surface the
// analyzer emits (11.8k calls on .cc alone were previously never compared —
// cpp sat outside the calls/uses compared-label sets). Contracts mirror
// RealCppAnalyzer exactly:
//   calls:     EVERY call_expression's callable leaf, except operator
//              targets (the analyzer drops operator-starting callees; infix/
//              explicit operator calls are additionally pinned-grammar
//              ERROR-recovered, ruled in the cpp spec). field_expression ->
//              field leaf; qualified_identifier -> last segment; identifier /
//              template_function -> base leaf. No resolvability gate (the
//              analyzer emits external/std leaves unconditionally, like C).
//   uses:      field_expression member READS (obj.field, obj->field) that are
//              not the callee of a call — assignment-LHS fields are writes
//              (no edge; mirrors the analyzer's call_expression callee guard
//              + SCD1-family write gate).
// Both sides walk the SAME pinned parse, so leaf-attribution disagreements
// surface as MISSING/UNEXPLAINED pairs for manual ruling.
//
// M37.21 #610 JVM oracle gap (master-review finding): java/kotlin/scala/groovy
// were the ONLY gated languages with no dedicated calls oracle — the generic
// deriveTreeEdges audited heritage/instantiates/overrides only, so the entire
// JVM call surface (the family's most important graph) was never compared.
// deriveJavaEdges audits it: every method_invocation, explicit constructor
// delegation (super/this/Foo.super), and method reference (T::m) derives an
// independent calls truth edge. The builtin/stdlib exclusion mirrors
// RealJavaAnalyzer.isJavaBuiltin EXACTLY (exact-match list + ROOT-segment
// STDLIB_ROOTS — M37.21 C5: root prefix only, never mid-chain segments) —
// that policy is a documented design decision (JLS-based,
// measured 4.2% fabrication without it); the oracle audits target FINDING,
// not the exclusion policy. Both sides walk the same pinned parse.
const JAVA_EXACT_BUILTINS = new Set([
  "System.out.println", "System.out.print", "System.out.printf",
  "System.err.println", "System.err.print",
  "System.exit", "System.gc", "System.currentTimeMillis",
  "System.nanoTime", "System.getProperty", "System.getenv",
  "System.identityHashCode", "System.arraycopy",
  "toString", "hashCode", "equals", "getClass", "notify", "notifyAll", "wait",
  "clone", "finalize",
])
const JAVA_STDLIB_ROOTS = new Set([
  "System", "String", "Integer", "Long", "Double", "Float", "Boolean",
  "Byte", "Short", "Character", "Math", "StrictMath", "Object", "Class",
  "Thread", "Runnable", "Runtime", "Process", "ProcessBuilder",
  "Throwable", "Error", "Exception", "StackTraceElement",
  "Enum", "Void", "Compiler", "Package",
  "ArrayList", "LinkedList", "HashMap", "HashSet", "TreeMap", "TreeSet",
  "LinkedHashMap", "LinkedHashSet", "WeakHashMap", "IdentityHashMap",
  "Collections", "Arrays", "Objects", "Optional", "OptionalInt",
  "OptionalLong", "OptionalDouble", "Stream", "Collectors", "Comparator",
  "Iterator", "ListIterator", "Spliterator", "Random", "UUID",
  "Date", "Calendar", "TimeZone", "Locale", "Currency",
  "Base64", "Scanner", "Formatter", "StringJoiner",
  "AbstractList", "AbstractMap", "AbstractSet", "AbstractCollection",
  "EnumMap", "EnumSet", "Queue", "Deque", "Stack", "Vector",
  "Hashtable", "Properties", "BitSet", "Dictionary",
  "List", "Map", "Set", "Collection", "Iterable",
  "File", "Files", "Path", "Paths", "InputStream", "OutputStream",
  "Reader", "Writer", "BufferedReader", "BufferedWriter",
  "FileInputStream", "FileOutputStream", "FileReader", "FileWriter",
  "ByteArrayInputStream", "ByteArrayOutputStream",
  "StringReader", "StringWriter", "PrintWriter", "PrintStream",
  "IOException", "FileNotFoundException", "EOFException",
  "URL", "URI", "HttpURLConnection", "URLEncoder", "URLDecoder",
  "Connection", "DriverManager", "ResultSet", "Statement",
  "PreparedStatement", "SQLException", "DataSource",
  "javax", "jakarta",
  "kotlin", "Unit", "Nothing", "Any", "Int", "String",
  "java", "jdk", "sun",
  "Logger", "LoggerFactory", "LogManager", "Level", "LogRecord",
  "Marker", "MDC", "NDC",
  "Override", "Deprecated", "SuppressWarnings", "SafeVarargs",
  "FunctionalInterface", "Nullable", "NotNull", "NonNls",
  "Test", "Before", "After", "BeforeClass", "AfterClass", "Ignore",
  "RunWith", "Suite", "Parameterized",
  "slf4j", "log4j", "logback",
])
function isJavaBuiltinCall(call: string): boolean {
  if (JAVA_EXACT_BUILTINS.has(call)) return true
  // M37.21 C5 mirror: ROOT segment only (see RealJavaAnalyzer.isJavaBuiltin).
  // M49.J3 mirror: org/com removed lockstep (reviewer wave — bare roots
  // dropped user FQ calls like org.apache.commons.io.FileUtils.readFile).
  const segments = call.split(".")
  if (segments.length > 0 && JAVA_STDLIB_ROOTS.has(segments[0])) return true
  if (JAVA_STDLIB_ROOTS.has(call)) return true
  return false
}
export function deriveJavaEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, target: string) => {
    if (!target) return
    const k = label + "|" + target
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }
  // Mirror of RealJavaAnalyzer.buildJavaCallExpression: qualified chain text
  // for builtin filtering (leaf extraction happens after the exclusion).
  const javaCallExpr = (n: any): string => {
    const obj = n.childForFieldName?.("object")
    const name = n.childForFieldName?.("name")
    if (!name) return n.text
    if (obj) {
      const objText = obj.type === "method_invocation" ? javaCallExpr(obj) : obj.text
      return `${objText}.${name.text}`
    }
    return name.text
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    if (t === "method_invocation") {
      const call = javaCallExpr(n)
      if (call && !isJavaBuiltinCall(call)) push("calls", call.split(".").pop() || call)
    } else if (t === "explicit_constructor_invocation") {
      // Mirror the analyzer: super(...)/this(...) keep the keyword target;
      // the qualified form Foo.super(...) keeps its receiver (unnamed keyword
      // children are read from node text — structural syntax, conf 1.0).
      const text = n.text.trim()
      let target = "super"
      if (text.startsWith("this")) target = "this"
      else if (!text.startsWith("super")) {
        const q = text.split("(")[0].trim().split(".")
        target = q[0] + ".super"
      }
      push("calls", target)
    } else if (t === "method_reference") {
      // Mirror: T::m emits calls to m (last named child) when a receiver
      // exists; constructor refs (int[]::new) have one named child only.
      const kids: any[] = []
      for (let i = 0; i < n.namedChildCount; i++) { const k = n.namedChild(i); if (k) kids.push(k) }
      if (kids.length >= 2) push("calls", kids[kids.length - 1].text)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return edges
}
// M37.21 #610 kotlin calls oracle: mirrors RealKotlinAnalyzer's call-graph
// contract exactly — buildKotlinCallExpression receiver.selector chains,
// leaf extraction, stdlib exclusion (stdlibPackagePrefixes + kotlinStdlibExact
// + kotlinBuiltinExtras for receiver-less calls), the MEASURED PascalCase
// construction rule (bare PascalCase callee = instantiates; qualified =
// calls), and constructor_delegation_call super/this edges.
const KOTLIN_STDLIB_PREFIXES = ["kotlin.", "kotlinx.", "java.", "javax.", "android.", "androidx."]
const KOTLIN_STDLIB_EXACT = new Set([
  "println", "print", "readLine", "require", "check", "error",
  "let", "run", "with", "apply", "also", "takeIf", "takeUnless",
  "toString", "equals", "hashCode", "copy", "componentN",
  "mutableMapOf", "mapOf", "mutableListOf", "listOf", "setOf", "mutableSetOf",
  "arrayOf", "emptyList", "emptyMap", "emptySet",
  "repeat", "uppercase", "lowercase", "trim", "startsWith", "endsWith",
  "contains", "substring", "map", "filter", "reduce", "fold", "forEach",
  "sorted", "sortedBy", "distinct", "first", "last", "add", "remove",
  "size", "isEmpty", "isNotEmpty", "put", "get", "getOrElse", "getOrDefault",
  "any", "all", "none", "count", "sum", "max", "min", "take", "drop",
])
const KOTLIN_BUILTIN_EXTRAS = new Set([
  "println", "print", "readLine", "require", "check", "error",
  "let", "run", "with", "apply", "also", "takeIf", "takeUnless",
  "toString", "equals", "hashCode", "copy", "componentN",
  "repeat", "uppercase", "lowercase", "trim",
  "mutableMapOf", "mapOf", "mutableListOf", "listOf", "setOf", "mutableSetOf",
  "arrayOf", "emptyList", "emptyMap", "emptySet",
])
function isKotlinStdlibCall(call: string): boolean {
  if (!call) return true
  for (const p of KOTLIN_STDLIB_PREFIXES) if (call.startsWith(p)) return true
  if (KOTLIN_STDLIB_EXACT.has(call)) return true
  if (!call.includes(".") && KOTLIN_BUILTIN_EXTRAS.has(call)) return true
  return false
}
export function deriveKotlinEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, target: string) => {
    if (!target) return
    const k = label + "|" + target
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }
  const kotlinCallExpr = (n: any): string => {
    // Mirror of RealKotlinAnalyzer.buildKotlinCallExpression: the DIRECT
    // navigation_expression child only (ERROR-recovered nested call chains
    // wrapping comments must never recurse — the analyzer reads the direct
    // callee path and falls back to text.split("(")[0]).
    const nav = n.namedChildren.find((c: any) => c.type === "navigation_expression")
    if (nav) {
      const receiver = nav.namedChild(0)
      let selector = nav.namedChild(nav.namedChildCount - 1)
      if (!receiver || !selector) return n.text
      if (selector.type === "navigation_suffix") {
        const inner = selector.namedChild(selector.namedChildCount - 1)
        if (!inner) return n.text
        selector = inner
      }
      const receiverText =
        receiver.type === "navigation_expression"
          ? kotlinNavText(receiver)
          : receiver.type === "call_expression"
            ? kotlinCallExpr(receiver)
            : receiver.text
      return `${receiverText}.${selector.text}`
    }
    const functionName = n.namedChildren.find((c: any) => c.type === "simple_identifier" || c.type === "identifier")
    return functionName ? functionName.text : n.text.split("(")[0]
  }
  const kotlinNavText = (n: any): string => {
    const receiver = n.namedChild(0)
    let selector = n.namedChild(n.namedChildCount - 1)
    if (!receiver || !selector) return n.text
    if (selector.type === "navigation_suffix") {
      const inner = selector.namedChild(selector.namedChildCount - 1)
      if (!inner) return n.text
      selector = inner
    }
    const receiverText = receiver.type === "navigation_expression" ? kotlinNavText(receiver) : receiver.text
    return `${receiverText}.${selector.text}`
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    if (t === "call_expression") {
      const call = kotlinCallExpr(n)
      const leaf = call.split(".").pop() || call
      const isQualified = call.includes(".")
      const isStdlib = KOTLIN_STDLIB_EXACT.has(call) || (!isQualified && KOTLIN_STDLIB_EXACT.has(leaf))
      if (call && call !== "print" && call !== "println" && !isStdlib) {
        const isPascal = leaf.length > 0 && leaf[0] >= "A" && leaf[0] <= "Z"
        if (isPascal && !isQualified) push("instantiates", leaf)
        else push("calls", leaf)
      }
    } else if (t === "constructor_delegation_call") {
      const text = n.text.trim()
      push("calls", text.startsWith("this") ? "this" : "super")
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return edges
}
// M37.21 #610 scala calls oracle: mirrors RealScalaAnalyzer.handleCall —
// quote/splice callee skip, curried-application wrapper skip (inner call
// emits, wrapper doesn't), field_expression leaf extraction, bracketed
// type-arg stripping, and the MEASURED companion-apply rule (bare PascalCase
// callee = instantiates; qualified obj.Method() = calls).
export function deriveScalaEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, target: string) => {
    if (!target) return
    const k = label + "|" + target
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    if (t === "call_expression") {
      const fnNode = n.childForFieldName?.("function")
      if (fnNode) {
        // Scala 3 quote/splice + backtick literals are never calls.
        if (!(fnNode.text.startsWith("'") || fnNode.text.startsWith("`"))) {
          // Curried wrapper: the INNER call is visited separately; deriving
          // from the wrapper would double-count (SCD7).
          if (fnNode.type !== "call_expression") {
            // M49.S1 #715 lockstep mirror: generic_function callees
            // (`foo.bar[Baz](1)`) extract the LAST identifier leaf BEFORE the
            // bracket strip — mirrors RealScalaAnalyzer.handleCall's S1.10
            // fix. Both sides emitted the dotted "foo.bar" before (shared
            // blind spot, probe s1-probe3).
            let calledName = ""
            let isQualified = false
            if (fnNode.type === "generic_function") {
              const kids: string[] = []
              const findLeaves = (nn: any): void => {
                if (nn.type === "identifier") { kids.push(nn.text); return }
                if (nn.type === "type_arguments") return
                for (let i = 0; i < nn.namedChildCount; i++) { const c = nn.namedChild(i); if (c) findLeaves(c) }
              }
              findLeaves(fnNode)
              if (kids.length > 0) {
                calledName = kids[kids.length - 1]
                isQualified = kids.length > 1
              }
            } else {
              calledName = fnNode.text
              isQualified = fnNode.type === "field_expression"
              if (isQualified) {
                const kids: string[] = []
                for (let i = 0; i < fnNode.namedChildCount; i++) {
                  const c = fnNode.namedChild(i)
                  if (c && c.type === "identifier") kids.push(c.text)
                }
                calledName = kids.length > 0 ? kids[kids.length - 1] : calledName
              }
            }
            // Strip bracketed type args iteratively (nested List[(A[B], C)]).
            let prevCalled: string | undefined
            do {
              prevCalled = calledName
              calledName = calledName.replace(/\[[^\[\]]*\]/g, "").trim()
            } while (calledName !== prevCalled)
            const first = calledName.charCodeAt(0)
            const isCapitalized = first >= 65 && first <= 90
            if (calledName) {
              if (isCapitalized && !isQualified) push("instantiates", calledName)
              else push("calls", calledName)
            }
          }
        }
      }
    } else if (t === "instance_expression") {
      // `new X` / `new X(...)` / `new X[T](...)` — mirror handleInstantiation:
      // generic supertypes collapse to the head, bracketed args stripped.
      const tn = n.namedChild(0)
      if (tn) {
        let name = tn.text
        if (tn.type === "generic_type" && tn.namedChildCount > 0) name = tn.namedChild(0).text
        let prevName: string | undefined
        do {
          prevName = name
          name = name.replace(/\[[^\[\]]*\]/g, "").replace(/<[^<>]*>/g, "").trim()
        } while (name !== prevName)
        if (name && name !== "unknown") push("instantiates", name)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return edges
}
// M37.21 #610 groovy calls oracle: mirrors RealGroovyAnalyzer's walk —
// method_invocation (object → buildGroovyQualifiedCall dotted path WITHOUT
// argument text; target is the bare methodName leaf), GROOVY_BUILTINS +
// STDLIB_ROOTS prefix filter, explicit_constructor_invocation honest
// literal ("super"/"this"), juxt_function_call (echo "msg" IS a call).
// M37.21 #611 typescript calls oracle: mirrors RealTypeScriptAnalyzer's
// call contract — call_expression with direct callee leaf (member_expression
// reduced to its property leaf), import()/require() excluded, TS_CONSOLE
// + TS_OBJECT_LEAF builtin sets (identical to the JS sets — verified by diff),
// malformed-call guard (hasBraceEquals), GLOBAL constructor calls kept (the
// analyzer filters only the same console/Object sets on the calls label).
export function deriveTypeScriptEdges(root: any): { label: string; from: string; target: string; fullCallee?: string }[] {
  const edges: { label: string; from: string; target: string; fullCallee?: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, target: string, fullCallee?: string) => {
    if (!target) return
    const k = label + "|" + target
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target, fullCallee }) }
  }
  const TS_CONSOLE_BUILTINS = new Set([
    "console.log", "console.warn", "console.error", "console.info", "console.debug",
    "console.trace", "console.table", "console.group", "console.groupEnd",
    "console.groupCollapsed", "console.time", "console.timeEnd", "console.assert",
    "console.count", "console.countReset", "console.dir", "console.dirxml",
    "console.clear", "console.profile", "console.profileEnd",
  ])
  const TS_OBJECT_LEAF_METHODS = new Set([
    "toString", "valueOf", "hasOwnProperty", "isPrototypeOf",
    "propertyIsEnumerable", "toLocaleString", "__defineGetter__", "__defineSetter__",
  ])
  const hasBraceEquals = (text: string): boolean => {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === "{" || ch === "}" || ch === ";" || ch === "=") return true
    }
    return false
  }
  const stripWhitespace = (s: string): string => {
    let out = ""
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") out += ch
    }
    return out
  }
  const isBuiltinCall = (targetName: string, fullCallee: string): boolean => {
    if (targetName === "super") return true
    if (TS_CONSOLE_BUILTINS.has(fullCallee)) return true
    if (TS_CONSOLE_BUILTINS.has(stripWhitespace(fullCallee))) return true
    if (TS_OBJECT_LEAF_METHODS.has(targetName)) return true
    return false
  }
  // M59 (#861): a decorator invocation is METADATA on the decorated symbol, not
  // a call — the python oracle already rules this way (PYD1) and the analyzer now
  // does too (inDecoratorPosition in real-typescript-analyzer.ts). Without this
  // mirror the analyzer's dropped edges would surface as fake MISSING rows
  // (`@inject("db")` is a call_expression in the tree). Walks up to the enclosing
  // statement boundary so a method's body is never treated as decorator position.
  const inDecoratorPosition = (n: any): boolean => {
    let p = n.parent
    while (p) {
      if (p.type === "decorator") return true
      if (
        p.type === "class_declaration" ||
        p.type === "abstract_class_declaration" ||
        p.type === "class" ||
        p.type === "function_declaration" ||
        p.type === "method_definition" ||
        p.type === "statement_block" ||
        p.type === "program"
      ) {
        return false
      }
      p = p.parent
    }
    return false
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    if (t === "call_expression" && !inDecoratorPosition(n)) {
      const callee = n.namedChild(0)
      // W2 mirror: computed member calls (cbs.doneEnter[trueSerialized](),
      // nodeTransforms[i](...)) are SKIPPED on the analyzer side (JS family
      // contract) — the oracle must skip them too or every skipped shape
      // surfaces as a fake MISSING edge (BaseTransition.spec.ts).
      // require() is a module dependency on BOTH analyzers (JS contract;
      // TS scripts never legitimately call require — vue-element-admin's
      // CommonJS .vue blocks would otherwise surface as fake MISSING).
      if (callee && callee.type !== "subscript_expression" && !((callee.text === "import" || callee.type === "import") || (callee.type === "identifier" && callee.text === "require"))) {
        let targetName = callee.text
        const fullCallee = callee.text
        if (callee.type === "member_expression") {
          const property = callee.childForFieldName("property")
          if (property) targetName = property.text
        }
        if (
          targetName.length <= 100 &&
          !targetName.includes("\n") &&
          !targetName.includes("`") &&
          !targetName.includes("${") &&
          !hasBraceEquals(targetName) &&
          !isBuiltinCall(targetName, fullCallee)
        ) push("calls", targetName, fullCallee)
      }
    } else if (t === "new_expression") {
      // Mirror of the analyzer's instantiation branch: generic_type head,
      // leaf segment, generic arguments stripped, GLOBAL_CTORS filtered.
      const ctor = n.namedChild(0)
      if (ctor) {
        let className = ctor.text
        if (ctor.type === "generic_type") className = ctor.namedChild(0)?.text ?? className
        const dot = className.lastIndexOf(".")
        if (dot !== -1 && dot < className.length - 1) className = className.slice(dot + 1)
        const lt = className.indexOf("<")
        if (lt !== -1) className = className.slice(0, lt)
        if (!TS_GLOBAL_CTORS.has(className)) push("instantiates", className)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return edges
}

// M37.21 #611 javascript calls oracle (web-family twin of the TS oracle —
// same call_expression contract with JS naming: require()/import() excluded
// on the ANALYZER side as imports; subscript callees skipped; the two builtin
// sets are identical to TS's — verified by diff).
export function deriveJavaScriptEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, target: string) => {
    if (!target) return
    const k = label + "|" + target
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }
  const JS_CONSOLE_BUILTINS = new Set([
    "console.log", "console.warn", "console.error", "console.info", "console.debug",
    "console.trace", "console.table", "console.group", "console.groupEnd",
    "console.groupCollapsed", "console.time", "console.timeEnd", "console.assert",
    "console.count", "console.countReset", "console.dir", "console.dirxml",
    "console.clear", "console.profile", "console.profileEnd",
  ])
  const JS_OBJECT_LEAF_METHODS = new Set([
    "toString", "valueOf", "hasOwnProperty", "isPrototypeOf",
    "propertyIsEnumerable", "toLocaleString", "__defineGetter__", "__defineSetter__",
  ])
  const hasBraceEquals = (text: string): boolean => {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === "{" || ch === "}" || ch === ";" || ch === "=") return true
    }
    return false
  }
  const stripWhitespace = (s: string): string => {
    let out = ""
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") out += ch
    }
    return out
  }
  const isBuiltinCall = (targetName: string, fullCallee: string): boolean => {
    if (targetName === "super") return true
    if (JS_CONSOLE_BUILTINS.has(fullCallee)) return true
    if (JS_CONSOLE_BUILTINS.has(stripWhitespace(fullCallee))) return true
    if (JS_OBJECT_LEAF_METHODS.has(targetName)) return true
    return false
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    // M49 #868, acceptance item 3's second half — "the javascript oracle
    // `deriveJavaScriptEdges` needs the same guard".
    //
    // The ANALYZER rules a decorator invocation METADATA on the decorated symbol,
    // so `@inject(DB)` yields no `calls` edge, no `uses` for the decorator's own
    // name and none for its argument: `processNode` calls
    // `RealJavaScriptAnalyzer.inDecoratorPosition(n)` FIRST and returns, which
    // skips the ENTIRE decorator subtree. The TYPESCRIPT mirror in this file has
    // the matching per-node guard; the JAVASCRIPT mirror did not, and both of its
    // edge kinds leaked from decorator position. Measured
    // (`script/m59/verify-868-js-oracle-decorator.ts`) before this change: oracle
    // `calls ["inject", "make"]` against the analyzer's `["make"]`, and oracle
    // `uses` including `DB` (a decorator ARGUMENT) and `sealed` (a bare decorator
    // name) which the analyzer emits as one `references` edge each instead.
    //
    // It was LATENT, which is why nothing caught it: the corpus lanes sample plain
    // `.js` from the web repos, which contain no class-body decorators (the #861
    // sweep found one affected file in 9,065), and the fixture lanes compare the
    // analyzer against its EXPECTATION — never against the oracle.
    //
    // Expressed as a whole-subtree skip rather than a per-node ancestor walk,
    // because that is literally what the analyzer does, and because the JS grammar
    // nests a decorator INSIDE `class_declaration` / `field_definition` /
    // `method_definition` (unlike TS, where method decorators are class-body
    // children) — so a decorator node is always reached by this traversal, and
    // skipping it here cannot miss one. Both edge kinds are covered by
    // construction rather than by a guard per branch.
    if (t === "decorator") continue
    if (t === "call_expression") {
      const fn = n.childForFieldName("function")
      const isImportCallee = !!fn && (fn.type === "import" || (fn.type === "identifier" && fn.text === "import"))
      const isRequire = !!fn && fn.type === "identifier" && fn.text === "require"
      if (fn && !isRequire && !isImportCallee) {
        let targetName = fn.text
        const fullCallee = fn.text
        if (fn.type === "member_expression") {
          const prop = fn.childForFieldName("property")
          if (prop) targetName = prop.text
        }
        if (
          fn.type !== "subscript_expression" &&
          targetName.length <= 100 &&
          !targetName.includes("\n") &&
          !targetName.includes("`") &&
          !targetName.includes("${") &&
          !hasBraceEquals(targetName) &&
          !isBuiltinCall(targetName, fullCallee)
        ) push("calls", targetName)
      }
    }
    // M49 #744 mirror (web fix wave, java #739 family contract): member
    // READ truth with the analyzer's exact gates — not a call callee, not
    // an assignment LHS (JSD1 write), emits EVERY chain segment INCLUDING
    // the root identifier (the pre-fix parity blind spot: the lane never
    // audited uses at all, so the dropped root was invisible).
    if (t === "member_expression") {
      const p7 = n.parent
      const calleeFn = p7?.type === "call_expression" ? p7.childForFieldName("function") : null
      const isCallee = !!calleeFn && calleeFn.id === n.id
      let isWrite = false
      if (p7?.type === "assignment_expression" || p7?.type === "augmented_assignment_expression") {
        const lhs = p7.childForFieldName("left") ?? p7.namedChild(0)
        isWrite = !!lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
      }
      if (!isCallee && !isWrite) {
        // flatten the chain: segments + root
        const parts: string[] = []
        let cur: any = n
        while (cur && cur.type === "member_expression") {
          const prop = cur.childForFieldName("property")
          if (prop) parts.unshift(prop.text)
          cur = cur.childForFieldName("object")
        }
        const head = cur ? cur.text : ""
        for (const seg of parts) push("uses", seg)
        // M49 W1 (#768) mirror: a head that is not an identifier (a call or a
        // literal) is not a symbol — the analyzer stopped emitting it as a
        // target, so the truth must not derive it either (lockstep).
        if (head && head !== "this" && head !== "super" && cur && cur.type === "identifier") push("uses", head)
      }
    }
    // M49 #744 mirror: BARE identifier reads (return config; / if (flag)) —
    // identical gate set to the analyzer: not a call callee, not an
    // assignment LHS, not a declaration name (function/variable/class),
    // not this/super/undefined/arguments, not object keys (pair/pair_pattern
    // key), not member parts, not labels, not shorthand properties.
    if (t === "identifier") {
      const txt = n.text
      if (txt !== "this" && txt !== "super" && txt !== "undefined" && txt !== "arguments") {
        const p7 = n.parent
        const calleeFn = p7?.type === "call_expression" ? p7.childForFieldName("function") : null
        const isCallee = !!calleeFn && calleeFn.id === n.id
        let isWrite2 = false
        if (p7?.type === "assignment_expression" || p7?.type === "augmented_assignment_expression") {
          const lhs2 = p7.childForFieldName("left") ?? p7.namedChild(0)
          isWrite2 = !!lhs2 && lhs2.id === n.id
        }
        const isDeclName = (p7?.type === "variable_declarator" && p7.childForFieldName("name")?.id === n.id) ||
          p7?.type === "function_declaration" || p7?.type === "function_expression" ||
          p7?.type === "generator_function_declaration" || p7?.type === "generator_function" ||
          p7?.type === "method_definition" ||
          p7?.type === "class_declaration" || p7?.type === "class"
        const isPropKey = (p7?.type === "pair" || p7?.type === "pair_pattern") && p7.childForFieldName("key")?.id === n.id
        const isMemberPart = p7?.type === "member_expression"
        const isPropName = p7?.type === "property_signature" || p7?.type === "property_identifier"
        const isLabel = p7?.type === "labeled_statement"
        const isShorthandProp = p7?.type === "shorthand_property_identifier"
        // M49 W1 (#768 binding-site wave) mirror: binding positions are
        // DEFINITIONS — import bindings, parameters, catch params,
        // destructuring targets and export specifiers are never reads.
        // The #744 mirror carried the analyzer's fabrication in lockstep,
        // so the lane agreed on a wrong contract (collusion blind spot).
        const isImportBinding = p7?.type === "import_clause" || p7?.type === "import_specifier" || p7?.type === "namespace_import"
        const isParamBinding = p7?.type === "formal_parameters" || p7?.type === "arrow_function" || p7?.type === "catch_clause"
        const isPatternBinding =
          p7?.type === "rest_pattern" || p7?.type === "array_pattern" || p7?.type === "pair_pattern" ||
          (p7?.type === "assignment_pattern" && (p7.childForFieldName("left") ?? p7.namedChild(0))?.id === n.id)
        const isExportSpecifier = p7?.type === "export_specifier"
        const isBindingSite = isImportBinding || isParamBinding || isPatternBinding || isExportSpecifier
        if (!isCallee && !isWrite2 && !isDeclName && !isPropKey && !isMemberPart && !isPropName && !isLabel && !isShorthandProp && !isBindingSite) {
          push("uses", txt)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return edges
}

// Analyzer's JS_GLOBAL_CONSTRUCTORS set — shared with the instantiation mirror.
const TS_GLOBAL_CTORS = new Set([
  "Promise", "Date", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "Proxy",
  "Error", "TypeError", "RangeError", "SyntaxError", "URIError", "EvalError",
  "AggregateError", "RegExp", "Array", "Object", "Function", "Boolean",
  "Number", "String", "BigInt", "ArrayBuffer", "SharedArrayBuffer",
  "DataView", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array",
  "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
  "BigInt64Array", "BigUint64Array", "WeakRef", "FinalizationRegistry",
  "AbortController", "FormData", "Blob", "File", "URL", "URLSearchParams",
  "Headers", "Request", "Response", "Intl", "Image", "Worker", "SharedWorker",
  "CustomEvent", "Event", "MouseEvent", "KeyboardEvent", "ResizeObserver",
  "MutationObserver", "IntersectionObserver", "PerformanceObserver",
  "FileReader", "XMLHttpRequest", "WebSocket", "TextEncoder", "TextDecoder",
  "DOMParser", "Notification", "BroadcastChannel", "MessageChannel",
  "FocusEvent", "InputEvent", "PointerEvent", "TouchEvent", "DragEvent", "ErrorEvent", "UIEvent", "StorageEvent", "PromiseRejectionEvent", "HashChangeEvent", "PageTransitionEvent", "PopStateEvent", "ProgressEvent", "SpeechSynthesisEvent", "AnimationEvent", "TransitionEvent", "ClipboardEvent", "WheelEvent", "CompositionEvent", "BeforeUnloadEvent",
])

// #841-round-14 mirror (M49 W22, measured: 7 MISSING `calls` across grails-core
// and geb rotation samples): the typed-closure-parameter misparse. When a
// closure's bare-name parameter type cannot win its reading, the parser folds
// `{ Method widgetMethod -> … }` into juxt_function_call(name: Method,
// args: (widgetMethod)) — the juxt name is the parameter's TYPE, not a callee,
// so any `calls` truth derived from it is a fabrication. The analyzer's
// looksLikeTypedClosureMisparse suppresses it (962 corpus juxt nodes verified,
// every one a real parameter list); truth must mirror with the same
// discriminator: type-cased head, identifier-only args, and the SOURCE tail
// (param-list material then the closure arrow) with the measured tree
// compositions as fallback.
function groovyTypedClosureMisparse(juxtNode: any, nameNode: any, sourceText?: string): boolean {
  const nameText = String(nameNode.text).trim()
  if (!/^[A-Z][A-Za-z0-9_]*(\.[A-Z][A-Za-z0-9_]*)*$/.test(nameText)) return false
  const argsNode = juxtNode.childForFieldName?.("args")
  if (!argsNode) return false
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*(\s*,\s*[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*)*$/.test(String(argsNode.text).trim())) return false
  if (sourceText != null) {
    const tail = sourceText.slice(juxtNode.endIndex, juxtNode.endIndex + 160)
    const arrow = tail.indexOf("->")
    if (arrow >= 0) {
      const between = tail.slice(0, arrow)
      if (/^[\s,.<>\[\]A-Za-z0-9_]*$/.test(between)) return true
    }
  }
  const parent = juxtNode.parent
  if (!parent) return false
  if (juxtNode.nextSibling?.type === "->") return true
  const siblings: any[] = []
  for (let i = 0; i < parent.namedChildCount; i++) {
    const c = parent.namedChild(i)
    if (c) siblings.push(c)
  }
  const idx = siblings.findIndex((s: any) => s.id === juxtNode.id)
  if (idx === -1) return false
  const next = siblings[idx + 1]
  if (next != null && next.type === "lambda_expression") return true
  if (idx === 0 && (parent.type === "closure" || parent.type === "block")) return true
  return false
}
export function deriveGroovyEdges(root: any, sourceText?: string): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, target: string) => {
    if (!target) return
    const k = label + "|" + target
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }
  // Mirror of GROOVY_BUILTINS + STDLIB_ROOTS prefix filter (analyzer lines 46/1096).
  const GROOVY_BUILTINS = new Set([
    "println", "print", "printf", "sprintf",
    "assert", "sleep", "synchronized",
    "toString", "hashCode", "equals", "getClass", "notify", "notifyAll",
    "wait", "clone", "finalize",
    "System.out.println", "System.out.print", "System.out.printf",
    "System.err.println", "System.err.print",
    "System.exit", "System.gc", "System.currentTimeMillis", "System.nanoTime",
    "System.getProperty", "System.getenv", "System.identityHashCode",
    "System.arraycopy", "System.lineSeparator",
  ])
  const STDLIB_ROOTS = new Set([
    "System", "String", "Integer", "Long", "Double", "Float", "Boolean",
    "Byte", "Short", "Character", "Math", "StrictMath", "Object", "Class",
    "Thread", "Runnable", "Runtime", "Process", "ProcessBuilder",
    "Throwable", "Error", "Exception", "StackTraceElement",
    "Enum", "Void", "Compiler", "Package",
    "ArrayList", "LinkedList", "HashMap", "HashSet", "TreeMap", "TreeSet",
    "LinkedHashMap", "LinkedHashSet", "ArrayDeque", "PriorityQueue",
    "Collections", "Arrays", "Objects", "Optional", "Comparator",
    "List", "Map", "Set", "Collection", "Iterator", "Iterable",
    "Calendar", "Date", "UUID", "Locale", "Currency",
    "File", "Path", "Paths", "Files",
    "BigDecimal", "BigInteger", "AtomicInteger", "AtomicLong",
    "StringBuilder", "StringBuffer", "Pattern", "Matcher", "Random",
    "Logger", "Level", "OutputStream", "InputStream", "Reader", "Writer",
    "URL", "URI", "Socket", "ServerSocket",
  ])
  const isBuiltin = (call: string): boolean => {
    if (GROOVY_BUILTINS.has(call)) return true
    const firstDot = call.indexOf(".")
    const rootSeg = firstDot > 0 ? call.slice(0, firstDot) : call
    return STDLIB_ROOTS.has(rootSeg)
  }
  // Mirror of buildGroovyQualifiedCall: dotted path WITHOUT argument text.
  const qualifiedCall = (objectNode: any, methodName: string): string => {
    if (!objectNode) return methodName
    if (objectNode.type === "method_invocation") {
      const innerName = objectNode.childForFieldName?.("name")
      const innerObject = objectNode.childForFieldName?.("object")
      const base = qualifiedCall(innerObject, innerName?.text ?? "")
      return `${base}.${methodName}`
    }
    return `${objectNode.text}.${methodName}`
  }
  // G7 mirror: interpolation reads. Before the grammar fix there was nothing to
  // mirror — `string_fragment` swallowed `$` and `{`, so no interpolated name
  // could reach the analyzer and this oracle was green by blindness. The
  // analyzer now reads a BARE name (`$name`, `${name}`) and DEFERS member/call
  // positions to the field-access and call walks, so the mirror must skip
  // exactly the identifiers those walks own — a mirror that read `${o.p}` again
  // would invent an edge the analyzer never emits, and one that missed the bare
  // local would leave the real edge unexplained. Both rules are the analyzer's,
  // copied rather than re-derived: the same five owning parents, the same
  // bound-name climb (through nested closures, stopping at the type boundary),
  // and the same owner gate — a script-level interpolation has no owner, so it
  // emits nothing and the oracle must agree (probe: `def s = "${unknownName}"`
  // at script level emits no edge, while the same line inside a class method
  // emits `uses m -> unknownName`).
  const INTERP_OWNED_BY_MEMBER_WALK = new Set([
    "field_access", "method_invocation", "juxt_function_call",
    "array_access", "object_creation_expression",
  ])
  const groovyBoundNames = (n: any): Set<string> => {
    const acc = new Set<string>()
    let p = n.parent
    let guard = 0
    while (p && guard++ < 24) {
      const pt = p.type
      if (pt === "method_declaration" || pt === "constructor_declaration" ||
          pt === "function_definition" || pt === "lambda_expression" ||
          pt === "closure" || pt === "program") {
        const work: any[] = []
        for (let i = 0; i < p.namedChildCount; i++) { const c = p.namedChild(i); if (c) work.push(c) }
        while (work.length > 0) {
          const m = work.pop()
          if (m.type === "formal_parameter" || m.type === "catch_formal_parameter" || m.type === "variable_declarator") {
            const nm = m.childForFieldName?.("name")
            if (nm) acc.add(nm.text)
          }
          for (let i = 0; i < m.namedChildCount; i++) { const c = m.namedChild(i); if (c) work.push(c) }
        }
        if (pt === "closure") acc.add("it")
      }
      if (pt === "class_declaration" || pt === "interface_declaration" ||
          pt === "trait_declaration" || pt === "enum_declaration") break
      p = p.parent
    }
    return acc
  }
  // The analyzer's `method ?? owner`, which is what decides whether a read has a
  // source at all. It is NOT "has an enclosing method": the walk writes `method`
  // from a method_declaration's DIRECT `identifier` child (findChild is
  // direct-children-only) and `owner` from a type declaration's, so a declaration
  // whose name is not an identifier leaves the source null and the read is
  // silently dropped. Measured on the corpus (probe: BB_G7_DEBUG over
  // grails-core/…/RestfulResourceMappingSpec.groovy): `$town` is VISITED with
  // parentType=string_literal, bound=false, candidates=1 — and source=null,
  // because a Spock feature method is named by a `string_literal` and the file
  // fails to parse as one whole-file ERROR node, so no class context survives
  // either. That file's reads are therefore honestly absent from the analyzer,
  // and a mirror that only asked "is there a method above me?" would report four
  // phantom truths corpus-wide (measured: 4 in 2 of 8,383 files). Climb and
  // return the nearest written name, method-kind or type-kind, exactly as the
  // walk's `method ?? owner` resolves.
  const groovySourceName = (n: any): string | null => {
    let p = n.parent
    let guard = 0
    while (p && guard++ < 40) {
      const pt = p.type
      if (pt === "method_declaration" || pt === "constructor_declaration" ||
          pt === "function_definition" || pt === "class_declaration" ||
          pt === "interface_declaration" || pt === "trait_declaration" ||
          pt === "enum_declaration") {
        for (let i = 0; i < p.namedChildCount; i++) {
          const c = p.namedChild(i)
          if (c && c.type === "identifier") return c.text
        }
      }
      p = p.parent
    }
    return null
  }
  const groovyHasOwner = (n: any): boolean => groovySourceName(n) !== null
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    if (t === "field_access") {
      // Mirror of collectFieldAccessUses (analyzer): the target is the LAST
      // dotted segment; a write LHS and a callee position are not reads; `?.`
      // and `*.` carry their operator in the text, so it is stripped before the
      // split. Owner resolution is deliberately NOT mirrored — the harness
      // matches label+target site-agnostically, so only membership matters.
      const pType = n.parent ? n.parent.type : ""
      let fIsWrite = false
      if (pType === "assignment_expression") {
        const lhs = n.parent.namedChild(0)
        fIsWrite = !!lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
      }
      const parentField = n.parent && n.parent.type === "juxt_function_call"
        ? n.parent.childForFieldName?.("name")
        : null
      const fIsCallee = !!parentField && parentField.startIndex === n.startIndex && parentField.endIndex === n.endIndex
      const fParts = String(n.text).split(".").map((p: string) => (p.endsWith("?") || p.endsWith("*") ? p.slice(0, -1) : p))
      if (fParts.length >= 2 && !fIsWrite && !fIsCallee && fParts[fParts.length - 1]) push("uses", fParts[fParts.length - 1])
    } else if (t === "leading_dot_call") {
      // #851: a continuation segment is a CALL only with an argument list
      // (`.build(1)`); a paren-less `.label` is a member READ. BOTH live in this
      // one arm. There used to be a separate calls-only arm for this node type
      // further down the chain; adding the read arm in front of it made that one
      // UNREACHABLE — two `else if`s on the same node type never both fire — and
      // calls truth silently stopped being derived for paren-ful continuations.
      // Caught by the corpus lane, not by reading the diff: three `calls` edges
      // surfaced as unexplained on the grails-core groovy lane. The arms are
      // merged here so the class cannot recur.
      const ldName = n.childForFieldName?.("name")
      const ldArgs = n.childForFieldName?.("arguments")
        ?? (n.namedChildren ?? []).find((c: any) => c.type === "argument_list")
      if (ldName && !isBuiltin(ldName.text)) {
        if (ldArgs) push("calls", ldName.text)
        else push("uses", ldName.text)
      }
    } else if (t === "array_access") {
      // KAD1 sweep (M37 #597) mirror: a read of the array expression is a use;
      // the assignment-LHS span is a write and must not emit.
      const aType = n.parent ? n.parent.type : ""
      let aIsWrite = false
      if (aType === "assignment_expression") {
        const lhs = n.parent.namedChild(0)
        aIsWrite = !!lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
      }
      const aFirst = n.namedChild(0)
      if (!aIsWrite && aFirst && aFirst.type === "identifier") push("uses", aFirst.text)
    } else if (t === "interpolated_identifier") {
      const pt = n.parent ? n.parent.type : ""
      if (pt !== "juxt_function_call" && pt !== "field_access" && groovyHasOwner(n)) {
        const raw = String(n.text)
        const nm = raw.startsWith("$") ? raw.slice(1) : raw
        if (nm && !groovyBoundNames(n).has(nm)) push("uses", nm)
      }
    } else if (t === "string_interpolation") {
      const collect = (m: any): void => {
        if (m.type === "identifier") {
          const pt = m.parent ? m.parent.type : ""
          if (!INTERP_OWNED_BY_MEMBER_WALK.has(pt) && groovyHasOwner(m) && !groovyBoundNames(m).has(m.text)) {
            push("uses", m.text)
          }
          return
        }
        for (let i = 0; i < m.namedChildCount; i++) { const c = m.namedChild(i); if (c) collect(c) }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) collect(c) }
    } else if (t === "method_invocation") {
      const nameNode = n.childForFieldName?.("name")
      if (nameNode) {
        const methodName = nameNode.text
        const objectNode = n.childForFieldName?.("object")
        const callExpr = qualifiedCall(objectNode, methodName)
        if (!isBuiltin(callExpr)) push("calls", methodName)
      }
    } else if (t === "explicit_constructor_invocation") {
      const first = n.namedChild(0)
      if (first && (first.type === "super" || first.type === "this")) push("calls", first.type)
    } else if (t === "juxt_function_call") {
      const nameNode = n.childForFieldName?.("name")
      if (nameNode && !isBuiltin(nameNode.text)) {
        // #852: the family contract is a BARE callee leaf. A dotted juxt name
        // parses as field_access (`helper.build "x"`, and every continued
        // dotted chain), so the whole dotted text used to become the target.
        const leaf = nameNode.type === "field_access"
          ? nameNode.childForFieldName?.("field") ?? nameNode
          : nameNode
        // M49 W22 (#841-round-14 mirror): the typed-closure-parameter misparse
        // (`{ Method widgetMethod -> … }` → juxt(name: Method, args: …)) names
        // the parameter's TYPE — no callee truth (see the helper for the
        // measured discriminator and counts).
        if (!groovyTypedClosureMisparse(n, nameNode, sourceText)) push("calls", leaf.text)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return edges
}
export function deriveCppEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const lastNamed = (n: any): any => n.namedChild(n.namedChildCount - 1)
  // CPPD2 (probe): field LHS of an assignment is a write designator.
  const isAssignLhsField = (n: any): boolean => {
    const p = n.parent
    if (!p) return false
    const isWriteParent =
      p.type === "assignment_expression" || p.type === "compound_assignment_expression"
    if (!isWriteParent) return false
    const lhs = p.namedChild(0)
    return !!lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "call_expression") {
        const fn = n.childForFieldName?.("function") ?? n.namedChild(0)
        let target = ""
        if (fn) {
          // CPPD13 mirror: the CALLEE LEAF is the bare name — template args
          // (m<int>), nested `::` chains (std::numeric_limits<X>::lowest),
          // and defense-parentheses ((X)() — Windows min/max) must all
          // unwrap to the innermost identifier. Mirrors the analyzer's
          // calleeLeaf exactly so leaf attribution stays one contract.
          const calleeLeaf = (x: any): string => {
            let cur = x
            let guard = 0
            while (cur && guard++ < 8) {
              const t = cur.type
              if (t === "field_expression") {
                const f = cur.childForFieldName?.("field") ?? cur.namedChild(cur.namedChildCount - 1)
                if (!f) return ""
                cur = f
                continue
              }
              if (t === "template_function" || t === "template_method") {
                const base = cur.namedChild(0)
                if (!base) return ""
                cur = base
                continue
              }
              // `loc.template get<T>()` — the `template` disambiguator makes
              // the member a dependent_name wrapping the template_method.
              if (t === "dependent_name" && cur.namedChildCount >= 1) {
                const inner = cur.namedChild(0)
                if (inner && (inner.type === "template_method" || inner.type === "template_function" || inner.type === "identifier" || inner.type === "field_identifier")) {
                  cur = inner
                  continue
                }
                return ""
              }
              if (t === "qualified_identifier" && cur.namedChildCount >= 1) {
                cur = cur.namedChild(cur.namedChildCount - 1)
                continue
              }
              if (t === "parenthesized_expression" && cur.namedChildCount >= 1) {
                cur = cur.namedChild(0)
                continue
              }
              // #924 mirror: a descent that ends anywhere but a NAME-BEARING
              // node found no named callee — the analyzer emits nothing, so
              // truth must derive nothing (a lambda callee, an element call, a
              // compound literal, an assignment, a mis-nested binary
              // expression: all source text, never a name).
              if (t === "identifier" || t === "field_identifier" || t === "type_identifier" ||
                  t === "operator_name" || t === "destructor_name" || t === "namespace_identifier") {
                // #924 mirror: a builtin TYPE keyword is not a function name —
                // the grammar classifies `unsigned(x)` as an `identifier`
                // callee, and the analyzer refuses it, so truth must too.
                if (t === "identifier" && CPP_BUILTIN_TYPE_KEYWORDS.has(cur.text)) return ""
                return cur.text
              }
              return ""
            }
            return ""
          }
          if (fn) target = calleeLeaf(fn)
          // CPPD13 mirror: functor-temporary invocation — the callee is itself
          // a call_expression (std::forward<F>(f)(args), Op<int>()(a,b)) whose
          // effective target is an anonymous operator(). No named callee
          // (CPP-D9 ruling); the inner construction call emits separately.
          if (fn && fn.type === "call_expression") target = ""
          // Pointer-to-member invocation ((declval<Class*>()->*pmf)()) —
          // ERROR-recovered by the pinned grammar, callee only knowable at
          // runtime (C fn-pointer class). No trustworthy leaf.
          if (fn && fn.hasError) target = ""
        }
        if (target && !target.startsWith("operator")) {
          const k = "calls|" + target
          if (!seen.has(k)) { seen.add(k); edges.push({ label: "calls", from: "(expr)", target }) }
        }
      } else if (n.type === "field_expression") {
      // member READ unless this field_expression is a call callee or a write
      // LHS (analyzer: uses on obj.field only when not the call function).
      const p = n.parent
      const isCallee = !!p && p.type === "call_expression"
      const f = n.childForFieldName?.("field") ?? lastNamed(n)
      if (f && !isCallee && !isAssignLhsField(n)) {
        const k = "uses|" + f.text
        if (!seen.has(k)) { seen.add(k); edges.push({ label: "uses", from: "(expr)", target: f.text }) }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return edges
}

export function deriveCppBareUses(root: any): { label: string; from: string; target: string }[] {
  // CP1 mirror (cpp review): bare value reads (`return g;`) — the analyzer
  // and this oracle were BOTH blind to them (the oracle audited only calls
  // and member reads). Same contract as the analyzer, rule for rule:
  // declaration positions (leftmost-declarator), call callees (span),
  // member leaves (span), qualified reads (limitation), preprocessor text,
  // labels, attributes, lambda-capture bindings, assignment-LHS writes —
  // shadowing via walk-order function locals/params, resolvability via
  // file-scope values / enclosing-class members / namespace rules.
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const fileScopeValues = new Set<string>()
  const namespaceValues = new Map<string, Set<string>>()
  const classMembers = new Map<string, Set<string>>()
  const usedNamespaces = new Set<string>()
  const pendingQualified: Array<{ name: string; scope: string }> = []
  const leftmostId = (n: any): string | null => {
    let cur: any = n
    while (cur) {
      if (cur.type === "identifier" || cur.type === "field_identifier") return cur.text
      cur = cur.childForFieldName?.("declarator") ?? cur.namedChild(0)
    }
    return null
  }
  const tname = (n: any): string | null => {
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) {
      const c = n.namedChild(i)
      if (c && c.type === "type_identifier") return c.text
    }
    return null
  }
  // Scope cleaning (mirrors the analyzer's getFunctionDetails template_type
  // handling): `FloatingPoint<float>::Max` scopes to FloatingPoint, not the
  // full argument list. Shared by the pre-pass flush and the CP5 main-walk
  // class scope below (one definition — they must compute identical keys).
  const cleanScope = (node: any): string | null => {
    if (!node) return null
    if (node.type === "template_type") {
      const tn = node.childForFieldName?.("name")?.text ??
        (node.namedChildren ?? []).find((c: any) => c.type === "type_identifier")?.text ??
        (() => { const lt = node.text.indexOf("<"); return lt > 0 ? node.text.slice(0, lt).trim() : node.text })()
      return tn ?? null
    }
    return node.text?.split("::").filter(Boolean).pop() ?? null
  }
  {
    const pre: any[] = [{ n: root, ns: [], inFn: false, inClass: null }]
    while (pre.length > 0) {
      const { n, ns, inFn, inClass } = pre.pop()!
      const t = n.type
      const addValue = (name: string, nss: string[], cls: string | null): void => {
        if (!name) return
        if (cls) {
          let s = classMembers.get(cls)
          if (!s) { s = new Set(); classMembers.set(cls, s) }
          s.add(name)
          return
        }
        if (nss.length > 0) {
          const top = nss[nss.length - 1]
          let s = namespaceValues.get(top)
          if (!s) { s = new Set(); namespaceValues.set(top, s) }
          s.add(name)
          return
        }
        fileScopeValues.add(name)
      }
      if (t === "namespace_definition") {
        const nm = tname(n) ?? n.namedChildren?.find((c: any) => c.type === "namespace_identifier")?.text
        if (nm && nm !== "anonymous") {
          for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) pre.push({ n: c, ns: [...ns, nm], inFn, inClass }) }
          continue
        }
      } else if (t === "class_specifier" || t === "struct_specifier" || t === "union_specifier") {
        // CPPD1 mirror: explicit/partial specialization names live in
        // template_type (`Matcher<const std::string&>`), not a bare
        // type_identifier — without the fallback the members (e.g. the
        // specialization's own ctors) misattribute to file scope and the
        // class-head name reads as a value use (MISSING uses on truth).
        const tt = (n.namedChildren ?? []).find((c: any) => c.type === "template_type")
        const ttn = tt ? (tt.childForFieldName?.("name")?.text ??
          (tt.namedChildren ?? []).find((c: any) => c.type === "type_identifier" || c.type === "qualified_identifier")?.text ??
          (() => { const lt = tt.text.indexOf("<"); return lt > 0 ? tt.text.slice(0, lt).trim() : null })()) : null
        const nm = tname(n) ?? ttn ?? null
        const hasBody = (n.namedChildren ?? []).some((c: any) => c.type === "class_body" || c.type === "field_declaration_list")
        if (nm && hasBody) {
          for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) pre.push({ n: c, ns, inFn, inClass: nm }) }
          continue
        }
      } else if (t === "function_definition") {
        // Mirror of the analyzer's getFunctionDetails declarator lookup
        // (CP1): a leading-`::` return type (`static ::std::ostream&
        // GetDesc(...)`) shatters the declarator — the function_declarator
        // nests under reference_declarator/pointer_declarator instead of
        // sitting direct. Direct-only lookup lost the defined name while
        // the analyzer registered it (unexplained uses on both fmt lanes).
        let decl = (n.namedChildren ?? []).find((c: any) => c.type === "function_declarator")
        if (!decl) {
          const ptr = (n.namedChildren ?? []).find((c: any) => c.type === "pointer_declarator" || c.type === "reference_declarator")
          if (ptr) decl = (ptr.namedChildren ?? []).find((c: any) => c.type === "function_declarator")
        }
        const qid = decl?.namedChildren?.find((c: any) => c.type === "qualified_identifier")
        // #924 MIRROR: a qualifier is an OWNER only when a real `::` token joins
        // it to the name; the phantom join is the grammar's record of a return
        // type it could not place (`FMT_API std::system_error vwindows_error`).
        // The analyzer reads the same exported rule, not a copy of it.
        const qparts = qid ? qualifiedDeclaratorLeaf(qid) : null
        const nm = qparts ? qparts.nameNode.text : decl?.namedChildren?.find((c: any) => c.type === "identifier" || c.type === "field_identifier")?.text
        // CP7 mirror: nested qualification (`Outer::Inner::m`) nests
        // RIGHT-leaning as qid[ns Outer, qid[ns Inner, m]] — the owning
        // scope is the INNERMOST qualifier (`Inner`, matching the
        // analyzer's descended scope and the member registry keys).
        // Descend to the deepest qualifier, then take the first scope-ish
        // child (namespace/type/identifier/template).
        const scopeQid: any = qparts?.scopeQid ?? null
        const scNode = scopeQid ? scopeQid.namedChildren?.find((c: any) => c.type === "namespace_identifier" || c.type === "type_identifier" || c.type === "identifier" || c.type === "template_type") : null
        const sc = cleanScope(scNode)
        // CP2 mirror: macro-function shapes (`TEST(a, b) {...}` — ALL-CAPS
        // name, params without any type node) define no real function; the
        // analyzer emits no symbol and registers no name, so neither does
        // the oracle (else ERROR-recovered sibling fragments read as uses).
        let isMacroShape = false
        if (nm && decl) {
          let allCaps = false
          for (let k = 0; k < nm.length; k++) {
            const ch = nm[k]
            if (ch >= "a" && ch <= "z") { allCaps = false; break }
            if (ch >= "A" && ch <= "Z") allCaps = true
          }
          if (allCaps) {
            const plist = (decl.namedChildren ?? []).find((c: any) => c.type === "parameter_list")
            const pnames = plist ? (plist.namedChildren ?? []) : []
            if (pnames.length > 0) {
              // Typed iff a hard type node, or a type_identifier BESIDE a
              // distinct declarator identifier (`MyClass x`). A lone
              // type_identifier is macro soup (`TEST(a, b)` classifies bare
              // names as type_identifier) — mirrors the analyzer exactly.
              const hasType = (m: any): boolean => {
                let sawHard = false
                let sawTypeIdent = false
                let sawNameIdent = false
                const st: any[] = [m]
                while (st.length > 0) {
                  const x = st.pop()!
                  if (x.type === "primitive_type" || x.type === "sized_type_specifier" ||
                      x.type === "template_type" || x.type === "qualified_identifier" ||
                      x.type === "typename_specifier" || x.type === "decltype" ||
                      x.type === "struct_specifier" || x.type === "union_specifier" ||
                      x.type === "enum_specifier") { sawHard = true; break }
                  if (x.type === "type_identifier") sawTypeIdent = true
                  if (x.type === "identifier" || x.type === "field_identifier") sawNameIdent = true
                  for (let k = 0; k < (x.namedChildCount ?? 0); k++) {
                    const c = x.namedChild(k)
                    if (c) st.push(c)
                  }
                }
                return sawHard || (sawTypeIdent && sawNameIdent)
              }
              isMacroShape = !pnames.some((p: any) => p.type !== "comment" && hasType(p))
            }
          }
        }
        if (nm && !nm.startsWith("~") && !nm.startsWith("operator") && !isMacroShape) {
          if (sc) pendingQualified.push({ name: nm, scope: sc })
          else if (!inFn) addValue(nm, ns, inClass)
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) pre.push({ n: c, ns, inFn: true, inClass }) }
        continue
      } else if (t === "compound_statement" && macroDeclaredBody(n)) {
        // #919 MIRROR (and it is the analyzer's own rule, imported — never a
        // re-implementation): a macro-declared body is a FUNCTION body, so its
        // declarations are execution artifacts and must not enter the
        // file-scope value roster. Without this arm truth kept believing
        // `j`/`it` were file-scope values in nlohmann-json's tests while the
        // fixed analyzer suppressed the reads they shadow — the exact #916
        // shape of drift (truth deriving the phantom, the analyzer refusing it).
        for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) pre.push({ n: c, ns, inFn: true, inClass }) }
        continue
      } else if (!inFn && (t === "declaration" || t === "field_declaration")) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          // CP6 mirror: a file-scope structured binding declares EVERY name.
          if (c.type === "init_declarator" && c.namedChild(0)?.type === "structured_binding_declarator") {
            const sb = c.namedChild(0)!
            for (let k = 0; k < sb.namedChildCount; k++) {
              const b = sb.namedChild(k)
              if (b && (b.type === "identifier" || b.type === "field_identifier")) addValue(b.text, ns, inClass)
            }
          } else if (c.type === "init_declarator" || c.type === "identifier" || c.type === "field_identifier" ||
              c.type === "pointer_declarator" || c.type === "reference_declarator" || c.type === "array_declarator" ||
              c.type === "function_declarator") {
            const id = leftmostId(c)
            if (id) addValue(id, ns, inClass)
          }
        }
      } else if (!inFn && t === "enumerator") {
        const nm = n.namedChildren?.find((c: any) => c.type === "identifier")?.text
        if (nm) fileScopeValues.add(nm)
      } else if (t === "using_declaration" && !inFn && !inClass) {
        const txt = n.text
        const tgt = (n.namedChildren ?? []).find((c: any) => c.type === "qualified_identifier" || c.type === "identifier")
        if (txt.indexOf("using namespace") !== -1) {
          if (tgt) usedNamespaces.add(tgt.text.split("::").filter(Boolean).join("::"))
        } else if (tgt) {
          const segs = tgt.text.split("::").filter(Boolean)
          if (segs.length > 0) fileScopeValues.add(segs[segs.length - 1])
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) pre.push({ n: c, ns, inFn, inClass }) }
    }
    for (const q of pendingQualified) {
      if (classMembers.has(q.scope)) {
        let s = classMembers.get(q.scope)!
        s.add(q.name)
      } else if (namespaceValues.has(q.scope)) {
        let s = namespaceValues.get(q.scope)!
        s.add(q.name)
      } else fileScopeValues.add(q.name)
    }
  }
  const DECL_PARENTS = new Set([
    "declaration", "field_declaration", "parameter_declaration",
    "init_declarator", "function_declarator", "pointer_declarator",
    "reference_declarator", "array_declarator", "abstract_pointer_declarator",
    "abstract_array_declarator", "abstract_function_declarator",
    "enumerator", "using_declaration", "alias_declaration",
    "optional_parameter_declaration", "type_parameter_declaration",
    // CP6 mirror: structured bindings declare (see the carve-out in
    // isDeclaringPos — all names, not first-only). NOTE: the analyzer's F6
    // audit removed the dead `template_type_parameter` /
    // `template_value_parameter` names here; they never occur in the pinned
    // grammar, so their absence changes nothing.
    "structured_binding_declarator",
  ])
  const isDeclaringPos = (n: any): boolean => {
    const p = n.parent
    if (!p) return false
    // CPPD15/CPPD16 MIRROR (imported, never re-implemented — the analyzer's own
    // rule): the NAME of a template-wrapped declarator is a DECLARED entity, not
    // a read of one. `template <> constexpr auto num_bits<native_int128>() -> int`
    // puts the defined name inside `template_function`, so the leftmost-
    // declarator rule below (which gates on the node's DIRECT parent) read it as
    // a value use. Measured: fmt's full extent derived 7 such `uses` truth edges
    // (format.h num_bits/digits10, printf.h find, gtest.h GenerateNamesRecursively,
    // one-arg.cc from_repr, fuzzer-common.h assign_from_buf, format-impl-test.cc
    // run_double_tests), every one of them a false read of the imported
    // specialization's own name — and the analyzer matched them, so the two sides
    // agreed on a wrong answer and no count moved. See the analyzer's
    // `templateWrappedDeclaratorName` for the shape and the narrowness argument.
    if (templateWrappedDeclaratorName(n)) return true
    if (p.type === "optional_parameter_declaration" || p.type === "type_parameter_declaration" ||
        p.type === "template_type_parameter" || p.type === "template_value_parameter") {
      for (let k = 0; k < p.namedChildCount; k++) {
        const c = p.namedChild(k)
        if (c && (c.type === "identifier" || c.type === "field_identifier")) return c.startIndex === n.startIndex
      }
      return false
    }
    // CP8 mirror: member/enum declarator segments (see the analyzer — a
    // field_declaration or enumerator with a bare identifier value has no
    // init_declarator wrapper, so the generic rule below treated the VALUE
    // as declaring). Segment rule over ALL children: `,`/`;` split
    // segments (fresh again), `=`/`:`/`{` switch a segment to reading; the
    // first identifier-ish child of a fresh segment declares, the rest read.
    if (p.type === "field_declaration" || p.type === "enumerator") {
      let fresh = true
      let foundFirst = false
      for (let k = 0; k < (p.childCount ?? 0); k++) {
        const c = p.child(k)
        if (!c) continue
        if (!c.isNamed) {
          if (c.type === "," || c.type === ";") { fresh = true; foundFirst = false }
          else if (c.type === "=" || c.type === ":" || c.type === "{") fresh = false
          continue
        }
        if (c.type === "identifier" || c.type === "field_identifier") {
          if (!foundFirst && fresh) {
            if (c.startIndex === n.startIndex && c.endIndex === n.endIndex) return true
            foundFirst = true
          } else {
            if (c.startIndex === n.startIndex && c.endIndex === n.endIndex) return false
          }
        }
      }
      return false
    }
    if (!DECL_PARENTS.has(p.type)) return false
    // CP6 mirror: structured bindings declare EVERY name (`auto [x, y]`
    // binds x AND y). Must precede the endsWith-declarator branch: that
    // rule is first-only and would bind x while leaking y as a read. The
    // initializer is a SIBLING (under init_declarator / for_range_loop),
    // never under this node, so a blanket true is exact.
    if (p.type === "structured_binding_declarator") return true
    if (p.type.endsWith("declarator") || p.type === "init_declarator") {
      let cur: any = p
      while (cur) {
        if (cur.type === "identifier" || cur.type === "field_identifier") return cur.startIndex === n.startIndex
        let next: any = null
        for (let k = 0; k < cur.namedChildCount; k++) {
          const c = cur.namedChild(k)
          if (c && (c.type.endsWith("declarator") || c.type === "identifier" || c.type === "field_identifier")) { next = c; break }
        }
        cur = next
      }
      return false
    }
    return true
  }
  const isPreprocText = (n: any): boolean => {
    let cur: any = n.parent
    while (cur) {
      const t: string = cur.type
      if (t.includes("statement") || t.includes("declaration") || t.includes("declarator") ||
          t.includes("specifier") || t.includes("enumerator") || t.includes("compound") ||
          t.includes("argument_list") || t.includes("init") || t.includes("expression") ||
          t.includes("function_definition") || t.includes("class_body") || t.includes("field_declaration_list")) return false
      if (t.startsWith("preproc_")) return true
      cur = cur.parent
    }
    return false
  }
  const hasQualifiedAncestor = (n: any): boolean => {
    let cur: any = n.parent
    while (cur) {
      const t: string = cur.type
      if (t === "qualified_identifier") return true
      if (t.includes("statement") || t.includes("declaration") || t.includes("declarator") ||
          t.includes("expression") || t.includes("function_definition") || t.includes("field_declaration_list") ||
          t.includes("class_body") || t.includes("argument_list")) return false
      cur = cur.parent
    }
    return false
  }
  const hasAttributeAncestor = (n: any): boolean => {
    let cur: any = n.parent
    while (cur) {
      const t: string = cur.type
      if (t === "attribute" || t === "attribute_declaration" || t === "attribute_specifier") return true
      if (t.includes("statement") || t.includes("declaration") || t.includes("function_definition") ||
          t.includes("expression") || t.includes("class_body")) return false
      cur = cur.parent
    }
    return false
  }
  // CP1 callee climb (mirrors the analyzer): template/dependent/
  // parenthesized wrappers around a call's function child are the callee.
  const isCallCallee = (n: any): boolean => {
    let top: any = n
    let p: any = n.parent
    while (p && (p.type === "template_function" || p.type === "template_method" ||
        p.type === "dependent_name" || p.type === "parenthesized_expression")) {
      top = p
      p = p.parent
    }
    if (!p || p.type !== "call_expression") return false
    const fnField = p.childForFieldName?.("function")
    if (fnField) return fnField.startIndex === top.startIndex && fnField.endIndex >= top.endIndex
    const first = p.namedChild(0)
    return !!first && first.startIndex === top.startIndex && first.endIndex >= top.endIndex
  }
  // Walk-order function locals (mirrors the analyzer's flow-sensitive
  // collection: params at entry, bindings in walk order, catch/lambda params).
  const scopeStack: Array<{ kind: string; name: string; locals: Set<string>; cls?: string | null }> = []
  const stack: any[] = [{ n: root, ctx: null as any, exit: false as boolean }]
  while (stack.length > 0) {
    const { n, ctx, exit } = stack.pop()!
    if (exit) {
      if (ctx && scopeStack.length > 0 && scopeStack[scopeStack.length - 1] === ctx) scopeStack.pop()
      continue
    }
    let cur = ctx
    const t = n.type
    if (t === "namespace_definition") {
      const nm = tname(n) ?? n.namedChildren?.find((c: any) => c.type === "namespace_identifier")?.text ?? "anonymous"
      cur = { kind: "namespace", name: nm, locals: new Set<string>() }
      scopeStack.push(cur)
      stack.push({ n, ctx: cur, exit: true })
    } else if (t === "class_specifier" || t === "struct_specifier" || t === "union_specifier") {
      // CPPD1 parity (analyzer main walk + oracle pre-pass): partial
      // specialization names live in template_type — without the fallback
      // the scope pushes as "anonymous" and member reads in its methods
      // never resolve (unexplained uses on both fmt lanes).
      const tt2 = (n.namedChildren ?? []).find((c: any) => c.type === "template_type")
      const ttn2 = tt2 ? (tt2.childForFieldName?.("name")?.text ??
        (tt2.namedChildren ?? []).find((c: any) => c.type === "type_identifier" || c.type === "qualified_identifier")?.text ??
        (() => { const lt = tt2.text.indexOf("<"); return lt > 0 ? tt2.text.slice(0, lt).trim() : null })()) : null
      const nm = tname(n) ?? ttn2 ?? "anonymous"
      cur = { kind: "class", name: nm, locals: new Set<string>() }
      scopeStack.push(cur)
      stack.push({ n, ctx: cur, exit: true })
    } else if (t === "function_definition") {
      // CP1-partial-gap fix (M49 W22, measured fmt test/std-test.cc):
      // `const char* my_exception::what() const noexcept { return
      // msg.c_str(); }` — a pointer/reference return type nests the
      // function_declarator under pointer_declarator/reference_declarator,
      // so the direct-only lookup here found no declarator: `what`'s scope
      // lost its class (fnCls stayed null), the bare member read `msg`
      // found no enclosing-class resolution, and the analyzer's `uses msg`
      // surfaced as the single fmt unexplained. The pre-pass already
      // carries this one-level fallback for the DEFINED NAME (CP1) — this
      // branch uses the same rule, for both the params walk and fnCls.
      let decl = (n.namedChildren ?? []).find((c: any) => c.type === "function_declarator")
      if (!decl) {
        const ptr = (n.namedChildren ?? []).find((c: any) => c.type === "pointer_declarator" || c.type === "reference_declarator")
        if (ptr) decl = (ptr.namedChildren ?? []).find((c: any) => c.type === "function_declarator")
      }
      const locals = new Set<string>()
      const pw: any[] = decl ? [decl] : []
      while (pw.length > 0) {
        const m = pw.pop()!
        if (m.type === "parameter_declaration") {
          const id = leftmostId(m)
          if (id) locals.add(id)
          continue
        }
        for (let k = 0; k < m.namedChildCount; k++) { const c = m.namedChild(k); if (c) pw.push(c) }
      }
      // CP5 mirror: out-of-line definitions resolve bare member reads
      // through their class (same qualified-scope computation as the
      // pre-pass flush above — the analyzer keys classMembers identically).
      let fnCls: string | null = null
      {
        const q2 = decl?.namedChildren?.find((c: any) => c.type === "qualified_identifier")
        if (q2) {
          // CP7 + #924 mirror: deepest qualifier, and ONLY when the join is a
          // real `::` (same exported rule the analyzer reads).
          const sq: any = qualifiedDeclaratorLeaf(q2)?.scopeQid ?? null
          const scNode2 = sq?.namedChildren?.find((c: any) => c.type === "namespace_identifier" || c.type === "type_identifier" || c.type === "identifier" || c.type === "template_type")
          fnCls = cleanScope(scNode2)
        }
      }
      cur = { kind: "function", name: "", locals, cls: fnCls }
      scopeStack.push(cur)
      stack.push({ n, ctx: cur, exit: true })
    } else if (t === "compound_statement" && macroDeclaredBody(n) && !scopeStack.some((s) => s.kind === "function")) {
      // #919 MIRROR: the analyzer opens a Function scope for a macro-declared
      // body (the heading text is the owner it publishes); truth must open the
      // same scope for the two things the scope decides — body locals bind
      // (shadow suppression) and the body's declarations stop being file-scope
      // values. Gated on the same context rule (`no enclosing function`):
      // inside a real function a call statement followed by a block is valid
      // C++ and the enclosing function already owns the reads. The scope NAME
      // is not compared (truth's edges carry the `(expr)` source on both
      // sides of the fix), so it mirrors the analyzer for readers only.
      const rec = macroDeclaredBody(n)!
      // The MACRO NAME names the scope here: names are not compared (truth's
      // edges carry the `(expr)` source on both sides of this fix), and the
      // published heading TEXT lives in the analyzer's output only, so truth
      // needs no source text at all.
      cur = { kind: "function", name: rec.macroName, locals: new Set<string>(), cls: null }
      scopeStack.push(cur)
      stack.push({ n, ctx: cur, exit: true })
    } else if (t === "identifier") {
      const p = n.parent
      let isBinding = false
      if (p && p.type === "lambda_capture_initializer" && p.namedChild(0)?.startIndex === n.startIndex) {
        isBinding = true
        const fn = [...scopeStack].reverse().find((s) => s.kind === "function")
        if (fn) fn.locals.add(n.text)
      }
      const lhsWrite = p && (p.type === "assignment_expression" || p.type === "compound_assignment_expression") &&
        p.namedChild(0)?.startIndex === n.startIndex && (p.namedChild(0)?.endIndex ?? 0) >= n.endIndex
      const isCallee = isCallCallee(n)
      const isFieldLeaf = p && p.type === "field_expression" && p.childForFieldName?.("field")?.startIndex === n.startIndex
      const isLabel = p && (p.type === "goto_statement" || p.type === "labeled_statement")
      if (!isBinding && !lhsWrite && !isCallee && !isFieldLeaf && !isLabel &&
          !isDeclaringPos(n) && !isPreprocText(n) && !hasQualifiedAncestor(n) && !hasAttributeAncestor(n)) {
        const fn = [...scopeStack].reverse().find((s) => s.kind === "function")
        if (!fn || !fn.locals.has(n.text)) {
          let ok = fileScopeValues.has(n.text)
          if (!ok) {
            for (let i = scopeStack.length - 1; i >= 0 && !ok; i--) {
              const s = scopeStack[i]
              if (s.kind === "class") {
                const mm = classMembers.get(s.name)
                if (mm && mm.has(n.text)) ok = true
              }
              // CP5 mirror: out-of-line member scope carries its class.
              if (!ok && s.kind === "function" && (s as any).cls) {
                const mm = classMembers.get((s as any).cls)
                if (mm && mm.has(n.text)) ok = true
              }
              if (s.kind === "namespace" && s.name !== "anonymous") {
                const nm = namespaceValues.get(s.name)
                if (nm && nm.has(n.text)) ok = true
              }
            }
          }
          if (!ok) {
            for (const used of usedNamespaces) {
              const nm = namespaceValues.get(used)
              if (nm && nm.has(n.text)) { ok = true; break }
            }
          }
          if (ok) {
            const k = "uses|" + n.text
            if (!seen.has(k)) { seen.add(k); edges.push({ label: "uses", from: "(expr)", target: n.text }) }
          }
        }
      }
      // Local bindings bind in walk order (declaration occurrences) —
      // but NEVER the function definition's OWN declarator name: it is the
      // defined entity, not a local (CP1: otherwise a same-named
      // overload/self call `fill_n<T>(...)` inside `fill_n` self-shadows
      // and the genuine read is suppressed while the analyzer emits it).
      // Parameter names (inside parameter_lists) still bind.
      if (!isBinding && isDeclaringPos(n)) {
        let selfName = false
        let up: any = n.parent
        let crossedParams = false
        while (up) {
          if (up.type === "parameter_list" || up.type === "parameter_declaration") { crossedParams = true; break }
          if (up.type === "function_declarator" && up.parent && up.parent.type === "function_definition") break
          up = up.parent
        }
        if (up && !crossedParams) selfName = true
        if (!selfName) {
          const fn = [...scopeStack].reverse().find((s) => s.kind === "function")
        // #919 MIRROR: a macro-declared body is a function body too (it has no
        // `function_definition`, which is the only reason the analyzer's
        // binding rule had to learn the same arm).
        let inFnBody = false
        let cur2: any = n.parent
        while (cur2) {
          if (cur2.type === "function_definition") { inFnBody = true; break }
          if (cur2.type === "class_specifier" || cur2.type === "struct_specifier") break
          if (macroDeclaredBody(cur2)) { inFnBody = true; break }
          cur2 = cur2.parent
        }
        if (fn && inFnBody) fn.locals.add(n.text)
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, ctx: cur, exit: false })
    }
  }
  return edges
}

export function deriveCCalls(root: any, sourceText?: string): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  // CGD1 mirror (M37 #601): compound/plain assignment LHS is a WRITE — the
  // analyzer gates it, so the oracle must too or every write surfaces as
  // "missing" (the SCD1 swift/ruby oracle-staleness lesson). Span-match the
  // first named child; web-tree-sitter gives FRESH objects per child(), so
  // reference identity never matches.
  const isAssignLhs = (n: any): boolean => {
    const p = n.parent
    if (!p || p.type !== "assignment_expression") return false
    const lhs = p.namedChild(0)
    return !!lhs && lhs.startIndex === n.startIndex && lhs.endIndex >= n.endIndex
  }
  // CGD28 (M37 #601, measured fossildelta.c): a cast to a typedef alias —
  // `(i64)x` parses as cast_expression > parenthesized_expression >
  // identifier — is a TYPE REFERENCE position, but ONLY for the cast's TYPE
  // operand: `(sqlite3_syscall_ptr)ts_open` — the function-name VALUE after
  // the type — stays a `uses` read (test_syscall.c syscall tables). The
  // value operand is the LAST named child of the cast; the type operand
  // starts before it. Mirrors the analyzer's isTypePositionIdentifier.
  const isCastTypePosition = (n: any): boolean => {
    let cur: any = n.parent
    while (cur) {
      const t: string = cur.type
      if (t === "sizeof_expression") return true
      if (t === "cast_expression") {
        const kids: any[] = []
        for (let i = 0; i < cur.namedChildCount; i++) kids.push(cur.namedChild(i))
        if (kids.length >= 2) {
          const value = kids[kids.length - 1]
          return n.startIndex < value.startIndex
        }
        return false
      }
      if (/statement|declaration|declarator|specifier|enumerator|compound|argument_list|init/.test(t)) return false
      cur = cur.parent
    }
    return false
  }
  // CGD-IDENT truth scope: names DECLARED in this file. CGD9 fix: the
  // declaring identifier is the identifier whose PARENT is a declaration
  // node (mirrors the analyzer's isDeclarationLikeIdentifier) — the old
  // isDeclarationPosition walked ANCESTORS and included
  // function_definition, so EVERY identifier inside ANY function body was
  // misclassified as a "declaration" and never emitted truth (reproduced:
  // probe c-oracle-min — aSyscall read, callback value, sizeof(RenameToken)
  // all silent). Type truth uses the analyzer's declaredTypes pre-pass
  // contract exactly: struct/union/enum WITH a body, typedef aliases.
  // Macros: preproc_def/preproc_function_def name.
  const DECL_PARENT_TYPES = new Set([
    "declaration", "parameter_declaration", "field_declaration", "init_declarator",
    "function_declarator", "pointer_declarator", "array_declarator", "type_definition",
    "enumerator", "preproc_def", "preproc_function_def",
  ])
  const isDeclaringIdentifier = (n: any): boolean => {
    const p = n.parent
    if (!p || !DECL_PARENT_TYPES.has(p.type)) return false
    // CGD26 (M37 #601, measured jimsh0.c): the TYPE of a field/declaration is
    // a USE, not a declaration — `Jim_FreeInternalRepProc *freeIntRepProc;`
    // parses as field_declaration > [type_identifier, pointer_declarator];
    // the any-position rule made the type_identifier count as a declaring
    // occurrence, suppressing its own references-truth (analyzer correctly
    // emits `references`).
    if (n.type === "type_identifier") return false
    // CGD12: for declarator-chain parents, only the LEFTMOST identifier
    // declares — `int aLock[SQLITE_SHM_NLOCK]` parses as array_declarator
    // with BOTH aLock and the size expression as identifier children; the
    // any-child rule turned every array-size constant into a "declared
    // name" (os_unix.c: false truth from `aMutex[SQLITE_SHM_NLOCK]`).
    if (/declarator$/.test(p.type)) {
      let cur: any = p
      while (cur) {
        if (cur.type === "identifier" || cur.type === "field_identifier") {
          return cur.startIndex === n.startIndex
        }
        let next: any = null
        for (let k = 0; k < cur.namedChildCount; k++) {
          const c = cur.namedChild(k)
          if (c && (c.type.endsWith("declarator") || c.type === "identifier" || c.type === "field_identifier")) {
            next = c
            break
          }
        }
        cur = next
      }
      return false
    }
    return true
  }
  // Truth scope refinement: function-LOCAL declarations are execution
  // artifacts (the analyzer's extractDeclaration only emits file/global
  // symbols), so a local's name must NOT qualify as a resolvable use target
  // — otherwise every read of a shadowed/unrelated name counted as truth and
  // the analyzer's correct silence surfaced as MISSING (first sqlite run:
  // 64.6% coverage / 2037 missing, all from locals). CGD8 refinement: the
  // exclusion must be the function BODY and PARAMETER LIST, not the whole
  // function_definition subtree — a function's own NAME is a file-scope
  // declaration (callback references like `Tcl_CreateObjCommand(interp,
  // "vfslog", test_vfslog, 0, 0)` are genuine reads of it; the old check
  // silenced them, leaving 800+ callback uses with no truth). Struct
  // fields, enum members, macros, typedefs, globals, and function names
  // all remain truth.
  // typedef alias name: the declarator chain's leftmost identifier
  // (`typedef struct VfslogFile VfslogFile` — both occurrences declare).
  // CGD18 (M37 #601): the descent must SKIP type nodes, never terminate on
  // them — `off_t offset` has namedChild(0)=type_identifier(off_t), and the
  // old terminal check stopped there and returned "off_t" as the bound
  // name, so `offset` never entered fnLocals and 32 param reads of the
  // struct field `offset` surfaced as bogus truth (os_unix.c MISSING
  // poison). Two passes: declarator-typed children first, then plain
  // identifier/field_identifier (type_identifier EXCLUDED — it names a
  // TYPE, not the declared entity). Reaching a level with neither ends the
  // walk (unnamed, e.g. abstract declarators).
  const leftmostDeclaratorIdentifier = (n: any): string | undefined => {
    if (!n) return undefined
    let cur = n
    while (cur && cur.type !== "identifier" && cur.type !== "field_identifier") {
      let next: any = null
      for (let k = 0; k < cur.namedChildCount; k++) {
        const c = cur.namedChild(k)
        if (c && c.type.endsWith("declarator")) {
          next = c
          break
        }
      }
      if (!next) {
        for (let k = 0; k < cur.namedChildCount; k++) {
          const c = cur.namedChild(k)
          if (c && (c.type === "identifier" || c.type === "field_identifier")) {
            next = c
            break
          }
        }
      }
      cur = next
    }
    return cur?.text
  }
  const isFunctionLocal = (n: any): boolean => {
    let cur: any = n
    while (cur) {
      if (cur.type === "compound_statement" || cur.type === "parameter_list") return true
      cur = cur.parent
    }
    return false
  }
  // M49 W22 (measured loadext.c): the SQLITE_WSD struct declaration
  // (`static SQLITE_WSD struct sqlite3AutoExtList {...} sqlite3Autoext =
  // { 0, 0 };`) parse-glues into a phantom compound_statement that swallows
  // the file's OWN later function DEFINITIONS — sqlite3_auto_extension and
  // siblings sit under compound_statement@L789, so isFunctionLocal denied
  // their names, the function-pointer table entries referencing them had no
  // declared name to resolve, and three real `uses` truth edges vanished
  // (sqlite rotation sample: 3 unexplained). The analyzer's symbol path is
  // immune (it creates real Function symbols for these defs, CGD36); the
  // syntax walk must be equally precise: a function's defining name is
  // file-scope whenever the walk from its function_declarator meets
  // function_definition BEFORE any compound_statement/parameter_list —
  // exactly the analyzer's isFnDefName discriminator.
  const isFnDefName = (n: any): boolean => {
    let mid: any = n.parent
    if (!mid || mid.type !== "function_declarator") return false
    while (mid) {
      if (mid.type === "compound_statement" || mid.type === "parameter_list") return false
      if (mid.type === "function_definition") return true
      mid = mid.parent
    }
    return false
  }
  // CGD25 (M37 #601, measured os_win.c/jimsh0.c): a BARE function_declarator
  // glued as a direct ERROR child (tokenize.c sqlite3RunParser, os_win.c
  // winRead/winWrite headers) has no declaration wrapper — its name node's
  // parent IS the fd. Test: walk from the name to the ERROR; a `declaration`
  // wrapper on the path means an ordinary prototype (NOT glue).
  const isBareFdGlueName = (n: any): boolean => {
    const p = n.parent
    if (!p || p.type !== "function_declarator") return false
    const gp = p.parent
    if (!gp || gp.type !== "ERROR") return false
    // POSITION comparison (KAD2/TSD2 class, hygiene F7): web-tree-sitter
    // hands out FRESH node wrappers per property access, so `mid === gp`
    // never holds — this gate was dead code and the oracle admitted glue-fd
    // names the analyzer structurally cannot resolve (no symbol: the
    // declaration's declarator was swallowed by the ERROR, s3jni_config_log
    // in sqlite3-jni.c). Reach the ERROR span by comparing spans.
    const errStart = gp.startIndex
    const errEnd = gp.endIndex
    let mid: any = n
    while (mid) {
      if (mid.startIndex === errStart && mid.endIndex === errEnd) return true
      if (mid.type === "declaration") return false
      mid = mid.parent
    }
    return false
  }
  // #907 round 2 MIRROR (one contract with src/ast/real-c-analyzer.ts
  // recoverGluedDefinitionHeader): the analyzer now creates a FILE-SCOPE symbol
  // for a definition header that parse recovery glued into an ERROR — at root
  // scope, through a pointer_declarator, behind a `#define`'s ERROR, and even
  // when the name arrives as a BARE identifier. `isBareFdGlueName` above still
  // excludes such a name from declaredNames, and the reason its comment gives
  // ("the analyzer structurally cannot resolve it — no symbol") is now false:
  // the symbol exists, so the exclusion makes truth blind to real uses of it.
  // F5 measured exactly that the moment the symbol appeared — sqlite os_win.c's
  // method table (`winRead,` / `winWrite,` in winIoMethod) is a REAL use of the
  // two recovered functions, the analyzer emits it, and truth had no
  // counterpart: `unexplained 0 -> 2` was the round's only regression.
  // Ported arrival for arrival from the analyzer's predicates
  // (definitionBodyFollows / insideMacroContinuation / declarationHeaderBefore).
  const isGlueDefinitionName = (n: any, src: string): boolean => {
    if (typeof src !== "string" || !n) return false
    // Arrival 1: `function_declarator` directly under the ERROR, or reached
    // through pointer/parenthesized wrappers (jv_dtoa.c `char * jvp_dtoa(...)`).
    let declarator: any = null
    if (n.parent && n.parent.type === "function_declarator") declarator = n.parent
    else if (n.parent && /^(pointer|parenthesized|attributed)_declarator$/.test(n.parent.type)) {
      let cur: any = n.parent
      for (let depth = 0; cur && depth < 4; depth++) {
        if (cur.type === "function_declarator") { declarator = cur; break }
        if (!/^(pointer|parenthesized|attributed)_declarator$/.test(cur.type)) break
        cur = cur.childForFieldName("declarator")
      }
    }
    // Arrival 2: the name IS the ERROR's direct child (decNumber.c, where the
    // return type and the declarator node are both gone).
    // Arrival 3 (#912): the CALL-shaped declarator — recovery absorbed the TYPE
    // words into the ERROR and the definition header now reads as a call
    // (`static block gen_last_1(void)`, jq src/builtin.c:2067). It is admitted on
    // STRICTER evidence than arrival 2 (`bare` below): the damaged region's own
    // tail must carry a reserved declaration word just before the call. A macro
    // INVOCATION with a block (`FOREACH(item) {`) has none, and neither has a
    // `#define` replacement text (`#define osCloseHandle ((BOOL…`), so the shapes
    // #912 was originally refused over stay refused on both sides.
    const callArrival =
      !declarator && n.parent?.type === "call_expression" && n.parent.childForFieldName("function")?.startIndex === n.startIndex
        ? n.parent
        : null
    const bare = !declarator && !callArrival && n.parent?.type === "ERROR"
    if (!declarator && !bare && !callArrival) return false
    // A `declaration`/`function_definition` wrapper on the way to the ERROR
    // means an ordinary prototype the analyzer's own pre-pass already catalogs.
    let w: any = declarator ? declarator.parent : callArrival ? callArrival.parent : n.parent
    let sawError = false
    while (w) {
      if (w.type === "declaration" || w.type === "function_definition") return false
      if (w.type === "ERROR") { sawError = true; break }
      w = w.parent
    }
    if (!sawError) return false
    // (a) the name's own parameter list must end at the body's `{`.
    let j = n.endIndex
    while (j < src.length && /\s/.test(src[j])) j++
    if (src[j] !== "(") return false
    let pd = 0
    for (; j < src.length; j++) {
      if (src[j] === "(") pd++
      else if (src[j] === ")") { pd--; if (pd === 0) break }
    }
    if (pd !== 0) return false
    j++
    while (j < src.length && /\s/.test(src[j])) j++
    if (src[j] !== "{") return false
    // (b) a `#define` body's `name` is the macro PARAMETER, not a symbol. Skip
    // only inside the directive's own logical line: a definition past the last
    // backslash continuation is ordinary file text (jq parser.c `yyerror`).
    let mac: any = n.parent
    while (mac) {
      if (mac.type === "preproc_def" || mac.type === "preproc_function_def") {
        let lineStart = mac.startIndex
        let allContinuation = true
        for (let row = mac.startPosition.row; row < n.startPosition.row; row++) {
          const nl = src.indexOf("\n", lineStart)
          if (nl < 0) { allContinuation = false; break }
          let end = nl - 1
          if (end >= lineStart && src[end] === "\r") end--
          if (src[end] !== "\\") { allContinuation = false; break }
          lineStart = nl + 1
        }
        if (allContinuation) return false
      }
      mac = mac.parent
    }
    // (c1) a CALL-shaped declarator (#912) rests on the analyzer's OWN exported
    // predicate — `declarationSpecifierRunBefore` — rather than on a copy of it:
    // the run of reserved declaration words the damaged region keeps in front of
    // the call (`static block gen_last_1(`). A macro invocation cannot present
    // it, which is what keeps the two sides refusing the same shapes; and the
    // looser header test would ADMIT `#define osCloseHandle ((BOOL…` (33 of them
    // in sqlite), so it is not used here on either side.
    if (callArrival && declarationSpecifierRunBefore(callArrival) === null) return false
    // (c2) a BARE identifier declares only with a type/storage header before it.
    // #912 made that rule an export (`declarationHeaderPresent`) so this side can
    // stop holding its own regex copy of it: one rule, two consumers, and a
    // change to it can no longer land on one side only.
    if (bare && !declarationHeaderPresent(src, n.startIndex)) return false
    return true
  }
  // #917 MIRROR — and it is the SAME CODE, not a copy: the shape rule is
  // exported by the analyzer (`macroWrappedHeadingShape` / `wrappedBodyAfter`)
  // and imported here, so the two sides cannot drift. A macro-wrapped function
  // heading (`MACRO(ret, name)(params){ body }`) names its function in the
  // macro's LAST identifier argument, and the analyzer suppresses that
  // occurrence as a DEFINING one (gluedDefNameOffsets). Truth must suppress the
  // same occurrence, because the mention is otherwise an ordinary identifier
  // read of anything else in the file that happens to carry the name —
  // measured: the moment the recovery emitted `cmpp_stream` as a symbol, truth
  // still derived `uses -> cmpp_stream` for the heading mention at libcmpp.c
  // L8748 (that file also `#define`s the name in an alternative preprocessor
  // branch), and the whole 315-file sqlite c lane read MISSING=68 with the
  // recovery landed. Every refusal travels with the shared rule: when the
  // analyzer declines the shape (no top-level comma, name == macro name, C
  // keyword) it does NOT suppress the mention, and neither does truth.
  const isWrappedHeadingName = (n: any): boolean => {
    if (!n || n.type !== "identifier") return false
    const argList = n.parent
    if (!argList || argList.type !== "argument_list") return false
    const c2 = argList.parent
    if (!c2 || c2.type !== "call_expression") return false
    const c1 = c2.parent
    if (!c1 || c1.type !== "call_expression") return false
    const stmt = c1.parent
    if (!stmt || stmt.type !== "expression_statement") return false
    const shape = macroWrappedHeadingShape(stmt)
    if (!shape || shape.nameNode?.startIndex !== n.startIndex) return false
    return !!wrappedBodyAfter(stmt)
  }
  // Truth scope refinement 2 (CGD-PREPROC): identifiers inside PREPROCESSOR
  // CONDITION TEXT are not code — `#if SQLITE_MAX_MMAP_SIZE>0` conditions,
  // `defined(X)` tests, `#ifndef X` guards, `#define IOMETHODS(...CLOSE,
  // LOCK...)` parameter lists, and macro-replacement bodies. The C
  // preprocessor is textual (C-D2 ruling). BUT the exclusion must not eat
  // CONDITIONAL CODE: test files are often one giant `#ifdef SQLITE_TEST`
  // block, and every declaration/statement inside is real (the analyzer
  // walks them). The precise rule: an identifier is directive text iff the
  // path from it to the first preproc_* ancestor passes through NO code
  // container (any statement/declaration/declarator/specifier/enumerator
  // node). `#if (SQLITE_MAX_MMAP_SIZE>0)` → expression chain only → text;
  // `int eAccess = F_OK;` inside #ifndef → init_declarator on path → code.
  const isDirectiveConditionText = (n: any): boolean => {
    // CGD13: the NAME identifier of a macro definition IS a declaration
    // (`#define FUNC_PERFECT_MATCH 6` — the analyzer's extractMacro emits a
    // Constant symbol, so uses of the name resolve). Everything else inside
    // preproc_* (preproc_arg bodies, preproc_params parameter names, #if
    // conditions) stays text.
    const p0 = n.parent
    if (p0 && (p0.type === "preproc_def" || p0.type === "preproc_function_def")) return false
    let cur: any = n.parent
    while (cur) {
      const t: string = cur.type
      if (/statement|declaration|definition|declarator|specifier|enumerator|compound/.test(t)) return false
      if (t.startsWith("preproc_")) return true
      cur = cur.parent
    }
    return false
  }
  // Type truth (CGD10): the analyzer's declaredTypes pre-pass — struct/
  // union/enum names WITH a body (forward declarations resolve to nothing,
  // no dangling edges) plus typedef aliases.
  const declaredTypes = new Set<string>()
  // File-scope declared value names (globals, functions, macros, enum
  // members). Local declarations inside compound statements are execution
  // artifacts and excluded.
  const declaredNames = new Set<string>()
  // CGD41 (#908 ruling, measured jq src/parser.c L2229/2230): a FUNCTION-LIKE
  // macro's NAME cannot be a declaration of that name — the previewer expands
  // it wherever it appears, so `YYSTYPE yylval YY_INITIAL_VALUE (= yyval_default);`
  // parses as a declaration whose DECLARATOR field is a function_declarator
  // named after the macro (the real declared name, `yylval`, is demoted to the
  // declaration's type_identifier). The oracle's local collector read that fd's
  // leftmost identifier as a BINDING, put YY_INITIAL_VALUE into yyparse's locals,
  // and then suppressed the genuine use at L2229 — while the analyzer (whose own
  // collector is order-dependent and had not yet reached L2230) emitted it: the
  // lane's single unexplained row. The ruling is the one the four-row lesson
  // established (a macro invocation is a USE), applied to the local collector:
  // these names bind nothing. Built here, in the same pre-pass that admits macro
  // names to declaredNames, so both sides can share one rule.
  const functionLikeMacros = new Set<string>()
  // CGD14 (REVISED, measured): blanket ERROR-ancestor exclusion is WRONG —
  // os_win.c parses as ONE giant ERROR span (L1–L5345, #if-chain recovery)
  // containing wholly real declarations the analyzer correctly extracts;
  // status.c's SQLITE_WSD recovery region holds 13 real symbols. The honest
  // discriminator mirrors the analyzer's CGD19 EXACTLY (one contract): an
  // occurrence inside an ERROR span is an artifact iff it sits AFTER the
  // FIRST glued function header in that span — glue = function_definition
  // or a BARE function_declarator (direct ERROR child, tokenize.c
  // sqlite3RunParser shape); ordinary prototypes (os_win.c winMemMalloc,
  // a valid `declaration` with a function_declarator) are NOT glue.
  // Memoized per ERROR span by startIndex.
  const errHeaderIdx = new Map<number, number>()
  const isSuppressedErrorDecl = (n: any): boolean => {
    let cur: any = n
    let innermost: any = null
    while (cur) {
      if (cur.type === "ERROR") innermost = cur
      cur = cur.parent
    }
    if (!innermost) return false
    const key = innermost.startIndex as number
    let headerIdx = errHeaderIdx.get(key)
    if (headerIdx === undefined) {
      headerIdx = -1
      const st: any[] = [innermost]
      while (st.length > 0) {
        const m = st.pop()!
        if (m !== innermost) {
          // Glue = function_definition OR a BARE function_declarator (no
          // declaration/function_definition wrapper between fd and the ERROR
          // — tokenize.c direct child; jimsh0.c nested in preproc_ifdef <
          // ERROR). An fd inside a declaration wrapper is an ordinary
          // prototype (os_win.c winMemMalloc) — NOT glue.
          if (m.type === "function_definition") {
            if ((headerIdx as number) < 0 || m.startIndex < (headerIdx as number)) headerIdx = m.startIndex
          } else if (m.type === "function_declarator") {
            // POSITION comparison (web-tree-sitter object identity never
            // holds — the same trap that hit the analyzer side).
            let w: any = m
            let bare = true
            while (w) {
              if (w.startIndex === innermost.startIndex && w.endIndex === innermost.endIndex) break
              if (w.type === "declaration" || w.type === "function_definition") {
                bare = false
                break
              }
              w = w.parent
            }
            if (bare && w) {
              if ((headerIdx as number) < 0 || m.startIndex < (headerIdx as number)) headerIdx = m.startIndex
            }
          }
        }
        for (let k = 0; k < m.namedChildCount; k++) {
          const c = m.namedChild(k)
          if (c) st.push(c)
        }
      }
      errHeaderIdx.set(key, headerIdx as number)
    }
    return (headerIdx as number) >= 0 && n.startIndex > (headerIdx as number)
  }
  // #916 mirror helper — the analyzer's `macroTruncatedDeclarationIdentifier`
  // plus the recovered-name read, so truth and analyzer share ONE rule about
  // what a bare-macro truncation declared. A truncated declaration is a
  // `declaration` with a MISSING token whose LAST named child descends to an
  // ALL-CAPS identifier (`SQLITE_WSD`); the real declarator was re-parsed as the
  // next sibling. Returns the declared name, or null when the shape is not
  // proven — in which case neither side claims anything.
  const macroTruncatedSiblingName = (n: any): string | null => {
    if (n.type !== "declaration") return null
    let missing = false
    for (let i = 0; i < (n.childCount ?? 0); i++) if (n.child(i)?.isMissing) missing = true
    if (!missing) return null
    const kids = (n.namedChildren ?? []).filter((k: any) => !!k)
    const last = kids[kids.length - 1]
    if (!last) return null
    // Descent mirror of getIdentifierFromDeclarator: the `declarator` field, else
    // the first child that is neither ERROR nor MISSING (the #916-C arm — a
    // parenthesized declarator holds the macro's ERROR beside the real one).
    let cur: any = last
    let guard = 0
    while (cur && !["identifier", "field_identifier", "type_identifier"].includes(cur.type) && guard++ < 32) {
      const byField = typeof cur.childForFieldName === "function" ? cur.childForFieldName("declarator") : null
      if (byField) {
        cur = byField
        continue
      }
      const cs = (cur.namedChildren ?? []).filter((k: any) => !!k)
      const clean = cs.find((k: any) => !k.isError && !k.isMissing)
      cur = clean ?? cs[0] ?? null
    }
    const macro = cur?.text ?? ""
    if (!macro || !/[A-Z]/.test(macro) || /[a-z]/.test(macro)) return null
    const next = n.nextSibling
    if (!next) return null
    // Shape A/B: the declarator arrived as an expression statement, and the token
    // after the name says whether it was a variable (`=`) or a callable (`(`).
    // Same regex, same two arms, as the analyzer's recovery.
    if (next.type === "expression_statement") {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(=|\()/.exec((next.text ?? "").trim())
      if (!m || m[1] === macro) return null
      return m[1]
    }
    // Shape D: a macro-decorated DEFINITION whose return type the truncation ate
    // — the name sits in the definition's `type` field and its `declarator` is
    // the parameter list.
    if (next.type === "function_definition") {
      const t = next.childForFieldName?.("type")
      const d = next.childForFieldName?.("declarator")
      if (t && d && d.type === "parenthesized_declarator" && ["identifier", "field_identifier", "type_identifier"].includes(t.type)) {
        return t.text
      }
    }
    return null
  }
  {
    const pre: any[] = [root]
    while (pre.length > 0) {
      const n = pre.pop()!
      if (n.text) {
        // #916 mirror (measured: the whole-corpus c lane's ONLY unexplained
        // edges attributable to the landed #916 recovery were the two reads of
        // its recovered globals — sqlite btree.c L2657/2874
        // `GLOBAL(BtShared*,sqlite3SharedCacheList)` and notify.c L59
        // `for(p=sqlite3BlockedList;…)`). The analyzer now recovers the real name
        // from the SIBLING a bare-macro truncation re-parsed it into
        // (`static BtShared *SQLITE_WSD sqlite3SharedCacheList = 0;` becomes
        // `declaration "static BtShared *SQLITE_WSD"` + `expression_statement
        // "sqlite3SharedCacheList = 0;"`), so every read of that name is a real
        // `uses` edge. Truth must know the name was declared or those reads
        // surface as fabrication — and the sibling shape is the same proof the
        // analyzer requires, so neither side can fire without it.
        // NOTE: this arm must sit OUTSIDE the type/identifier chain below — a
        // truncated declaration is a `declaration` node, which no branch of that
        // chain visits (first attempt put it in the identifier branch and it
        // silently never ran; the lane still reported both edges unexplained).
        const recoveredTruncatedName = macroTruncatedSiblingName(n)
        if (recoveredTruncatedName) declaredNames.add(recoveredTruncatedName)
        if (n.type === "struct_specifier" || n.type === "union_specifier") {
          // CGD14b: type declarations mirror the ANALYZER — extractStruct has
          // no ERROR gate (only extractDeclaration does). os_win.c's structs
          // sit in one giant ERROR span and are real.
          if (n.childForFieldName("body")) {
            // CGD20-mirror: function-local type declarations are execution
            // artifacts (C-D1) — no declaredTypes admission (measured:
            // test_backup.c BackupSubCommandEnum, test_malloc.c MB_enum).
            const inFunction = (() => { let c: any = n; while (c) { if (c.type === "function_definition") return true; c = c.parent } return false })()
            if (!inFunction) {
              const nm = n.childForFieldName("name")
              if (nm && nm.text.trim()) declaredTypes.add(nm.text)
            }
          }
        } else if (n.type === "enum_specifier") {
          const nm = n.childForFieldName("name")
          // CGD20-mirror (see struct branch): skip function-local enums.
          const inFunction = (() => { let c: any = n; while (c) { if (c.type === "function_definition") return true; c = c.parent } return false })()
          if (nm && nm.text.trim() && !inFunction) declaredTypes.add(nm.text)
        } else if (n.type === "type_definition") {
          // typedef name. TWO shapes (measured, probe c-oswin):
          //  (a) `typedef struct Jim_Obj Jim_Obj;` / `typedef long i64;` —
          //      the DECLARATOR FIELD ITSELF is a leaf type_identifier
          //      (tree-sitter-c names the new type the "declarator" even
          //      though its node type says identifier-ish TYPE). The
          //      leftmost walk never terminates on type_identifier (CGD18:
          //      it must SKIP type nodes inside chains) so these aliases
          //      were silently dropped from declaredTypes — every later
          //      `references i64` truth vanished (fossildelta.c/showwal.c
          //      unexplained mass).
          //  (b) `typedef void (*Fn)(int);` — a real declarator chain.
          // CGD20-mirror: skip function-local typedefs.
          const declField = n.childForFieldName("declarator")
          const inFunction = (() => { let c: any = n; while (c) { if (c.type === "function_definition") return true; c = c.parent } return false })()
          let ident: string | undefined
          if (declField && /^(identifier|field_identifier|type_identifier)$/.test(declField.type)) {
            ident = declField.text
          } else if (declField) {
            ident = leftmostDeclaratorIdentifier(declField)
            // CGD30 (M37 #601, measured libcmpp.c/jimsh0.c): fn-ptr/fn-type
            // typedef chains TERMINATE on a type_identifier leaf — tree-sitter-c
            // names the new type of `typedef int (*cmpp_input_f)(...)` and
            // `typedef void (Jim_FreeInternalRepProc)(...)` with a
            // type_identifier node. The leftmost walk excludes type_identifier
            // mid-chain (CGD18) and returns undefined here; the declared name
            // is the first identifier-ish leaf OUTSIDE the parameter_list
            // (~200 references-truth edges in libcmpp/jimsh0 were unexplained).
            if (!ident) {
              const findLeaf = (m: any): string | undefined => {
                if (m.type === "parameter_list") return undefined
                if (/^(identifier|field_identifier|type_identifier)$/.test(m.type)) return m.text
                for (let k = 0; k < m.namedChildCount; k++) {
                  const c = m.namedChild(k)
                  if (c) {
                    const r = findLeaf(c)
                    if (r) return r
                  }
                }
                return undefined
              }
              ident = findLeaf(declField)
            }
          }
          if (ident && !inFunction) declaredTypes.add(ident)
        } else if (n.type === "identifier" || n.type === "field_identifier") {
          // CGD23/CGD24 (M37 #601): macro definition names are TEXTUALLY
          // file-scoped (the C preprocessor has no lexical scope — a #define
          // inside a function body or inside an error-recovered region is
          // effective to end-of-file; C-D2). They bypass BOTH the
          // function-local exclusion (prepare.c's `#ifndef
          // SQLITE_MAX_PREPARE_RETRY` inside sqlite3Prepare's compound — the
          // L883 use is a genuine macro use) AND the ERROR-ancestor
          // exclusion (status.c's `# define wsdStat x[0]` sits inside the
          // SQLITE_WSD recovery region but is a real directive the analyzer
          // extracts). Directives are line-anchored text, not recoverable
          // grammar — the CGD14 artifact ruling does not apply to their
          // NAME nodes.
          const isMacroName = !!(n.parent && (n.parent.type === "preproc_def" || n.parent.type === "preproc_function_def"))
          // CGD25: glue fd NAMES never declare (analyzer suppresses the
          // symbol). CGD19-mirror: VARIABLE declarations after the first
          // glue in an ERROR span are body locals (analyzer extractDeclaration
          // gate). Function names (extractFunction path) still declare —
          // os_win.c's 54 real fnDefs inside the giant span are truth.
          const fnNameDecl = (() => {
            if (n.parent && n.parent.type === "function_declarator") {
              let mid: any = n.parent
              while (mid) {
                if (mid.type === "function_definition") return true
                if (mid.type === "declaration") return false
                mid = mid.parent
              }
            }
            return false
          })()
          // CGD38 (M49 W17, measured jq src/jv.c L1963): a FILE-SCOPE
          // enumerator is real even inside an ERROR-glued span. The enum
          // sits between glued function headers, so the CGD19 first-glue
          // position test suppresses it — but the analyzer's extractEnum has
          // no ERROR gate (mirrors extractStruct, CGD14b), so its members
          // are real EnumMember symbols and uses of them resolve
          // (ITER_FINISHED at jv.c L1963/1966/1976/1981 inside the
          // 19013..57718 recovery span). Discriminator: no compound_statement
          // ancestor — enums in bodies stay CGD20 execution artifacts.
          // CGD38a refinement (measured jq src/jv_dtoa.c `emin`): a
          // function-local enum glued OUT of its body by parse recovery
          // (enumerator_list wrapped in preproc_ifdef/preproc_else) has NO
          // compound ancestor anymore either — and the analyzer never
          // creates its members (extractEnum reads only DIRECT
          // enumerator_list children; the preproc wrappers exclude them).
          // Admitting it fabricated `uses emin` truth with no analyzer
          // symbol. Rule: the exemption applies ONLY when the enumerator is
          // a DIRECT child of its enumerator_list (no preproc wrapper
          // between) — exactly the shapes extractEnum can see.
          const isFileScopeEnumerator = n.parent?.type === "enumerator"
            && n.parent?.parent?.type === "enumerator_list"
            && n.parent?.parent?.parent?.type === "enum_specifier"
            && !isFunctionLocal(n)
          const varDeclSuppressed = !fnNameDecl && !isFileScopeEnumerator && isSuppressedErrorDecl(n)
          // #907 round 2: a glued definition the ANALYZER emits at file scope is
          // admitted here on its own arm, because the analyzer's own rule is
          // unconditional at that point — C has no nested functions, so the
          // symbol is file-scope whatever the damaged tree's ancestors say. The
          // generic arm below keeps its gates untouched for everything else.
          const isGlueDefName = isGlueDefinitionName(n, sourceText ?? "")
          if (isGlueDefName || (isDeclaringIdentifier(n) && !isDirectiveConditionText(n) && !isBareFdGlueName(n) && (isMacroName || isFnDefName(n) || (!isFunctionLocal(n) && !varDeclSuppressed)))) {
            declaredNames.add(n.text)
            // CGD41: a function-like macro's definition site (its NAME's parent
            // is the preproc_function_def) is what makes the name unmaskable-as-
            // binding later — see the collector's gate.
            if (n.parent && (n.parent.type === "preproc_function_def")) functionLikeMacros.add(n.text)
          }
        }
      }
      for (let k = 0; k < n.namedChildCount; k++) pre.push(n.namedChild(k))
    }
  }
  // CGD15: per-function locals mirror (params + locally-bound names) —
  // the analyzer suppresses a use when the CURRENT function binds the name
  // locally (functionLocals), so `offset` as a PARAMETER of the reading
  // function must not surface as truth merely because some struct elsewhere
  // has a field named offset. Keyed by function startIndex; the emission
  // branch resolves the ENCLOSING function.
  const fnLocals = new Map<number, Set<string>>()
  {
    const pre: any[] = [root]
    while (pre.length > 0) {
      const n = pre.pop()!
      if (n.type === "function_definition") {
        const locals = new Set<string>()
        const declarator = n.childForFieldName("declarator")
        const collectParam = (node: any): void => {
          if (!node) return
          if (node.type === "parameter_declaration") {
            const id = leftmostDeclaratorIdentifier(node)
            if (id) locals.add(id)
            return
          }
          for (let k = 0; k < node.namedChildCount; k++) collectParam(node.namedChild(k))
        }
        if (declarator) collectParam(declarator)
        const body = n.childForFieldName("body")
        const collectLocalDecl = (node: any): void => {
          if (!node) return
          if (node.type === "declaration") {
            for (let k = 0; k < node.namedChildCount; k++) {
              const c = node.namedChild(k)
              if (c && (c.type.endsWith("declarator") || c.type === "identifier")) {
                const id = leftmostDeclaratorIdentifier(c)
                // CGD41 (#908): a function-like macro's NAME never BINDS — it
                // is expanded away, and the mention is a use (emitted by the
                // identifier path). Without this the L2230 macro-invocation
                // declarator put the name in yyparse's locals and suppressed
                // the genuine L2229 use.
                if (id && !functionLikeMacros.has(id)) locals.add(id)
              }
            }
          }
          for (let k = 0; k < node.namedChildCount; k++) collectLocalDecl(node.namedChild(k))
        }
        if (body) collectLocalDecl(body)
        fnLocals.set(n.startIndex as number, locals)
      }
      for (let k = 0; k < n.namedChildCount; k++) pre.push(n.namedChild(k))
    }
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "call_expression") {
      // identifier callee OR member/pointer callee -> its callable LEAF.
      // CGD3 mirror: a parenthesized callee is a vendor-macro cast or a
      // computed deref — no resolvable NAME, dropped on both sides. Calls
      // INSIDE the call (cast arguments) still walk below and emit.
      const fn = n.namedChildren.find((c: any) => c.type === "identifier" || c.type === "field_expression")
      let name: string | undefined
      if (fn?.type === "field_expression") {
        const leaf = fn.namedChildren.find((c: any) => c.type === "field_identifier")
        name = leaf?.text
      } else name = fn?.text
      if (name && !seen.has(name)) {
        seen.add(name)
        edges.push({ label: "calls", from: "(expr)", target: name })
      }
    } else if (n.type === "field_expression") {
      // CGD-FIELD mirror: member reads are `uses` on the field leaf; an
      // assignment-LHS field is a WRITE (analyzer SCD1 gate).
      const parent = n.parent
      const isCallee = !!parent && parent.type === "call_expression"
      if (!isCallee && !isAssignLhs(n)) {
        const leaf = n.namedChildren.find((c: any) => c.type === "field_identifier")
        if (leaf && !seen.has("use:" + leaf.text)) {
          seen.add("use:" + leaf.text)
          edges.push({ label: "uses", from: "(expr)", target: leaf.text })
        }
      }
    } else if (n.type === "type_identifier") {
      // CGD10: a type-name READ (`sizeof(struct RenameToken)`, `sizeof(X)`
      // via type_identifier inside type_descriptor) is a REFERENCES edge to
      // a type DECLARED in this file — the analyzer's type_reference
      // contract. The declaring occurrence itself is skipped via
      // isDeclaringIdentifier (struct_specifier name is captured as the
      // child, so check parent type_identifier positions only).
      if (!isDeclaringIdentifier(n) && !isDirectiveConditionText(n)) {
        const name = n.text
        if (name && declaredTypes.has(name) && !seen.has("ref:" + name)) {
          seen.add("ref:" + name)
          edges.push({ label: "references", from: "(expr)", target: name })
        }
      }
    } else if (n.type === "preproc_include") {
      // CGD16: include truth mirrors the analyzer's include_dependency edge —
      // target is the RAW path text (quotes/brackets stripped), measured from
      // the analyzer (`imports sqliteInt.h`).
      //
      // M60/#910: the KIND is `imports`, not `references`. The oracle is the
      // analyzer's mirror, so the ontology change had to land on both sides in
      // one round: pre-fix the analyzer emitted references+isImport and this
      // pushed `references`, which kept the asymmetry invisible to every
      // harness while the LSP reader saw a kind that could never match.
      const pathNode = n.namedChildren.find((c: any) => c.type === "string_literal" || c.type === "system_lib_string")
      if (pathNode) {
        const raw = pathNode.text.replace(/^["<]/, "").replace(/[">]$/, "")
        if (raw && !seen.has("inc:" + raw)) {
          seen.add("inc:" + raw)
          edges.push({ label: "imports", from: "(expr)", target: raw })
        }
      }
    } else if (n.type === "identifier" && !isAssignLhs(n)) {
      // CGD-IDENT mirror: a bare identifier READ of a file-scope variable,
      // enum member, or macro constant. Truth requires the name to be
      // DECLARED somewhere in this file (mirrors isResolvableUseTarget:
      // no fabricated edges to undeclared names). Call-target identifiers
      // are covered by the calls branch above.
      const p = n.parent
      // CGD-PREPROC: condition-text mentions emit no truth even when the
      // name is declared elsewhere (a `#if SQLITE_WASI` reference to an
      // external flag is not a code-level use).
      // CGD39 (M49 W17, measured jq src/jv_dtoa.c NO_HEX_FP/ROUND_BIASED/
      // Sudden_Underflow): a bare identifier dissolved into a TOP-LEVEL
      // ERROR blob (ERROR directly under translation_unit — no surviving
      // code container, no preproc_* ancestor) is parse-recovery debris:
      // the `#ifdef X` line lost every grammatical anchor, so
      // isDirectiveConditionText is blind and no reading of the mention is
      // possible. The analyzer is correctly silent (valueless guard defines
      // are not symbols) — micro-repro w17-jqc-valueless2.ts: analyzer=[]
      // oracle=[uses].
      // CGD39a (measured jq src/builtin.c LIBM_* L2056-2061, src/lexer.c
      // yynoreturn L565, src/parser.c YY_INITIAL_VALUE): an ERROR nested
      // INSIDE surviving containers (argument_list < call_expression,
      // declaration, function_definition) is a swallowed FRAGMENT of a real
      // code line — the mention keeps its container reading and the
      // analyzer's declaredNames-macro contract emits there. Truth MUST
      // mirror (pre-CGD39 those lanes were covered). Scope: only
      // ERROR-parented mentions whose ERROR hangs off the translation_unit
      // are suppressed; everything else keeps the normal gates.
      const isTopLevelErrorDebris = p?.type === "ERROR" && p.parent?.type === "translation_unit"
      // CGD40 (M49 W17, measured jq src/jv_dtoa.c ROUND_BIASED L4038 +
      // src/builtin.c #undef LIBM_* L2056-2061): parse recovery SPLICES
      // directive lines into continuing code — the `#ifndef ROUND_BIASED`
      // mention survives as an operand of the surrounding if-condition's
      // binary_expression, structurally identical to a real use. The C
      // preprocessor is line-anchored text (C-D2), so the honest
      // discriminator is PHYSICAL: a mention whose source line starts with
      // '#' is directive text no matter where recovery glued the node. The
      // analyzer's own CGD11 is blind to the spliced shape (no preproc_*
      // ancestor survives) — its L2056-2061 emissions are artifacts the
      // same rule suppresses on the analyzer side.
      const isHashLine = sourceText !== undefined
        ? (() => {
            const bol = sourceText.lastIndexOf("\n", n.startIndex - 1) + 1
            let i = bol
            while (i < n.startIndex && (sourceText[i] === " " || sourceText[i] === "\t")) i++
            return sourceText[i] === "#"
          })()
        : false
      // #907 round 2 mirror: the NAME of a recovered glued definition is a
      // declaration of that name, not a read of it. The analyzer suppresses this
      // exact occurrence (gluedDefNameOffsets) because the damaged tree makes the
      // header look like an expression — without the same suppression here, truth
      // would expect a `uses` edge the analyzer correctly refuses to emit
      // (decNumber.c L2284/2304/2309: `decNumberPower uses decNumberQuantize`).
      const isGlueDefNameOccurrence = isGlueDefinitionName(n, sourceText ?? "")
      // #917 mirror: the naming occurrence of a macro-wrapped heading is a
      // DECLARATION of the name the heading defines, never a read of it (the
      // analyzer's pinned #917 contract) — see isWrappedHeadingName above.
      const isWrappedHeadingNameOccurrence = isWrappedHeadingName(n)
      if (p && p.type !== "call_expression" && !isTopLevelErrorDebris && !isHashLine && !isDeclaringIdentifier(n) && !isDirectiveConditionText(n) && !isGlueDefNameOccurrence && !isWrappedHeadingNameOccurrence) {
        const name = n.text
        // CGD15: a function-local BINDING of the name (param or local
        // declaration in the enclosing function) shadows the file-scope
        // name — the analyzer's functionLocals.has gate suppresses those
        // reads, so truth must too.
        let enc: any = n.parent
        while (enc && enc.type !== "function_definition") enc = enc.parent
        const locs = enc ? fnLocals.get(enc.startIndex) : undefined
        // CGD28: cast-to-typedef positions are type references, not value
        // uses — the analyzer re-routes them to `references` via
        // isTypePositionIdentifier(cast_expression) when the name IS a
        // declared type; M49 W22 (measured jimsh0.c L12183 `sizeof(jim_wide)`):
        // a type-position name that is NOT a declared type but IS a declared
        // VALUE/macro keeps its normal read path — exactly the analyzer's
        // CGD12 contract ("a value-only name keeps its normal path"):
        // jim_wide expands to a type via #define, so the mention is a
        // genuine macro USE and the analyzer emits it. Type-only names keep
        // the references leg; names with no declaration anywhere stay silent
        // (CGD33).
        if (isCastTypePosition(n)) {
          if (name && declaredTypes.has(name) && !seen.has("ref:" + name)) {
            seen.add("ref:" + name)
            edges.push({ label: "references", from: "(expr)", target: name })
          } else if (name && declaredNames.has(name) && !(locs && locs.has(name)) && !seen.has("use:" + name)) {
            seen.add("use:" + name)
            edges.push({ label: "uses", from: "(expr)", target: name })
          }
        } else if (name && declaredNames.has(name) && !(locs && locs.has(name)) && !seen.has("use:" + name)) {
          seen.add("use:" + name)
          edges.push({ label: "uses", from: "(expr)", target: name })
        }
      }
    }
    for (let k = 0; k < n.namedChildCount; k++) stack.push(n.namedChild(k))
  }
  return edges
}

// Go truth: mirror the analyzer's leaf-target call contract, struct
// embedding (extends), and PascalCase constructor instantiation.
// Calls: every call_expression whose callee is an identifier or a
// selector_expression => LEAF target (pkg.Fn -> Fn, s.repo.Save -> Save).
// stdlib/external leaves are kept as truth (like rust/c). Builtins
// (make/len/append/new/...) are deliberately not truth (analyzer excludes).
// Extends: anonymous embedded fields in a struct (Go composition).
// Instantiates: calls to in-file PascalCase top-level constructor
// functions (NewFoo) => instantiates the ctor target (family convention).
export function deriveGoEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const GOBUILTINS = new Set(["make", "new", "len", "cap", "append", "copy", "delete", "panic", "recover", "print", "println", "close"])

  // In-file top-level (non-method) function/method names. Mirror the
  // analyzer's resolveGoFunctionCall contract EXACTLY:
  //   - package-qualified / selector callee (s.start, pkg.Fn) => leaf kept
  //     unconditionally (stdlib/external leaves are truth, like rust/c)
  //   - bare identifier callee => emitted ONLY if it names an in-file
  //     declared top-level function OR method (type conversions string(x),
  //     float64(x), closure vars fn(), bare externals are NOT truth -
  //     the analyzer resolves them to no local symbol and drops them).
  // declaredFns: every in-file top-level function AND method name (used for
  // BARE-callee call truth, mirroring resolveGoFunctionCall which needs a
  // matching Function/Method symbol). ctorFns: top-level functions ONLY
  // (no receiver) — the analyzer's instantiates fires only for PascalCase
  // TOP-LEVEL FUNCTION symbols (`!s.ownerName && kind === Function`), never
  // for methods, so type conversions and method leaves never instantiate.
  const declaredFns = new Set<string>()
  const ctorFns = new Set<string>()
  {
    const pre: any[] = [root]
    while (pre.length > 0) {
      const n = pre.pop()!
      if (n.type === "function_declaration") {
        const nm = n.childForFieldName?.("name")
        if (nm) { declaredFns.add(nm.text); ctorFns.add(nm.text) }
      } else if (n.type === "method_declaration") {
        const nm = n.childForFieldName?.("name")
        if (nm) declaredFns.add(nm.text)
      }
      for (let k = 0; k < n.namedChildCount; k++) pre.push(n.namedChild(k))
    }
  }

  const stack: any[] = [root]
  // GO3 mirror: a dot-import (`import . "fmt"`) lets bare identifiers name
  // dot-imported members — the analyzer resolves bare callees leniently
  // (besides builtins), so bare leaves are truth here too.
  let hasDotImport = false
  {
    const pre: any[] = [root]
    while (pre.length > 0 && !hasDotImport) {
      const m = pre.pop()!
      if (m.type === "import_spec") {
        for (let k = 0; k < (m.namedChildCount ?? 0); k++) {
          if (m.namedChild(k)?.type === "dot") { hasDotImport = true; break }
        }
      }
      for (let k = 0; k < (m.namedChildCount ?? 0); k++) { const c = m.namedChild(k); if (c) pre.push(c) }
    }
  }
  const leafOf = (fn: any): { leaf?: string; qualified: boolean } => {
    if (!fn) return { qualified: false }
    if (fn.type === "identifier") return { leaf: fn.text, qualified: false }
    if (fn.type === "selector_expression") {
      const f = fn.childForFieldName?.("field")
      return { leaf: f?.text, qualified: true }
    }
    return { qualified: false }
  }
  // Deep-review alignment 2026-08-29 (go family final pass, go-tools @200
  // measured 12 MISSING): mirror the analyzer's package-scope closure
  // contract. Inside a function body findGoFunctionCalls descends closure
  // bodies (goroutines/callbacks are reachable), but at PACKAGE scope only an
  // IMMEDIATELY-invoked func literal (`var x = func(){...}()` -> parent is
  // call_expression) runs at init, so only those bodies are descended; a
  // STORED package closure (`var table = map...{func(){...}}`) is a template
  // not executed at init and its body must be skipped. The flat DFS below
  // previously descended every func_literal body, over-deriving calls from
  // stored package closures the analyzer correctly omits.
  const isInsideFunctionBody = (node: any): boolean => {
    let p: any = node.parent
    while (p) {
      if (p.type === "function_declaration" || p.type === "method_declaration") return true
      p = p.parent
    }
    return false
  }
  while (stack.length > 0) {
    const n = stack.pop()!
    // NOTE (#889 round): the guard for grammar error regions is deliberately
    // NARROW — see the composite-literal branch below. Skipping every ERROR
    // subtree here was the first draft, and it cost 4 real calls the analyzer
    // legitimately emits from recovered regions (the analyzer's own walk skips
    // ERROR subtrees, but its SYMBOL walk still reaches functions that error
    // recovery re-parsed afterwards, so a blanket oracle skip desynchronises
    // the two sides in the other direction). Only the construction synthesis,
    // which INVENTS a type name out of error-mangled text, is refused.
    if (n.type === "func_literal") {
      // Stored package-scope closure (non-IIFE, not inside any function body):
      // template, not executed at init -> skip body entirely. IIFE closures
      // and in-function closures are descended normally below.
      const isIIFE = n.parent && n.parent.type === "call_expression"
      if (!isIIFE && !isInsideFunctionBody(n)) {
        continue
      }
    }
    if (n.type === "call_expression") {
      const fn = n.childForFieldName?.("function")
      const { leaf: name, qualified } = leafOf(fn)
      const isCtor = !!name && /^[A-Z]/.test(name) && name[0] !== name[0].toLowerCase()
      // Call truth: qualified leaves unconditionally; bare callees need an
      // in-file declared function/method (string(x), float64(x) conversions
      // and closure vars fn() are type/bare names not in declaredFns -> not
      // truth, mirroring the analyzer's resolveGoFunctionCall drop). GO3:
      // with a dot-import, bare names may be dot-imported members.
      const emit = !!name && !GOBUILTINS.has(name) && (qualified || declaredFns.has(name) || hasDotImport)
      if (emit && !seen.has("call:" + name)) {
        seen.add("call:" + name)
        edges.push({ label: "calls", from: "(expr)", target: name })
      }
      // Instantiates: only in-file TOP-LEVEL constructor FUNCTIONS (NewFoo).
      // ctorFns excludes methods (analyzer: `!s.ownerName && Function`), so
      // method leaves and stdlib ctors never instantiate.
      if (isCtor && ctorFns.has(name) && !seen.has("inst:" + name)) {
        seen.add("inst:" + name)
        edges.push({ label: "instantiates", from: "(expr)", target: name })
      }
    } else if (n.type === "composite_literal") {
      // A GRAMMAR error region is not evidence of a construction (#889 round).
      // The pinned tree-sitter-go errors on two LEGAL constructs — a
      // package-scope generic function VALUE (`var _ = slices.Backward[[]int]`)
      // and a method on an instantiated generic receiver (`func (Either[A, B])
      // A() A`) — and error RECOVERY re-reads the next declaration's text as a
      // composite literal: `func caller(s []int) {` became
      // `composite_literal "s []int) { _ = s }"`, from which BOTH sides
      // published `instantiates -> s`, a construction of a name the source
      // never constructs (it is a parameter of the mangled declaration). The
      // analyzer's composite pass never descends into an ERROR subtree; this is
      // the same rule expressed against the flat DFS, so the fabrication
      // disappears on both sides at once instead of reading as MISSING on one.
      let inError = false
      for (let p: any = n.parent; p; p = p.parent) {
        if (p.type === "ERROR" || p.isMissing) {
          inError = true
          break
        }
      }
      // Composite-literal construction (`Foo{...}`, `&Foo{...}`,
      // `pkg.Foo{...}`) -> instantiates of the type leaf. Mirror of the
      // analyzer's analyzeGoCompositeLiteralConstruction (M37 #604): only
      // type_identifier / qualified_type children name a type; slice/map/
      // array literals carry wrapper type children and elided element
      // literals have none, so both fall through to no edge. Builtin guard
      // matches the analyzer. In an ERROR region no literal is read at all —
      // but the traversal continues, because a real declaration can sit
      // deeper inside a recovered region and must not be lost.
      const typeN = inError ? undefined : (n.childForFieldName?.("type") ?? (n.namedChildCount > 0 ? n.namedChild(0) : undefined))
      let ctorTarget: string | undefined
      if (typeN && typeN.type === "type_identifier") {
        ctorTarget = typeN.text
      } else if (typeN && typeN.type === "qualified_type") {
        const raw = typeN.text
        ctorTarget = lastSegment(raw)
      } else if (typeN && typeN.type === "generic_type") {
        // GO8 mirror: generic composite literals (`Box[int]{...}`) —
        // constructed type is the base type_identifier.
        const base = typeN.namedChildCount > 0 ? typeN.namedChild(0) : undefined
        if (base && (base.type === "type_identifier" || base.type === "qualified_type")) {
          ctorTarget = lastSegment(base.text)
        }
      }
      if (ctorTarget && !GOBUILTINS.has(ctorTarget) && !seen.has("inst-lit:" + ctorTarget)) {
        seen.add("inst-lit:" + ctorTarget)
        edges.push({ label: "instantiates", from: "(expr)", target: ctorTarget })
      }
    } else if (n.type === "type_declaration") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const ts = n.namedChild(i)
        if (!ts || ts.type !== "type_spec") continue
        const nm = ts.childForFieldName?.("name")
        const structN = ts.namedChildren.find((c: any) => c.type === "struct_type")
        if (nm && structN) {
          const fdl = structN.namedChildren.find((c: any) => c.type === "field_declaration_list")
          if (fdl) {
            for (let j = 0; j < fdl.namedChildCount; j++) {
              const fd = fdl.namedChild(j)
              if (!fd || fd.type !== "field_declaration") continue
              // Embedded field: no field_identifier/name child, only a type.
              const hasName = (fd.namedChildren ?? []).some((c: any) => c.type === "field_identifier" || c.type === "identifier")
              if (hasName) continue
              const typeN =
                fd.childForFieldName?.("type") ??
                (fd.namedChildren ?? []).find(
                  (c: any) => c.type === "type_identifier" || c.type === "qualified_type" || c.type === "generic_type" || c.type === "pointer_type",
                )
              if (typeN) {
                // The embedded field's NAME, not its text: `lastSegment(raw)`
                // put the last dot INSIDE a generic's type arguments and
                // published `Example]` for `listers.ResourceIndexer[*crv1.Example]`
                // (see goEmbeddedLeaf).
                const t = goEmbeddedLeaf(typeN)
                if (t && !seen.has("ext:" + nm.text + "->" + t)) {
                  seen.add("ext:" + nm.text + "->" + t)
                  edges.push({ label: "extends", from: nm.text, target: t })
                }
              }
            }
          }
        }
        // Interface embedding (`interface { Reader; io.Closer }`) = Go
        // interface inheritance -> extends, mirror of the analyzer's
        // go_interface_embedding (GOD4/M37 #604). Target is the LEAF so it
        // matches the analyzer byte-for-byte for both local (Reader) and
        // external (io.Closer -> Closer) embeds.
        const ifaceN = ts.namedChildren.find((c: any) => c.type === "interface_type")
        if (nm && ifaceN) {
          for (let j = 0; j < ifaceN.namedChildCount; j++) {
            const elem = ifaceN.namedChild(j)
            if (!elem || elem.type !== "constraint_elem") continue
            const inner = elem.namedChildCount > 0 ? elem.namedChild(0) : undefined
            if (!inner) continue
            // GO2 mirror: union/tilde members (`int | string`, `~int`) are
            // not embedded interfaces — only plain type references extend.
            if (inner.type !== "type_identifier" && inner.type !== "qualified_type") continue
            const raw = inner.text
            const leaf = raw.lastIndexOf(".") !== -1 ? raw.slice(raw.lastIndexOf(".") + 1) : raw
            if (!leaf || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(leaf)) continue
            const key = "ext:" + nm.text + "->" + leaf
            if (leaf && !seen.has(key)) {
              seen.add(key)
              edges.push({ label: "extends", from: nm.text, target: leaf })
            }
          }
        }
      }
    }
    for (let k = 0; k < n.namedChildCount; k++) stack.push(n.namedChild(k))
  }
  return edges
}

// C# second-opinion oracle (csharp #264 wave). Re-derives the SAME relationship
// set the analyzer emits, independently, so disagreements surface as
// missing/unexplained rather than being copied. Mirrors the analyzer's
// deterministic C# base-list rule (CSD1): a type's base_list children are
// ordered — the FIRST entry is the base class (extends), every remaining
// entry is an interface (implements). Instantiates comes from
// object_creation_expression; calls come from invocation_expression leaf
// targets (the analyzer's leaf-target M12 contract, like go/rust).

// Mirror of RealCSharpAnalyzer.cleanTypeName: strip generics (`<...>`) and
// nullable (`?`) suffixes, but KEEP the full qualified prefix (no lastSegment)
// so the oracle's implicit-new target matches the analyzer's instantiates
// target byte-for-byte before normTarget reduction.
function csharpCleanTypeName(text: string): string {
  const lt = text.indexOf("<")
  const base = lt > 0 ? text.slice(0, lt) : text
  const q = base.indexOf("?")
  return (q > 0 ? base.slice(0, q) : base).trim()
}

// CSD14 (OO family closure 2026-09): single shared source of truth with the
// analyzer — csharpResolveTargetTypedNew handles direct assignments (declared
// type), collection/array element positions (element type) and assignment-form
// member resolution through the memberTypes prepass. The old local DFS over the
// property subtree picked argument/initializer identifiers (Description, UNSET)
// as targets — the exact fabrication class this shared helper eliminates.
function csharpImplicitNewType(node: any, memberTypes?: Map<string, string>): string | null {
  return csharpResolveTargetTypedNew(node, memberTypes)
}

/**
 * R9 (#804): the declared-type reference graph, as TRUTH.
 *
 * Derived from the analyzer's own `csharpDeclaredTypeRefs` — deliberately not a second
 * implementation. A truth that re-implements the rule can disagree with it in silence
 * (the reason CSD14 exists), and here the failure mode is specific: the analyzer's new
 * `references` edges would surface in every depth draw as ANALYZER-ONLY, and the fix
 * would look like a widening of the oracle rather than the lockstep it is.
 *
 * The label is `references` (the edge type both sides publish); the marker and the
 * declared position are analyzer-side metadata the differential does not compare.
 */
export function deriveCSharpDeclaredTypeEdges(root: any): { label: string; from: string; target: string }[] {
  return csharpDeclaredTypeRefs(root).map((ref) => ({ label: "references", from: ref.source, target: ref.target }))
}

/**
 * R9 (#804): the `references` edge every `using` directive publishes, as truth.
 *
 * Needed the moment csharp's `references` label became COMPARABLE (see the harness
 * allowlist): the lane's using-directive references are `references` edges, so without
 * this truth they would all read as fabrication. The target comes from the analyzer's own
 * `csharpUsingDirectiveTarget` — the alias/plain shapes have the SAME textual shape and
 * only tree POSITION tells them apart (CSD7), so re-deriving it here would be a second
 * reading free to disagree.
 */
export function deriveCSharpUsingReferences(root: any): { label: string; from: string; target: string }[] {
  const out: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "using_directive") {
      const t = csharpUsingDirectiveTarget(n)
      if (t && !seen.has(t.module)) {
        seen.add(t.module)
        out.push({ label: "references", from: "root", target: t.module })
      }
    }
    for (const c of n.namedChildren ?? []) stack.push(c)
  }
  return out
}

export function deriveCSharpEdges(root: any, corpusInterfaces?: Set<string>): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const leafOf = (t: string): string => {
    // generic_name: IComparer<Circle> -> IComparer; qualified: A.B.C -> C
    const lt = t.indexOf("<")
    const base = lt >= 0 ? t.slice(0, lt) : t
    // M59.A7 (#825, lockstep): the analyzer canonicalises a WRAPPED qualified
    // base's whitespace (csharpTypeNameText), so the truth must clean the same
    // way — otherwise the two sides compare different strings for one
    // declaration. Shared from the analyzer, never a second copy (CSD14).
    return lastSegment(csharpTypeNameText(base))
  }
  // Receiver wrappers the analyzer suppresses (isCSharpBuiltin: Console
  // output, Environment/GC/Debug/Trace noise). Deliberately NOT `string`/
  // `object` — string.Create / object.Equals are real framework calls.
  // Mirror RealCSharpAnalyzer.isCSharpBuiltin: the ANALYZER filters only the
  // exact full-call CSHARP_BUILTINS strings (Console.WriteLine, GC.Collect,
  // Debug.Write, ...) plus Object-method leaves — it does NOT blanket-suppress
  // whole receivers. So `Debug.Assert`, `File.Close`, `Math.Abs` are real
  // framework calls the analyzer keeps and the oracle must CONFIRM, not hide.
  const CSHARP_BUILTINS_ORACLE = new Set([
    "Console.WriteLine", "Console.Write", "Console.WriteAsync",
    "Console.Error.WriteLine", "Console.Error.Write", "Console.Error.WriteAsync",
    "Console.Out.WriteLine", "Console.Out.Write", "Console.Out.WriteAsync",
    "Environment.Exit", "Environment.GetEnvironmentVariable", "Environment.GetEnvironmentVariables", "Environment.SetEnvironmentVariable",
    "GC.Collect", "GC.SuppressFinalize", "GC.WaitForPendingFinalizers",
    "Debug.WriteLine", "Debug.Write", "Debug.Print",
    "Trace.WriteLine", "Trace.Write",
  ])
  // In-file declared type kinds, mirroring the analyzer's typeKinds pre-pass
  // (CSD1). Lets `class X : ISomeInterface` resolve to implements even when
  // the interface is the FIRST base-list entry — the two sides only diverge
  // on cross-file interface kinds, which is the declared per-file limitation.
  const declKinds = new Map<string, string>()
  // CSD11 mirror: field/property declarator name -> declared type, feeding
  // assignment-form target-typed new() resolution (same pre-pass shape as
  // RealCSharpAnalyzer.collectMemberTypes).
  const memberTypes = new Map<string, string>()
  // C923 (#923) mirror: the member-level interface-implementation contract. The analyzer
  // publishes `overrides Owner.member -> Iface.member` for an EXPLICIT interface member always,
  // and for an IMPLICIT one only where the interface's member set is known (an interface declared
  // in this file — see resolveInterfaceImplementations). The oracle must derive the identical
  // class or the two sides disagree the moment this label is ever compared; the analyzer's
  // shipped rule is per-file by construction, so the truth is too, with no corpus companion.
  //
  // The blind spot this creates is DISCLOSED rather than hidden: `overrides` is already excluded
  // from csharp's corpus comparison (pre-existing, unchanged by this round), so the class's
  // independent evidence is the tree-vs-lane reconciliation in
  // script/m60/verify-c923-interface-members.ts plus its fixture and reverting mutant — not this
  // oracle, which now mirrors the rule it would have to adjudicate.
  const ifaceMemberNames = new Map<string, Set<string>>()
  const classMemberNames = new Map<string, Set<string>>()
  const typeBaseLeaves = new Map<string, string[]>()
  const CSHARP_IFACE_MEMBER_DECLS = new Set(["method_declaration", "property_declaration", "event_declaration", "event_field_declaration", "indexer_declaration"])
  /**
   * Every member a type declaration declares, descended through EVERY intermediate node except
   * nested type declarations: a member inside `#if`/`#region` sits under a `preproc_if`, and
   * powershell's ConsoleHost.cs is that shape — reading only the direct children of
   * `declaration_list` made four explicit interface properties invisible to this oracle.
   * An indexer carries no `name` field; the analyzer publishes its symbol as `this`, so the truth
   * spells it the same way.
   */
  const csharpMemberNodes = (decl: any): any[] => {
    const out: any[] = []
    const q: any[] = (decl.namedChildren ?? []).slice()
    while (q.length > 0) {
      const m = q.pop()!
      if (m !== decl && /^(class|interface|struct|record|enum)_declaration$/.test(m.type)) continue
      if (CSHARP_IFACE_MEMBER_DECLS.has(m.type)) { out.push(m); continue }
      for (const c of m.namedChildren ?? []) q.push(c)
    }
    return out
  }
  const csharpMemberName = (m: any): string | undefined => {
    const direct = m.childForFieldName?.("name")?.text
    if (typeof direct === "string" && direct.length > 0) return direct
    if (m.type === "indexer_declaration") return "this"
    // A field-like event writes its name on the `variable_declarator`, never on a `name` field.
    if (m.type === "event_field_declaration") {
      const vd = (m.namedChildren ?? []).find((c: any) => c.type === "variable_declaration")
      const decl = (vd?.namedChildren ?? []).find((c: any) => c.type === "variable_declarator")
      const id = (decl?.namedChildren ?? []).find((c: any) => c.type === "identifier")
      if (id && typeof id.text === "string" && id.text.length > 0) return id.text
    }
    return undefined
  }
  {
    const pre: any[] = [root]
    while (pre.length) {
      const t = pre.pop()!
      if (/^(class|interface|struct|record)_declaration$/.test(t.type)) {
        const nm = t.childForFieldName?.("name")?.text
        if (nm) declKinds.set(nm, t.type.startsWith("interface") ? "interface" : t.type.includes("struct") ? "struct" : "class")
        if (nm && t.type === "interface_declaration") {
          let set = ifaceMemberNames.get(nm)
          if (!set) { set = new Set<string>(); ifaceMemberNames.set(nm, set) }
          for (const m of csharpMemberNodes(t)) {
            const mn = csharpMemberName(m)
            if (mn) set.add(mn)
          }
        }
        // The CLASS side of the contract: a base class that declares a member already fills
        // that interface slot, so the implicit walk stops there (the analyzer's rule).
        if (nm && t.type !== "interface_declaration") {
          let cset = classMemberNames.get(nm)
          if (!cset) { cset = new Set<string>(); classMemberNames.set(nm, cset) }
          for (const m of csharpMemberNodes(t)) {
            const mn = csharpMemberName(m)
            if (mn) cset.add(mn)
          }
        }
        if (nm) {
          const bl = t.namedChildren.find((c: any) => c.type === "base_list")
          const bases: string[] = []
          for (const b of bl?.namedChildren ?? []) {
            if (!b || b.type === "argument_list") continue
            // primary_constructor_base_type (a record's / class's primary base) writes its type
            // name as an identifier child; the analyzer's own shape (CSD9).
            const tn = b.type === "primary_constructor_base_type"
              ? (b.namedChildren ?? []).find((c: any) => c.type === "identifier" || c.type === "generic_name")
              : b
            if (tn && typeof tn.text === "string") bases.push(leafOf(tn.text))
          }
          if (!typeBaseLeaves.has(nm)) typeBaseLeaves.set(nm, bases)
        }
      }
      if (t.type === "field_declaration" || t.type === "property_declaration") {
        const isField = t.type === "field_declaration"
        // CSD14 mirror (OO family closure 2026-09): shared
        // csharpMemberDeclaredTypeText unwraps array/pointer/nullable
        // containers so array-typed members no longer self-map (the old
        // direct-child scan fell through to the member NAME). RAW type text is
        // stored; base/element resolution happens at use time.
        const declaredType = csharpMemberDeclaredTypeText(t) ?? undefined
        const names: string[] = []
        if (isField) {
          const typeContainer = t.namedChildren.find((c: any) => c.type === "variable_declaration")
          if (typeContainer) {
            for (const d of typeContainer.namedChildren) {
              if (d.type === "variable_declarator") {
                const id = d.namedChildren.find((c: any) => c.type === "identifier")
                if (id) names.push(id.text)
              }
            }
          }
        } else {
          const nm = t.childForFieldName?.("name")?.text
          if (nm) names.push(nm)
        }
        if (declaredType) for (const nm of names) if (!memberTypes.has(nm)) memberTypes.set(nm, declaredType)
      }
      for (let k = 0; k < t.namedChildCount; k++) pre.push(t.namedChild(k))
    }
  }

  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "class_declaration" || n.type === "interface_declaration" || n.type === "struct_declaration" || n.type === "record_declaration") {
      const nameNode = n.childForFieldName?.("name")
      const nm = nameNode?.text
      const baseList = n.namedChildren.find((c: any) => c.type === "base_list")
      // C923 (#923): the member-level implements truth, derived for EVERY type declaration
      // (not only the ones with a base list — an explicit interface member whose class omits the
      // interface is invalid C#, but a truth that silently skipped the shape would hide exactly
      // the defect this round exists to catch).
      if (nm && n.type !== "interface_declaration") {
        const declaredBases = typeBaseLeaves.get(nm) ?? []
        for (const m of csharpMemberNodes(n)) {
          const mn = csharpMemberName(m)
          if (!mn) continue
          const spec = (m.namedChildren ?? []).find((c: any) => c.type === "explicit_interface_specifier")
          let target: string | null = null
          if (spec && typeof spec.text === "string") {
            const raw = spec.text
            let end = raw.length
            while (end > 0) {
              const ch = raw.charCodeAt(end - 1)
              if (ch === 46 || ch === 32 || ch === 9 || ch === 10 || ch === 13) end--
              else break
            }
            const iface = leafOf(raw.slice(0, end))
            if (iface) target = `${iface}.${mn}`
          } else if (declaredBases.length > 0) {
            // BFS in declaration order over IN-FILE declared bases (the shipped rule).
            const queue: string[] = [...declaredBases]
            const visited = new Set<string>()
            while (queue.length > 0) {
              const parent = queue.shift()!
              if (visited.has(parent)) continue
              visited.add(parent)
              if (ifaceMemberNames.get(parent)?.has(mn)) { target = `${parent}.${mn}`; break }
              if (classMemberNames.get(parent)?.has(mn)) continue
              for (const b of typeBaseLeaves.get(parent) ?? []) if (!visited.has(b)) queue.push(b)
            }
          }
          if (!target) continue
          const key = `implmem:${nm}.${mn}->${target}`
          if (!seen.has(key)) {
            seen.add(key)
            edges.push({ label: "overrides", from: `${nm}.${mn}`, target })
          }
        }
      }
      if (nm && baseList) {
        const baseTypes: string[] = []; for (const b of baseList.namedChildren) if (b) baseTypes.push(leafOf(b.text))
        const isInterfaceDecl = n.type === "interface_declaration"
        for (let i = 0; i < baseTypes.length; i++) {
          const target = baseTypes[i]
          if (!target) continue
          // C#: an interface only EVER $extends other interfaces (no
          // interface-implements keyword). Mirror the analyzer's isInterface
          // branch exactly.
          if (isInterfaceDecl) {
            const key = `extends:${nm}->${target}`
            if (!seen.has(key)) { seen.add(key); edges.push({ label: "extends", from: nm, target }) }
            continue
          }
          // class/struct/record: mirror the analyzer — in-file kind, then the
          // corpus interface set (the oracle's cross-file companion), then the
          // qualified-name leaf (a nested type like Outer.Base is keyed by its
          // leaf Base in the kind maps), then the deterministic rule
          // (first=extends, later-unknown=implements).
          const dot = target.lastIndexOf(".")
          const leaf = dot > 0 ? target.slice(dot + 1) : target
          const knownIface =
            declKinds.get(target) === "interface" || corpusInterfaces?.has(target) ||
            declKinds.get(leaf) === "interface" || corpusInterfaces?.has(leaf)
          const knownClass =
            declKinds.get(target) === "class" || declKinds.get(target) === "struct" ||
            declKinds.get(leaf) === "class" || declKinds.get(leaf) === "struct"
          const declaredKind = knownIface ? "interface" : knownClass ? "class" : undefined
          // CSD12 mirror: struct bases are ALWAYS interfaces; an unknown
          // external index-0 I-prefixed PascalCase name is conventionally an
          // interface (matches the analyzer's looksLikeInterface exactly).
          const isStructDecl = n.type.includes("struct")
          const looksLikeInterface = !declaredKind && (isStructDecl || (i === 0 && /^[I][A-Z]/.test(leaf) && leaf.length > 2))
          const label = knownIface || looksLikeInterface || (i > 0 && !declaredKind) ? "implements" : "extends"
          const key = `${label}:${nm}->${target}`
          if (!seen.has(key)) {
            seen.add(key)
            edges.push({ label, from: nm, target })
          }
        }
      }
    } else if (n.type === "object_creation_expression") {
      // C2a mirror: `alias_qualified_name` is the node the pinned grammar gives a
      // `global::`-qualified name with a single segment, which the analyzer now reads in this
      // position too (the same node set on both sides — a truth that omits a shape the analyzer
      // publishes is a fabricated UNEXPLAINED, and a truth that reads a shape the analyzer
      // drops is a fabricated MISSING).
      const typeNode =
        n.namedChildren.find((c: any) => c.type === "generic_name" || c.type === "identifier" || c.type === "qualified_name" || c.type === "predefined_type" || c.type === "alias_qualified_name") ??
        n.namedChildren.find((c: any) => c.type === "type_argument_list")
      if (typeNode) {
        const t = leafOf(typeNode.text)
        const key = "inst:" + t
        // A construction target is always a constructible type — `new object()`
        // and `new string(...)` are real instantiations, so CSBUILTINS must NOT
        // filter them (only `var`/`nameof` can never be `new` targets, and those
        // never parse as object_creation_expression anyway).
        if (t && !seen.has(key)) {
          seen.add(key)
          edges.push({ label: "instantiates", from: "(expr)", target: t })
        }
      }
    } else if (n.type === "constructor_initializer") {
      // CSD8 mirror (re-review 2026-09-04): `public Sub() : base(42) { }` /
      // `: this()` — a real constructor-to-constructor call the analyzer now
      // emits (calls IS compared for csharp, so both sides must derive it).
      // `from` is a placeholder (the matcher is label+target site-agnostic).
      const tgt = /:\s*base\s*\(/.test(n.text) ? "base" : "this"
      const key = `calls:${tgt}`
      if (!seen.has(key)) {
        seen.add(key)
        edges.push({ label: "calls", from: "(ctor)", target: tgt })
      }
    } else if (n.type === "implicit_object_creation_expression") {
      // Target-typed `new()` — the type is NOT inside the node. Resolve it
      // from the enclosing variable_declarator / property_declaration exactly
      // like RealCSharpAnalyzer.resolveImplicitNewType, so the oracle
      // CONFIRMS the analyzer's instantiates (csharp #264 Station-6: `object
      // x = new()` / `Dictionary<..> d = new()` were UNEXPLAINED because the
      // oracle only understood explicit object_creation_expression). Same
      // inst: key dedups explicit+implicit constructions of one type per file.
      const t = csharpImplicitNewType(n, memberTypes)
      if (t) {
        const key = "inst:" + t
        if (!seen.has(key)) {
          seen.add(key)
          edges.push({ label: "instantiates", from: "(expr)", target: t })
        }
      }
    } else if (n.type === "invocation_expression") {
      // CS-P1 mirror: positional-pattern heads parse as invocations inside
      // pattern contexts (trailing `&&` misparses inside constant_pattern,
      // so direct-parent checks miss — bounded climb like the analyzer).
      let inPattern = false
      {
        let q: any = n.parent
        while (q) {
          const t: string = q.type
          if (t === "constant_pattern" || t === "is_pattern_expression") { inPattern = true; break }
          if (
            t === "invocation_expression" ||
            t.includes("statement") || t.includes("declaration") ||
            t.includes("block") || t.includes("function") ||
            t === "lambda_expression" || t === "local_function_statement" ||
            t === "query_expression" || t === "method_declaration" ||
            t === "constructor_declaration"
          ) break
          q = q.parent
        }
      }
      if (inPattern) {
        for (let k = 0; k < n.namedChildCount; k++) stack.push(n.namedChild(k))
        continue
      }
      const fn = n.childForFieldName?.("function")
      if (fn) {
        let leaf = ""
        if (fn.type === "member_access_expression") {
          const nameNode = fn.childForFieldName?.("name")
          leaf = nameNode ? (nameNode.type === "generic_name" ? (nameNode.childForFieldName?.("name")?.text ?? nameNode.text.split("<")[0]) : nameNode.text) : ""
        } else if (fn.type === "identifier" || fn.type === "generic_name") {
          leaf = fn.type === "generic_name" ? (fn.childForFieldName?.("name")?.text ?? fn.text.split("<")[0]) : fn.text
        } else if (fn.type === "conditional_access_expression") {
          // Null-conditional call `x?.M(args)` — the callee is a
          // member_binding_expression (`.M`) whose `name` field is the member
          // identifier. csharp #264 Station-6: `postActionHandler?.PostVisit(ast)`,
          // `subscriber.Action?.NotifyJobStopped()`, `destinationStream?.Close()`
          // were UNEXPLAINED because the oracle only read member_access_expression
          // / identifier callees. Mirror the analyzer's leaf (Close, Translate,
          // PostVisit, ...) so it confirms these real calls.
          const stack: any[] = [fn]
          while (stack.length && !leaf) {
            const t = stack.pop()!
            if (t.type === "member_binding_expression") {
              const nm = t.childForFieldName?.("name")
              if (nm) leaf = nm.type === "generic_name" ? (nm.childForFieldName?.("name")?.text ?? nm.text.split("<")[0]) : nm.text
            }
            for (let k = 0; k < t.namedChildCount; k++) stack.push(t.namedChild(k))
          }
        }
        // Mirror the analyzer's isCSharpBuiltin: suppress a call ONLY when its
        // exact full name matches CSHARP_BUILTINS (or the leaf is an Object
        // method). Debug.Assert / File.Close / Math.Abs / NotifyJobStopped are
        // NOT in that set, so the oracle confirms them instead of assuming the
        // whole receiver is noise.
        const OBJMETHODS = new Set(["ToString", "GetHashCode", "Equals", "GetType", "ReferenceEquals"])
        const rcvr = fn.type === "member_access_expression" ? (fn.childForFieldName?.("expression")?.text ?? "") : ""
        const full = fn.type === "member_access_expression" ? (rcvr ? rcvr + "." + leaf : leaf) : leaf
        const isSuppressed = CSHARP_BUILTINS_ORACLE.has(full) || OBJMETHODS.has(leaf)
        // Call-target hygiene mirror of the analyzer: tree-sitter mislabels
        // `if (...)` as an invocation_expression, and unsafe vtable dispatch can
        // slot pointer indexes / element-addresses as the callee. A real target
        // is a clean, non-keyword identifier.
        const isKeyword = /^(if|for|foreach|while|do|switch|case|else|return|throw|using|new|delegate|in|is|as|sizeof|fixed|lock|checked|unchecked|params|ref|out|base|this|get|set|nameof)$/.test(leaf)
        const key = "call:" + leaf
        if (leaf && !isKeyword && /^[A-Za-z_][A-Za-z0-9_]*$/.test(leaf) && !isSuppressed && !seen.has(key)) {
          seen.add(key)
          edges.push({ label: "calls", from: "(expr)", target: leaf })
        }
      }
    }
    for (let k = 0; k < n.namedChildCount; k++) stack.push(n.namedChild(k))
  }
  return edges
}

// Dart tree-truth oracle (dart managed-OO wave #264). Mirrors
// RealDartAnalyzer's M12.11 leaf-target contract exactly:
//   - extends:  superclass first type_identifier
//   - implements: every type_identifier under `interfaces` (not type_arguments)
//   - uses:     every type_identifier under the mixins (with-clause)
//   - instantiates: constructor_invocation / new_expression /
//     const_object_expression type_identifier, PLUS a capitalized bare
//     identifier directly before an argument_part selector (Dart types are
//     capitalized; `Foo()` is a constructor invocation)
//   - calls:    selector(argument_part) callee leaf — member_access chains
//     resolve to the LAST identifier (obj.method -> method), null-conditional
//     `x?.M()` via conditional_assignable_selector, cascade_section via
//     cascade_selector; dart global builtins (print/assert/identical) and
//     Object methods (toString/hashCode/runtimeType/noSuchMethod) filtered.
// The oracle emits UNIQUE (label,target) edges (seen-set per label+target),
// matching the site-agnostic coverage match in main().
export function deriveDartEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const isCapitalized = (t: string): boolean => t.length > 0 && t.charCodeAt(0) >= 65 && t.charCodeAt(0) <= 90
  const DART_BUILTINS = new Set(["print", "assert", "identical", "toString", "hashCode", "runtimeType", "noSuchMethod"])
  const key = (label: string, target: string) => label + ":" + target
  const push = (label: string, target: string) => {
    const k = key(label, target)
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }

  // Collect type_identifier leaves of a container, excluding generic args.
  const typeLeaves = (n: any): string[] => {
    const out: string[] = []
    const st: any[] = [n]
    while (st.length) {
      const t = st.pop()!
      if (t.type === "type_identifier") { out.push(t.text); continue }
      if (t.type === "type_arguments") continue // generic args are NOT bases
      for (let k = 0; k < t.namedChildCount; k++) { const c = t.namedChild(k); if (c) st.push(c) }
    }
    return out
  }

  // DAD1/DAD2 mirror: resolved heritage names from a clause node — keep a
  // raw type child whose next raw sibling is NOT a `.` token (alias prefix),
  // skip type_arguments. Same contract as
  // RealDartAnalyzer.resolvedHeritageNames (probed dart-heritage-shapes.ts).
  const resolvedRawNames = (n: any): string[] => {
    const out: string[] = []
    for (let k = 0; k < n.childCount; k++) {
      const c = n.child(k)
      if (!c) continue
      if (c.type === "type_arguments" || c.type === "mixins") continue
      if (c.type !== "type_identifier" && c.type !== "identifier") continue
      const next = n.child(k + 1)
      if (next && next.type === ".") continue // alias prefix: `A.B` keeps B
      out.push(c.text)
    }
    return out
  }

  // DT-A/DT-D oracle mirrors: in-file named constructors (owner.named) and
  // superclass per class (resolved). Both prescans mirror the analyzer's
  // extractCallRelationships setup exactly.
  const dartNamedCtors = new Set<string>()
  const dartSuperByClass = new Map<string, string>()
  {
    const pre: any[] = [root]
    while (pre.length > 0) {
      const pn = pre.pop()!
      if (!pn) continue
      if (pn.type === "class_definition") {
        const nm = pn.childForFieldName?.("name")?.text
        const sup = pn.namedChildren.find((c: any) => c.type === "superclass")
        if (nm && sup) {
          const base = resolvedRawNames(sup)[0]
          if (base) dartSuperByClass.set(nm, base)
        }
      }
      // M60 depth (#933 dart half): a Dart 3 `extension type` is a CONTAINER
      // like a class — and the pinned objective_c/FFI bindings declare their
      // whole surface that way (`extension type NSCsondition._(...)
      // implements ...` with `NSCondition.as(other) : object$ = other` INSIDE
      // it). The parent walk below used to accept only `class_definition`, so
      // on the full 335-file dart-http extent this prescan registered 0 of 159
      // constructor signatures: every `Foo.named(...)` call inside such a
      // container fell through to the keyword branch and the truth published
      // `calls -> as` (the name of the FFI `as` constructor) while the
      // analyzer — whose named-ctor set is built from SYMBOLS, where the
      // extension type became an owner in DARTD21 — published the correct
      // `instantiates`. 27 unexplained + 1 MISSING, one root cause, both sides
      // reconciled here rather than by relaxing a gate.
      // All four constructor signature kinds (generative, factory, const,
      // redirecting) — the analyzer's namedSegment covers them all.
      if (pn.type === "constructor_signature" || pn.type === "factory_constructor_signature" ||
          pn.type === "constant_constructor_signature" || pn.type === "redirecting_factory_constructor_signature") {
        const dids: string[] = []
        for (let k = 0; k < pn.namedChildCount; k++) {
          const c = pn.namedChild(k)
          if (c && (c.type === "identifier" || c.type === "type_identifier")) dids.push(c.text)
        }
        let own: any = pn.parent
        let og = 0
        while (own && og++ < 8) {
          if (own.type === "class_definition" || own.type === "extension_type_declaration") break
          own = own.parent
        }
        const ownsCtor = !!own && (own.type === "class_definition" || own.type === "extension_type_declaration")
        const onm = ownsCtor
          ? (own.childForFieldName?.("name")?.text ??
            own.namedChildren.find((c: any) => c.type === "identifier")?.text)
          : null
        const seg = dids.find((id) => id !== onm)
        if (onm && seg) dartNamedCtors.add(`${onm}.${seg}`)
      }
      for (let k = pn.namedChildCount - 1; k >= 0; k--) {
        const c = pn.namedChild(k)
        if (c) pre.push(c)
      }
    }
  }
  const dartLinkMember = (sel: any): string | null => {
    const kids: any[] = sel.type === "selector" ? sel.namedChildren : [sel]
    for (const c of kids) {
      if (c.type === "unconditional_assignable_selector" || c.type === "conditional_assignable_selector" ||
          c.type === "cascade_selector") {
        const id = c.namedChildren.find((x: any) => x.type === "identifier") ??
          c.namedChildren.find((x: any) => x.type === "type_identifier")
        if (id) return id.text
      }
    }
    return null
  }
  const dartChain = (argsSel: any): { head: any; links: string[] } => {
    const links: string[] = []
    let c: any = argsSel.previousNamedSibling
    while (c) {
      if (c.type === "selector") {
        const m = dartLinkMember(c)
        if (!m) break
        links.unshift(m)
        c = c.previousNamedSibling
      } else if (c.type === "unconditional_assignable_selector" || c.type === "conditional_assignable_selector") {
        const id = c.namedChildren.find((x: any) => x.type === "identifier") ??
          c.namedChildren.find((x: any) => x.type === "type_identifier")
        if (!id) break
        links.unshift(id.text)
        c = c.previousNamedSibling
      } else break
    }
    return { head: c, links }
  }
  const dartHeadText = (head: any): string | null =>
    head && (head.type === "identifier" || head.type === "type_identifier") ? head.text : null
  const dartIsCap = (t: string | null): boolean =>
    !!t && t.length > 0 && t.charCodeAt(0) >= 65 && t.charCodeAt(0) <= 90
  const dartIsIndexSel = (sel: any): boolean => {
    if (dartLinkMember(sel) !== null) return false
    if (sel.namedChildren.some((c: any) => c.type === "argument_part")) return false
    const stack: any[] = [sel]
    let g = 0
    while (stack.length > 0 && g++ < 32) {
      const c = stack.pop()!
      if (!c.isNamed && (c.text === "[" || c.text === "?[")) return true
      for (let k = 0; k < c.childCount; k++) { const ch = c.child(k); if (ch) stack.push(ch) }
    }
    return false
  }
  // Assignment-target index shape (`xs[3] = 4` wraps base+index in
  // assignable_expression): member-less assignable holding brackets.
  const dartIsIndexAssignable = (sel: any): boolean => {
    if (sel.type !== "unconditional_assignable_selector" && sel.type !== "conditional_assignable_selector") return false
    if (sel.namedChildren.some((c: any) => c.type === "identifier" || c.type === "type_identifier")) return false
    const stack: any[] = [sel]
    let g = 0
    while (stack.length > 0 && g++ < 32) {
      const c = stack.pop()!
      if (!c.isNamed && (c.text === "[" || c.text === "?[")) return true
      for (let k = 0; k < c.childCount; k++) { const ch = c.child(k); if (ch) stack.push(ch) }
    }
    return false
  }
  const dartLhsWrite = (sel: any): boolean => {
    let p: any = sel.parent
    let g = 0
    while (p && g++ < 16) {
      if (p.type === "assignment_expression") {
        let op: string | null = null
        for (let k = 0; k < p.childCount; k++) {
          const c = p.child(k)
          if (c && !c.isNamed && c.text.includes("=")) { op = c.text; break }
        }
        if (op !== "=") return false
        const lhs = p.namedChild(0)
        if (lhs && lhs.startIndex <= sel.startIndex && lhs.endIndex >= sel.endIndex) return true
        return false
      }
      if (p.type === "function_body" || p.type === "block" || p.type === "class_body" ||
          p.type === "program" || p.type === "declaration") return false
      p = p.parent
    }
    return false
  }
  const dartInInterp = (n: any): boolean => {
    let p: any = n.parent
    let g = 0
    while (p && g++ < 8) {
      if (p.type === "template_substitution") return true
      if (p.type === "function_body" || p.type === "block" || p.type === "class_body" ||
          p.type === "program" || p.type === "declaration") return false
      p = p.parent
    }
    return false
  }
  const dartDeclParent = (t: string): boolean =>
    t === "formal_parameter" || t === "constructor_param" ||
    t === "function_signature" || t === "method_signature" ||
    t === "getter_signature" || t === "setter_signature" ||
    t === "type_alias" || t === "label"
  const dartDeclaredName = (n: any): boolean => {
    const parent = n.parent
    if (!parent) return false
    const pt = parent.type
    if (pt !== "initialized_variable_definition" && pt !== "static_final_declaration") return false
    let eq = -1
    let mine = -1
    for (let k = 0; k < parent.childCount; k++) {
      const c = parent.child(k)
      if (!c) continue
      if (!c.isNamed && c.text === "=" && eq === -1) eq = k
      if (c.isNamed && c.startIndex === n.startIndex && c.endIndex === n.endIndex) mine = k
    }
    if (mine === -1) return false
    if (eq === -1) return true
    return mine < eq
  }

  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    const t = n.type
    // M60 (#753 census, DARTD21): `extension_type_declaration` (Dart 3) is a
    // CONTAINER like a class — its `interfaces` clause carries real heritage
    // (`extension type X._(T o) implements I` in the pinned jni/objc bindings)
    // and the analyzer now emits it, so the truth instrument must know the
    // shape or every such edge would read as analyzer-only.
    if (t === "class_definition" || t === "mixin_declaration" || t === "extension_type_declaration") {
      const nm = n.childForFieldName?.("name")?.text ||
        (t === "mixin_declaration" ? n.namedChildren.find((c: any) => c.type === "identifier")?.text : undefined)
      if (nm) {
        // DARTD14 mirror: mixin on-base is a DIRECT type_identifier child
        // (mixin_declaration > [mixin, identifier, type_identifier, ...]) —
        // never a superclass child, so the branch below never sees it.
        // DT-B: resolved (alias-free) — `on _i1.Base` leaked the alias.
        if (t === "mixin_declaration") {
          const onNames = resolvedRawNames(n).filter((x) => x !== nm)
          for (const b of onNames) push("extends", b)
        }
        const sup = n.namedChildren.find((c: any) => c.type === "superclass")
        if (sup) {
          // DAD1 mirror: resolved base = first raw name NOT followed by `.`
          // (alias prefix). `extends _i1.SmartFake` resolves to SmartFake,
          // not the alias. Mixins (with-clause) handled below as uses.
          for (const base of resolvedRawNames(sup)) {
            push("extends", base)
            break
          }
          // mixins under superclass (extends A with M) — DT-B resolved
          const mx = sup.namedChildren.find((c: any) => c.type === "mixins")
          if (mx) for (const m of resolvedRawNames(mx)) push("uses", m)
        }
        // mixins directly on the class (class A with M implements C) — DT-B resolved
        const mxDirect = n.namedChildren.find((c: any) => c.type === "mixins")
        if (mxDirect) for (const m of resolvedRawNames(mxDirect)) push("uses", m)
        // interfaces — DAD2 mirror: resolved names only (alias prefixes
        // dropped, generic args excluded).
        const ifc = n.namedChildren.find((c: any) => c.type === "interfaces")
        if (ifc) for (const m of resolvedRawNames(ifc)) push("implements", m)
      }
    }
    // DARTD15 mirror: enhanced enums carry implements/with heritage like
    // classes (`enum Poly implements Shape`).
    if (t === "enum_declaration") {
      const nm = n.childForFieldName?.("name")?.text
      if (nm) {
        const ifc = n.namedChildren.find((c: any) => c.type === "interfaces")
        if (ifc) for (const m of resolvedRawNames(ifc)) push("implements", m)
        const mx = n.namedChildren.find((c: any) => c.type === "mixins")
        if (mx) for (const m of resolvedRawNames(mx)) push("uses", m)
      }
    }
    if (t === "constructor_invocation" || t === "new_expression" || t === "const_object_expression") {
      const tn = n.namedChildren.find((c: any) => c.type === "type_identifier")
      if (tn && isCapitalized(tn.text)) push("instantiates", tn.text)
    }
    // DARTD19 mirror (OO family closure): redirecting factories
    // (`factory $X() = _$Y;`) construct the implementation class _$Y — the
    // analyzer emits instantiates for the redirect target (probed on the
    // generated jni_bindings.dart where these are the only unexplained
    // instantiates; the redirect target may be private `_`-prefixed so no
    // capitalization filter applies). DT-C: alias-qualified targets
    // (`= _i1.Impl.make`) resolve to the class (second-to-last part).
    if (t === "redirecting_factory_constructor_signature") {
      const parts: string[] = []
      let pastEq = false
      for (let k = 0; k < n.childCount; k++) {
        const c = n.child(k)
        if (!c) continue
        if (!pastEq) {
          if (!c.isNamed && c.type === "=") pastEq = true
          continue
        }
        if (c.isNamed && (c.type === "type_identifier" || c.type === "identifier")) parts.push(c.text)
      }
      const target = parts.length <= 1 ? parts[0] : parts[parts.length - 2]
      if (target) push("instantiates", target)
    }
    // DT-A/DT-F mirror: selector with arguments. Chain walk decides
    // construction vs call (named ctors, prefix construction); bare calls
    // keep the DARTD1 rule verbatim.
    if (t === "selector") {
      const hasArgs = n.namedChildren.some((c: any) => c.type === "argument_part")
      if (hasArgs) {
        const { head, links } = dartChain(n)
        if (links.length === 0) {
          const prev = n.previousNamedSibling
          if (prev) {
            let leaf: string | null = null
            if (prev.type === "unconditional_assignable_selector" || prev.type === "conditional_assignable_selector" || prev.type === "selector") {
              const id = prev.namedChildren.find((c: any) => c.type === "identifier")
              leaf = id ? id.text : (() => { const stk: any[] = [prev]; let last: string | null = null; while (stk.length) { const x = stk.pop()!; if (x.type === "identifier" || x.type === "type_identifier") last = x.text; for (let k = 0; k < x.namedChildCount; k++) { const c = x.namedChild(k); if (c) stk.push(c) } } return last })()
            } else if (prev.type === "identifier" || prev.type === "type_identifier") {
              leaf = prev.text
            }
            if (leaf && !DART_BUILTINS.has(leaf)) {
              if (isCapitalized(leaf) && (prev.type === "identifier" || prev.type === "type_identifier")) {
                push("instantiates", leaf)
              } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(leaf)) {
                push("calls", leaf)
              }
            }
          }
        } else {
          const method = links[links.length - 1]
          const headText = dartHeadText(head)
          const before = links.length > 1 ? links[links.length - 2] : headText
          if (DART_BUILTINS.has(method)) {
            // filtered
          } else if (
            links.length === 1 && isCapitalized(method) && headText !== null &&
            !isCapitalized(headText) && head !== null &&
            (head.type === "identifier" || head.type === "type_identifier")
          ) {
            push("instantiates", method)
          } else if (before !== null && isCapitalized(before) && dartNamedCtors.has(`${before}.${method}`)) {
            push("instantiates", before)
          } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(method)) {
            push("calls", method)
          }
        }
      } else {
        // DT-F mirror: member reads. Callee links (followed by the
        // argument-carrying selector), LHS writes and builtins excluded;
        // capitalized heads with in-file named ctors tear off construction.
        const member = dartLinkMember(n)
        if (member && !DART_BUILTINS.has(member)) {
          const next = n.nextNamedSibling
          const nextIsArgs = !!next && next.type === "selector" &&
            next.namedChildren.some((c: any) => c.type === "argument_part")
          if (!nextIsArgs && !dartLhsWrite(n)) {
            const head = n.previousNamedSibling
            const headText = dartHeadText(head)
            if (headText !== null && isCapitalized(headText) && dartNamedCtors.has(`${headText}.${member}`)) {
              push("instantiates", headText)
            } else {
              push("uses", member)
            }
          }
        }
      }
    }
    if (t === "cascade_section") {
      // DARTD18 mirror (OO family closure): one call per selector immediately
      // followed by its own argument_part sibling — `..headers.addAll(x)`
      // calls addAll (headers is a bare getter), and `..a(x)..b(y)` calls
      // BOTH a and b (previously only the FIRST cascade_selector identifier
      // was emitted, fabricating getter junk and missing later calls).
      // DT-F: selectors NOT followed by an argument_part are getter reads,
      // unless the section assigns (`..b = 1`).
      let assigns = false
      for (let k = 0; k < n.childCount; k++) {
        const c = n.child(k)
        if (c && !c.isNamed && c.text === "=") { assigns = true; break }
      }
      const idText = (sel: any): string | null => {
        const stk: any[] = [sel]
        let last: string | null = null
        while (stk.length) {
          const x = stk.pop()!
          if (x.type === "identifier" || x.type === "type_identifier") last = x.text
          for (let k = 0; k < x.namedChildCount; k++) { const c = x.namedChild(k); if (c) stk.push(c) }
        }
        return last
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type !== "cascade_selector" && c.type !== "unconditional_assignable_selector" &&
            c.type !== "conditional_assignable_selector" && c.type !== "selector") continue
        const next = n.namedChild(i + 1)
        if (next && next.type === "argument_part") {
          const id = idText(c)
          if (id && !DART_BUILTINS.has(id) && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(id)) push("calls", id)
        } else if (!assigns) {
          const id = idText(c)
          if (id && !DART_BUILTINS.has(id) && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(id)) push("uses", id)
        }
      }
    }
    // DT-D mirror: constructor redirection in initializer lists.
    if (t === "initializer_list_entry") {
      let hs = false
      let ht = false
      const fr = n.child(0)
      if (fr && !fr.isNamed && (fr.text === "super" || fr.text === "this")) {
        hs = fr.text === "super"
        ht = fr.text === "this"
      } else {
        const fn0 = n.namedChild(0)
        if (fn0 && (fn0.type === "super" || fn0.type === "this")) {
          hs = fn0.type === "super"
          ht = fn0.type === "this"
        }
      }
      if (hs || ht) {
        let own: any = n.parent
        let og = 0
        while (own && og++ < 12) {
          if (own.type === "class_definition") break
          own = own.parent
        }
        const onm = own && own.type === "class_definition" ? own.childForFieldName?.("name")?.text : null
        if (onm) {
          if (hs) {
            const base = dartSuperByClass.get(onm)
            if (base) push("instantiates", base)
          } else {
            push("instantiates", onm)
          }
        }
      }
    }
    // DT-D mirror: `this.named(...)` redirects parse as `redirection`
    // (`:` `this` `.` `named` `arguments`).
    if (t === "redirection") {
      let rS = false
      let rT = false
      for (let k = 0; k < n.namedChildCount; k++) {
        const c = n.namedChild(k)
        if (!c) continue
        if (c.type === "this") { rT = true; break }
        if (c.type === "super") { rS = true; break }
        if (c.type === "identifier" || c.type === "type_identifier" || c.type === "arguments") continue
        break
      }
      if (rS || rT) {
        let own: any = n.parent
        let og = 0
        while (own && og++ < 12) {
          if (own.type === "class_definition") break
          own = own.parent
        }
        const onm = own && own.type === "class_definition" ? own.childForFieldName?.("name")?.text : null
        if (onm) {
          if (rS) {
            const base = dartSuperByClass.get(onm)
            if (base) push("instantiates", base)
          } else {
            push("instantiates", onm)
          }
        }
      }
    }
    // DT-F mirrors: subscript bases, interpolation reads, `$x` placeholders.
    if (t === "identifier") {
      const pt = n.parent ? n.parent.type : ""
      if (!dartDeclParent(pt) && pt !== "label" && !dartDeclaredName(n)) {
        const nx = n.nextNamedSibling
        if (nx && ((nx.type === "selector" && dartIsIndexSel(nx)) || dartIsIndexAssignable(nx))) {
          push("uses", n.text)
        } else if (dartInInterp(n)) {
          push("uses", n.text)
        }
      }
    }
    if (t === "identifier_dollar_escaped") {
      const raw = String(n.text)
      const nm = raw.startsWith("$") ? raw.slice(1) : raw
      if (nm) push("uses", nm)
    }
    for (let k = 0; k < n.namedChildCount; k++) { const c = n.namedChild(k); if (c) stack.push(c) }
  }
  return edges
}

// Dart #752 mirror: bare identifier member reads. The oracle mirrors the
// analyzer rule for rule — the name must resolve to a DECLARED MEMBER of the
// enclosing type (name inventory from the analyzer's own symbols, the zig
// deriveZigBareUses precedent), must not be a local/param of the current
// function (CGD15), and must not sit in a declaration-name, selector-link,
// callee-head or write-LHS position. Truth still derives every EDGE from tree
// structure; only the member inventory is shared ground truth.
export function deriveDartBareUses(root: any, symbols: any[] = []): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const membersByOwner = new Map<string, Set<string>>()
  for (const s of symbols ?? []) {
    if (!s || typeof s.name !== "string" || !s.ownerName) continue
    let set = membersByOwner.get(s.ownerName)
    if (!set) { set = new Set<string>(); membersByOwner.set(s.ownerName, set) }
    set.add(s.name)
  }
  // DT2 mirror: file-scope values (top-level variables, constants,
  // functions, accessors) — same filter as the analyzer's topLevelValues.
  const topLevelValues = new Set<string>()
  for (const s of symbols ?? []) {
    if (!s || typeof s.name !== "string" || s.ownerName) continue
    if (s.kind === "variable" || s.kind === "constant" || s.kind === "function" || s.kind === "property") {
      topLevelValues.add(s.name)
    }
  }
  const push = (name: string): void => {
    const key = "uses\u0000" + name
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ label: "uses", from: "", target: name })
  }
  const DECL_PARENTS = new Set([
    "formal_parameter", "constructor_param", "function_signature", "method_signature",
    "getter_signature", "setter_signature", "type_alias", "label",
    "initialized_identifier", "static_final_declaration",
    "class_definition", "enum_declaration", "mixin_declaration", "extension_declaration",
    // M60 (#753 census, DARTD21): the extension type's own name identifier AND
    // its representation field's name are DECLARATIONS, not reads.
    "extension_type_declaration", "representation_declaration",
    // M60 (#933 dart triage): an enum VALUE is a declaration too — the analyzer
    // publishes nothing for it since the fix, and without this mirror the
    // oracle would keep deriving `uses Shape -> circle` and every enum-bearing
    // corpus file would read as MISSING. Single source of truth: the analyzer's
    // `isDartDeclNameParent` carries the same clause.
    "enum_constant",
  ])
  const LINK_PARENTS = new Set([
    "unconditional_assignable_selector", "conditional_assignable_selector",
    "cascade_selector", "selector",
  ])
  const firstIdentifier = (node: any): any => {
    const s: any[] = [node]
    while (s.length > 0) {
      const x = s.pop()!
      if (x.type === "identifier") return x
      for (let i = x.namedChildCount - 1; i >= 0; i--) { const c = x.namedChild(i); if (c) s.push(c) }
    }
    return null
  }
  const hasType = (node: any, type: string): boolean => {
    const s: any[] = [node]
    while (s.length > 0) {
      const x = s.pop()!
      if (x.type === type) return true
      for (let i = x.namedChildCount - 1; i >= 0; i--) { const c = x.namedChild(i); if (c) s.push(c) }
    }
    return false
  }
  const declaredName = (n: any): boolean => {
    const p = n.parent
    if (!p) return false
    const pt = p.type
    if (pt !== "initialized_variable_definition" && pt !== "static_final_declaration") return false
    let eqIdx = -1
    let myIdx = -1
    for (let i = 0; i < p.childCount; i++) {
      const c = p.child(i)
      if (!c) continue
      if (!c.isNamed && c.text === "=" && eqIdx === -1) eqIdx = i
      if (c.isNamed && c.startIndex === n.startIndex && c.endIndex === n.endIndex) myIdx = i
    }
    if (myIdx === -1) return false
    if (eqIdx === -1) return true
    return myIdx < eqIdx
  }
  const isWrite = (n: any): boolean => {
    let p: any = n.parent
    let guard = 0
    while (p && guard++ < 16) {
      if (p.type === "assignment_expression") {
        let opText: string | null = null
        for (let i = 0; i < p.childCount; i++) {
          const c = p.child(i)
          if (c && !c.isNamed && c.text.includes("=")) { opText = c.text; break }
        }
        if (opText !== "=") return false
        const lhs = p.namedChild(0)
        return !!lhs && lhs.startIndex <= n.startIndex && lhs.endIndex >= n.endIndex
      }
      if (p.type === "function_body" || p.type === "block" || p.type === "class_body" ||
          p.type === "program" || p.type === "declaration") return false
      p = p.parent
    }
    return false
  }
  const collectLocals = (node: any, out: Set<string>): void => {
    const w: any[] = [node]
    while (w.length > 0) {
      const m = w.pop()!
      if (m.type === "identifier" && declaredName(m)) out.add(m.text)
      if (
        m.type === "formal_parameter" || m.type === "constructor_param" ||
        m.type === "simple_formal_parameter" || m.type === "super_formal_parameter" ||
        m.type === "catch_clause_parameter" || m.type === "catch_parameters"
      ) {
        // Direct child only (analyzer parity): a deep search binds the
        // INNER names of function-typed parameters (`Function(Uri uri, ...)
        // webSocketFactory` would bind `uri` — a type-signature name that
        // is not readable in this scope — while missing the outer name).
        const id = m.namedChildren.find((c: any) => c.type === "identifier")
        if (id) out.add(id.text)
      }
      // DT2 mirror: for-in variables (identifier before `in`) and pattern
      // binds (variable_pattern; constant_pattern only under a binding
      // ancestor — a bare `case Foo:` tests, never binds).
      if (m.type === "for_loop_parts") {
        for (let k = 0; k < m.childCount; k++) {
          const c = m.child(k)
          if (c && !c.isNamed && c.text === "in") {
            for (let j = 0; j < k; j++) {
              const pc = m.child(j)
              if (pc && pc.isNamed && pc.type === "identifier") out.add(pc.text)
            }
            break
          }
        }
      }
      if (m.type === "variable_pattern") {
        const id = firstIdentifier(m)
        if (id) out.add(id.text)
      }
      if (m.type === "constant_pattern") {
        // Structural descent only (record/list/map to a destructuring
        // declaration or for-in head); case TESTS across a switch/if
        // boundary never bind, even under `var x = switch ...`.
        let p: any = m.parent
        let g = 0
        let binding = false
        while (p && g++ < 8) {
          const t = p.type
          if (t === "pattern_variable_declaration" || t === "for_loop_parts") { binding = true; break }
          if (
            t !== "record_pattern" && t !== "list_pattern" && t !== "map_pattern" &&
            t !== "constant_pattern" && t !== "variable_pattern"
          ) break
          p = p.parent
        }
        if (binding) {
          const id = firstIdentifier(m)
          if (id) out.add(id.text)
        }
      }
      for (let i = m.namedChildCount - 1; i >= 0; i--) { const c = m.namedChild(i); if (c) w.push(c) }
    }
  }
  const enclosingClass = (n: any): string | null => {
    let p: any = n.parent
    let guard = 0
    while (p && guard++ < 64) {
      if (p.type === "class_definition" || p.type === "enum_declaration" || p.type === "extension_type_declaration") {
        return p.childForFieldName?.("name")?.text ?? null
      }
      if (p.type === "extension_declaration" || p.type === "mixin_declaration") {
        const id = firstIdentifier(p)
        return id ? id.text : null
      }
      p = p.parent
    }
    return null
  }
  const walk = (n: any, locals: Set<string>): void => {
    const t = n.type
    let childLocals = locals
    if (t === "function_body" || t === "function_expression_body" || t === "block") {
      const bound = new Set<string>()
      collectLocals(n, bound)
      const sig = n.previousNamedSibling
      if (sig) collectLocals(sig, bound)
      if (bound.size > 0) {
        childLocals = new Set(locals)
        for (const nm of bound) childLocals.add(nm)
      }
    }
    // DT2 mirror: constructor initializer lists read the constructor's
    // parameters (sibling signature, not under any body).
    if (t === "initializers") {
      const par = n.parent
      if (par) {
        for (let k = 0; k < par.namedChildCount; k++) {
          const sib = par.namedChild(k)
          if (sib && (sib.type === "constructor_signature" || sib.type === "method_signature" || sib.type === "function_signature")) {
            const bound = new Set<string>()
            collectLocals(sib, bound)
            if (bound.size > 0) {
              childLocals = new Set(locals)
              for (const nm of bound) childLocals.add(nm)
            }
            break
          }
        }
      }
    }
    if (t === "identifier") {
      const txt = n.text
      const pt = n.parent ? n.parent.type : ""
      const nx = n.nextNamedSibling
      const nextIsCall = !!nx && nx.type === "selector" && hasType(nx, "argument_part")
      const owner = enclosingClass(n)
      const isMember = !!owner && (membersByOwner.get(owner)?.has(txt) ?? false)
      // DT2 skips: labels and control-transfer targets name, never read;
      // field-initializer targets bind; this/super are keyword receivers.
      const isLabelish = pt === "labeled_statement" || pt === "break_statement" || pt === "continue_statement"
      let isFieldTarget = false
      if (pt === "field_initializer" && n.parent) {
        const first = n.parent.namedChild(0)
        isFieldTarget = !!first && first.startIndex === n.startIndex && first.endIndex === n.endIndex
      }
      if (txt === "this" || txt === "super") {
        // silent by design
      } else if (
        !LINK_PARENTS.has(pt) &&
        !DECL_PARENTS.has(pt) &&
        !declaredName(n) &&
        !nextIsCall &&
        !isWrite(n) &&
        !isLabelish &&
        !isFieldTarget
      ) {
        if (!locals.has(txt) && isMember) {
          push(txt)
        } else if (locals.has(txt)) {
          push(txt)
        } else if (!isMember && topLevelValues.has(txt)) {
          push(txt)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, childLocals) }
  }
  walk(root, new Set<string>())
  return edges
}

// Swift tree-truth oracle (swift managed-OO wave #266). Mirrors
// RealSwiftAnalyzer's M12.21 leaf-target contract exactly:
//   - extends:  FIRST inheritance base of class/struct/actor (superclass),
//     from the inheritance_specifier children
//   - implements: REMAINING bases (adopted protocols)
//   - instantiates: bare CAPITALIZED call `User(...)` -> instantiates ONLY
//     (no calls edge — Swift construction syntax, Java `new Foo()` analog)
//   - calls:    member calls resolve to the LEAF target (`users.first` ->
//     `first`); bare non-capitalized identifiers, with the analyzer's
//     BUILTIN_BARE_CALLS set filtered (print/String/Int/... AND the `defer`
//     keyword-construct which parses as a call in the pinned grammar)
//   - uses:     ONLY `self.` member READS — navigation_expression with a
//     self receiver that is NOT the callee of a call_expression
//   - references: imports -> root -> module (mirrors handleImport)
// The oracle emits UNIQUE (label,target) edges (seen-set per label+target),
// matching the site-agnostic coverage match in main().
// Swift #940 (both sides): an ERROR the pinned grammar failed to reduce into a
// nominal declaration — its FIRST child is the anonymous nominal keyword token
// and the recovery's OWN name node is present. The name rule is deliberately
// the same one the analyzer's handleDeclaration uses (an extension is named by
// the leaf of its `user_type`, everything else by its `type_identifier`), so a
// recovered header and a reduced one can never disagree.
const SW_NOMINAL_KW = new Set(["class", "struct", "enum", "extension", "actor"])
// Header material may precede the keyword; declaration content may not (a
// nested declaration the recovery left as a SIBLING contributes its own keyword
// token to the same child list — measured on `extension SocketAddressError {
// ... struct UnknownHost ... }`).
const swIsHeaderNode = (t: string): boolean => t === "modifiers" || t === "attribute" || t === "comment"
function swRecoveryHeader(n: any): { kind: string | null; nameNode: any } {
  let kind: string | null = null
  let nameNode: any = null
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c) continue
    if (!c.isNamed) {
      if (!kind && SW_NOMINAL_KW.has(c.type)) kind = c.type
      continue
    }
    if (swIsHeaderNode(c.type)) continue
    if (c.type === "user_type" || c.type === "type_identifier" || c.type === "simple_identifier" || c.type === "identifier") nameNode = c
    break
  }
  return { kind, nameNode }
}
function swRecoveryName(n: any): string | null {
  const { nameNode } = swRecoveryHeader(n)
  if (!nameNode) return null
  if (nameNode.type === "user_type") {
    let leaf: any = null
    for (let i = 0; i < nameNode.namedChildCount; i++) {
      const c = nameNode.namedChild(i)
      if (c && c.type === "type_identifier") leaf = c
    }
    return leaf ? leaf.text : null
  }
  return nameNode.text
}
function swIsNominalRecovery(n: any): boolean {
  if (!n || n.type !== "ERROR") return false
  const { kind, nameNode } = swRecoveryHeader(n)
  return kind !== null && nameNode !== null
}

export function deriveSwiftEdges(root: any, corpusProtocols?: Set<string>): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const SWIFT_BUILTINS = new Set([
    "print", "debugPrint", "assert", "precondition", "fatalError",
    "String", "Int", "Double", "Float", "Bool", "Array", "Dictionary",
    "Set", "Optional", "Any", "Void", "Character", "Data", "Date", "defer",
    // SWIFTD16 mirror: fixed-width stdlib numerics filtered like Int/Double.
    "UInt", "UInt8", "UInt16", "UInt32", "UInt64",
    "Int8", "Int16", "Int32", "Int64",
    // SW-E mirror: `type(of:)` is a stdlib free function like print/assert.
    "type",
  ])
  // SWIFTD15 mirror: stdlib raw-value types of a raw-representable enum.
  // The oracle must skip the SAME first base the analyzer records as
  // meta.rawType (String/Int/...) — everything else is a conformance.
  const SWIFT_ENUM_RAW = new Set([
    "String", "Character",
    "Int", "Int8", "Int16", "Int32", "Int64",
    "UInt", "UInt8", "UInt16", "UInt32", "UInt64",
    "Float", "Float32", "Float64", "Double",
  ])
  // SWIFTD17 mirror (OO family closure family sweep): capitalized = type-name
  // signal regardless of length — the old `length > 1` carve-out mislabeled
  // single-letter constructions (`E()`) as calls on BOTH sides (F5-blind).
  const isCapitalized = (t: string): boolean => t.length > 0 && t.charCodeAt(0) >= 65 && t.charCodeAt(0) <= 90
  // #924 (swift half) — the name-surface mirror of the analyzer's two rules:
  //   (a) Swift's keyword-escape quoting is not part of a name: `` `continue` ``
  //       declares/references the identifier `continue`, and every corpus
  //       reference spells it WITHOUT backticks, so a name that keeps them can
  //       never match a reference;
  //   (b) a tuple POSITION is not a name (the pinned grammar leaves `pair.0` as
  //       a navigation suffix with no identifier child).
  // Truth edges compare by (label,target), so both sides must agree on the
  // spelling; without this mirror the analyzer's corrected names read as MISSING
  // and its dropped `.0`/`.1` edges as missing truth.
  const swStripQuoting = (t: string): string =>
    t.length >= 2 && t.charCodeAt(0) === 96 && t.charCodeAt(t.length - 1) === 96 ? t.slice(1, -1) : t
  const key = (label: string, target: string) => label + ":" + target
  const push = (label: string, target: string) => {
    target = swStripQuoting(target)
    const k = key(label, target)
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }
  // SW-B candidates (head + leaf), resolved post-walk against declared
  // enum cases; matched leaf calls convert to instantiates.
  const swEnumCtorCandidates: Array<{ head: string | null; owner: string | null; leaf: string; removeCalls: boolean }> = []
  // #938/#942: how many CALL SITES contribute a `calls` edge per target.
  // Truth edges are (label,target)-deduped and the analyzer's are then
  // collapsed the same way by the harness, so a construction conversion must
  // retire only ITS OWN site's contribution — the old splices removed the
  // first edge with that target, which is a different site's call whenever two
  // sites in one file share a leaf name (measured: `calls -> method` vanished
  // from alamofire's TestHelpers.swift, and `calls -> websocket` vanished from
  // Client.swift behind a phantom two-sided agreement).
  const swCallsSites = new Map<string, number>()
  const swNoteCallsSite = (target: string): void => {
    swCallsSites.set(target, (swCallsSites.get(target) ?? 0) + 1)
  }
  // SW-G: class -> superclass map for super.init targets.
  const swSuperByClass = new Map<string, string>()
  // hasSelfReceiver): navigation > (navigation | self_expression) — stops at
  // the first non-receiver child (call_expression/try_expression).
  const hasSelfReceiver = (n: any): boolean => {
    let cur: any = n
    let guard = 0
    while (cur && guard++ < 64) {
      if (cur.type === "self_expression") return true
      let next: any = cur.namedChildren.find((c: any) => c.type === "navigation_expression" || c.type === "self_expression")
      // Glued grammar shapes — mirror the analyzer's hasSelfReceiver
      // (probe-verified 2026-09, swift-nio corpus): the receiver spine may
      // be wrapped one level deeper. additive (`buf.readerIndex +
      // self.count` — suffix binds to the RIGHT self spine) and prefix
      // (`&self.ctx` inout — the & wraps the base; passing by reference is
      // a genuine use).
      if (!next && cur.type === "navigation_expression") {
        const spine = cur.namedChildren[0]
        if (spine && (spine.type === "additive_expression" || spine.type === "prefix_expression")) {
          if (spine.namedChildren.some((c: any) => c.type === "self_expression")) return true
          next = spine
        }
      }
      if (!next) return false
      cur = next
    }
    return false
  }

  // Leaf name of a navigation_expression: last navigation_suffix's
  // simple_identifier/identifier (mirrors navigationLeaf).
  const navLeaf = (n: any): string | null => {
    let leaf: any = null
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c && c.type === "navigation_suffix") {
        // #924: no identifier child -> not a name (tuple position `pair.0`),
        // and the quoting syntax is stripped like the analyzer strips it.
        leaf = c.namedChildren.find((x: any) => x.type === "simple_identifier" || x.type === "identifier") ?? null
      }
    }
    return leaf ? swStripQuoting(leaf.text) : null
  }

  // #938 mirror: a `case .X(let y)` switch pattern does not reduce in the
  // pinned grammar — it recovers as a call_expression whose callee navigation
  // starts at the reserved `case` keyword. Read from the token, never text.
  const isCasePatternRecovery = (callNode: any): boolean => {
    for (let i = 0; i < callNode.namedChildCount; i++) {
      const c = callNode.namedChild(i)
      if (!c || c.type !== "navigation_expression") continue
      const f = c.namedChildCount > 0 ? c.namedChild(0) : null
      if (f && (f.type === "simple_identifier" || f.type === "identifier") && f.text === "case") return true
    }
    return false
  }

  // Base names from the inheritance_specifier (mirrors extractBaseName).
  // SWIFTD19 mirror: the LEAF of a dotted user_type is the LAST sibling
  // type_identifier (Outer.Inner -> Inner, Foundation.URLSession ->
  // URLSession) — the pre-fix FIRST-segment read fabricated edges to the
  // module/container name.
  const baseName = (spec: any): string | null => {
    for (let i = 0; i < spec.namedChildCount; i++) {
      const c = spec.namedChild(i)
      if (!c) continue
      if (c.type === "type_identifier") return c.text
      if (c.type === "user_type") {
        let leaf: any = null
        for (let j = 0; j < c.namedChildCount; j++) {
          const x = c.namedChild(j)
          if (x && x.type === "type_identifier") leaf = x
        }
        if (leaf) return leaf.text
      }
    }
    const txt = spec.text.trim()
    return txt && !txt.includes(" ") ? txt : null
  }

  // SWIFTD17 mirror helper: is this call_expression a SUBSCRIPT access
  // (call_suffix with a `[` value_arguments) rather than a method call?
  const isSubscript = (n: any): boolean => {    const suffix = n.namedChildren.find((c: any) => c.type === "call_suffix")
    if (!suffix) return false
    const va = suffix.namedChildren.find((c: any) => c.type === "value_arguments" && c.text.startsWith("["))
    return !!va
  }

  const stack: any[] = [{ n: root, parentType: "" }]
  while (stack.length > 0) {
    const { n, parentType } = stack.pop()!
    const t = n.type
    // #940 mirror: an ERROR-recovered nominal header is the container, exactly
    // as a reduced `class_declaration` is (the keyword-token scan and the base
    // extraction below are shape-driven, so they run unchanged on it).
    if (t === "class_declaration" || swIsNominalRecovery(n)) {
      // Actor/struct/enum/extension are all class_declaration in the pinned
      // grammar, decided by the anonymous keyword token. Swift semantics:
      // ONLY a class can have a superclass (first base extends); struct/actor
      // bases are all protocol adoptions (implements); enum/extension bases
      // are conformances (SWIFTD14/15, below) — mirrors the analyzer.
      let isEnum = false
      let isExtension = false
      let isClass = false
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && !c.isNamed) {
          if (c.type === "enum") isEnum = true
          if (c.type === "extension") isExtension = true
          if (c.type === "class") isClass = true
        }
      }
      const bases: string[] = []
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "inheritance_specifier") {
          const nm = baseName(c)
          if (nm) bases.push(nm)
        }
      }
      if (isEnum || isExtension) {
      // SWIFTD14/15 oracle mirror: extension bases are ALL conformances
      // (no superclass possible); enum bases are conformances except a
      // stdlib raw-value first base (analyzer records it as meta.rawType).
      const skipFirst = isEnum && bases.length > 0 && SWIFT_ENUM_RAW.has(bases[0])
      for (let i = skipFirst ? 1 : 0; i < bases.length; i++) push("implements", bases[i])
      } else {
        // Mirror the analyzer: a class's first base is extends only when it
        // is NOT a known corpus protocol; a known protocol first-base (or any
        // struct/actor base) is implements.
        const firstIsSuperclass =
          isClass &&
          (bases.length > 0 ? !(corpusProtocols?.has(bases[0]) ?? false) : true)
        // SW-G mirror: record class -> superclass for super.init targets.
        if (firstIsSuperclass && bases.length > 0) {
          const nmNode = n.namedChildren.find((c: any) => c.type === "type_identifier")
          if (nmNode) swSuperByClass.set(nmNode.text, bases[0])
        }
        for (let i = 0; i < bases.length; i++) {
          const isExtends = firstIsSuperclass && i === 0
          push(isExtends ? "extends" : "implements", bases[i])
        }
      }
    }
    if (t === "protocol_declaration") {
      // SWIFTD13 oracle mirror: protocol inheritance -> extends per parent;
      // AnyObject/Any class-constraint markers are NOT protocol parents.
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "inheritance_specifier") {
          const nm = baseName(c)
          if (nm && nm !== "AnyObject" && nm !== "Any") push("extends", nm)
        }
      }
    }
    if (t === "call_expression") {
      // Subscript READ (`entries[key]`) parses as call_expression with a
      // `[key]` call_suffix — a property access, NOT a call (mirrors the
      // analyzer's isSubscriptRead gate).
      const isSubscriptCall = isSubscript(n)
      if (isSubscriptCall) { for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push({ n: c, parentType: t }) }; continue }
      // #938 mirror: the `case`-keyword recovery is a pattern match, not a
      // call — emit nothing (still descend, so the arguments' own edges stay).
      if (isCasePatternRecovery(n)) { for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push({ n: c, parentType: t }) }; continue }
      // callee: simple_identifier / identifier / navigation_expression
      const callee = n.namedChildren.find((c: any) => c.type === "simple_identifier" || c.type === "identifier" || c.type === "navigation_expression")
      if (callee && callee.type === "navigation_expression") {
        // Member call -> leaf, WITHOUT the builtin filter. The analyzer filters
        // BUILTIN_BARE_CALLS for BARE identifier invocations only ("Member calls
        // like `users.map` are NOT filtered — only bare identifier invocations
        // of these names"), so a receiver-qualified leaf that happens to share a
        // stdlib name is a REAL call. Applying the filter here under-derived
        // truth and reported genuine analyzer edges as fabrications: swift-nio's
        // `handler.assert(callbackCount: 0, cancelCount: 0)` on
        // NonSendableMockScheduledCallbackHandler (F5 2026-09-12, unexplained=1,
        // and `contains MockScheduledCallbackHandler -> assert` proves the type
        // DECLARES that method). The bare branch below keeps the filter.
        const leaf = navLeaf(callee)
        // Enclosing nominal type (class/struct/actor/enum/extension/protocol)
        // for owner-relative rules (SW-G self, SW-H Self).
        const enclosingType = (() => {
          let o: any = n.parent
          let og = 0
          while (o && og++ < 14) {
            // #940 mirror: a recovered nominal names the enclosing type too.
            if (o.type === "class_declaration" || swIsNominalRecovery(o)) {
              return swRecoveryName(o)
            }
            if (o.type === "protocol_declaration") {
              for (let k = 0; k < o.namedChildCount; k++) {
                const c = o.namedChild(k)
                if (c && c.type === "type_identifier") return c.text
              }
              return null
            }
            o = o.parent
          }
          return null
        })()
        let consumed = false
        // SW-G mirror: super/self/Self.init(...) constructs (dart DT-D).
        if (leaf === "init") {
          const firstC = callee.namedChildren.find((c: any) => true)
          let recv: string | null = null
          if (firstC) {
            if (firstC.type === "super_expression") recv = "super"
            else if (firstC.type === "self_expression") recv = "self"
            else if ((firstC.type === "simple_identifier" || firstC.type === "identifier" || firstC.type === "type_identifier") && firstC.text === "Self") recv = "Self"
          }
          if (recv) {
            const target = recv === "super" ? swSuperByClass.get(enclosingType) ?? null : enclosingType
            if (target) push("instantiates", target)
            // #941 mirror: SW-G, verbatim — "Unresolvable stays silent". An
            // initializer delegation is never a `calls` edge, so the
            // unresolvable case must not fall through to the generic path and
            // publish the dangling `calls -> init`.
            consumed = true
          }
        }
        if (!consumed) {
          if (leaf && leaf !== "$0") { swNoteCallsSite(leaf); push("calls", leaf) }
          // SW-B mirror: record enum-construction candidates (capitalized
          // DIRECT receiver + leaf) for post-walk resolution. Receiver is
          // second-to-last in document order; never descend into nested
          // calls (arguments are not chain members).
          if (leaf && leaf !== "$0") {
            const seen: any[] = [callee]
            const st: any[] = [callee]
            while (st.length > 0) {
              const x = st.pop()!
              if (x !== callee && x.type === "call_expression") continue
              for (let k = x.namedChildCount - 1; k >= 0; k--) {
                const c = x.namedChild(k)
                if (c) { st.push(c); seen.push(c) }
              }
            }
            seen.sort((a: any, b: any) => a.startIndex - b.startIndex)
            const parts: string[] = []
            for (const x of seen) {
              if (x.type === "simple_identifier" || x.type === "identifier" || x.type === "type_identifier") parts.push(x.text)
            }
            const receiver = parts.length >= 2 ? parts[parts.length - 2] : null
            if (receiver && isCapitalized(receiver) && receiver !== "Self" && receiver !== "super" && receiver !== "this") {
              swEnumCtorCandidates.push({ head: receiver, owner: null, leaf, removeCalls: true })
            } else if (receiver === "Self" && enclosingType) {
              // SW-H mirror: Self.a(v) in an enum builds the enclosing enum.
              swEnumCtorCandidates.push({ head: null, owner: enclosingType, leaf, removeCalls: true })
            }
          }
        }
      } else if (callee) {
        const target = callee.text
        // SWIFTD16 mirror: XCTest assertion functions (capitalized free
        // functions, never types) must not fabricate instantiates edges.
        if (target && !SWIFT_BUILTINS.has(target) && !target.startsWith("XCT")) {
          if (isCapitalized(target)) push("instantiates", target)
          else { swNoteCallsSite(target); push("calls", target) }
        }
      }
      // SW-H mirror: implicit enum-case construction (`.a(v)` parses the
      // callee as a leading-dot prefix_expression — no simple callee).
      if (!callee) {
        const pre = n.namedChildren.find((c: any) => c.type === "prefix_expression")
        const dotFirst = pre ? pre.child(0) : null
        if (pre && dotFirst && !dotFirst.isNamed && dotFirst.type === ".") {
          let leaf: string | null = null
          for (let k = 0; k < pre.namedChildCount; k++) {
            const c = pre.namedChild(k)
            if (c && (c.type === "simple_identifier" || c.type === "identifier")) { leaf = c.text; break }
          }
          if (leaf) {
            let own: any = n.parent
            let og = 0
            let onm: string | null = null
            while (own && og++ < 14) {
              if (own.type === "class_declaration") {
                for (let k = 0; k < own.namedChildCount; k++) {
                  const c = own.namedChild(k)
                  if (c && c.type === "type_identifier") { onm = c.text; break }
                }
                if (onm) break
                for (let k = 0; k < own.namedChildCount; k++) {
                  const c = own.namedChild(k)
                  if (c && c.type === "user_type") {
                    let lf: any = null
                    for (let j = 0; j < c.namedChildCount; j++) {
                      const x = c.namedChild(j)
                      if (x && x.type === "type_identifier") lf = x
                    }
                    if (lf) { onm = lf.text; break }
                  }
                }
                if (onm) break
                break
              }
              own = own.parent
            }
            if (onm) swEnumCtorCandidates.push({ head: null, owner: onm, leaf, removeCalls: false })
          }
        }
      }
    }
    if (t === "navigation_expression") {
      // uses: self. member READ — not the callee of a call_expression, and
      // self must be on the RECEIVER chain (navigation > navigation > self),
      // never inside a call: `self.decode(...)?.buffer` reads .buffer off the
      // CALL RESULT, not off self (mirrors the analyzer's hasSelfReceiver).
      // SCD1 write gate — mirrors the analyzer: an assignment LHS is a
      // WRITE, never a read. The pinned grammar wraps the LHS in
      // directly_assignable_expression; gate only when this node sits
      // INSIDE the LHS span (the RHS of `self.x = self.y` stays a read).
      {
        // #939 mirror: climb through the `postfix_expression` unwrap wrapper
        // as well — `x.a!.b += 1` puts the inner navigation one wrapper away
        // from the assignable path, and stopping there let the LHS-span test
        // never run on the ANALYZER side while this side blocked descent.
        let a: any = n.parent
        while (a && (a.type === "directly_assignable_expression" || a.type === "postfix_expression")) a = a.parent
        if (a && a.type === "assignment") {
          const lhs = a.namedChild(0)
          if (lhs && lhs.startIndex <= n.startIndex && lhs.endIndex >= n.endIndex) continue
        }
      }
      const hasSelf = hasSelfReceiver(n)
      // SWIFTD17 mirror: the funcNode of a METHOD call is not a member read
      // (analyzer RULED), but the base navigation of a SUBSCRIPT access is a
      // genuine container read — php/objc emit uses there too. The analyzer
      // inspects node.parent; the oracle receives the parent type via the
      // walk, so re-derive subscript-ness from this node's parent node.
      const parCallSubscript = n.parent && n.parent.type === "call_expression" && isSubscript(n.parent)
      if (hasSelf && (parentType !== "call_expression" || parCallSubscript)) {
        const leaf = navLeaf(n)
        if (leaf) push("uses", leaf)
      }
      // SW-A mirror: NON-self navigation member reads. Direct suffixes only
      // (nested navigations visit separately); self-chains belong to the
      // self rule above. Skip callee suffixes (last suffix of a func-nav of
      // a non-subscript call), implicit-dot roots, LHS writes, self/Self/$0.
      if (!hasSelf) {
        const par = n.parent
        const isFuncOfCall = par && par.type === "call_expression" && !isSubscript(par)
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c || c.type !== "navigation_suffix") continue
          const m = c.namedChildren.find((x: any) => x.type === "simple_identifier" || x.type === "identifier")
          if (!m || !m.text || m.text === "$0" || m.text === "self" || m.text === "Self") continue
          if (isFuncOfCall) {
            let isLast = true
            for (let j = n.namedChildCount - 1; j >= 0; j--) {
              const s = n.namedChild(j)
              if (s && s.type === "navigation_suffix") {
                isLast = s.startIndex === c.startIndex && s.endIndex === c.endIndex
                break
              }
            }
            if (isLast) continue
          }
          let outer: any = n
          while (outer && outer.parent && outer.parent.type === "navigation_expression") outer = outer.parent
          const firstTok = outer ? outer.child(0) : null
          if (firstTok && !firstTok.isNamed && firstTok.type === ".") continue
          // #939 mirror: the unwrap wrapper is part of the assignable path.
          let a2: any = n.parent
          while (a2 && (a2.type === "directly_assignable_expression" || a2.type === "postfix_expression" || a2.type === "navigation_expression" || a2.type === "navigation_suffix")) a2 = a2.parent
          if (a2 && a2.type === "assignment") {
            const lhs2 = a2.namedChild(0)
            if (lhs2 && lhs2.startIndex <= c.startIndex && lhs2.endIndex >= c.endIndex) continue
          }
          push("uses", m.text)
        }
      }
    }
    // SW-D mirror: key-path members always read the member identity.
    if (t === "key_path_expression") {
      const st: any[] = [n]
      while (st.length > 0) {
        const x = st.pop()!
        if (!x) continue
        if (x.type === "navigation_suffix") {
          const m = x.namedChildren.find((c: any) => c.type === "simple_identifier" || c.type === "identifier")
          if (m && m.text && m.text !== "self" && m.text !== "Self") push("uses", m.text)
          continue
        }
        for (let k = x.namedChildCount - 1; k >= 0; k--) { const c = x.namedChild(k); if (c) st.push(c) }
      }
    }
    if (t === "import_declaration") {
      // mirror handleImport: first simple_identifier/type_identifier/identifier
      const id = n.namedChildren.find((c: any) => c.type === "simple_identifier" || c.type === "type_identifier" || c.type === "identifier")
      if (id && id.text) push("references", id.text)
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, parentType: t })
    }
  }
  // SW-B post-walk: enum-case construction converts matched leaf calls.
  // Enums parse as class_declaration with an `enum` token (SWIFTD1) —
  // match on the token, not a dedicated node type.
  if (swEnumCtorCandidates.length > 0) {
    const enumCases = new Set<string>()
    const hasEnumTok = (n: any): boolean => {
      for (let k = 0; k < n.childCount; k++) {
        const c = n.child(k)
        if (c && !c.isNamed && c.type === "enum") return true
      }
      return false
    }
    const pre: any[] = [root]
    while (pre.length > 0) {
      const pn = pre.pop()!
      if (!pn) continue
      // #940 mirror: a recovered `enum` header owns its cases exactly as a
      // reduced one does (the case inventory must match the analyzer's
      // EnumMember symbols, which the recovery mints).
      if ((pn.type === "class_declaration" || swIsNominalRecovery(pn)) && hasEnumTok(pn)) {
        const enm: string | null = pn.type === "class_declaration"
          ? (() => {
              for (let k = 0; k < pn.namedChildCount; k++) {
                const c = pn.namedChild(k)
                if (c && c.type === "type_identifier") return c.text
              }
              return null
            })()
          : swRecoveryName(pn)
        if (enm) {
          const est: any[] = [pn]
          while (est.length > 0) {
            const en = est.pop()!
            if (!en) continue
            if (en.type === "enum_entry") {
              for (let k = 0; k < en.namedChildCount; k++) {
                const c = en.namedChild(k)
                if (c && c.type === "simple_identifier") { enumCases.add(`${enm}.${swStripQuoting(c.text)}`); break }
                // #924: an attributed case puts `modifiers` FIRST — the name is
                // the identifier after it, exactly as the analyzer reads it.
                if (c && (c.type === "modifiers" || c.type === "attribute")) continue
              }
            }
            for (let k = en.namedChildCount - 1; k >= 0; k--) {
              const c = en.namedChild(k)
              if (c) est.push(c)
            }
          }
        }
      }
      for (let k = pn.namedChildCount - 1; k >= 0; k--) {
        const c = pn.namedChild(k)
        if (c) pre.push(c)
      }
    }
    if (enumCases.size > 0) {
      // #938/#942: retire only the contributing SITES, then drop a `calls`
      // edge whose site count fell to zero, then append the instantiates
      // edges. Splicing by (label,target) deleted another site's real call.
      const instantiatesKeys: string[] = []
      for (const cand of swEnumCtorCandidates) {
        const key = cand.head ?? cand.owner
        if (!key || !enumCases.has(`${key}.${cand.leaf}`)) continue
        if (cand.removeCalls) swCallsSites.set(cand.leaf, (swCallsSites.get(cand.leaf) ?? 0) - 1)
        instantiatesKeys.push(key)
      }
      for (let k = edges.length - 1; k >= 0; k--) {
        if (edges[k].label !== "calls") continue
        if ((swCallsSites.get(edges[k].target) ?? 0) > 0) continue
        edges.splice(k, 1)
      }
      for (const key of instantiatesKeys) push("instantiates", key)
    }
  }
  return edges
}

// Swift #754 mirror: bare member reads. Mirrors the analyzer rule for rule —
// the name must resolve to a DECLARED MEMBER of the enclosing type (member
// inventory from the analyzer's own symbols; ownerName IS the enclosing type),
// must not be a local/param the current function binds (CGD15), and must not
// sit in a declaration, chain-leaf, callee or write-LHS position. Truth still
// derives every EDGE from tree structure; only the inventory is shared.
export function deriveSwiftBareUses(root: any, symbols: any[] = []): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const membersByOwner = new Map<string, Set<string>>()
  for (const s of symbols ?? []) {
    if (!s || typeof s.name !== "string" || !s.ownerName) continue
    let set = membersByOwner.get(s.ownerName)
    if (!set) { set = new Set<string>(); membersByOwner.set(s.ownerName, set) }
    set.add(s.name)
  }
  // #924 mirror: the quoting syntax is not part of a name (`return \`default\``
  // reads the member `default`, which is the name the declaration publishes).
  const stripQuoting = (t: string): string =>
    t.length >= 2 && t.charCodeAt(0) === 96 && t.charCodeAt(t.length - 1) === 96 ? t.slice(1, -1) : t
  const push = (name: string): void => {
    name = stripQuoting(name)
    const key = "uses\u0000" + name
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ label: "uses", from: "", target: name })
  }
  // Mirrors NOT_A_READ in the analyzer: declarations, plus the two positions
  // that name something other than a member of the enclosing type — an
  // argument label (names a parameter) and an implicit member expression
  // (`.regular`, whose base the type checker infers).
  const NOT_A_READ = new Set([
    "pattern", "parameter", "function_declaration", "protocol_function_declaration",
    "class_declaration", "protocol_declaration", "struct_declaration",
    "enum_declaration", "extension_declaration", "actor_declaration",
    "typealias_declaration", "associatedtype_declaration", "type_annotation",
    "user_type", "import_declaration", "attribute", "enum_entry",
    "value_argument_label",
  ])
  const TYPE_NODES = new Set([
    "class_declaration", "protocol_declaration", "struct_declaration",
    "enum_declaration", "extension_declaration", "actor_declaration",
  ])
  const FUNC_SCOPES = new Set([
    "function_declaration", "protocol_function_declaration",
    "init_declaration", "deinit_declaration",
  ])
  const VALUE_SCOPES = new Set(["lambda_literal", "property_declaration"])
  const isWrite = (n: any): boolean => {
    // #939 mirror: traverse the unwrap wrapper (`x.a!` sits inside a
    // postfix_expression) — otherwise the climb stops at its first step.
    let a: any = n.parent
    while (
      a && (a.type === "directly_assignable_expression" ||
        a.type === "postfix_expression" ||
        a.type === "navigation_expression" ||
        a.type === "navigation_suffix")
    ) a = a.parent
    if (a && a.type === "assignment") {
      const lhs = a.namedChild(0)
      return !!lhs && lhs.startIndex <= n.startIndex && lhs.endIndex >= n.endIndex
    }
    return false
  }
  const ownNameSpan = (scope: any): number => {
    if (scope.type === "property_declaration") {
      let pat: any = null
      for (let i = 0; i < scope.namedChildCount; i++) {
        const c = scope.namedChild(i)
        if (c && c.type === "pattern") { pat = c; break }
      }
      if (pat) {
        for (let i = 0; i < pat.namedChildCount; i++) {
          const c = pat.namedChild(i)
          if (c && c.type === "simple_identifier") return c.startIndex
        }
      }
    }
    return -1
  }
  const collectBound = (node: any, out: Set<string>): void => {
    const own = ownNameSpan(node)
    const w: any[] = [node]
    while (w.length > 0) {
      const m = w.pop()!
      if (m.type === "simple_identifier" && m.startIndex !== own) {
        const pt = m.parent ? m.parent.type : ""
        if (pt === "parameter" || pt === "pattern") out.add(m.text)
      }
      for (let i = m.namedChildCount - 1; i >= 0; i--) {
        const c = m.namedChild(i)
        if (c) w.push(c)
      }
    }
  }
  const extendLocals = (locals: Set<string>, scope: any): Set<string> => {
    const bound = new Set<string>()
    collectBound(scope, bound)
    if (bound.size === 0) return locals
    const next = new Set(locals)
    for (const nm of bound) next.add(nm)
    return next
  }
  const firstName = (node: any, type: string): any => {
    const s: any[] = [node]
    while (s.length > 0) {
      const x = s.pop()!
      if (x.type === type) return x
      for (let i = x.namedChildCount - 1; i >= 0; i--) { const c = x.namedChild(i); if (c) s.push(c) }
    }
    return null
  }
  const walk = (n: any, ty: string | null, locals: Set<string>): void => {
    const t = n.type
    let cTy = ty
    let cLocals = locals
    if (TYPE_NODES.has(t)) {
      const nameNode = firstName(n, "type_identifier") || firstName(n, "simple_identifier")
      if (nameNode) cTy = nameNode.text
    } else if (swIsNominalRecovery(n)) {
      // #940 mirror: an ERROR-recovered nominal is a container for its members
      // exactly like a reduced declaration, so the member inventory a bare
      // read is scored against must resolve the same way on both sides.
      const nm = swRecoveryName(n)
      if (nm) cTy = nm
    } else if (FUNC_SCOPES.has(t)) {
      cLocals = extendLocals(locals, n)
    } else if (VALUE_SCOPES.has(t)) {
      cLocals = extendLocals(locals, n)
    }
    if (t === "simple_identifier") {
      const txt = n.text
      const pt = n.parent ? n.parent.type : ""
      // SW-F mirror: projected values read the wrapped member ($0-style
      // closure shorthands never resolve).
      let lookup = txt
      if (lookup.startsWith("$")) {
        const rest = lookup.slice(1)
        let allDigits = rest.length > 0
        for (let k = 0; k < rest.length; k++) {
          const cc = rest.charCodeAt(k)
          if (cc < 48 || cc > 57) { allDigits = false; break }
        }
        if (!allDigits) {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c) walk(c, cTy, cLocals)
          }
          return
        }
        lookup = rest
      }
      const isMember = !!cTy && (membersByOwner.get(cTy)?.has(lookup) ?? false)
      const isImplicitMember = pt === "prefix_expression" && String(n.parent ? n.parent.text : "").startsWith(".")
      if (
        !NOT_A_READ.has(pt) &&
        !isImplicitMember &&
        pt !== "navigation_suffix" &&
        pt !== "call_expression" &&
        !isWrite(n) &&
        !cLocals.has(txt) &&
        !cLocals.has(lookup) &&
        isMember
      ) push(lookup)
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walk(c, cTy, cLocals)
    }
  }
  walk(root, null, new Set<string>())
  return edges
}

// Objective-C tree-truth oracle (objective-c managed-OO wave #267, selector
// identity wave #2). Mirrors RealObjectiveCAnalyzer's emission contract:
//   - extends: superclass (the first identifier/type_identifier AFTER the
//     class name, past the `:` in class_interface/class_implementation),
//     from non-category declarations only
//   - implements: protocols under parameterized_arguments (type_identifier /
//     identifier / type_name children)
//   - instantiates: message_expression whose selector is alloc/new — the
//     receiver leaf is the instantiated class (nested [[Foo alloc] ...] too)
//   - calls: message_expression FULL SELECTORS (OBJCD7: the keyword segments
//     are identifiers whose next child is an anonymous ':' — leaf naming
//     merged distinct overloads; zero-arg selectors are the last identifier)
//     AND C call_expression identifiers, ONLY inside method/function bodies
//   - overrides (verified in-file only, OBJCD8): a class whose superclass is
//     declared in-file and declares the same full selector emits overrides
//     target `Base.method` (the analyzer's verified 0.95 edges; external-base
//     first-parent guesses at 0.5 are heuristic, no oracle counterpart)
//   - references: preproc_include -> root -> module name (system_lib_string
//     stripped of <>, or string_literal content)
// The oracle emits UNIQUE (label,target) edges (seen-set per label+target),
// matching the site-agnostic coverage match in main().
export function deriveObjcEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const key = (label: string, target: string) => label + ":" + target
  const push = (label: string, target: string) => {
    const k = key(label, target)
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }
  const isRootBase = (name: string) => name === "NSObject" || name === "NSProxy"
  // OC-E oracle mirror: bare-identifier value reads. Mirrors the analyzer's
  // scope inventory exactly — per-definition value frames (+ block chain),
  // same-file class ivar/property pre-scan, file-scope globals, and the
  // identical name-vs-read skip battery (span-compared, never reference
  // identity). Unbound names stay silent on both sides.
  const objcBareSkip = new Set(["self", "super", "nil", "Nil", "NULL", "YES", "NO", "true", "false", "_cmd"])
  const objcSame = (a: any, b: any): boolean => !!a && !!b && a.startIndex === b.startIndex && a.endIndex === b.endIndex
  const objcSpanIn = (outer: any, inner: any): boolean => !!outer && !!inner && outer.startIndex <= inner.startIndex && outer.endIndex >= inner.endIndex
  const objcDeclaredName = (mnode: any): string | null => {
    const firstId = (n: any): any => {
      if (!n) return null
      if (n.type === "identifier") return n
      for (let i = 0; i < n.namedChildCount; i++) {
        const f = firstId(n.namedChild(i))
        if (f) return f
      }
      return null
    }
    const idNode = firstId(mnode)
    if (!idNode) return null
    const findT = (n: any, pred: (x: any) => boolean): any => {
      if (pred(n)) return n
      for (let i = 0; i < n.namedChildCount; i++) {
        const f = findT(n.namedChild(i), pred)
        if (f) return f
      }
      return null
    }
    const structDecl = findT(mnode, (n: any) => n.type === "struct_declaration")
    if (structDecl) {
      const sd = findT(structDecl, (n: any) => n.type === "struct_declarator")
      if (sd) {
        const deep = firstId(sd)
        if (deep) return deep.text
      }
    }
    return idNode.text
  }
  const objcDeclaratorName = (dnode: any): string | null => {
    // Mirrors the analyzer's declaratorName exactly: init_declarators
    // search the head declarator subtree; parameters prefer the DIRECT
    // identifier child (a block-pointer parameter's inner type names must
    // not win over the parameter name).
    if (dnode.type !== "init_declarator") {
      const direct = dnode.namedChildren.find((c: any) => c.type === "identifier")
      if (direct) return direct.text
    }
    const kids: any[] = dnode.type === "init_declarator" && dnode.namedChild(0) ? [dnode.namedChild(0)] : [dnode]
    const stack: any[] = [...kids]
    while (stack.length > 0) {
      const c = stack.pop()!
      if (!c) continue
      if (c.type === "identifier") return c.text
      for (let i = c.namedChildCount - 1; i >= 0; i--) {
        const ch = c.namedChild(i)
        if (ch) stack.push(ch)
      }
    }
    return null
  }
  const objcDeclaratorWrappers = new Set(["array_declarator", "pointer_declarator", "parenthesized_declarator", "attributed_declarator", "abstract_pointer_declarator", "abstract_block_pointer_declarator", "block_pointer_declarator", "function_declarator"])
  const objcIsDeclaratorName = (inode: any): boolean => {
    const wrappers = objcDeclaratorWrappers
    let cur: any = inode
    let p: any = inode.parent ?? null
    while (p && wrappers.has(p.type) && cur) { cur = p; p = p.parent ?? null }
    if (!p || p.type !== "init_declarator" || !cur) return false
    return objcSpanIn(p.namedChild(0), cur)
  }
  // M60 objc lane (2026-09-25), analyzer mirror: the DECLARED NAME of a parameter
  // is a name, never a read. The direct `identifier < parameter_declaration` and
  // `identifier < pointer_declarator < parameter_declaration` shapes were already
  // covered by the parent-type skip, but a BLOCK-POINTER parameter nests
  // `identifier < block_pointer_declarator < parenthesized_declarator <
  // function_declarator < parameter_declaration`, so this oracle published
  // `uses h -> handler` from the declaration alone (probe
  // script/m14/tmp/oc-oracle-param-uses.ts: "block decl only" -> uses handler,
  // with no read in the file) — while the C oracle given the identical
  // function-pointer parameter publishes NOTHING. The analyzer's isParameterDeclaredName
  // now refuses it, so the oracle must refuse it too (the #916 lesson: a fix the
  // oracle does not learn reads as MISSING at full extent).
  const objcIsParameterDeclaredName = (inode: any): boolean => {
    let cur: any = inode
    let p: any = inode.parent ?? null
    while (p && objcDeclaratorWrappers.has(p.type) && cur) { cur = p; p = p.parent ?? null }
    if (!p || !cur) return false
    if (p.type !== "parameter_declaration" && p.type !== "method_parameter") return false
    const declared = typeof p.childForFieldName === "function" ? p.childForFieldName("declarator") : null
    if (!declared) return p.type === "method_parameter"
    return objcSpanIn(declared, cur)
  }
  const objcIsForInVar = (forNode: any, inode: any): boolean => {
    for (let i = 0; i < forNode.childCount; i++) {
      const c = forNode.child(i)
      if (c && !c.isNamed && c.type === "in" && i > 0) {
        for (let j = i - 1; j >= 0; j--) {
          const pc = forNode.child(j)
          if (pc && pc.isNamed) return objcSame(pc, inode)
        }
        return false
      }
    }
    return false
  }
  const objcClassMembers = new Map<string, Set<string>>()
  // OC-F mirror: same-file enum case names (flat set, shadowed by nearer binds).
  const objcEnumCases = new Set<string>()
  {
    const pre: any[] = [root]
    while (pre.length > 0) {
      const pn = pre.pop()!
      if (!pn) continue
      if (pn.type === "enum_specifier") {
        const el = pn.namedChildren.find((c: any) => c.type === "enumerator_list")
        if (el) {
          for (let i = 0; i < el.namedChildCount; i++) {
            const en = el.namedChild(i)
            if (!en || en.type !== "enumerator") continue
            const nm = en.namedChildren.find((c: any) => c.type === "identifier")
            if (nm && nm.text.trim()) objcEnumCases.add(nm.text)
          }
        }
      }
      if (pn.type === "class_interface" || pn.type === "class_implementation") {
        const cn = pn.namedChildren.find((c: any) => c.type === "identifier" || c.type === "type_identifier")
        if (cn) {
          let members = objcClassMembers.get(cn.text)
          if (!members) { members = new Set<string>(); objcClassMembers.set(cn.text, members) }
          const ms: any[] = [pn]
          while (ms.length > 0) {
            const mn = ms.pop()!
            if (!mn) continue
            if (mn !== pn && (mn.type === "class_interface" || mn.type === "class_implementation" || mn.type === "protocol_declaration")) continue
            if (mn.type === "property_declaration" || mn.type === "instance_variable") {
              const mname = objcDeclaredName(mn)
              if (mname) members!.add(mname)
            }
            for (let i = mn.namedChildCount - 1; i >= 0; i--) {
              const mc = mn.namedChild(i)
              if (mc) ms.push(mc)
            }
          }
        }
      }
      for (let i = pn.namedChildCount - 1; i >= 0; i--) {
        const pc = pn.namedChild(i)
        if (pc) pre.push(pc)
      }
    }
  }
  let objcFrame: Set<string> | null = null
  const objcBlockFrames: Array<Set<string>> = []
  const objcGlobals = new Set<string>()
  const objcBind = (name: string): void => {
    if (!name) return
    if (objcBlockFrames.length > 0) objcBlockFrames[objcBlockFrames.length - 1].add(name)
    else if (objcFrame) objcFrame.add(name)
    else objcGlobals.add(name)
  }
  const objcBound = (name: string, owner: string): boolean => {
    for (let i = objcBlockFrames.length - 1; i >= 0; i--) {
      if (objcBlockFrames[i].has(name)) return true
    }
    if (objcFrame && objcFrame.has(name)) return true
    const cm = objcClassMembers.get(owner)
    if (cm && cm.has(name)) return true
    if (objcGlobals.has(name)) return true
    // OC-F: same-file enum cases resolve last.
    if (objcEnumCases.has(name)) return true
    return false
  }
  // OBJCD8 oracle mirror: collect in-file class superclass clauses + full
  // selectors per class (interface/implementation both contribute; a Set
  // dedups the same selector declared in @interface and defined in
  // @implementation, mirroring the analyzer's symbol dedup).
  const classBase = new Map<string, string>()
  const classMethods = new Map<string, Set<string>>()
  const fullMethodSelector = (mnode: any): string => {
    let sel = ""
    for (let i = 0; i < mnode.namedChildCount; i++) {
      const c = mnode.namedChild(i)
      if (!c) continue
      if (c.type === "identifier") {
        sel += c.text
        const next = i + 1 < mnode.namedChildCount ? mnode.namedChild(i + 1) : null
        if (next && next.type === "method_parameter") sel += ":"
      }
    }
    return sel
  }
  const fullMessageSelector = (mnode: any): string => {
    let sel = ""
    let lastId: string | null = null
    for (let i = 0; i < mnode.childCount; i++) {
      const c = mnode.child(i)
      if (!c) continue
      if (c.isNamed && c.type === "identifier") {
        const nxt = i + 1 < mnode.childCount ? mnode.child(i + 1) : null
        if (nxt && !nxt.isNamed && nxt.type === ":") {
          sel += c.text + ":"
        } else {
          lastId = c.text
        }
      }
    }
    if (sel) return sel
    return lastId ?? ""
  }
  const collectCls = (cnode: any) => {
    let hasParen = false
    for (let i = 0; i < cnode.childCount; i++) {
      const c = cnode.child(i)
      if (c && !c.isNamed && c.type === "(") { hasParen = true; break }
    }
    if (hasParen) return
    // class_interface: identifier(class), identifier(superclass),
    // parameterized_arguments(protocols), then method_declaration nodes
    // DIRECTLY. class_implementation: identifier(class), then methods nest
    // under implementation_definition wrappers. Collect superclass from the
    // top-level identifiers (probe-verified 2026-09) and methods via a
    // subtree scan that stops at nested class/protocol boundaries.
    let foundName = false
    let superName: string | null = null
    let className: string | null = null
    const methods = new Set<string>()
    for (let i = 0; i < cnode.namedChildCount; i++) {
      const c = cnode.namedChild(i)
      if (!c) continue
      if ((c.type === "identifier" || c.type === "type_identifier") && !foundName && !className) {
        className = c.text
        foundName = true
        continue
      }
      if (c.type === "identifier" && className && !superName && !c.text.startsWith("@")) superName = c.text
    }
    const mstack: any[] = [{ n: cnode, top: true }]
    while (mstack.length > 0) {
      const { n } = mstack.pop()!
      const tt = n.type
      if (!n || n === cnode) { /* root of scan */ }
      if (n !== cnode && (tt === "class_interface" || tt === "class_implementation" || tt === "protocol_declaration")) continue
      if (tt === "method_declaration" || tt === "method_definition") {
        const sel = fullMethodSelector(n)
        if (sel) methods.add(sel)
        continue
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const cc = n.namedChild(i)
        if (cc) mstack.push({ n: cc })
      }
    }
    if (className) {
      if (superName && !isRootBase(superName)) classBase.set(className, superName)
      let set = classMethods.get(className)
      if (!set) { set = new Set<string>(); classMethods.set(className, set) }
      for (const m of methods) set.add(m)
    }
  }
  // In-file verified overrides (OBJCD8): for each class with a KNOWN in-file
  // base that declares the same selector. NSObject/NSProxy bases never appear
  // (excluded above); external bases emit no oracle edge (the analyzer's 0.5
  // guess is heuristic by design).
  const scanStack: any[] = [root]
  while (scanStack.length > 0) {
    const nn = scanStack.pop()!
    if (nn.type === "class_interface" || nn.type === "class_implementation") collectCls(nn)
    for (let i = nn.namedChildCount - 1; i >= 0; i--) {
      const cc = nn.namedChild(i)
      if (cc) scanStack.push(cc)
    }
  }
  for (const [cls, base] of classBase) {
    const baseSet = classMethods.get(base)
    const clsSet = classMethods.get(cls)
    if (!baseSet || !clsSet) continue
    for (const m of clsSet) {
      if (baseSet.has(m)) push("overrides", `${base}.${m}`)
    }
  }

  // Walk with an inBody flag: calls/instantiates only inside method/function
  // bodies (mirrors the analyzer's activeScope !== "global" guard). OC-E
  // threads the analyzer's scope model too (scope ~ activeScope, owner,
  // bindable) plus block exit markers, so bare-read binds and reads land
  // identically on both sides.
  const stack: any[] = [{ n: root, inBody: false, parentType: "", scope: "global", owner: "", bindable: false }]
  while (stack.length > 0) {
    const { n, inBody, parentType, scope, owner, bindable, exitBlock } = stack.pop()!
    if (exitBlock) { objcBlockFrames.pop(); continue }
    const t = n.type
    let childScope = scope
    let childOwner = owner
    let childBindable = bindable
    if (t === "method_definition" || t === "function_definition") {
      objcFrame = new Set<string>()
      childBindable = true
      if (t === "function_definition") {
        childOwner = ""; childScope = "fn"
        // OC-H mirror: file-scope function names are resolvable values
        // (first function_declarator outside the body, then its identifier).
        const fstack: any[] = [n]
        let fname: string | null = null
        while (fstack.length > 0 && !fname) {
          const fc = fstack.pop()!
          if (!fc || fc.type === "compound_statement") continue
          if (fc.type === "function_declarator") {
            const id = fc.namedChildren.find((c: any) => c.type === "identifier")
            if (id) fname = id.text
            break
          }
          for (let k = fc.namedChildCount - 1; k >= 0; k--) {
            const c = fc.namedChild(k)
            if (c) fstack.push(c)
          }
        }
        if (fname) objcGlobals.add(fname)
      }
      else { const sel = fullMethodSelector(n); if (sel) childScope = sel }
    }
    if (t === "block_literal" && childBindable) objcBlockFrames.push(new Set<string>())
    if (t === "class_interface" || t === "class_implementation") {
      // Category detection: an anonymous `(` child (like swift's actor via
      // keyword token). Categories emit Extension symbols, no inheritance.
      let isCategory = false
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && !c.isNamed && c.type === "(") { isCategory = true; break }
      }
      // OC-E: the class name scopes reads (categories resolve to the
      // extended class, mirroring the analyzer).
      const clsNameNode = n.namedChildren.find((c: any) => c.type === "identifier" || c.type === "type_identifier")
      if (clsNameNode) { childScope = clsNameNode.text; childOwner = clsNameNode.text }
      if (!isCategory) {
        let foundName = false
        let superName: string | null = null
        const protocols: string[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "identifier" && !foundName) { foundName = true; continue }
          if ((c.type === "type_identifier" || c.type === "identifier") && !superName) { superName = c.text }
          if (c.type === "parameterized_arguments") {
            for (let j = 0; j < c.namedChildCount; j++) {
              const pn = c.namedChild(j)
              if (pn && (pn.type === "type_identifier" || pn.type === "identifier" || pn.type === "type_name")) protocols.push(pn.text)
            }
          }
        }
        if (superName) push("extends", superName)
        for (const p of protocols) push("implements", p)
      } else {
        // Category protocol conformance: `@interface NSString (Cat) <NSCoding>`
        // — the class genuinely adopts the protocol (mirrors the analyzer).
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "parameterized_arguments") {
            for (let j = 0; j < c.namedChildCount; j++) {
              const pn = c.namedChild(j)
              if (pn && (pn.type === "type_identifier" || pn.type === "identifier" || pn.type === "type_name")) push("implements", pn.text)
            }
          }
        }
      }
    }
    if (t === "protocol_declaration") {
      // Protocol inheritance: `@protocol Child <Parent, Grandparent>` —
      // inherited parents under protocol_reference_list (mirrors the
      // analyzer). Protocols inherit other protocols in ObjC.
      const nameNode = n.namedChildren.find((c: any) => c.type === "identifier")
      if (nameNode) {
        const refList = n.namedChildren.find((c: any) => c.type === "protocol_reference_list")
        if (refList) {
          for (let i = 0; i < refList.namedChildCount; i++) {
            const cn = refList.namedChild(i)
            if (cn && cn.type === "identifier") push("extends", cn.text)
          }
        }
      }
    }
    if (t === "field_expression" && inBody) {
      // Member READS (managed-OO family contract): dot-syntax property
      // reads (`self.next`, `w.next`, `self.origin.x`) emit uses -> the
      // field name. The LHS of an assignment_expression is a WRITE, not a
      // read (mirrors the analyzer's parentType gate).
      const field = n.childForFieldName?.("field") ?? n.namedChildren.find((c: any) => c.type === "field_identifier")
      if (field && field.text.trim() && parentType !== "assignment_expression") {
        push("uses", field.text)
      }
    }
    if (t === "message_expression" && inBody) {      // OBJCD7: full selector (mirrors the analyzer) — a keyword is an
      // identifier whose next child is an anonymous ':'; zero-arg messages
      // fall back to the last identifier. alloc/new -> instantiates the
      // receiver leaf (first keyword check); nested [[Foo alloc] ...]
      // resolves through the inner message.
      const msgSel = fullMessageSelector(n)
      if (msgSel) {
        const firstKw = msgSel.split(":")[0]
        if (firstKw === "alloc" || firstKw === "new") {
          let receiverLeaf: string | null = null
          const receiver = n.namedChild(0)
          if (receiver) {
            if (receiver.type === "identifier" || receiver.type === "type_identifier") receiverLeaf = receiver.text
            else if (receiver.type === "message_expression") {
              const innerSel = fullMessageSelector(receiver)
              const innerKw = innerSel.split(":")[0]
              if (innerKw === "alloc" || innerKw === "new") {
                const innerRecv = receiver.namedChild(0)
                if (innerRecv && (innerRecv.type === "identifier" || innerRecv.type === "type_identifier")) receiverLeaf = innerRecv.text
              }
            }
          }
          if (receiverLeaf) push("instantiates", receiverLeaf)
        } else {
          push("calls", msgSel)
        }
      }
      // OC-E bare reads inside the send (mirrors the analyzer): receiver +
      // arguments; keywords and the keyword-less zero-arg selector are
      // names. Gated on scope like the analyzer (activeScope !== global).
      if (t === "message_expression" && inBody && scope !== "global") {
        const kids: Array<{ n: any; isKeyword: boolean }> = []
        for (let mi = 0; mi < n.childCount; mi++) {
          const mc = n.child(mi)
          if (!mc || !mc.isNamed || mc.type !== "identifier") continue
          const nxt = mi + 1 < n.childCount ? n.child(mi + 1) : null
          kids.push({ n: mc, isKeyword: !!(nxt && !nxt.isNamed && nxt.type === ":") })
        }
        const recvNode = n.namedChild(0)
        const hasKw = kids.some((k) => k.isKeyword)
        let lastNonRecv = -1
        if (!hasKw) {
          for (let ki = kids.length - 1; ki >= 0; ki--) {
            if (!objcSame(kids[ki].n, recvNode)) { lastNonRecv = ki; break }
          }
        }
        for (let ki = 0; ki < kids.length; ki++) {
          const kk = kids[ki]
          if (kk.isKeyword || ki === lastNonRecv) continue
          const ktext = String(kk.n.text).trim()
          if (!ktext || objcBareSkip.has(ktext)) continue
          const isRecv = objcSame(kk.n, recvNode)
          if (isRecv && (ktext === "self" || ktext === "super")) continue
          if (objcBound(ktext, owner)) push("uses", ktext)
        }
      }
    }
    if (t === "call_expression" && inBody) {
      const fn = n.namedChildren.find((c: any) => c.type === "identifier")
      // OC-G mirror: `@protocol(P)` is a compiler directive, not a call
      // (direct child of at_expression with callee `protocol`).
      const inAt = (() => {
        let p: any = n.parent
        let g = 0
        while (p && g++ < 3) {
          if (p.type === "at_expression") return true
          if (p.type === "message_expression" || p.type === "call_expression") return false
          p = p.parent
        }
        return false
      })()
      if (fn && !(inAt && fn.text === "protocol")) push("calls", fn.text)
    }
    if (t === "preproc_include") {
      // module name: system_lib_string stripped of <>, or string_literal
      // content (mirrors handleImport's modName extraction)
      let modName: string | null = null
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === "system_lib_string") {
          const txt = c.text
          if (txt.length >= 2) modName = txt.slice(1, txt.length - 1)
        } else if (c.type === "string_literal") {
          const content = c.namedChildren.find((x: any) => x.type === "string_content")
          modName = content ? content.text : c.text
        }
        if (modName) break
      }
      if (modName) push("references", modName)
    }
    // OC-E binding sites (mirror the analyzer's bindable-gated binds).
    if (bindable) {
      if (t === "declaration") {
        for (let di = 0; di < n.namedChildCount; di++) {
          const dc = n.namedChild(di)
          if (!dc) continue
          if (dc.type === "init_declarator" || dc.type === "pointer_declarator" || dc.type === "array_declarator" ||
              dc.type === "parenthesized_declarator" || dc.type === "attributed_declarator") {
            const dname = objcDeclaratorName(dc)
            if (dname) objcBind(dname)
          } else if (dc.type === "identifier") {
            objcBind(dc.text)
          }
        }
      } else if (t === "method_parameter" || t === "parameter_declaration") {
        const pname = objcDeclaratorName(n)
        if (pname) objcBind(pname)
      } else if (t === "for_statement") {
        for (let fi = 0; fi < n.childCount; fi++) {
          const fc = n.child(fi)
          if (fc && !fc.isNamed && fc.type === "in" && fi > 0) {
            for (let fj = fi - 1; fj >= 0; fj--) {
              const pc = n.child(fj)
              if (pc && pc.isNamed) {
                if (pc.type === "identifier") objcBind(pc.text)
                break
              }
            }
            break
          }
        }
      }
    }
    if (t === "declaration" && scope === "global") {
      // File-scope names are resolvable read targets (mirrors the
      // analyzer's globals set).
      for (let di = 0; di < n.namedChildCount; di++) {
        const dc = n.namedChild(di)
        if (!dc) continue
        if (dc.type === "init_declarator" || dc.type === "pointer_declarator" || dc.type === "array_declarator" ||
            dc.type === "parenthesized_declarator" || dc.type === "attributed_declarator") {
          const dname = objcDeclaratorName(dc)
          if (dname) objcGlobals.add(dname)
        } else if (dc.type === "identifier") {
          objcGlobals.add(dc.text)
        }
      }
    }
    // OC-E bare-identifier reads (mirrors the analyzer's 8c rule exactly:
    // same parent-type skips, span-compared positions, same inventory).
    if (t === "identifier" && bindable && scope !== "global") {
      const text = String(n.text).trim()
      if (text && !objcBareSkip.has(text)) {
        const parent = n.parent
        const ptype = parent ? parent.type : ""
        let isName = false
        if (ptype === "method_declaration" || ptype === "method_definition" ||
            ptype === "method_parameter" || ptype === "parameter_declaration" ||
            ptype === "property_implementation" || ptype === "selector_expression" ||
            ptype === "function_declarator" || ptype === "message_expression" ||
            ptype === "declaration") {
          isName = true
        } else if (ptype === "call_expression" && parent && objcSame(parent.namedChild(0), n)) {
          isName = true
        } else if (ptype === "assignment_expression" && parent && objcSpanIn(parent.namedChild(0), n)) {
          isName = true
        } else if (ptype === "for_statement" && parent && objcIsForInVar(parent, n)) {
          isName = true
        } else if (objcIsDeclaratorName(n) || objcIsParameterDeclaredName(n)) {
          isName = true
        }
        if (!isName && objcBound(text, owner)) push("uses", text)
      }
    }
    const nextBody = inBody || t === "method_definition" || t === "method_declaration" || t === "function_definition"
    // OC-E: block exit markers pop the block frame after its children.
    if (t === "block_literal" && childBindable) {
      stack.push({ n: null, inBody: nextBody, parentType: t, scope: childScope, owner: childOwner, bindable: childBindable, exitBlock: true })
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, inBody: nextBody, parentType: t, scope: childScope, owner: childOwner, bindable: childBindable })
    }
  }
  return edges
}

/**
 * R9 (#835): php's declared-type reference graph, as TRUTH.
 *
 * Derived from the analyzer's own `phpDeclaredTypeRefs` — deliberately not a second
 * implementation (CSD14's rule, and the csharp round's measured lesson: a truth that
 * re-implements the rule surfaces every new edge as analyzer-only).
 *
 * `parent` needs the enclosing class's declared base, and the analyzer PUBLISHES that on
 * its class symbols (`metadata.baseClass`), so the map is built from the analyzer's own
 * payload rather than from a second reading of the base clause.
 */
export function derivePhpDeclaredTypeEdges(
  root: any,
  symbols: any[],
): { label: string; from: string; target: string }[] {
  const baseByClass = new Map<string, string>()
  for (const s of symbols ?? []) {
    const base = s?.metadata?.baseClass
    if (s?.name && base) baseByClass.set(String(s.name), String(base))
  }
  return phpDeclaredTypeRefs(root, (owner) => baseByClass.get(owner)).map((ref) => ({
    label: "references",
    from: ref.source,
    target: ref.target,
  }))
}

export function derivePhpEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const classBase = new Map<string, string>()  // class -> declared base (for new parent)
  // Import the analyzer's EXACT builtin set (never a hand-duplicated copy —
  // a drift here would fabricate or hide call edges).
  const key = (label: string, target: string) => label + ":" + target
  const push = (label: string, target: string) => {
    const k = key(label, target)
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }

  // PHP2 mirror helpers: bare-name extraction, bind-site test, scope
  // collectors. Mirror the analyzer's variableBareName / isPhpBindSite /
  // collectPhpScopeBinds exactly (same shapes, same order).
  // M60 mirror: the BRACED dynamic member form (`$o->{$x}`) is distinguishable
  // from the static form (`$o->x`) only by the anonymous `{` token the pinned
  // grammar keeps around the name field. Mirrors RealPhpAnalyzer
  // .isBracedMemberName exactly.
  const phpIsBracedMember = (n: any): boolean => {
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c && !c.isNamed && c.type === "{") return true
    }
    return false
  }
  const phpBareName = (n: any): string => {
    const nameChild = n.namedChildren.find((c: any) => c.type === "name")
    if (nameChild) return nameChild.text
    const t = n.text
    return t.startsWith("$") ? t.slice(1) : t
  }
  const phpIsBindSite = (n: any): boolean => {
    const parent = n.parent
    if (!parent) return false
    const pt = parent.type
    if (pt === "static_variable_declaration" || pt === "global_declaration") return true
    if (pt === "catch_clause") return true
    if (pt === "assignment_expression") {
      const lhs = parent.namedChild(0)
      return !!lhs && lhs.startIndex <= n.startIndex && lhs.endIndex >= n.endIndex
    }
    if (pt === "list_literal") {
      let a: any = parent.parent
      let g = 0
      while (a && g++ < 4) {
        if (a.type === "assignment_expression") {
          const lhs = a.namedChild(0)
          return !!lhs && lhs.startIndex <= parent.startIndex && lhs.endIndex >= parent.endIndex
        }
        if (a.type === "expression_statement" || a.type === "compound_statement" ||
            a.type === "program") return false
        a = a.parent
      }
      return false
    }
    if (pt === "pair") {
      let a: any = parent.parent
      let g = 0
      while (a && g++ < 4) {
        if (a.type === "foreach_statement") return true
        if (a.type === "compound_statement" || a.type === "program" ||
            a.type === "expression_statement") return false
        a = a.parent
      }
      return false
    }
    // Bare foreach value (`as $item` — variable directly under the
    // foreach; the collection is always the first named child and reads).
    // Mirrors RealPhpAnalyzer.isPhpBindSite exactly.
    if (pt === "foreach_statement") {
      const first = parent.namedChild(0)
      return !!first && (first.startIndex !== n.startIndex || first.endIndex !== n.endIndex)
    }
    return false
  }
  const phpCollectBinds = (node: any, out: Set<string>): void => {
    if (!node) return
    const t = node.type
    if (t === "simple_parameter" || t === "variadic_parameter" ||
        t === "property_promotion_parameter") {
      const v = node.namedChildren.find((c: any) => c.type === "variable_name")
      if (v) {
        const nm = phpBareName(v)
        if (nm && nm !== "this") out.add(nm)
      }
      return
    }
    if (t === "anonymous_function_use_clause") {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "variable_name") {
          const nm = phpBareName(c)
          if (nm && nm !== "this") out.add(nm)
        }
      }
      return
    }
    const stack: any[] = [node]
    while (stack.length > 0) {
      const m = stack.pop()!
      const mt = m.type
      if (m !== node && (mt === "anonymous_function" || mt === "arrow_function" ||
          mt === "function_definition" || mt === "method_declaration")) {
        continue
      }
      if (mt === "variable_name" && phpIsBindSite(m)) {
        const nm = phpBareName(m)
        if (nm && nm !== "this") out.add(nm)
      }
      if (mt === "simple_parameter" || mt === "variadic_parameter" ||
          mt === "property_promotion_parameter") {
        const v = m.namedChildren.find((c: any) => c.type === "variable_name")
        if (v) {
          const nm = phpBareName(v)
          if (nm && nm !== "this") out.add(nm)
        }
      }
      if (mt === "catch_clause") {
        for (let i = 0; i < m.namedChildCount; i++) {
          const c = m.namedChild(i)
          if (c && c.type === "variable_name") {
            const nm = phpBareName(c)
            if (nm && nm !== "this") out.add(nm)
          }
        }
      }
      if (mt === "anonymous_function_use_clause") {
        for (let i = 0; i < m.namedChildCount; i++) {
          const c = m.namedChild(i)
          if (c && c.type === "variable_name") {
            const nm = phpBareName(c)
            if (nm && nm !== "this") out.add(nm)
          }
        }
      }
      for (let i = m.namedChildCount - 1; i >= 0; i--) {
        const c = m.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }
  // PHP2 mirror: bounded interpolation climb (encapsed/dynamic strings).
  const phpInInterp = (n: any): boolean => {
    let p: any = n.parent
    let g = 0
    while (p && g++ < 8) {
      if (p.type === "encapsed_string" || p.type === "dynamic_variable_name") return true
      if (p.type === "compound_statement" ||
          p.type === "class_declaration" || p.type === "program" ||
          p.type === "function_definition" || p.type === "method_declaration") return false
      p = p.parent
    }
    return false
  }
  const phpFileBinds = new Set<string>()
  const phpFuncValues = new Set<string>()
  const phpConstValues = new Set<string>()
  const phpSuperGlobals = new Set(["_GET", "_POST", "_SERVER", "_COOKIE", "_SESSION", "_FILES", "_ENV", "_REQUEST", "GLOBALS", "argv", "argc"])
  const phpMagicConsts = new Set(["__DIR__", "__FILE__", "__LINE__", "__FUNCTION__", "__CLASS__", "__METHOD__", "__NAMESPACE__", "__TRAIT__"])
  {
    const isScopeRoot = (t: string): boolean =>
      t === "function_definition" || t === "method_declaration" ||
      t === "anonymous_function" || t === "arrow_function" ||
      t === "class_declaration" || t === "interface_declaration" ||
      t === "trait_declaration" || t === "enum_declaration"
    const st: Array<{ n: any; fileLevel: boolean }> = [{ n: root, fileLevel: true }]
    while (st.length > 0) {
      const { n, fileLevel } = st.pop()!
      const t = n.type
      if (t === "function_definition") {
        const nm = n.childForFieldName?.("name")
        if (nm) phpFuncValues.add(nm.text)
      }
      if (t === "function_call_expression") {
        const fn = n.childForFieldName?.("function")
        if (fn && fn.text === "define") {
          const args = n.namedChildren.find((c: any) => c.type === "arguments")
          if (args) {
            const first = args.namedChild(0)
            if (first) {
              const txt = first.text
              if ((txt.startsWith("'") || txt.startsWith('"')) && txt.length >= 2) phpConstValues.add(txt.slice(1, -1))
            }
          }
        }
      }
      if (t === "namespace_use_clause") {
        let isFn = false
        let isConst = false
        let leaf: string | null = null
        const leafOf = (x: string): string => {
          const parts = x.split("\\").filter(Boolean)
          return parts.length > 0 ? parts[parts.length - 1] : x
        }
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (!c) continue
          if (!c.isNamed && c.text === "function") isFn = true
          else if (!c.isNamed && c.text === "const") isConst = true
          if (c.isNamed && (c.type === "name" || c.type === "qualified_name")) leaf = leafOf(c.text)
        }
        if (leaf && isFn) phpFuncValues.add(leaf)
        else if (leaf && isConst) phpConstValues.add(leaf)
      }
      if (t === "const_declaration" && fileLevel) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "const_element") {
            const nm = c.namedChildren.find((x: any) => x.type === "name")
            if (nm) phpConstValues.add(nm.text)
          }
        }
      }
      if (fileLevel && !isScopeRoot(t)) {
        if (n.type === "variable_name" && phpIsBindSite(n)) {
          const nm = phpBareName(n)
          if (nm && nm !== "this") phpFileBinds.add(nm)
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) st.push({ n: c, fileLevel: fileLevel && !isScopeRoot(t) })
      }
    }
  }
// PHP tree-truth oracle (php managed-OO wave #268). Mirrors
// RealPhpAnalyzer's emission contract exactly:
//   - extends: class base_clause (FIRST child = superclass) + interface
//     base_clause (ALL children — interfaces inherit multiple parents)
//   - implements: class_interface_clause children
//   - calls: function_call_expression (PHP_BUILTINS filtered), member_call /
//     nullsafe_member_call / scoped_call name fields
//   - uses: trait use_declaration names (isTraitUse) AND member_access_expression
//     READS (the field name; assignment-LHS writes and call receivers excluded)
//   - instantiates: object_creation_expression first name/qualified_name
//   - references: require/include expression include paths (mirrors
//     emitInclude — namespace `use` declarations go to imports, NOT
//     references, exactly like the analyzer)
// The oracle emits UNIQUE (label,target) edges (seen-set per label+target),
// matching the site-agnostic coverage match in main().
  const leafName = (t: string): string => {
    const parts = t.split(/\\|\./).filter(Boolean)
    return parts[parts.length - 1] ?? t
  }
  // PHPD10 mirror (M37.13): a qualified base/interface whose leaf equals the
  // declaring class's own name must keep its qualification (leading \\
  // stripped) — leaf-collapse would fabricate self extends/implements truth
  // for same-leaf cross-namespace inheritance (Setup\\FeaturesForm extends
  // User\\FeaturesForm). Bare names and non-colliding leaves are unchanged.
  const heritageTarget = (raw: string, ownName: string): string => {
    const leaf = leafName(raw)
    if (raw.includes("\\") && leaf === ownName) {
      return raw.replace(/^\\+/, "")
    }
    return leaf
  }
  // PHPD10 mirror: returns undefined when qualification cannot disambiguate
  // a same-leaf base/interface (global single-segment: `class Foo extends
  // \\Foo`) — the analyzer emits NO edge there (self-loop would be
  // fabrication); the oracle must not fabricate truth for it either.
  const heritageOrSkip = (raw: string, ownName: string): string | undefined => {
    const t = heritageTarget(raw, ownName)
    if (t === ownName && raw !== t) return undefined
    return t
  }
  // PHP-E mirror: sole-`...` arguments never invoke (first-class callable).
  const phpIsTearOff = (n: any): boolean => {
    const args = n.namedChildren.find((c: any) => c.type === "arguments")
    if (!args) return false
    let saw = false
    for (let i = 0; i < args.namedChildCount; i++) {
      const c = args.namedChild(i)
      if (!c) continue
      if (c.type === "variadic_placeholder") {
        if (saw) return false
        saw = true
        continue
      }
      return false
    }
    return saw
  }
  // R10 (#835): the include-path rule and the callee-name rule are NO LONGER
  // mirrored here — both sides call the analyzer's own functions
  // (`phpStaticIncludePath`, `phpStaticCallableName`), so a hand-written copy
  // cannot drift from the rule it claims to state. The old locals
  // (`cleanString`/`collapseWhitespace`) were deleted with the copies: dead code
  // standing next to a comment about agreement is how a mirror grows back.
  // PHP-O2 (first review): verified in-file overrides. The analyzer emits
  // overrides[B.foo->A.foo] @0.95 when the in-file base declares the same
  // method; the oracle derived nothing, so every verified pair was an
  // unexplained edge waiting for a sample to hit it. Prescan classes
  // (name -> heritage-resolved base + declared methods); external-base
  // guesses stay oracle-silent by design (0.5, below the lane filter).
  {
    const methodsByClass = new Map<string, Set<string>>()
    const baseByClass = new Map<string, string>()
    const pre: any[] = [root]
    while (pre.length > 0) {
      const pn = pre.pop()!
      if (!pn) continue
      if (pn.type === "class_declaration" || pn.type === "interface_declaration" ||
          pn.type === "trait_declaration" || pn.type === "enum_declaration") {
        const nm = pn.namedChildren.find((c: any) => c.type === "name")?.text
        if (nm) {
          if (!methodsByClass.has(nm)) methodsByClass.set(nm, new Set<string>())
          const bc = pn.namedChildren.find((c: any) => c.type === "base_clause")
          if (bc && pn.type === "class_declaration") {
            const first = bc.namedChild(0)
            if (first) {
              const t = heritageOrSkip(first.text, nm)
              if (t) baseByClass.set(nm, t)
            }
          }
        }
      }
      if (pn.type === "method_declaration") {
        const mn = pn.childForFieldName?.("name")?.text ??
          pn.namedChildren.find((c: any) => c.type === "name")?.text
        if (mn) {
          let own: any = pn.parent
          let og = 0
          while (own && og++ < 12) {
            if (own.type === "class_declaration" || own.type === "interface_declaration" ||
                own.type === "trait_declaration" || own.type === "enum_declaration") break
            own = own.parent
          }
          const onm = own ? own.namedChildren.find((c: any) => c.type === "name")?.text : null
          if (onm) {
            if (!methodsByClass.has(onm)) methodsByClass.set(onm, new Set<string>())
            methodsByClass.get(onm)!.add(mn)
          }
        }
      }
      for (let k = pn.namedChildCount - 1; k >= 0; k--) {
        const c = pn.namedChild(k)
        if (c) pre.push(c)
      }
    }
    for (const [cls, base] of baseByClass) {
      const baseSet = methodsByClass.get(base)
      const clsSet = methodsByClass.get(cls)
      if (!baseSet || !clsSet) continue
      for (const m of clsSet) {
        if (baseSet.has(m)) push("overrides", `${base}.${m}`)
      }
    }
  }
  // R10 (#835): the analyzer's OWN static-path rule, not a mirror of it. The
  // previous local copy reproduced the defect faithfully (both sides published
  // `$this->baseDir.'revision-info.php'` as a path, so the differential agreed
  // and could see nothing), and a hand-written mirror is how a narrowing on one
  // side becomes phantom "missing in analyzer" edges on the other.
  const extractPhpIncludePath = (node: any): string | undefined => phpStaticIncludePath(node)

  // PHP2 mirror: persistent value-scope frames (file prescan + per-scope
  // binds). Mirrors the analyzer's fileScope/universals/collectors exactly.
  const phpFileScope: Set<string> = phpFileBinds
  const stack: any[] = [{ n: root, parent: null, inBody: false, cls: undefined as string | undefined, base: undefined as string | undefined, scope: { bound: phpFileBinds, parent: null } }]
  const phpScopeHas = (scope: any, name: string): boolean => {
    let cur: any = scope
    while (cur) {
      if (cur.bound && cur.bound.has(name)) return true
      cur = cur.parent
    }
    return false
  }
  const phpFrameFor = (node: any, parentScope: any): any => {
    // Scope boundaries mirror the analyzer: closures fresh (params+use),
    // arrows chain, named functions/methods fresh (params).
    const bound = new Set<string>()
    phpCollectBinds(node, bound)
    if (node.type === "arrow_function") return { bound, parent: parentScope }
    return { bound, parent: null }
  }
  while (stack.length > 0) {
    const { n, parent, inBody, cls, base, scope } = stack.pop()!
    const t = n.type
    if (t === "class_declaration") {
      const nameNode = n.namedChildren.find((c: any) => c.type === "name")
      const className = nameNode?.text ?? "?"
      const baseClause = n.namedChildren.find((c: any) => c.type === "base_clause")
      let declaredBase: string | undefined
      if (baseClause) {
        const first = baseClause.namedChild(0)
        if (first) {
          declaredBase = heritageOrSkip(first.text, className)
          if (declaredBase) push("extends", declaredBase)
        }
      }
      const ifaceClause = n.namedChildren.find((c: any) => c.type === "class_interface_clause")
      if (ifaceClause) {
        for (let i = 0; i < ifaceClause.namedChildCount; i++) {
          const c = ifaceClause.namedChild(i)
          if (c) {
            const ifaceT = heritageOrSkip(c.text, className)
            if (ifaceT) push("implements", ifaceT)
          }
        }
      }
      // Hoisted for the walk-tail (nextCls/nextBase) via the stack object:
      ;(stack as any)._curCls = className
      ;(stack as any)._curBase = declaredBase
    }
    if (t === "enum_declaration") {
      // M37.13 mirror: PHP 8.1 enums implement interfaces via the SAME
      // class_interface_clause shape as classes (analyzer emits the edges).
      const nameNode = n.namedChildren.find((c: any) => c.type === "name")
      const enumCls = nameNode?.text ?? "?"
      if (nameNode) (stack as any)._curCls = enumCls
      const ifaceClause = n.namedChildren.find((c: any) => c.type === "class_interface_clause")
      if (ifaceClause) {
        for (let i = 0; i < ifaceClause.namedChildCount; i++) {
          const c = ifaceClause.namedChild(i)
          if (c) {
            const ifaceT = heritageOrSkip(c.text, enumCls)
            if (ifaceT) push("implements", ifaceT)
          }
        }
      }
    }
    if (t === "interface_declaration") {
      const nameNode = n.namedChildren.find((c: any) => c.type === "name")
      const ifaceName = nameNode?.text ?? "?"
      const baseClause = n.namedChildren.find((c: any) => c.type === "base_clause")
      if (baseClause) {
        for (let i = 0; i < baseClause.namedChildCount; i++) {
          const c = baseClause.namedChild(i)
          if (c) {
            const extT = heritageOrSkip(c.text, ifaceName)
            if (extT) push("extends", extT)
          }
        }
      }
    }
    // PHP-O1 (first review): trait uses live at CLASS-body level, never
    // inside a function body — the old inBody gate silenced every one of
    // them on the oracle side while the analyzer always emits them.
    if (t === "use_declaration") {
      // Trait use inside a class body
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && (c.type === "name" || c.type === "qualified_name")) push("uses", leafName(c.text))
      }
    }
    if (t === "require_once_expression" || t === "include_once_expression" ||
        t === "require_expression" || t === "include_expression") {
      // Mirror the analyzer's emitInclude: references -> the include path
      // (cleanString/collapseWhitespace equivalents).
      const p = extractPhpIncludePath(n)
      if (p) push("references", p)
    }
    if (t === "function_call_expression") {
      // R10 (#835): the analyzer's OWN callee rule, not a mirror. A variable
      // callee (`$callable()`) has no callee NAME; both sides previously derived
      // `calls -> $callable` from the same raw text, so the differential agreed
      // and could not see it.
      const target = phpStaticCallableName(n.childForFieldName?.("function"))
      if (target) {
        // M37.13 mirror: the analyzer's processFunctionCall returns EARLY for
        // the WordPress hook registrars (framework detection only, no calls
        // edge). Without this mirror the oracle fabricated calls:add_action/
        // add_filter truth on every procedural WP-style file.
        const isWpHook = target === "add_action" || target === "add_filter"
        // PHP-E mirror: sole-`...` is a tear-off reference, never a call.
        if (phpIsTearOff(n)) {
          if (!isWpHook && !PHP_BUILTINS.has(target)) push("uses", target)
        } else if (!isWpHook && !PHP_BUILTINS.has(target)) push("calls", target)
      }
    }
    if (t === "member_call_expression" || t === "nullsafe_member_call_expression") {
      const nameNode = n.childForFieldName?.("name")
      if (nameNode) {
        if (phpIsTearOff(n)) push("uses", nameNode.text)
        else push("calls", nameNode.text)
      }
    }
    if (t === "scoped_call_expression") {
      const nameNode = n.childForFieldName?.("name")
      if (nameNode) {
        if (phpIsTearOff(n)) push("uses", nameNode.text)
        else push("calls", nameNode.text)
      }
    }
    if (t === "object_creation_expression") {
      // Mirror the analyzer: named/qualified target -> leaf; self/static ->
      // enclosing class; parent -> declared base class (probe-verified:
      // pinned grammar parses new self/parent/static as name, not
      // relative_scope). Unresolvable parent emits NOTHING.
      const named = n.namedChildren.find((c: any) => c.type === "name" || c.type === "qualified_name")
      if (named) {
        if (named.text === "self" || named.text === "static" || named.text === "parent") {
          const resolved = named.text === "parent" ? base : cls
          if (resolved) push("instantiates", resolved)
        } else {
          push("instantiates", leafName(named.text))
        }
      } else {
        const rel = n.namedChildren.find((c: any) => c.type === "relative_scope")
        if (rel) {
          const resolved = rel.text === "parent" ? base : cls
          if (resolved) push("instantiates", resolved)
        }
      }
    }
    if ((t === "member_access_expression" || t === "nullsafe_member_access_expression") && inBody) {
      // Member READS only: assignment/augmented-assignment LHS is a write.
      // PHP-A mirror: call receivers ARE reads (the old isCallReceiver gate
      // is dropped on both sides — `$this->dep` in `$this->dep->run()`).
      //
      // M60: the read is the STATIC member NAME only. Pushing the raw name
      // field's text published non-symbols as targets — `uses -> $param` for
      // `$postParams->$param` (phpmyadmin ServerRequest.php:233; the analyzer
      // emitted nothing, so the lane read MISSING there), and `uses -> 'lit'` /
      // `uses -> 2` for `$o->{'lit'}` / `$o->{2}` on BOTH sides, which no mirror
      // can see by construction. A braced field is a dynamic selection: the
      // braces are anonymous tokens in the pinned grammar (`$o->NAME` is
      // `variable_name, ~->, name`; `$o->{NAME}` is `variable_name, ~->, ~{,
      // name, ~}`), so `{` is the discriminator, and the field's own expression
      // reads are emitted by the ordinary rules for those nodes.
      const lhs = parent ? parent.namedChild(0) : null
      const isWrite = parent && (parent.type === "assignment_expression" || parent.type === "augmented_assignment_expression") && lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
      if (!isWrite) {
        const nameNode = n.childForFieldName?.("name")
        if (nameNode && nameNode.type === "name" && !phpIsBracedMember(n)) push("uses", nameNode.text)
      }
    }
    // PHP-H mirror: static property reads (`C::$total`, `self::$x`) with
    // the same write gate; the scope is never a read.
    if (t === "scoped_property_access_expression" && inBody) {
      const lhs = parent ? parent.namedChild(0) : null
      const isWrite = parent && (parent.type === "assignment_expression" || parent.type === "augmented_assignment_expression") && lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
      if (!isWrite) {
        const varNode = n.namedChildren.find((c: any) => c.type === "variable_name")
        if (varNode) {
          // Mirror variableBareName: `name` child, else strip `$`.
          const nmNode = varNode.namedChildren.find((c: any) => c.type === "name")
          const raw = nmNode ? nmNode.text : varNode.text
          const nm = raw.startsWith("$") ? raw.slice(1) : raw
          if (nm) push("uses", nm)
        }
      }
    }
    // PHP-D mirror: constant fetches (`Suit::Hearts`, `parent::VERSION`);
    // `::class` is a keyword, never a member. No name field exists —
    // positional [scope, name], so the constant is the LAST name child.
    if (t === "class_constant_access_expression" && inBody) {
      let member: string | undefined
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c && c.type === "name") { member = c.text; break }
      }
      if (member && member.toLowerCase() !== "class") push("uses", member)
    }
    // PHP-B mirror: subscript bases (first named child only; the index is
    // a bare value). Write-position bases read the address.
    if (t === "variable_name" && parent && parent.type === "subscript_expression" && inBody) {
      const first = parent.namedChild(0)
      if (first && first.startIndex === n.startIndex && first.endIndex === n.endIndex) {
        const raw = n.namedChildren.find((c: any) => c.type === "name")?.text ?? n.text
        const base = raw.startsWith("$") ? raw.slice(1) : raw
        if (base && base !== "this") push("uses", base)
      }
    }
    // PHP-C mirror: closure captures.
    if (t === "variable_name" && parent && parent.type === "anonymous_function_use_clause" && inBody) {
      const raw = n.namedChildren.find((c: any) => c.type === "name")?.text ?? n.text
      const base = raw.startsWith("$") ? raw.slice(1) : raw
      if (base && base !== "this") push("uses", base)
    }
    // PHP-F mirrors: interpolation reads.
    if (t === "variable_name" && inBody) {
      let p: any = n.parent
      let g = 0
      let inside = false
      while (p && g++ < 8) {
        if (p.type === "encapsed_string" || p.type === "dynamic_variable_name") { inside = true; break }
        if (p.type === "function_body" || p.type === "compound_statement" ||
            p.type === "class_declaration" || p.type === "program" ||
            p.type === "function_definition" || p.type === "method_declaration") break
        p = p.parent
      }
      if (inside) {
        const raw = n.namedChildren.find((c: any) => c.type === "name")?.text ?? n.text
        const base = raw.startsWith("$") ? raw.slice(1) : raw
        if (base && base !== "this") push("uses", base)
      }
    }
    if (t === "name" && parent && parent.type === "dynamic_variable_name" && inBody) {
      const base = n.text
      if (base && base !== "this") push("uses", base)
    }
    // PHP2 mirror: bare `$var` reads (frame chain, then file functions,
    // then superglobals) and bare `NAME` const reads (file consts only).
    // Mirrors emitPhpVariableRead/emitPhpConstRead exactly.
    if (t === "variable_name") {
      const raw = n.namedChildren.find((c: any) => c.type === "name")?.text ?? n.text
      const base = raw.startsWith("$") ? raw.slice(1) : raw
      if (base && base !== "this") {
        const ptype = parent ? parent.type : ""
        // Subscript BASES belong to the unconditional subscript rule —
        // index expressions read (positional, mirrors the analyzer).
        let isSubBase = false
        if (ptype === "subscript_expression" && parent) {
          const first = parent.namedChild(0)
          isSubBase = !!first && first.startIndex === n.startIndex && first.endIndex === n.endIndex
        }
        if (
          ptype !== "property_declaration" && ptype !== "property_element" &&
          ptype !== "simple_parameter" && ptype !== "variadic_parameter" &&
          ptype !== "property_promotion_parameter" &&
          ptype !== "anonymous_function_use_clause" &&
          !isSubBase &&
          !phpIsBindSite(n) && !phpInInterp(n)
        ) {
          if (phpScopeHas(scope, base)) {
            push("uses", base)
          } else if (phpFuncValues.has(base)) {
            push("uses", base)
          } else if (phpSuperGlobals.has(base)) {
            push("uses", base)
          }
        }
      }
    }
    if (t === "name") {
      const txt = n.text
      if (txt && !phpMagicConsts.has(txt)) {
        const ptype = parent ? parent.type : ""
        const calleePos = parent && (parent.type === "function_call_expression" || parent.type === "scoped_call_expression" ||
          parent.type === "member_call_expression" || parent.type === "nullsafe_member_call_expression") &&
          parent.namedChild(0) && parent.namedChild(0).startIndex === n.startIndex && parent.namedChild(0).endIndex === n.endIndex
        let isLabel = false
        if (ptype === "argument" && parent) {
          for (let i = 0; i < parent.childCount; i++) {
            const c = parent.child(i)
            if (c && c.isNamed && c.startIndex === n.startIndex && c.endIndex === n.endIndex) {
              const nx = parent.child(i + 1)
              if (nx && !nx.isNamed && nx.type === ":") isLabel = true
              break
            }
          }
        }
        let inNs = false
        {
          let a: any = parent
          let g = 0
          while (a && g++ < 4) {
            if (a.type === "namespace_use_clause" || a.type === "namespace_definition") { inNs = true; break }
            if (a.type === "compound_statement" || a.type === "class_declaration" || a.type === "program" ||
                a.type === "expression_statement") break
            a = a.parent
          }
        }
        let isDecl = false
        if (ptype === "const_element" && parent) {
          const first = parent.namedChild(0)
          isDecl = !!first && first.startIndex === n.startIndex && first.endIndex === n.endIndex
        }
        // M60: the member-access exclusion covers the STATIC member-NAME
        // position. In a BRACED field the name is a value expression
        // (`$o->{$CONST}` selects the property BY that constant), so it reads —
        // the same exception the member rule above takes, with the same test.
        const dynamicMemberField = !!parent &&
          (ptype === "member_access_expression" || ptype === "nullsafe_member_access_expression") &&
          phpIsBracedMember(parent)
        if (
          (dynamicMemberField || (ptype !== "member_access_expression" && ptype !== "nullsafe_member_access_expression")) &&
          ptype !== "class_constant_access_expression" &&
          !calleePos && !isDecl && !isLabel && !inNs &&
          phpConstValues.has(txt)
        ) {
          push("uses", txt)
        }
      }
    }
    const nextBody = inBody || t === "method_declaration" || t === "function_definition"
    const nextCls = t === "class_declaration" ? (stack as any)._curCls : cls
    const nextBase = t === "class_declaration" ? (stack as any)._curBase : base
    let childScope = scope
    if (t === "anonymous_function" || t === "arrow_function" ||
        t === "function_definition" || t === "method_declaration") {
      childScope = phpFrameFor(n, scope)
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, parent: n, inBody: nextBody, cls: nextCls, base: nextBase, scope: childScope })
    }
  }
  return edges
}

// Ruby truth: derive the same structural edges the analyzer emits, from
// clause node structure only. Mirrors RealRubyAnalyzer (probe-verified):
export function deriveRubyEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const key = (label: string, target: string) => label + ":" + target
  const push = (label: string, target: string) => {
    const k = key(label, target)
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }
  const leafName = (t: string): string => {
    const parts = t.replace(/^<\s*/, "").split(/::|\./).filter(Boolean)
    return parts[parts.length - 1] ?? t
  }
  const isRubyBuiltin = (name: string): boolean => {
    // Mirror RealRubyAnalyzer.pushBareCall filters: builtins, Rails macros,
    // self/nil/true/false, capitalized constants (a bare uppercase identifier
    // is a CONSTANT, never a call), __dunder__.
    if (RUBY_BUILTINS.has(name)) return true
    if (RAILS_MACRO_METHODS.has(name)) return true
    if (name === "self" || name === "nil" || name === "true" || name === "false") return true
    const firstChar = name.charCodeAt(0)
    if (firstChar >= 65 && firstChar <= 90) return true
    if (name.startsWith("__") && name.endsWith("__")) return true
    return false
  }
  // Call-node filter mirrors RealRubyAnalyzer.processCall, which skips ONLY
  // RUBY_BUILTINS + RAILS_MACRO_METHODS — NOT the uppercase rule: `Pathname
  // (FOOFILE)` is a real Kernel method call (rake test_rake_rules.rb L86),
  // and the analyzer emits calls:Pathname. Filtering uppercase names here
  // wrongly dropped every capitalized Kernel call from the oracle.
  const isRubyCallBuiltin = (name: string): boolean => {
    if (RUBY_BUILTINS.has(name)) return true
    if (RAILS_MACRO_METHODS.has(name)) return true
    if (name === "self" || name === "nil" || name === "true" || name === "false") return true
    if (name.startsWith("__") && name.endsWith("__")) return true
    return false
  }
  const isVisibilityDirective = (name: string | undefined): boolean =>
    name === "private" || name === "protected" || name === "public"

  // Implicit overrides (RUBYD2): methods redeclared in a subclass that also
  // exist in its superclass, from local class declarations in this file.
  const classBases = new Map<string, string>()
  const classMethods = new Map<string, Set<string>>()
  const collectDecls = (start: any) => {
    const stack: any[] = [start]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "class") {
        const nameNode = n.childForFieldName?.("name")
        const sup = n.childForFieldName?.("superclass")
        if (nameNode?.text) {
          // Same static-superclass gate as the extends truth above and as the
          // analyzer's overrides pass: `class X < Struct.new(:a)` has no base
          // CLASS, so its method set cannot be an override set. Without the
          // gate this map held the raw expression text as a class name — the
          // analyzer emitted 3 phantom first-parent guesses for it on the
          // 200-file rack draw, and this derivation silently agreed by finding
          // no such class. One gate, both passes, so neither can drift.
          if (sup) {
            const cleanedSup = sup.text.replace(/^<\s*/, "").trim()
            if (isRubyStaticSuperclassName(cleanedSup)) classBases.set(nameNode.text, leafName(cleanedSup))
          }
          const body = n.namedChildren.find((c: any) => c.type === "body_statement")
          if (body) {
            const names = classMethods.get(nameNode.text) ?? new Set<string>()
            const mstack: any[] = [body]
            while (mstack.length > 0) {
              const m = mstack.pop()!
              if (m.type === "method" || m.type === "singleton_method") {
                const mn = m.childForFieldName?.("name")
                if (mn?.text) names.add(mn.text)
              }
              for (let i = 0; i < m.namedChildCount; i++) mstack.push(m.namedChild(i))
            }
            classMethods.set(nameNode.text, names)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
    }
  }
  collectDecls(root)

  // Same-file method names (all classes + top-level): a bare identifier that
  // names a method defined in this file is a CALL of that method, not noise.
  // The analyzer emits these (bare-identifier branch); the oracle must too.
  const fileMethods = new Set<string>()
  for (const names of classMethods.values()) for (const m of names) fileMethods.add(m)

  // Local-variable resolution (mirrors RealRubyAnalyzer.walkBody localNames):
  // a bare identifier is a LOCAL READ, not a method call, if it names a
  // parameter, a block parameter, or an assignment target ANYWHERE IN THE
  // ENCLOSING METHOD BODY. Ruby resolves this at parse-of-scope time. The
  // analyzer pre-scans EACH method body for assignment targets + block/lambda
  // params and threads the method's own params in (walkBody scoping). The
  // oracle must scope the same way: a whole-file pass wrongly treats `runlist`
  // (assigned in test_invoke) as a local inside test_investigation_output,
  // where Ruby actually resolves it as a METHOD CALL — verified on rake
  // test_rake_task.rb (the analyzer's `calls:runlist` there is correct).
  const methodLocals = new Map<string, Set<string>>()
  const collectLocals = (start: any, into: Set<string>) => {
    const st: any[] = [start]
    while (st.length > 0) {
      const n = st.pop()!
      if (n.type === "assignment" || n.type === "operator_assignment") {
        const left = n.childForFieldName?.("left") ?? n.namedChild(0)
        if (left) {
          if (left.type === "identifier") into.add(left.text)
          for (let i = 0; i < left.namedChildCount; i++) {
            const c = left.namedChild(i)
            if (c?.type === "identifier") into.add(c.text)
          }
        }
      }
      // Method/block parameters live in a container node (method_parameters,
      // block_parameters, lambda_parameters) and come in several forms:
      // plain identifier, optional_parameter, splat_parameter,
      // keyword_parameter, block_parameter, destructured_parameter. Recurse
      // into the whole subtree so the bound name inside every form is added.
      if (n.type === "method_parameters" || n.type === "block_parameters" ||
          n.type === "lambda_parameters" || n.type === "parameters") {
        // Only the BOUND NAMES are locals. optional_parameter / keyword_parameter
        // also carry a default VALUE expression whose identifiers are NOT
        // locals — `def f(x = challenge)` must leave `challenge` a method call
        // (RB-B parity fix, rack wave: handler.rb). Block/lambda containers
        // hold names only, so the plain recursion stays correct for them.
        const collectParamName = (qn: any) => {
          for (let i = 0; i < qn.namedChildCount; i++) {
            const c = qn.namedChild(i)
            if (!c) continue
            if (c.type === "identifier") into.add(c.text)
            else if (c.type === "optional_parameter" || c.type === "keyword_parameter") {
              const nm = c.childForFieldName?.("name") ?? c.namedChild(0)
              if (nm?.type === "identifier") into.add(nm.text)
            } else collectParamName(c)
          }
        }
        collectParamName(n)
      }
      // `rescue Exception => ex` binds `ex` as a local (mirrors the analyzer's
      // exception_variable rule — probe-verified 2026-08-31).
      if (n.type === "exception_variable") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c?.type === "identifier") into.add(c.text)
        }
      }
      // Ruby 3 pattern-matching bindings (RUBYG1 — mirrors the analyzer rule
      // with the identical shape set): identifiers in array_pattern /
      // find_pattern / as_pattern, the value position of keyword_pattern,
      // splat_parameter names, and a bare in_clause pattern are BINDINGS =
      // locals, never calls. Without this the oracle (and the analyzer, now
      // fixed) fabricated calls:a/calls:b etc. for every `in [a, b]`.
      if (n.type === "array_pattern" || n.type === "find_pattern" ||
          n.type === "as_pattern") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "identifier") into.add(c.text)
          else if (c.type === "splat_parameter") {
            const nm = c.childForFieldName?.("name") ?? c.namedChild(0)
            if (nm?.type === "identifier") into.add(nm.text)
          }
        }
      } else if (n.type === "keyword_pattern") {
        // `{name:}` binds `name` via the hash_key_symbol (shorthand);
        // `{age: x}` binds x via the value identifier.
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "identifier") into.add(c.text)
          else if (c.type === "hash_key_symbol") into.add(c.text.replace(/^:/, ""))
        }
      } else if (n.type === "in_clause") {
        const first = n.namedChild(0)
        if (first?.type === "identifier") into.add(first.text)
      }
      for (let i = 0; i < n.namedChildCount; i++) st.push(n.namedChild(i))
    }
  }
  // Per-method local sets, keyed by the method node's id (nested defs get
  // their own scope). Code OUTSIDE any method has no local set — bare
  // identifiers there are calls, matching the analyzer's walkBody scoping.
  const methodScan: any[] = [root]
  while (methodScan.length > 0) {
    const n = methodScan.pop()!
    if (n.type === "method" || n.type === "singleton_method" || n.type === "setter") {
      const set = new Set<string>()
      collectLocals(n, set)
      methodLocals.set(String(n.id), set)
    }
    for (let i = 0; i < n.namedChildCount; i++) methodScan.push(n.namedChild(i))
  }

  const stack: any[] = [{ n: root, parent: null, inBody: false, cls: undefined as string | undefined, methodId: undefined as string | undefined }]
  while (stack.length > 0) {
    const { n, parent, inBody, cls: enclosingClass, methodId } = stack.pop()
    const t = n.type
    if (t === "class") {
      // superclass field text is "< Name" — strip the marker, keep the leaf.
      // Static-superclass gate mirrors the analyzer's isStaticSuperclassName
      // (RUBD13 master-review): `class X < Struct.new(:a)` has an ANONYMOUS
      // base (RB-C: no extends). The old rule leaf-split the raw expression
      // text into a DIFFERENT junk target than the analyzer's, a latent
      // missing+unexplained pair whenever the shape was sampled.
      const sup = n.childForFieldName?.("superclass")
      if (sup) {
        const cleaned = sup.text.replace(/^<\s*/, "").trim()
        // Shared single-source-of-truth gate with the analyzer
        // (isRubyStaticSuperclassName) — a duplicated inline regex previously
        // produced a DIFFERENT junk target than the analyzer (master-review
        // 2026-09), a latent missing+unexplained pair on real corpora.
        if (isRubyStaticSuperclassName(cleaned)) {
          push("extends", leafName(cleaned))
        }
      }
    }
    // Keyword `alias new_name old_name` (class/module/top-level): the
    // analyzer treats it as the RB-E alias_method contract (calls:<newname>,
    // aliasedTo metadata). Mirror so the edge is covered, not unexplained
    // (master-review 2026-09). Method-body aliases emit nothing on either
    // side (the identifier skip suppresses both names).
    if (t === "alias" && !inBody) {
      // Keyword alias is a declaration-time construct (class/module/top
      // level). The analyzer's walkBody consumes method bodies and its
      // `alias` skip-parent suppresses method-body aliases (runtime
      // redefinition) — gate on !inBody to stay in exact parity.
      const names: string[] = []
      for (let i = 0; i < n.namedChildCount && names.length < 2; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === "identifier") names.push(c.text)
        else if (c.type === "simple_symbol") names.push(c.text.replace(/^:/, ""))
      }
      if (names.length === 2) push("calls", names[0])
    }
    // Mixins: the analyzer emits include/extend/prepend wherever they appear
    // (class level AND inside method bodies — `base.extend(ClassMethods)`,
    // `exception.extend(Mixin)`). The oracle must not gate on !inBody.
    if (t === "call" || t === "command" || t === "command_call") {
      const methodNode = n.childForFieldName?.("method")
      const methodName = methodNode?.text
      if (methodName === "include" || methodName === "prepend") {
        const args = n.namedChildren.find((c: any) => c.type === "argument_list")
        if (args) {
          for (let i = 0; i < args.namedChildCount; i++) {
            const arg = args.namedChild(i)
            if (arg && (arg.type === "constant" || arg.type === "scope_resolution")) {
              push("implements", leafName(arg.text))
            }
          }
        }
      } else if (methodName === "extend") {
        const args = n.namedChildren.find((c: any) => c.type === "argument_list")
        if (args) {
          for (let i = 0; i < args.namedChildCount; i++) {
            const arg = args.namedChild(i)
            if (arg && (arg.type === "constant" || arg.type === "scope_resolution")) {
              push("extends", leafName(arg.text))
            }
          }
        }
      } else if (methodName === "alias_method") {
        // `alias_method :local_path, :path` makes the alias name a callable
        // member of the class — the analyzer emits calls:local_path with
        // aliasedTo metadata (long-standing contract); mirror it so the edge
        // is covered rather than flagged unexplained (RB-E, rack wave:
        // uploaded_file.rb). Only simple_symbol args, like the analyzer.
        const args = n.namedChildren.find((c: any) => c.type === "argument_list")
        if (args) {
          const names: string[] = []
          for (let i = 0; i < args.namedChildCount && names.length < 2; i++) {
            const arg = args.namedChild(i)
            if (arg && arg.type === "simple_symbol") names.push(arg.text.replace(/^:/, ""))
          }
          if (names.length === 2) push("calls", names[0])
        }
      }
    }
    if (t === "call" || t === "command" || t === "command_call") {
      const methodNode = n.childForFieldName?.("method")
      if (methodNode) {
        const methodName = methodNode.text
        if (methodName === "new") {
          // `X.new(...)` instantiates the receiver class. A receiverless `new`
          // (e.g. `EMPTY = EmptyLinkedList.new` inside the class body, or a
          // bare `new` in a class method) constructs the ENCLOSING class —
          // resolve it from the nearest enclosing class/module, mirroring the
          // analyzer. Track enclosing class names on the walk stack.
          // The analyzer's contract (real-ruby-analyzer processCall): an
          // UPPERCASE receiver -> instantiates:leaf; a lowercase-identifier
          // receiver (`task_class.new`) is a REGULAR call (calls:new, not an
          // instantiation — the receiver is a local, its class is unknowable);
          // no receiver at all -> instantiates the enclosing class. The old
          // scan only matched constant/scope_resolution, so `task_class.new`
          // fell through to enclosingClass and fabricated instantiates
          // (verified: rake task_manager.rb `task_class.new(task_name, self)`
          // -> bogus instantiates:TaskManager).
          // RB-A note (rack wave): the receiver scan below intentionally skips
          // expression receivers (`Class.new { ... }.new`, `self.class.new`) —
          // they read as receiverless, so `self.new` / `self.class.new` inside
          // a class resolve to the ENCLOSING class (instantiates, mirroring the
          // analyzer's owner fallback) and a complex receiver at TOP level has
          // no enclosing class and correctly emits nothing. The analyzer's
          // own rb-A gate suppresses its junk `calls:new` for the same shapes.
          // A VARIABLE receiver (`@params_class.new`, `@@k.new`, `$k.new`) is the
          // same case as a lowercase identifier receiver: the variable names no
          // class, so the call is not a known instantiation. It used to be read
          // as RECEIVERLESS here (the scan below only matched constant / scope_
          // resolution / identifier), which made this oracle and the analyzer
          // agree on `instantiates <enclosing class>` for a class the source
          // never names — a shared blind spot, so the differential could not
          // see it. Measured: rack query_parser.rb:203/207, where
          // `@params_class` is a constructor PARAMETER. Both sides now fall
          // through to the member call.
          const RUNTIME_VARIABLE_RECEIVERS = new Set(["instance_variable", "class_variable", "global_variable"])
          let receiver: string | undefined
          let receiverIsConst = false
          let receiverIsVariable = false
          for (let i = 0; i < n.namedChildCount; i++) {
            const child = n.namedChild(i)
            if (child && child.id === methodNode.id) break
            if (child && (child.type === "constant" || child.type === "scope_resolution")) {
              receiver = child.text
              receiverIsConst = true
            } else if (child && child.type === "identifier") {
              receiver = child.text
            } else if (child && RUNTIME_VARIABLE_RECEIVERS.has(child.type)) {
              receiver = child.text
              receiverIsVariable = true
            }
          }
          if (receiverIsVariable) {
            // variable receiver — analyzer emits calls:new
            push("calls", "new")
          } else if (!receiver) {
            if (enclosingClass) push("instantiates", leafName(enclosingClass))
          } else if (receiverIsConst) {
            push("instantiates", leafName(receiver))
          } else {
            // lowercase receiver (`task_class.new`) — analyzer emits calls:new
            push("calls", "new")
          }
        } else if (!isRubyCallBuiltin(methodName) && !isVisibilityDirective(methodName)) {
          push("calls", methodName)
        }
      }
    }
    if (t === "identifier" && inBody) {
      // Bare identifiers in expression position are calls (RUBYD4) —
      // mirrors the analyzer's bare-identifier branch. Skip assignment
      // LHS, def names, parameters, hash keys, and LOCALS (parameters,
      // block params, assignment targets — resolved just above), so Ruby
      // locals are not misread as method calls.
      const pt = parent?.type
      // `assignment`/`operator_assignment` are deliberately NOT in the skip
      // list: the LHS is already covered by the per-method local set
      // (collectLocals adds assignment targets), while the RHS is a genuine
      // bare call — `loc = find_location` must emit calls:find_location (the
      // analyzer's walkBody recurses into the RHS; verified on rake
      // task_manager.rb L242). Local check is scoped to the ENCLOSING METHOD
      // (mirrors walkBody): an identifier assigned in test_invoke but used in
      // test_investigation_output is a CALL in Ruby, not a local.
      const localsHere = methodId ? methodLocals.get(methodId) : undefined
      // `pair` is deliberately ABSENT (RUBD12, master-review 2026-09): a
      // hash/argument pair's VALUE is a real expression (`{ x: helper }`,
      // `foo(k: helper)`) and colon-form KEYS are hash_key_symbol nodes, so
      // the old `pair` skip only ever suppressed genuine value-position
      // calls — on BOTH sides, a shared blind spot F5 cannot see.
      // `alias` is present: `alias a b` identifiers are method-name
      // declarations, never expression calls (analyzer + oracle parity).
      // Def names never read: prefer the `name` field (receiver-
      // qualified defs like `def @rio.check?` / `def self.build` put the
      // receiver first, so positional-first misses them); fall back to
      // first-named-child for fieldless shapes. Endless bodies
      // (`def label = name`) read normally (mirrors the analyzer's
      // second-review fix exactly).
      const nameField = (pt === "method" || pt === "singleton_method") ?
        (parent as any)?.childForFieldName?.("name") ?? null : null
      const isDefName = !!nameField ?
        (nameField as any).id === (n as any).id :
        ((pt === "method" || pt === "singleton_method") &&
          (parent as any)?.namedChild?.(0)?.id === (n as any).id)
      const skip = ((pt !== "method" && pt !== "singleton_method") && (
        pt === "setter" ||
        pt === "method_parameters" || pt === "parameters" ||
        pt === "block_parameters" || pt === "lambda_parameters" ||
        pt === "alias" || pt === "class" || pt === "module" ||
        pt === "singleton_class" || pt === "call" || pt === "command" || pt === "command_call")) ||
        isDefName
      if (!skip && !(localsHere?.has(n.text) ?? false) && !isRubyBuiltin(n.text) && !isVisibilityDirective(n.text)) {
        // A bare identifier naming a method defined in this file resolves to
        // that method (Ruby parse-of-scope rule) — the analyzer emits it as a
        // bare call, so the oracle must too (`until (fn = have_rakefile)`).
        push("calls", n.text)
      }
    }
    // Call node in a METHOD BODY: also emit the bare method name as a call
    // (mirrors the analyzer's walkBody: `service.authorize(x)` -> calls:authorize
    // regardless of receiver). Without this, the oracle misses the member-call
    // surface the analyzer surfaces on every receiver.
    // `new` is excluded here: `X.new` is handled above as instantiates (the
    // analyzer RETURNS from processCall on `new`, so it never emits calls:new
    // for an uppercase receiver — the old rule fabricated 41 bogus calls:new
    // edges across rake). Lowercase `task_class.new` IS a calls:new, and the
    // new-branch above now emits it.
    if ((t === "call" || t === "command" || t === "command_call") && inBody) {
      const methodNode = n.childForFieldName?.("method")
      if (methodNode && methodNode.text !== "new" && !isRubyCallBuiltin(methodNode.text) && !isVisibilityDirective(methodNode.text)) {
        push("calls", methodNode.text)
      }
    }
    if (t === "instance_variable") {
      // READS only (mirrors RUBD1 + RUBD5 + SCD1): BOTH `assignment` (@x = v)
      // and `operator_assignment` (@x += / -= / ||= v) LHS are WRITES — the
      // family contract (JAD1/KAD1/SCD1/CSD1 sweep, commit 2807164) gates
      // compound-assign LHS too, and the ruby fixture re-authoring removed
      // the refund `@balance += amount` pin accordingly. The old "RMW emits a
      // use" behavior predated that sweep (its rake `@options ||=` witness
      // then matched an analyzer that leaked the same write) — stale, removed.
      const lhs = parent ? parent.childForFieldName?.("left") : null
      const isWrite = parent && (parent.type === "assignment" || parent.type === "operator_assignment") &&
        lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
      if (!isWrite) push("uses", n.text)
    }
    // Track nearest enclosing class/module for receiverless-new resolution.
    let nextCls = enclosingClass
    if (t === "class" || t === "module") {
      const nameNode = n.childForFieldName?.("name")
      if (nameNode?.text) nextCls = nameNode.text
    }
    // Track nearest enclosing method for per-method local resolution.
    let nextMethodId = methodId
    if (t === "method" || t === "singleton_method" || t === "setter") {
      nextMethodId = String(n.id)
      // A nested def's NAME and RECEIVER (`def result.name`) evaluate in
      // the ENCLOSING scope — only params/body belong to the fresh scope.
      // Push name+receiver here with the outer id (so receiver locals
      // resolve: probe `result` bound two lines up misread as
      // calls:result), params+body below with the fresh id, then skip the
      // generic push (it would re-push everything with one id).
      // (The def NAME itself is still skipped at visit time by the
      // name-field isDefName check above.)
      // NOTE: body/params ride the method's own inBody (a def body IS a
      // body even when reached through this branch).
      const defBody = inBody || t === "method" || t === "singleton_method"
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === "body_statement") {
          stack.push({ n: c, parent: n, inBody: defBody, cls: nextCls, methodId: nextMethodId })
          continue
        }
        if (c.type === "method_parameters" || c.type === "parameters" || c.type === "block_parameters") {
          stack.push({ n: c, parent: n, inBody: defBody, cls: nextCls, methodId: nextMethodId })
          continue
        }
        stack.push({ n: c, parent: n, inBody, cls: nextCls, methodId })
      }
      continue
    }
    // `defined?(...)` is unevaluated (mirrors the analyzer): skip the
    // whole subtree so probed names never read as calls/uses.
    if (t === "unary") {
      const op = (n as any).childCount > 0 ? (n as any).child(0) : null
      if (op && !op.isNamed && op.type === "defined?") continue
    }
    // `undef foo` names methods being undefined (mirrors the analyzer).
    if (t === "undef") continue
    const nextBody = inBody || t === "method" || t === "singleton_method"
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, parent: n, inBody: nextBody, cls: nextCls, methodId: nextMethodId })
    }
  }
  // Implicit overrides (RUBYD2): subclass methods redeclaring a superclass
  // method, emitted as `Sub.method -> Base.method` (analyzer contract).
  for (const [cls, base] of classBases) {
    const baseMethods = classMethods.get(base)
    const subMethods = classMethods.get(cls)
    if (!baseMethods || !subMethods) continue
    for (const m of subMethods) {
      // Analyzer contract: overrides edges point at the BASE method
      // (source=Sub.method, target=Base.method). The old rule pushed the
      // SUBclass method as target, so every ruby overrides edge was BOTH
      // missing (oracle Sub.method) and unexplained (analyzer Base.method) —
      // 6 phantom gaps on linked_list.rb alone.
      if (baseMethods.has(m)) push("overrides", `${base}.${m}`)
    }
  }
  return edges
}

/**
 * The embedded field's NAME — the oracle-side mirror of the analyzer's
 * `goEmbeddedFieldName` (src/ast/real-go-analyzer.ts), written out here rather
 * than imported because an oracle that shares the rule cannot see the rule.
 *
 * Why it exists (go-heavy corpus stress read, 2026-09-24): kubernetes' generated
 * client code embeds INSTANTIATED GENERICS — `listers.ResourceIndexer[*crv1.Example]`,
 * `*gentype.ClientWithListAndApply[*crv1.Example, *crv1.ExampleList, *applyconfigurationcrv1.ExampleApplyConfiguration]` —
 * and the oracle used `lastSegment(raw text)`, whose last dot lands INSIDE the
 * type arguments: it published `Example]` and
 * `CustomResourceDefinitionApplyConfiguration]` as the embedded type's name
 * while the analyzer published the LEAF (`ResourceIndexer`,
 * `ClientWithListAndApply`). Both sides were then wrong about each other: on
 * 13,488 kubernetes files the F5 comparison reads 648 MISSING + 557
 * UNEXPLAINED `extends` rows, every one this shape. The two pinned corpora carry
 * ZERO generic embedded fields, so no draw of them could ever show it.
 *
 * `T`, `*T`, `pkg.T`, `Generic[A, B]` and `*pkg.Generic[A, B]` all name the leaf
 * of their BASE type; a leaf that is not an identifier names nothing honest.
 */
function goEmbeddedLeaf(typeNode: any): string | undefined {
  let cur = typeNode
  for (let guard = 0; guard < 8 && cur; guard++) {
    if (cur.type === "pointer_type" || cur.type === "generic_type") {
      cur = cur.namedChildCount > 0 ? cur.namedChild(0) : undefined
      continue
    }
    break
  }
  if (!cur || (cur.type !== "type_identifier" && cur.type !== "qualified_type")) return undefined
  const raw = String(cur.text ?? "")
  const dot = raw.lastIndexOf(".")
  const leaf = dot !== -1 ? raw.slice(dot + 1) : raw
  return isGoIdentifier(leaf) ? leaf : undefined
}

/** A Go identifier, by character scan (the lane's standing no-regex rule). */
function isGoIdentifier(text: string): boolean {
  if (text.length === 0) return false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    const alpha = (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95
    const digit = c >= 48 && c <= 57
    if (i === 0 ? !alpha : !(alpha || digit)) return false
  }
  return true
}

/**
 * The analyzer's canonical Go method-signature TEXT, derived here from the
 * TREE and never imported — an oracle that shares the rule cannot see the rule
 * (the same reason `goEmbeddedLeaf` above is written out).
 *
 * WHY THIS EXISTS (go #914, 2026-09-24). The oracle used to compare interface
 * and implementor method sets by NAME ONLY, which is a strict SUPERSET of Go's
 * satisfaction rule: on two full corpora it published pairs Go refuses.
 * `Value` (whose `Elem() Value`) "implemented" `Type` (whose `Elem() Type`);
 * `graphTransformerMulti` (`Transform(*Graph) error`) "implemented"
 * `GraphVertexTransformer` (`Transform(dag.Vertex) (dag.Vertex, error)`);
 * `Diff` (`RenderHuman(int, RenderHumanOpts) string`) "implemented"
 * `DiffRenderer` (`RenderHuman(Diff, int, RenderHumanOpts) string`);
 * `UnimplementedProviderServer` (fixed-arity, and with a `mustEmbed...`
 * placeholder) "implemented" `ProviderClient` (variadic). Every one of those
 * rows was charged to the analyzer as a MISSING edge it could never close,
 * because there was no real edge to close. Method SIGNATURES, not names, are
 * the truth — this oracle now compares what Go compares.
 *
 * The canonical rules, mirrored one-for-one with the analyzer
 * (`buildGoMethodSignature` + `extractGoParameters` /
 * `extractGoMethodSpecParameters` + `extractGoReturnType` /
 * `extractGoMethodSpecReturnType` + `normalizeGoSignature`):
 *   1. parameters compare by TYPE only — a parameter NAME is not part of a Go
 *      method signature, so `(ctx context.Context)` == `(arg0 context.Context)`;
 *   2. a GROUPED declaration (`a, b int`) names one parameter per NAME;
 *   3. a VARIADIC parameter is `...T`, which is a DIFFERENT type from `[]T`
 *      (go 1.26's `Logf(format string, args ...any)`, and every grpc client
 *      method); an absent type is the analyzer's `interface{}` placeholder;
 *   4. named results reduce to their TYPES (`(result any, err error)` ==
 *      `(any, error)`), a single result stays bare, no result at all is `void`;
 *   5. the text is then normalized (whitespace collapsed, no space before the
 *      dots, `interface{}` -> `any`) and the whole strings are compared.
 */
function normalizeGoSignatureText(sig: string): string {
  // (a) collapse every whitespace run to one space
  let collapsed = ""
  let prevSpace = false
  for (let i = 0; i < sig.length; i++) {
    const ch = sig[i]
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      if (!prevSpace && collapsed.length > 0) collapsed += " "
      prevSpace = true
    } else {
      collapsed += ch
      prevSpace = false
    }
  }
  // (b) drop the space before `...` (so `x ...T` and `x...T` agree)
  let variadic = ""
  for (let i = 0; i < collapsed.length; i++) {
    const ch = collapsed[i]
    if (ch === "." && collapsed[i + 1] === "." && collapsed[i + 2] === ".") {
      if (variadic.length > 0 && variadic[variadic.length - 1] === " ") variadic = variadic.slice(0, -1)
      variadic += "..."
      i += 2
    } else {
      variadic += ch
    }
  }
  // (c) interface{} -> any
  let result = ""
  let k = 0
  while (k < variadic.length) {
    if (variadic[k] === "i" && variadic.slice(k, k + 11) === "interface{}") {
      result += "any"
      k += 11
    } else {
      result += variadic[k]
      k++
    }
  }
  // (d) trim
  let start = 0
  let end = result.length
  while (start < end && result[start] === " ") start++
  while (end > start && result[end - 1] === " ") end--
  return result.slice(start, end)
}

const GO_SIGNATURE_TYPE_NODES = [
  "type_identifier",
  "qualified_type",
  "pointer_type",
  "slice_type",
  "array_type",
  "map_type",
  "channel_type",
  "function_type",
]

/**
 * The parameter_list holding a node's PARAMETERS: for a method_declaration
 * that is the SECOND one (the first is the receiver parameter_list); for a
 * method_spec it is the FIRST (a method_spec children are only ever
 * [field_identifier, parameter_list(parameters), result?]).
 */
function goParameterList(node: any): any {
  const lists: any[] = []
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === "parameter_list") lists.push(c)
  }
  return node.type === "method_declaration" ? lists[1] : lists[0]
}

/** Rule 1/2/3: the parameter TYPES of a Go parameter_list, in order, with the
 *  `...` marker kept on a variadic declaration. */
function goSignatureParameterTypes(paramList: any): string[] {
  const out: string[] = []
  if (!paramList) return out
  for (let i = 0; i < paramList.namedChildCount; i++) {
    const p = paramList.namedChild(i)
    if (!p) continue
    const isVariadic = p.type === "variadic_parameter_declaration"
    if (p.type !== "parameter_declaration" && !isVariadic) continue
    const t = p.childForFieldName?.("type")
    const typeText = t ? String(t.text ?? "") : "interface{}"
    const rendered = isVariadic ? "..." + typeText : typeText
    let names = 0
    for (let j = 0; j < p.namedChildCount; j++) {
      if (p.namedChild(j)?.type === "identifier") names++
    }
    for (let k = 0; k < Math.max(1, names); k++) out.push(rendered)
  }
  return out
}

/** Rule 4: the canonical RESULT text — named results reduce to their types, one
 *  type stays bare, no result at all is `void` (the analyzer's `|| "void"`). */
function goSignatureResult(node: any): string {
  const resultNode = node.childForFieldName?.("result")
  if (resultNode) {
    if (resultNode.type === "parameter_list") {
      const types: string[] = []
      for (let i = 0; i < resultNode.namedChildCount; i++) {
        const p = resultNode.namedChild(i)
        if (!p || p.type !== "parameter_declaration") continue
        const t = p.childForFieldName?.("type")
        if (!t) continue
        let names = 0
        for (let j = 0; j < p.namedChildCount; j++) {
          if (p.namedChild(j)?.type === "identifier") names++
        }
        for (let k = 0; k < Math.max(1, names); k++) types.push(String(t.text ?? ""))
      }
      if (types.length === 1) return types[0]
      if (types.length > 1) return `(${types.join(", ")})`
      return String(resultNode.text ?? "")
    }
    return String(resultNode.text ?? "")
  }
  // The analyzer's last-resort scan: a DIRECT type-shaped child. A bare
  // parameter_list is deliberately NOT in the list — in this grammar the named
  // result list is the `result` FIELD (handled above), so a stray
  // parameter_list here is the RECEIVER (methods) or the PARAMETERS, and
  // reading either as a return type is exactly the go-wave deep-review defect.
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child && GO_SIGNATURE_TYPE_NODES.indexOf(child.type) !== -1) return String(child.text ?? "")
  }
  return "void"
}

/** Rules 1-5 applied: the whole canonical signature the implements check compares. */
function goSignatureText(name: string, node: any): string {
  const params = goSignatureParameterTypes(goParameterList(node))
  return normalizeGoSignatureText(`${name}(${params.join(", ")}) ${goSignatureResult(node)}`)
}

// Go implicit interface-implementation truth (duck typing): a type T
// implements interface I when T's receiver-method set (value OR pointer
// receivers) contains a method that MATCHES every method I declares — by name
// AND by canonical signature (see `goSignatureText`). Mirrors the analyzer's
// checkGoInterfaceImplementation exactly.
//
// IMPLEMENTOR CANDIDATES are the receiver TYPE NAMES read off method
// declarations, not the types declared in the file: Go's method set is a
// PACKAGE-level property, so `func (s *clientDispatcher) LogTrace(...)` alone
// — the struct itself declared in a sibling file, as gopls does — still names
// a type whose method set this file can enumerate. The analyzer mirrors this
// (GO20).
export function deriveGoImplements(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  // Every map below is keyed by a name READ FROM SOURCE, so it must not inherit
  // Object.prototype: a legal Go type named `constructor`, `toString` or
  // `valueOf` made the lookup find the INHERITED function instead of "absent",
  // and `structMethods[receiverType].add(...)` then threw — the go lane crashed
  // outright on go-tools/go/callgraph/vta/vta.go (`func (c *constructor) ...`),
  // which the canonical 60-file draw never reaches. Null-prototype records are
  // the fix; `Object.keys`/`Object.entries` and every truthiness test behave
  // identically, so nothing else about the oracle moves.
  // interfaceName -> method entries {name, signature} (an ARRAY, not a Map:
  // duplicate names with different signatures must stay visible, exactly as
  // the analyzer's getGoInterfaceMethods keeps them)
  const interfaces: Record<string, Array<{ name: string; signature: string }>> = Object.create(null)
  // interfaceName -> Set<embeddedInterfaceName>
  const embedded: Record<string, Set<string>> = Object.create(null)
  // structName -> Set<embeddedStructName> (Go struct embedding promotion)
  const structEmbedded: Record<string, Set<string>> = Object.create(null)
  // receiverType -> method entries {name, signature} (value AND pointer
  // receivers merged)
  const structMethods: Record<string, Array<{ name: string; signature: string }>> = Object.create(null)
  // Generic type names (type_spec with type_parameter_list): implements
  // satisfaction across generic instantiations needs type UNIFICATION, so
  // BOTH sides refuse (M37 #604, mirrors the analyzer's hasGenerics skip).
  const genericNames = new Set<string>()
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "type_declaration") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const ts = n.namedChild(i)
        // GO20 (#914): `type A = interface { M() }` is a `type_alias`, NOT a
        // `type_spec`, and the type_spec-only gate skipped it — so an ALIAS
        // never entered `interfaces`, and neither the struct that satisfies it
        // nor the interface that embeds it could ever be derived (go-tools
        // internal/gcimporter/testdata/issue25301.go was the only file in the
        // lane with unexplained implements rows, both from this). The alias
        // node declares the same `name` and `type` fields as the spec, so it is
        // read through the identical path below.
        if (!ts || (ts.type !== "type_spec" && ts.type !== "type_alias")) continue
        const nm = ts.childForFieldName?.("name")?.text
        // Generic type_spec (`MapLattice[Key comparable, ...]`): satisfaction
        // needs unification — record for the pair-level skip below.
        if (nm && (ts.namedChildren ?? []).some((c: any) => c.type === "type_parameter_list")) {
          genericNames.add(nm)
        }
        const structN = ts.namedChildren.find((c: any) => c.type === "struct_type")
        if (nm && structN) {
          // Anonymous (embedded) fields: field_declaration with NO name child —
          // its type node is the embedded type (type_identifier for `*Shape`
          // under a pointer_type). Record leaf name (mirrors analyzer's
          // embedding resolution).
          const fdl = structN.namedChildren.find((c: any) => c.type === "field_declaration_list")
          if (fdl) {
            if (!structMethods[nm]) structMethods[nm] = []
          for (let k = 0; k < fdl.namedChildCount; k++) {
              const fd = fdl.namedChild(k)
              if (!fd || fd.type !== "field_declaration") continue
              const nameF = fd.childForFieldName?.("name")
              if (nameF) continue // named field, not embedding
              const typeNode = fd.childForFieldName?.("type") ?? (fd.namedChildCount > 0 ? fd.namedChild(0) : undefined)
              if (!typeNode) continue
              // Descend pointer/GENERIC/qualified wrappers to the leaf identifier —
              // the generic wrapper is the go-heavy-corpus finding: without it the
              // "leaf" of `listers.ResourceIndexer[*crv1.Example]` was `Example]`,
              // a TYPE ARGUMENT recorded as an embedded struct whose methods were
              // then promoted into the embedding struct's set (fabrication), while
              // the real embedded type was never recorded (omission).
              const leaf = goEmbeddedLeaf(typeNode)
              if (leaf) { if (!structEmbedded[nm]) structEmbedded[nm] = new Set(); structEmbedded[nm].add(leaf) }
            }
          }
        }
        const interfaceN = ts.namedChildren.find((c: any) => c.type === "interface_type")
        if (nm && interfaceN) {
          const entries: Array<{ name: string; signature: string }> = []
          for (let j = 0; j < interfaceN.namedChildCount; j++) {
            const m = interfaceN.namedChild(j)
            if (!m) continue
            if (m.type === "method_spec") {
              const mn = m.childForFieldName?.("name")
              if (mn) entries.push({ name: mn.text, signature: goSignatureText(mn.text, m) })
            } else if (m.type === "constraint_elem") {
              // Embedded interface (`Reader`/`io.Closer` in
              // `interface { Reader; Close() error }`) — the embedded
              // interface's methods are promoted into the embedding
              // interface's method set. Record the embedded interface's LEAF
              // name so its methods can be folded in transitively after the
              // walk (a named embedded LOCAL interface like `Reader`
              // contribs its method set; an external `io.Closer` (leaf
              // `Closer`) is only contributed when a local interface of that
              // name exists). Matches the analyzer's promotion (fixed go
              // wave deep-review 2026-08-29).
              const child0 = m.namedChildCount > 0 ? m.namedChild(0) : undefined
              if (child0) {
                const raw = child0.text
                const leaf = raw.lastIndexOf(".") !== -1 ? raw.slice(raw.lastIndexOf(".") + 1) : raw
                if (!embedded[nm]) embedded[nm] = new Set()
                embedded[nm].add(leaf)
              }
            }
          }
          interfaces[nm] = entries
        }
      }
    } else if (n.type === "method_declaration") {
      const nm = n.childForFieldName?.("name")?.text
      // receiver: function_declaration's second parameter_list holds params;
      // method_declaration's second child is the receiver param.
      let receiverType: string | undefined
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        // Receiver is the FIRST named child (parameter_list). Probe-verified
        // (2026-08-28): namedChildren = [receiver parameter_list, name,
        // params parameter_list, result..., block]. i===0 holds the receiver.
        if (c && c.type === "parameter_list" && i === 0) {
          const p = c.namedChild(0)
          if (p && (p.type === "parameter_declaration" || p.type === "receiver")) {
            const tn = p.childForFieldName?.("type")
            // Strip pointer AND generic brackets — Go generics use `[...]`,
            // not `<...>` (M37 #604: MapLattice[Key, Elem, L] receivers were
            // never matched to the declared MapLattice).
            if (tn) receiverType = lastSegment(tn.text.replace(/^\*/, "").replace(/[\[<].*$/, ""))
          }
        }
      }
      if (nm && receiverType) {
        if (!structMethods[receiverType]) structMethods[receiverType] = []
        structMethods[receiverType].push({ name: nm, signature: goSignatureText(nm, n) })
      }
    }
    // Package-scope-only mirror (LocalsAreNotSymbols contract): function-,
    // method- and func-literal-local type/method declarations are not
    // symbols in the analyzer, so no implements edge may be derived from
    // them. All needed info is processed at the declaration node itself —
    // their subtrees carry nothing relevant, so skip descending entirely
    // (M37 #604 go-tools: function-local `interface hasCommands` in
    // gopls/internal/cmd/subcommands.go was over-derived).
    if (n.type === "function_declaration" || n.type === "method_declaration" || n.type === "func_literal") {
      continue
    }
    for (let k = 0; k < n.namedChildCount; k++) stack.push(n.namedChild(k))
  }
  // Fold embedded-interface method sets into embedding interfaces,
  // transitively (interface { Reader } promotes Reader's methods).
  //
  // The embedded interface is resolved FULLY FIRST, then merged — the order
  // matters and was a real omission: copying `interfaces[e]` before folding `e`
  // meant a two-hop embedding (`interface A { B }; interface B { C }`) only ever
  // contributed C's methods to whichever of B/A happened to be visited second,
  // so the result depended on declaration order. The analyzer recurses the same
  // way (`getGoInterfaceMethods` returns the embedded interface's COMPLETE set),
  // and it now deletes its visiting mark on the way out too, so a diamond
  // (`A` embeds both `B` and `C`, each embedding `D`) resolves to D's methods
  // through BOTH branches on each side. Cycles stay safe: the mark is checked
  // on entry.
  const fold = (name: string, visiting: Set<string>) => {
    const target = interfaces[name]
    if (!target || visiting.has(name)) return
    visiting.add(name)
    const embs = embedded[name]
    if (embs) {
      for (const e of embs) {
        fold(e, visiting)
        const eEntries = interfaces[e]
        if (!eEntries) continue
        for (const m of eEntries) {
          // Same dedup as the analyzer's merge: identical name AND signature.
          if (!target.some((x) => x.name === m.name && x.signature === m.signature)) target.push(m)
        }
      }
    }
    visiting.delete(name)
  }
  for (const name of Object.keys(interfaces)) fold(name, new Set())
  // Promoted struct method sets: an embedding struct includes its embedded
  // struct's methods (Go method promotion) — `Worker struct { *Shape }`
  // includes Shape's methods, so Worker implements any interface Shape
  // implements. Transitive + cycle-safe, mirrors the analyzer exactly.
  const foldStruct = (name: string, visiting: Set<string>) => {
    const target = structMethods[name]
    if (!target || visiting.has(name)) return
    visiting.add(name)
    const embs = structEmbedded[name]
    if (embs) {
      for (const e of embs) {
        // Fully resolve the embedded type first (transitivity, same reason as
        // the interface fold above), then promote its whole set. Shadowing
        // mirrors the analyzer's collectGoPromotedMethods: a method the
        // embedding type (or an already-promoted one) already carries with the
        // SAME signature wins over the promoted copy.
        foldStruct(e, visiting)
        const eEntries = structMethods[e]
        if (eEntries) {
          for (const m of eEntries) {
            if (!target.some((x) => x.signature === m.signature)) target.push(m)
          }
        }
      }
    }
    visiting.delete(name)
  }
  for (const name of Object.keys(structMethods)) foldStruct(name, new Set())
  for (const [iface, ifaceMethods] of Object.entries(interfaces)) {
    if (ifaceMethods.length === 0) continue
    // Generic pairs skipped on BOTH sides (mirrors the analyzer).
    if (genericNames.has(iface)) continue
    for (const [structName, methods] of Object.entries(structMethods)) {
      if (structName === iface) continue
      if (genericNames.has(structName)) continue
      let ok = true
      for (const im of ifaceMethods) {
        // Go's rule: a method of the same NAME and the same canonical
        // SIGNATURE. Name-only here was the over-claim (#914).
        if (!methods.some((m) => m.name === im.name && m.signature === im.signature)) { ok = false; break }
      }
      if (ok && !seen.has(structName + "->" + iface)) {
        seen.add(structName + "->" + iface)
        edges.push({ label: "implements", from: structName, target: iface })
      }
    }
  }
  return edges
}

// Zig truth: calls (identifier + field_expression-leaf callees) and uses
// (field access NOT in call-callee position), mirroring the family leaf
// contract the analyzer implements (zig wave 2026-08-29): a call_expression
// emits calls -> callee LEAF (helper -> helper, std.debug.print -> print,
// lst.append -> append); a field_expression that is not a call's direct
// callee emits uses -> field leaf (list.items.len -> len). Both skip bare
// numeric/builtin tokens. This mirrors the analyzer's analyzeZigCodeRelationships
// so the differential can verify it (it previously had NO oracle and the
// analyzer emitted no calls/uses at all).
export function derivePythonEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, target: string) => {
    const k = label + ":" + target
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }
  // Mirror the analyzer's PYTHON_BUILTINS filter (imported — never duplicated).
  const isBuiltin = (name: string): boolean =>
    PYTHON_BUILTINS.has(name) ||
    (name.startsWith("__") && name.endsWith("__"))
  // Uppercase-head leaf the analyzer treats as a possible class name; only
  // in-file declared names become instantiates (tracked via declaredTypes
  // pass below).
  const isUpper = (name: string): boolean => {
    const c = name.charCodeAt(0)
    return c >= 65 && c <= 90
  }

  // Pass 1: collect in-file declared class/enum names (the analyzer's
  // declaredTypes gate — instantiates is only emitted for those).
  const declaredTypes = new Set<string>()
  const scan = (n: any) => {
    if (n.type === "class_definition") {
      const nameNode = n.namedChildren.find((c: any) => c.type === "identifier")
      if (nameNode?.text) declaredTypes.add(nameNode.text)
    }
    for (let i = 0; i < n.namedChildCount; i++) scan(n.namedChild(i))
  }
  scan(root)

  // Class structure maps for in-file override resolution (same contract as
  // the analyzer's extractOverrideRelationships: base from the FIRST
  // extends edge — Python MRO; methods registered per class).
  const baseByClass = new Map<string, string>()
  const classMethods = new Map<string, Set<string>>()
  const regMethod = (cls: string | undefined, m: string) => {
    if (!cls || !m) return
    const set = classMethods.get(cls) ?? new Set()
    set.add(m)
    classMethods.set(cls, set)
  }

  // #748 (M49 dup-key family ruling, Option A): python binds the LAST
  // definition of a name in one container scope, so an EARLIER same-name def
  // is a PHANTOM whose body can never run. The oracle derives from BOTH bodies
  // today (it walks every function_definition), and the analyzer's fix drops
  // the shadowed one — so the rule has to be expressed on THIS side in the same
  // commit, or every phantom-body edge would surface as MISSING. Container
  // identity is the scope NODE (module / class_definition), and "symbol-level"
  // is the analyzer's published scope model: a class opens a container and
  // clears the function scope, a def inside a def is not a symbol (PYD5) and
  // so cannot be a phantom. Measured before the change: 0 duplicate-name
  // scopes across both pinned corpora (cython 475 + requests 37 files).
  // Identity is a BYTE RANGE, never the node object or the class name: the
  // wrappers are per-access (so a Set<Node> membership silently never holds),
  // and container identity must be the scope node so two same-named classes
  // stay distinct containers.
  //
  // A DECLARATION CHAIN is not a rebinding: `@overload` stubs and property
  // accessors (`@property` / `@x.setter` / `@x.getter` / `@x.deleter`) coexist
  // by design and the family ruling keeps them. MEASURED on the pinned corpora:
  // 21 of 25 duplicate-name scopes are chains, 4 are genuine rebindings.
  const chainLeaf = new Set(["overload", "property", "setter", "getter", "deleter"])
  const decoratorLeaf = (d: any): string | undefined => {
    const inner = d.namedChild(0)
    if (!inner) return undefined
    if (inner.type === "identifier") return inner.text
    if (inner.type === "call") return decoratorLeaf(inner.namedChild(0))
    const last = inner.namedChild(inner.namedChildCount - 1)
    return last?.text
  }
  const isDeclarationChain = (defs: any[], name: string): boolean => {
    for (const d of defs) {
      const parent = d.parent
      if (!parent || parent.type !== "decorated_definition") continue
      for (let i = 0; i < parent.namedChildCount; i++) {
        const c = parent.namedChild(i)
        if (!c || c.type !== "decorator") continue
        const leaf = decoratorLeaf(c)
        if (leaf && chainLeaf.has(leaf)) return true
        if (c.text.replace(/^@/, "").trim().startsWith(`${name}.`)) return true
      }
    }
    return false
  }
  const phantoms = new Set<string>()
  {
    const nodeKey = (n: any): string => `${n.startIndex}:${n.endIndex}`
    const containerKey = (n: any): string => `${n.type}:${n.startIndex}:${n.endIndex}`
    const byContainer = new Map<string, Map<string, { key: string; node: any }[]>>()
    const frames: { n: any; container: string; inFn: boolean }[] = [{ n: root, container: containerKey(root), inFn: false }]
    while (frames.length > 0) {
      const { n, container, inFn } = frames.pop()!
      let nextContainer = container
      let nextInFn = inFn
      if (n.type === "class_definition" || n.type === "module") {
        nextContainer = containerKey(n)
        nextInFn = false
      } else if (n.type === "function_definition") {
        if (!inFn) {
          const name = n.namedChildren.find((c: any) => c.type === "identifier")?.text
          if (name) {
            const m = byContainer.get(container) ?? new Map<string, { key: string; node: any }[]>()
            m.set(name, [...(m.get(name) ?? []), { key: nodeKey(n), node: n }])
            byContainer.set(container, m)
          }
        }
        nextInFn = true
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) frames.push({ n: c, container: nextContainer, inFn: nextInFn })
      }
    }
    // ALTERNATIVES ARE NOT SHADOWS: same-name defs in different branches are
    // both live, so only a rebinding INSIDE one statement block is a phantom.
    const blockKey = (n: any): string => {
      for (let p: any = n.parent; p; p = p.parent) {
        if (p.type === "block") return `${p.type}:${p.startIndex}:${p.endIndex}`
      }
      return ""
    }
    for (const m of byContainer.values())
      for (const [name, defs] of m) {
        if (isDeclarationChain(defs.map((d) => d.node), name)) continue
        for (let i = 0; i < defs.length - 1; i++) {
          const later = defs.slice(i + 1).some((d) => blockKey(d.node) === blockKey(defs[i].node))
          if (later) phantoms.add(defs[i].key)
        }
      }
  }
  const isPhantom = (n: any): boolean => phantoms.has(`${n.startIndex}:${n.endIndex}`)

  // Pass 2: structural edge derivation (mirrors RealPythonAnalyzer).
  const stack: any[] = [{ n: root, parent: null, inFn: undefined as string | undefined }]
  while (stack.length > 0) {
    const { n, parent, inFn } = stack.pop()!
    const t = n.type
    // The shadowed earlier definition — see the phantom pre-pass above. Its
    // subtree is not walked, so it contributes no edge, exactly like the walk
    // it mirrors.
    if (isPhantom(n)) continue
    // PYD5: rebind the owner ONLY when entering a symbol-level def (inFn is
    // still undefined). A def inside a def is NOT a symbol — the calls
    // contract attributes its body to the ENCLOSING function, so its member
    // reads must keep the outer owner too (mirrors extractMemberUses).
    let nextFn = inFn
    if (t === "function_definition" && !inFn) {
      const nameNode = n.namedChildren.find((c: any) => c.type === "identifier")
      nextFn = nameNode?.text ?? inFn
    }
    // Enum flag shared by both class_definition branches below (extends
    // derivation sets it; member registration reads it).
    let isEnumCls = false

    if (t === "class_definition") {
      const className = n.namedChildren.find((c: any) => c.type === "identifier")?.text ?? "?"
      const args = n.namedChildren.find((c: any) => c.type === "argument_list")
      if (args) {
        for (let i = 0; i < args.namedChildCount; i++) {
          const arg = args.namedChild(i)
          if (!arg) continue
          // base-class LEAF only: subscript Generic[T] -> Generic,
          // attribute a.b -> b (mirrors baseClassLeaf).
          let leaf: string | undefined
          if (arg.type === "identifier") leaf = arg.text
          else if (arg.type === "subscript" || arg.type === "attribute") {
            const inner = arg.type === "attribute"
              ? arg.namedChild(arg.namedChildCount - 1)
              : arg.namedChild(0)
            leaf = inner?.text
            if (leaf && leaf.includes(".")) leaf = leaf.split(".").pop()
          }
          if (leaf && leaf !== className) {
            push("extends", leaf)
            if (leaf === "Enum") isEnumCls = true
            if (!baseByClass.has(className)) baseByClass.set(className, leaf)
          }
        }
      }
    }

    if (t === "assignment") {
      // annotated assignment `x: T = v` → references:declared_type (the
      // analyzer's walk emits these from the assignment case; builtin
      // scalars excluded; attribute-path types descend to leaves)
      const typeNode = n.namedChildren.find((c: any) => c.type === "type")
      if (typeNode) {
        const stackT: any[] = [typeNode]
        while (stackT.length > 0) {
          const tn = stackT.pop()!
          if (tn.type === "identifier") {
            if (!["str", "int", "float", "complex", "bool", "bytes", "object", "None", "Any", "self", "cls"].includes(tn.text)) push("references", tn.text)
          } else if (tn.type !== "string" && tn.type !== "concatenated_string" && tn.type !== "none") {
            for (let i = 0; i < tn.namedChildCount; i++) stackT.push(tn.namedChild(i))
          }
        }
      }
    }

    if (t === "function_definition") {
      // return annotation → references:return_type (builtin scalars excluded)
      const typeNode = n.namedChildren.find((c: any) => c.type === "type")
      if (typeNode) {
        const stackT: any[] = [typeNode]
        while (stackT.length > 0) {
          const tn = stackT.pop()!
          if (tn.type === "identifier") {
            if (!["str", "int", "float", "complex", "bool", "bytes", "object", "None", "Any", "self", "cls"].includes(tn.text)) push("references", tn.text)
          } else if (tn.type !== "string" && tn.type !== "concatenated_string" && tn.type !== "none") {
            for (let i = 0; i < tn.namedChildCount; i++) stackT.push(tn.namedChild(i))
          }
        }
      }
      // typed params → references:declared_type
      const paramsNode = n.namedChildren.find((c: any) => c.type === "parameters")
      if (paramsNode) {
        for (let i = 0; i < paramsNode.namedChildCount; i++) {
          const p = paramsNode.namedChild(i)
          const ptype = p?.type === "typed_parameter" || p?.type === "typed_default_parameter"
            ? p.namedChildren.find((c: any) => c.type === "type")
            : undefined
          if (ptype) {
            const stackT: any[] = [ptype]
            while (stackT.length > 0) {
              const tn = stackT.pop()!
              if (tn.type === "identifier") {
                if (!["str", "int", "float", "complex", "bool", "bytes", "object", "None", "Any"].includes(tn.text)) push("references", tn.text)
              } else if (tn.type !== "string" && tn.type !== "concatenated_string" && tn.type !== "none") {
                for (let j = 0; j < tn.namedChildCount; j++) stackT.push(tn.namedChild(j))
              }
            }
          }
        }
      }
    }

    if (t === "function_definition" && parent && parent.type === "class_definition") {
      const clsName = parent.namedChildren.find((c: any) => c.type === "identifier")?.text
      const mname = n.namedChildren.find((c: any) => c.type === "identifier")?.text
      regMethod(clsName, mname)
    }

    if (t === "class_definition") {
      // register own DIRECT methods too (the generic regMethod branch above
      // needs parent — but during the LIFO walk the class node is popped
      // before its methods, so methods deep inside the block reach the
      // generic branch only via their own parent chain; direct scan here is
      // the belt-and-braces pass the analyzer does at extractClass time)
      const clsName2 = n.namedChildren.find((c: any) => c.type === "identifier")?.text
      const block = n.namedChildren.find((c: any) => c.type === "block")
      if (clsName2 && block) {
        if (isEnumCls) {
          // Enum class: members are ONLY the analyzer's extractClass contract
          // — direct-body constant-valued assignments (string/integer/float/
          // true/false/none/identifier RHS). No deep scan, no method
          // registration (enum methods are registered by the generic
          // function_definition branch above).
          for (let i = 0; i < block.namedChildCount; i++) {
            const stmt = block.namedChild(i)
            if (stmt?.type !== "expression_statement") continue
            const assign = stmt.namedChild(0)
            if (assign?.type !== "assignment") continue
            const left = assign.namedChild(0)
            const right = assign.namedChild(assign.namedChildCount - 1)
            if (left?.type !== "identifier") continue
            if (right && (right.type === "string" || right.type === "integer" ||
                right.type === "float" || right.type === "true" || right.type === "false" ||
                right.type === "none" || right.type === "identifier")) {
              regMethod(clsName2, left.text)
            }
          }
        } else {
          // register every method declared anywhere in the class body except
          // inside NESTED classes (methods of inner classes belong to them) —
          // descends decorated_definition wrappers and compound statements.
          // Class-body assignment LHS also register: the analyzer's
          // extractAssignment class-variable branch turns `code_object = None`
          // at class scope into a Property owned by the class, and
          // baseDeclares treats ANY base-owned symbol as an override target
          // (Cython's CFuncDefNode.code_object -> FuncDefNode hook pattern).
          // Function bodies are skipped (locals are not symbols); compound
          // statements descend (the analyzer's currentClass persists inside
          // if/for/try at class scope). `__all__` is intercepted before the
          // Property branch by the analyzer, so it never registers.
          const mstack: any[] = [block]
          while (mstack.length > 0) {
            const m = mstack.pop()!
            if (m.type === "function_definition") {
              regMethod(clsName2, m.namedChildren.find((c: any) => c.type === "identifier")?.text)
              continue
            }
            if (m.type === "class_definition") continue
            if (m.type === "assignment") {
              // #928: a CHAINED class-attribute assignment (`a = b = c`) binds EVERY
              // name — tree-sitter nests chains RIGHT: `x = y = z = 1` is
              // assignment(identifier x, assignment(identifier y,
              // assignment(identifier z, integer))). This oracle registered only
              // namedChild(0), so a subclass `def` of any non-first chain name found no
              // base member and 10 real overrides in Cython's PyrexTypes.py (where the
              // chain is LINE-CONTINUATION-wrapped over four lines) read UNEXPLAINED at
              // depth. A right-nested chain has exactly one target per level, so the
              // targets are identifier(0) of every nested assignment; the innermost
              // right-hand side is the value, never a target. Annotated (`x: T = v`,
              // incl. `a: T = b = c`) has a `type` child between the name and the
              // value — the name is still namedChild(0) and the chain, if any, nests
              // after the type. This mirrors the analyzer's class-variable branch,
              // which owns every name of the chain as a Property of the class.
              let node: any = m
              while (node?.type === "assignment") {
                const lhs = node.namedChild(0)
                if (lhs?.type === "identifier" && lhs.text !== "__all__") regMethod(clsName2, lhs.text)
                node = node.namedChildren.find((k: any) => k?.type === "assignment")
              }
              continue
            }
            if (m.type === "augmented_assignment" || m.type === "named_expression") {
              const lhs = m.namedChild(0)
              if (lhs?.type === "identifier" && lhs.text !== "__all__") regMethod(clsName2, lhs.text)
              continue
            }
            for (let i = 0; i < m.namedChildCount; i++) mstack.push(m.namedChild(i))
          }
        }
      }
    }

    if (t === "function_definition") {
      // In-file overrides (mirror the analyzer's harness-companion contract):
      // method redeclared in a subclass whose base (from the extends edges
      // derived above) declares the same-name method. Pure clause structure.
      // NOTE: the method's structural parent is the class BLOCK, not the
      // class — use the node's real .parent pointer and walk up to the
      // class_definition.
      let owner: any = null
      let up: any = n.parent
      while (up) {
        if (up.type === "class_definition") { owner = up; break }
        if (up.type === "function_definition" || up.type === "module") break
        up = up.parent
      }
      if (owner) {
        const clsName = owner.namedChildren.find((c: any) => c.type === "identifier")?.text
        const mname = n.namedChildren.find((c: any) => c.type === "identifier")?.text
        if (clsName && mname) {
          const base = baseByClass.get(clsName)
          if (base && classMethods.get(base)?.has(mname)) {
            push("overrides", `${base}.${mname}`)
          }
        }
      }
    }

    if (t === "call") {
      // isinstance(x, T) / issubclass(a, B): second positional arg names a
      // type → references:instanceof_check (mirror extractDeclaredTypeRefs).
      const fn = n.namedChild(0)
      if (fn && (fn.text === "isinstance" || fn.text === "issubclass")) {
        const args = n.namedChildren.find((c: any) => c.type === "argument_list")
        const last = args && args.namedChildCount >= 2 ? args.namedChild(args.namedChildCount - 1) : undefined
        if (last) {
          // Same primitive exclusion as the analyzer's PRIMITIVES — self/cls
          // are conventional method/classmethod receivers (and here `cls` is
          // a local bound class), never type-name references (PYD cython
          // corpus: Pipeline.py `isinstance(t, cls)` was oracle-only noise).
          const stackT: any[] = [last]
          while (stackT.length > 0) {
            const tn = stackT.pop()!
            if (tn.type === "identifier") {
              if (!["str", "int", "float", "complex", "bool", "bytes", "object", "None", "Any", "self", "cls"].includes(tn.text)) push("references", tn.text)
            } else for (let i = 0; i < tn.namedChildCount; i++) stackT.push(tn.namedChild(i))
          }
        }
      }
      // Decorator-position calls (@wraps(f), @magic_arguments()): the
      // analyzer treats decorators as metadata on the decorated symbol, not
      // runtime call edges — the oracle must skip them identically (PYD1
      // differential: 8 decorator-site calls were oracle-only noise).
      let anc: any = parent
      let inDecorator = false
      while (anc) {
        if (anc.type === "decorator") { inDecorator = true; break }
        if (anc.type === "function_definition" || anc.type === "class_definition" || anc.type === "module") break
        anc = anc.parent
      }
      if (!inDecorator) {
      let fn = n.namedChild(0)
      // M60 #902: the callee rule is the analyzer's own list of shapes that name
      // their callee statically — identifier, attribute (leaf) — plus TRANSPARENT
      // grouping, which unwraps. Everything else names nothing: a conditional
      // callee is whichever branch the condition selects, a lambda callee is the
      // lambda (not its body), and `f()()`'s callee is the RESULT of `f()` (the
      // inner call emits its own edge). The analyzer descended into the first
      // named child for every unlisted shape and published the `if` branch of a
      // conditional as a callee; the oracle refused it, which is the single
      // UNEXPLAINED edge this mirror now mirrors exactly.
      while (fn && fn.type === "parenthesized_expression" && fn.namedChildCount >= 1) fn = fn.namedChild(0)
      if (fn) {
        const calleeLeaf =
          fn.type === "identifier" ? fn.text :
          fn.type === "attribute" ? fn.namedChild(fn.namedChildCount - 1)?.text :
          undefined
        if (calleeLeaf && !isBuiltin(calleeLeaf)) {
          if (isUpper(calleeLeaf) && declaredTypes.has(calleeLeaf)) push("instantiates", calleeLeaf)
          else if (!isUpper(calleeLeaf)) push("calls", calleeLeaf)
        }
      }
      }
    }

    if (t === "attribute" && inFn && parent) {
      const leaf = n.namedChild(n.namedChildCount - 1)
      if (leaf && leaf.type === "identifier") {
        // Write / call-function / call-receiver gates (byte-range compare —
        // web-tree-sitter wrappers are per-access, identity never holds).
        const gp = parent.parent
        const isAssignLhs = parent.type === "assignment" &&
          parent.namedChild(0)?.startIndex === n.startIndex && parent.namedChild(0)?.endIndex === n.endIndex
        const gpIsAssign = gp?.type === "assignment"
        const gpLhs = gpIsAssign ? gp!.namedChild(0) : undefined
        const isGpAssignLhs = !!gpLhs && gpLhs.startIndex === n.startIndex && gpLhs.endIndex === n.endIndex
        const isAugLhs = parent.type === "augmented_assignment" &&
          parent.namedChild(0)?.startIndex === n.startIndex && parent.namedChild(0)?.endIndex === n.endIndex
        const isCallFn = parent.type === "call" &&
          parent.namedChild(0)?.startIndex === n.startIndex && parent.namedChild(0)?.endIndex === n.endIndex
        const gpIsCall = gp?.type === "call"
        const gpFn = gpIsCall ? gp!.namedChild(0) : undefined
        const isReceiverOfCall = !!gpFn && gpFn.type === "attribute" &&
          gpFn.startIndex === n.startIndex && gpFn.endIndex === n.endIndex
        if (!isAssignLhs && !isGpAssignLhs && !isAugLhs && !isCallFn && !isReceiverOfCall) {
          push("uses", leaf.text)
        }
      }
    }

    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, parent: n, inFn: nextFn })
    }
  }
  return edges
}

// Haskell oracle (HSD wave 2026-09-03): independently derivable truth for
// class/instance/data/deriving/superclass structure + in-file calls. Mirrors
// the analyzer's declared contract (see script/m14/spec/haskell-completeness.json).
export function deriveHaskellEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, from: string, target: string) => {
    // Self-edges are REAL for calls (Haskell self-recursion is a genuine
    // call edge; the analyzer emits it deliberately). Structural labels
    // (extends/implements/instantiates) can never legitimately be self-
    // loops in this contract, so keep the from!==target guard for them.
    if (!from || !target) return
    if (label !== "calls" && from === target) return
    const k = `${label}|${from}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label, from, target })
  }
  const classMethods = new Map<string, Set<string>>()
  const classAttrs = new Map<string, Set<string>>()
  const instanceBases = new Map<string, string>() // instance CLASS name -> anonymous
  const declared = new Set<string>()
  const declaredOps = new Set<string>()

  // Pass 1: declarations — classes (name/methods/superclass context),
  // instances (class + target), data/newtype (constructors), callables.
  const stack1: any[] = [{ n: root, cls: undefined as string | undefined, inBody: false }]
  while (stack1.length > 0) {
    const { n, cls, inBody } = stack1.pop()
    const t = n.type

    if (t === "function" || t === "bind") {
      // Type-position function nodes (parameter/result fields) are types.
      const isTypeFn = t === "function" && (n.childForFieldName?.("parameter") || n.childForFieldName?.("result"))
      if (!isTypeFn) {
        // Do-binds (`z <- fetch x`) are values, not callables.
        const isArrowBind = t === "bind" && n.children.some((c: any) => c.type === "<-")
        if (!isArrowBind) {
          const head = n.namedChildCount > 0 ? n.namedChild(0) : null
          if (head?.type === "variable") declared.add(head.text)
          else if (head && (head.type === "infix" || head.type === "prefix_id")) {
            const op = head.namedChildren.find((c: any) => c.type === "operator")
            // HSD19 mirror: backtick-operator definitions declare the
            // infix_id's variable; constructor/tuple-pattern heads declare
            // nothing (the old fallthrough declared the raw head text).
            let callable: string | undefined = op?.text
            if (!callable) {
              const infixId = head.namedChildren.find((c: any) => c.type === "infix_id")
              const tv = infixId?.namedChildren.find((c: any) => c.type === "variable")
              callable = tv?.text
            }
            if (callable) declaredOps.add(callable)
          }
        }
      }
      // NO early return: where/let locals hold more callables.
    }
    if (t === "signature" && !inBody) {
      // HSD17 mirror: only DECLARATION signatures declare callables
      // (declarations/local_binds/class/instance bodies). Expression-position
      // annotations (`(e :: T)`) declare nothing.
      const p2 = n.parent?.type
      // foreign_import: FFI declarations (`foreign import capi ... c_foo :: ...`)
      // are real in-file callables — mirror the analyzer's prepass.
      if (p2 === "declarations" || p2 === "local_binds" || p2 === "class" || p2 === "instance" || p2 === "class_declarations" || p2 === "instance_declarations" || p2 === "foreign_import") {
        const nameNode = n.namedChildCount > 0 ? n.namedChild(0) : null
        if (nameNode?.type === "variable") declared.add(nameNode.text)
      }
    }
    if (t === "class") {
      const nameNode = n.namedChildren.find((c: any) => c.type === "name")
      const cn = nameNode?.text
      if (cn) {
        classMethods.set(cn, new Set())
        classAttrs.set(cn, new Set())
        // Superclass context (#872 lockstep): the constraint tree is walked
        // exactly as the analyzer now does — tuple lists, parens wrappers,
        // quantified (forall) bodies, and applied heads take the LEFT-SPINE
        // class (Eq (f a) => D: the class is Eq, (f a) is its argument);
        // qualified heads are taken verbatim (P.Show).
        const context = n.namedChildren.find((c: any) => c.type === "context")
        if (context) {
          const supers: string[] = []
          const stackC: any[] = [context]
          while (stackC.length > 0) {
            const x = stackC.pop()!
            if (x.type === "apply") {
              let head: any = x
              while (head?.type === "apply") head = head.namedChild(0)
              if (head && (head.type === "name" || head.type === "constructor" || head.type === "qualified")) supers.push(head.text)
            }
            for (let i = 0; i < x.namedChildCount; i++) stackC.push(x.namedChild(i))
          }
          for (const s of supers) push("extends", cn, s)
        }
      }
    }
    if (t === "instance") {
      const nameNode = n.namedChildren.find((c: any) => c.type === "name")
      const tp = n.namedChildren.find((c: any) => c.type === "type_patterns")
      let target: string | undefined
      if (tp) {
        const direct = tp.namedChildren.find((c: any) => c.type === "name" || c.type === "constructor")
        if (direct) target = direct.text
        else {
          const list = tp.namedChildren.find((c: any) => c.type === "list")
          if (list) target = "[]"
          else {
            const parens = tp.namedChildren.find((c: any) => c.type === "parens")
            const ap = parens?.namedChildren.find((c: any) => c.type === "apply")
            const first = ap?.namedChildCount ? ap.namedChild(0) : null
            if (first) target = first.text
          }
        }
      }
      const cn = nameNode?.text
      if (cn && target) push("implements", target, cn)
      if (cn && !target) instanceBases.set(cn, cn)
      // Instance method bodies attribute to the TARGET name.
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack1.push({ n: c, cls: target ?? cn, inBody: true })
      }
      continue
    }
    if (t === "data_type" || t === "newtype") {
      const nameNode = n.namedChildren.find((c: any) => c.type === "name")
      const dn = nameNode?.text
      if (dn) {
        // deriving -> implements
        const dv = n.namedChildren.find((c: any) => c.type === "deriving")
        if (dv) {
          // HSD18 mirror: entry-wise extraction — bare name, qualified full
          // text, or class-APPLICATION head. Argument leaves (the SessionError
          // in `MonadError SessionError`) are NOT classes — the old
          // descend-all-names pass fabricated Session->SessionError.
          const entries: string[] = []
          const grabD = (nn: any) => {
            for (let i = 0; i < nn.namedChildCount; i++) {
              const c = nn.namedChild(i)
              if (!c) continue
              if (c.type === "name") entries.push(c.text)
              else if (c.type === "qualified") entries.push(c.text)
              else if (c.type === "apply") {
                const h = c.namedChildCount > 0 ? c.namedChild(0) : null
                if (h?.text) entries.push(h.text)
              } else if (c.type === "parens") grabD(c)
            }
          }
          const tuple = dv.namedChildren.find((c: any) => c.type === "tuple")
          if (tuple) grabD(tuple)
          grabD(dv)
          for (const e2 of entries) push("implements", dn, e2)
        }
      }
      // Do NOT descend into data bodies — constructor references there are
      // declarations, not call sites.
      continue
    }
    if (t === "deriving_instance") {
      // HSD12 (probe 2026-09-03, postgrest Routine.hs:65): standalone
      // `deriving instance Show Foo` — same emission as data-level deriving:
      // implements target -> class. Parens wrapper handled recursively.
      let cls: string | undefined
      let target: string | undefined
      const grab = (nn: any) => {
        for (let i = 0; i < nn.namedChildCount; i++) {
          const c = nn.namedChild(i)
          if (!c) continue
          // HSD18 mirror: qualified class heads and apply heads are
          // entry-wise extracted (matches the analyzer's standalone-deriving
          // handling exactly).
          if (c.type === "name" || c.type === "qualified") cls = c.text
          else if (c.type === "apply") {
            const h = c.namedChildCount > 0 ? c.namedChild(0) : null
            if (h?.text) cls = h.text
          } else if (c.type === "type_patterns") {
            const t2 = c.namedChildren.find((x: any) => x.type === "name" || x.type === "constructor")
            target = t2?.text
          } else if (c.type === "parens") grab(c)
        }
      }
      grab(n)
      if (cls && target) push("implements", target, cls)
      continue
    }

    let nextCls = cls
    if (t === "signature" && cls) {
      const nameNode = n.namedChildCount > 0 ? n.namedChild(0) : null
      if (nameNode?.type === "variable") classMethods.get(cls)?.add(nameNode.text)
    }
    if (t === "class") {
      const nameNode = n.namedChildren.find((c: any) => c.type === "name")
      if (nameNode?.text) nextCls = nameNode.text
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack1.push({ n: c, cls: nextCls, inBody: inBody || t === "function" || t === "bind" })
    }
  }

  // Pass 2: call sites — apply heads (variable/qualified/constructor) and
  // backtick infix_id, attributed to the enclosing callable; record
  // construction in body position (constructor head) -> instantiates.
  const stack2: any[] = [{ n: root, fn: undefined as string | undefined, inBody: false }]
  while (stack2.length > 0) {
    const { n, fn, inBody } = stack2.pop()
    const t = n.type

    if (t === "apply" || t === "infix" || t === "record") {
      if (t === "apply" && fn) {
        const head = n.namedChildCount > 0 ? n.namedChild(0) : null
        if (head?.type === "variable" && declared.has(head.text)) push("calls", fn, head.text)
        else if (head?.type === "qualified") {
          const mod = head.namedChildren.find((c: any) => c.type === "module")
          const modText = mod?.text?.replace(/\.$/, "") ?? ""
          // HSD16 (probe 2026-09-03, 985 corpus occurrences): qualified
          // CONSTRUCTOR application in body position (`M.Just 1`) →
          // instantiates with the pattern gate; the function form stays calls.
          const ctor = head.namedChildren.find((c: any) => c.type === "constructor")
          if (modText && ctor?.text) {
            if (inBody && !isPatternPos(n)) push("instantiates", fn, `${modText}.${ctor.text}`)
          } else {
            const func = head.namedChildren.find((c: any) => c.type === "variable")
            if (modText && func?.text) push("calls", fn, `${modText}.${func.text}`)
          }
        } else if (head?.type === "constructor" || head?.type === "prefix") {
          // Body-position constructor application → instantiates. Pattern-
          // position applies (inside `patterns`) are excluded — mirror the
          // analyzer's isPatternPosition gate.
          if (inBody && !isPatternPos(n)) push("instantiates", fn, head.text)
        }
      } else if (t === "infix" && fn) {
        const infixId = n.namedChildren.find((c: any) => c.type === "infix_id")
        const opNode = n.namedChildren.find((c: any) => c.type === "operator")
        if (infixId) {
          // HSD19 mirror: infix DEFINITION heads are pattern territory — the
          // head's own infix_id names the callable being defined, not a call.
          if (isPatternPos(n)) {
            // fall through: no call emission from a definition head
          } else {
            const target = infixId.namedChildren.find((c: any) => c.type === "variable")
            if (target?.text && (declared.has(target.text) || declaredOps.has(target.text))) push("calls", fn, target.text)
          }
        } else if (opNode?.text === "$") {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (!c || c.type === "operator") continue
            if (c.type === "variable" && declared.has(c.text)) push("calls", fn, c.text)
            else if (c.type === "qualified") {
              const mod = c.namedChildren.find((x: any) => x.type === "module")
              const func = c.namedChildren.find((x: any) => x.type === "variable")
              const modText = mod?.text?.replace(/\.$/, "") ?? ""
              if (modText && func?.text) push("calls", fn, `${modText}.${func.text}`)
            }
            break
          }
        }
      } else if (t === "record" && fn && inBody) {
        // Body-position record with a CONSTRUCTOR head = construction; a
        // variable head is an update (no edge). Data-declaration records sit
        // under data_constructor and are excluded via inBody + parent chain:
        // only descend here from function/bind bodies. HSD14-record: record
        // PATTERNS (function heads, pattern guards) are excluded via
        // isPatternPos — mirror the analyzer.
        const ctor = n.namedChildren.find((c: any) => c.type === "constructor")
        const inDecl = (() => {
          let cur = n.parent
          while (cur) {
            if (cur.type === "match" || cur.type === "do" || cur.type === "bind" || cur.type === "let_in") return false
            if (cur.type === "data_constructor" || cur.type === "newtype_constructor") return true
            cur = cur.parent
          }
          return false
        })()
        if (ctor?.text && !inDecl && !isPatternPos(n)) push("instantiates", fn, ctor.text)
      }
    }
    if (t === "signature") {
      // HSD17 mirror: declaration signatures are TYPE trees — no calls inside,
      // never descend (the old descent fabricated type-application calls like
      // `t (t B.ByteString)` from `t :: T (T B.ByteString)` annotations).
      // Expression-position annotations host the annotated EXPRESSION as
      // child 0; descend into it only — the sibling type subtree would
      // fabricate calls the same way.
      const p2 = n.parent?.type
      const isDeclSig = p2 === "declarations" || p2 === "local_binds" || p2 === "class" || p2 === "instance" || p2 === "class_declarations" || p2 === "instance_declarations" || p2 === "foreign_import"
      if (isDeclSig) continue
      const expr = n.namedChildCount > 0 ? n.namedChild(0) : null
      if (expr) stack2.push({ n: expr, fn, inBody })
      continue
    }
    if (t === "function" || t === "bind") {
      const isTypeFn = t === "function" && (n.childForFieldName?.("parameter") || n.childForFieldName?.("result"))
      const isArrowBind = t === "bind" && n.children.some((c: any) => c.type === "<-")
      if (!isTypeFn && !isArrowBind) {
        const head = n.namedChildCount > 0 ? n.namedChild(0) : null
        let nextFn = fn
        if (head?.type === "variable") nextFn = head.text
        else if (head && (head.type === "infix" || head.type === "prefix_id")) {
          const op = head.namedChildren.find((c: any) => c.type === "operator")
          if (op?.text) {
            nextFn = op.text
          } else {
            // HSD19 mirror: backtick-operator definition heads name their
            // infix_id variable; constructor/tuple-pattern heads are NOT
            // callables — keep the enclosing fn (no reset), mirroring the
            // analyzer's caller-preservation for the non-callable head slot.
            const infixId = head.namedChildren.find((c: any) => c.type === "infix_id")
            const tv = infixId?.namedChildren.find((c: any) => c.type === "variable")
            if (tv?.text) nextFn = tv.text
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) stack2.push({ n: c, fn: nextFn, inBody: true })
        }
        continue
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack2.push({ n: c, fn, inBody: inBody || t === "do" })
    }
  }
  for (const op of declaredOps) if (!declared.has(op)) declared.add(op)
  return edges
}

function isPatternPos(node: any): boolean {
  let cur = node.parent
  let prev = node
  while (cur) {
    if (cur.type === "patterns") return true
    // HSD14 (probe 2026-09-03): case-alternative patterns are direct children
    // of `alternative`; bind-form pattern guards keep only their FIRST child
    // as pattern territory; an infix head as FIRST child of function/bind is
    // pattern territory (`Tok a == Tok b = ...`), while do-bind RHS is a
    // direct child at index >= 1 — expression, stays emitting. Node IDs are
    // compared (web-tree-sitter hands out fresh wrappers per access).
    if (cur.type === "alternative") return true
    if (cur.type === "pattern_guard") {
      if (prev.id === cur.namedChild(0)?.id) return true
    } else if (cur.type === "match" || cur.type === "do" || cur.type === "class" || cur.type === "instance") {
      return false
    } else if (cur.type === "function" || cur.type === "bind") {
      // HSD19 mirror: the child-0 head SLOT of function/bind is pattern
      // territory (infix definitions, constructor/tuple patterns); match and
      // patterns children are expression territory; do-bind RHS (index >= 1)
      // stays emitting.
      if (prev.type === "match" || prev.type === "patterns") return false
      if (prev.id === cur.namedChild(0)?.id) return true
      return false
    }
    prev = cur
    cur = cur.parent
  }
  return false
}


// Elixir calls/instantiates/implements/references oracle (#274 F5).
// Independently derived from the pinned grammar + the analyzer's declared
// contract (script/m14/spec/elixir-completeness.json EX-D1..D6): the same
// rulings, a separate implementation, so disagreements surface as
// missing/unexplained rather than being copied. The lane comparison is
// site-agnostic (label + last-segment target), so `from` is attribution only.
// Two passes like the analyzer: pass 1 collects per-module declaration sets
// (forward references resolve), aliases, and the scope-free edges
// (references/implements); pass 2 emits calls/instantiates with the same
// resolution rule (unqualified calls keep only when declared in the enclosing
// module — or unconditionally at top level, where there is no scope).
export function deriveElixirEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, from: string, target: string) => {
    if (!from || !target) return
    if (label !== "calls" && from === target) return
    const k = `${label}|${from}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label, from, target })
  }
  // Language facts: call-shaped syntax that is never a runtime invocation
  // (Elixir special forms), and the always-available Kernel builtins whose
  // call edges would be pure graph noise (FP-family precedent). The Kernel
  // set is the full call-shaped auto-import surface (ELXD16 mirror — must
  // stay identical to the analyzer's KERNEL_FUNCTIONS or top-level phantoms
  // like `calls Global->match?` surface as MISSING).
  const SPECIAL = new Set(["if", "unless", "case", "cond", "receive", "for", "with", "try", "rescue", "catch", "after", "else", "quote", "unquote", "super", "raise", "throw", "exit", "fn", "do", "match"])
  const KERNEL = new Set(["length", "hd", "tl", "elem", "put_elem", "map_size", "tuple_size", "byte_size", "bit_size", "div", "rem", "abs", "round", "trunc", "ceil", "floor", "min", "max", "is_atom", "is_binary", "is_bitstring", "is_boolean", "is_float", "is_function", "is_integer", "is_list", "is_map", "is_map_key", "is_number", "is_pid", "is_port", "is_reference", "is_tuple", "is_nil", "is_struct", "is_exception", "map_get", "to_string", "inspect", "apply", "self", "send", "send_after", "spawn", "spawn_link", "spawn_monitor", "make_ref", "node", "put_in", "get_in", "update_in", "get_and_update_in", "pop_in", "struct", "struct!", "binary_part", "binding", "tap", "then", "dbg", "tuple_to_list", "list_to_tuple", "atom_to_binary", "binary_to_atom", "term_to_binary", "binary_to_term", "process_flag", "sleep", "yield", "match?", "function_exported?", "macro_exported?", "reraise"])
  const DEFS = new Set(["def", "defp", "defmacro", "defmacrop", "defdelegate", "defguard", "defguardp"])
  const DIRECTIVES = new Set(["use", "import", "alias", "require"])
  const DECL_KW = new Set(["defmodule", "defprotocol", "defimpl", "defstruct", "defexception", "case", "cond", "receive", "match"])

  const kids = (n: any): any[] => {
    const r: any[] = []
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) { const c = n.namedChild(i); if (c) r.push(c) }
    return r
  }
  const find = (n: any, pred: (c: any) => boolean): any => {
    for (const c of kids(n)) if (pred(c)) return c
    return undefined
  }
  const callTarget = (call: any): string => find(call, (c) => c.type === "identifier" || c.type === "dot")?.text ?? ""
  const isQuoted = (n: any): boolean => {
    let cur = n.parent
    while (cur) {
      if (cur.type === "call") {
        const idText = find(cur, (c: any) => c.type === "identifier")?.text
        if (idText === "quote") return true
        // X7 mirror: unquote arguments execute at expansion time — the
        // nearest boundary wins over the enclosing quote (see the analyzer).
        if (idText === "unquote" || idText === "unquote_splicing") return false
      }
      cur = cur.parent
    }
    return false
  }
  const isAttr = (n: any): boolean => {
    let cur = n.parent
    while (cur) {
      if (cur.type === "unary_operator" && cur.childCount > 0 && cur.child(0)?.text === "@") return true
      cur = cur.parent
    }
    return false
  }
  const isHead = (n: any): boolean => {
    let cur = n.parent
    while (cur) {
      if (cur.type === "do_block") return false
      if (cur.type === "pair") {
        const kwt = find(cur, (c) => c.type === "keyword")?.text ?? ""
        if (kwt === "do" || kwt.startsWith("do:")) return false
      }
      // EX2-U6 mirror (CLJ1 session): a default-value expression
      // (`x \\ g()`) EXECUTES at call time — the head walk stops at the
      // right-hand side of a `\\` operator so the call inside it is never
      // swallowed as a declaration head (the analyzer's isDefHead escape).
      if (cur.type === "binary_operator" && cur.childCount > 2 && cur.child(1)?.text === "\\\\") {
        const rhs = cur.child(2)
        if (rhs && n.startIndex >= rhs.startIndex) return false
      }
      if (cur.type === "call" && DEFS.has(find(cur, (c) => c.type === "identifier")?.text ?? "")) return true
      cur = cur.parent
    }
    return false
  }
  const stripQuotes = (s: string): string => {
    let out = ""
    for (let i = 0; i < s.length; i++) { const ch = s[i]; if (ch === "\"" || ch === "'") continue; out += ch }
    return out
  }
  const stripAfterColon = (s: string): string => {
    const c = s.indexOf(":")
    return (c >= 0 ? s.slice(0, c) : s).trim()
  }
  // Analyzer extractName mirror: alias text, else the first alias/identifier/
  // dot child, else the paren-stripped source text.
  const modName = (args: any): string => {
    const a = find(args, (c) => c.type === "alias")
    if (a) return a.text
    if (args.namedChildCount > 0) {
      const f = args.namedChild(0)
      if (f?.type === "alias" || f?.type === "identifier" || f?.type === "dot") return f.text
    }
    let out = ""
    for (const ch of args.text) { if (ch === "(" || ch === ")") continue; out += ch }
    return out.trim()
  }
  // Analyzer processFunction name mirror: arguments unwrap, when-guard left
  // side, inner identifier of a signature call, bare identifier, or the
  // operator of a binary_operator head.
  const declName = (defCall: any): string => {
    const sigs = kids(defCall).filter((c) => c.type !== "identifier" && c.type !== "do_block")
    if (sigs.length === 0) return ""
    let sig: any = sigs[0]
    if (sig && sig.type === "arguments" && sig.namedChildCount > 0) sig = sig.namedChild(0)
    if (!sig) return ""
    let actual: any = sig
    if (sig.type === "binary_operator" && sig.childCount > 1 && sig.child(1)?.text === "when") {
      actual = sig.childCount > 0 ? sig.child(0) : undefined
    }
    if (!actual) return ""
    if (actual.type === "call") return find(actual, (c) => c.type === "identifier")?.text ?? ""
    if (actual.type === "identifier") return actual.text
    if (actual.type === "binary_operator") return actual.childCount > 1 ? actual.child(1)?.text ?? "" : ""
    if (actual.type === "unary_operator") {
      // ELXD24 mirror: the name is the anonymous operator token.
      for (let i = 0; i < actual.childCount; i++) {
        const c = actual.child(i)
        if (c && !c.isNamed) return c.text
      }
      return ""
    }
    return ""
  }
  interface Scope { node: any; name: string; kind: string }
  const declaredByScope = new Map<string, Set<string>>()
  // W23-E1 mirror: alias scoping is LEXICAL on both sides. The old flat Map
  // leaked a module's explicit aliases to later siblings (Leak.After) and a
  // nested module's implied alias to the file root (Nest.After). Each scope
  // frame now owns a Map; lookups fall through enclosing frames to a root
  // (the Map analog of the analyzer's Object.create(parent) chain).
  const aliasesRoot = new Map<string, string>()
  const aliasFrames: Map<string, string>[] = []
  const aliasFrameOf = new Map<number, Map<string, string>>()
  const aliasLookup = (k: string): string | undefined => {
    for (let i = aliasFrames.length - 1; i >= 0; i--) {
      const m = aliasFrames[i]!
      if (m.has(k)) return m.get(k)
    }
    return aliasesRoot.get(k)
  }
  const aliasSetCurrent = (k: string, v: string): void => {
    const m = aliasFrames.length > 0 ? aliasFrames[aliasFrames.length - 1]! : aliasesRoot
    m.set(k, v)
  }
  // ELXD17 mirror: ordered :only-constrained imports per scope.
  // (Keyword-colon stripping reuses the module-level stripAfterColon.)
  const importList: { module: string; only?: Set<string>; scope: string }[] = []
  const decl = (scope: string, name: string) => {
    if (!name) return
    let s = declaredByScope.get(scope)
    if (!s) { s = new Set(); declaredByScope.set(scope, s) }
    s.add(name)
  }
  // X3 mirror: the analyzer resolves every NAMED type/behaviour/protocol/
  // module through its alias table; this oracle emitted raw `.text` on those
  // paths, so `Phx.New.Project` vs `Project` agreed only because the lane
  // comparison normalizes to the last segment (19 masked pairs measured).
  const resolveAliasO = (name: string): string => {
    if (!name) return name
    const parts = name.split(".")
    const root = parts[0] ?? ""
    const hit = root ? aliasLookup(root) : undefined
    if (hit) {
      parts[0] = hit
      return parts.join(".")
    }
    return name
  }
  // X2 mirror: pattern positions are never constructions — a stab_clause's
  // pre-arrow part, or the left of `=`/`<-` (see the analyzer).
  const isPattern = (n: any): boolean => {
    let cur: any = n
    while (cur && cur.parent) {
      const p = cur.parent
      if (p.type === "stab_clause") {
        // The `->` arrow is an ANONYMOUS node — `find` searches named
        // children only, so scan raw children (the named-only lookup made
        // every clause pattern look like a body: 14 corpus instantiates
        // diverged until this was measured).
        let arrow: any = null
        for (let i = 0; i < p.childCount; i++) { const c = p.child(i); if (c && c.type === "->") { arrow = c; break } }
        return arrow ? n.startIndex < arrow.startIndex : false
      }
      if (p.type === "binary_operator" && (p.child(1)?.text === "=" || p.child(1)?.text === "<-")) {
        const left = p.child(0)
        return !!(left && n.startIndex >= left.startIndex && n.endIndex <= left.endIndex)
      }
      cur = p
    }
    return false
  }
  const ownerOf = (stack: Scope[]): string => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const k = stack[i].kind
      if (k !== "function" && k !== "macro" && k !== "method") return stack[i].name
    }
    return ""
  }
  const innerOf = (stack: Scope[]): string => stack.length > 0 ? stack[stack.length - 1].name : "Global"

  // ---- Pass 1: declarations, aliases, references, implements ----
  {
    const stack: Scope[] = []
    const work: { n: any; exit?: boolean }[] = [{ n: root }]
    while (work.length > 0) {
      const { n, exit } = work.pop()!
      if (exit) {
        if (stack.length > 0 && stack[stack.length - 1].node === n) {
          const sc: any = stack.pop()!
          // W23-E1 mirror: pop the frame's alias map FIRST — the implied
          // registration below must land in the ENCLOSING frame only.
          if (sc.afm) aliasFrames.pop()
          // EX-L5 mirror (CLJ1-session correction): the implied last-segment
          // alias goes live in the ENCLOSING scope when the definition
          // CLOSES — never inside the module's own body (`use Supervisor`
          // in Task.Supervisor/Registry.Supervisor is the external one; the
          // analyzer was corrected to the same timing).
          if ((sc.kind === "module" || sc.kind === "interface") && sc.name) {
            const implied = String(sc.name).split(".").pop()
            if (implied && !aliasLookup(implied)) aliasSetCurrent(implied, String(sc.name))
          }
        }
        continue
      }
      const t = n.type
      let pushed = false
      if (t === "call" && !isQuoted(n)) {
        const target = callTarget(n)
        if ((target === "defmodule" || target === "defprotocol") && !isHead(n) && !isAttr(n)) {
          const args = find(n, (c) => c.type !== "identifier" && c.type !== "do_block")
          if (args) {
            const nm = modName(args)
            if (nm) {
              const full = stack.length > 0 ? `${stack[stack.length - 1].name}.${nm}` : nm
              const mfr = new Map<string, string>()
              stack.push({ node: n, name: full, kind: target === "defmodule" ? "module" : "interface", afm: mfr })
              aliasFrameOf.set(n.startIndex, mfr)
              aliasFrames.push(mfr)
              pushed = true
            }
          }
        } else if (target === "defimpl" && !isHead(n) && !isAttr(n)) {
          const args = find(n, (c: any) => c.type !== "identifier" && c.type !== "do_block")
          if (args) {
            const als = kids(args).filter((c: any) => c.type === "alias")
            const protocol = als.length > 0 && als[0] ? resolveAliasO(als[0].text) : "Unknown"
            let forType = "Unknown"
            // W23 mirror (fixture defimpl-target-forms): a multi-type
            // `for: [A, B]` is one Implements truth per element — the raw
            // list text is never a target.
            const forTypeList: string[] = []
            const kw = find(args, (c: any) => c.type === "keywords")
            if (kw) {
              for (let i = 0; i < kw.namedChildCount; i++) {
                const pair = kw.namedChild(i)
                if (!pair || pair.type !== "pair") continue
                const kwn = find(pair, (c: any) => c.type === "keyword")
                if (kwn && stripAfterColon(kwn.text) === "for" && pair.namedChildCount > 1) {
                  const v = pair.namedChild(1)
                  if (!v) continue
                  if (v.type === "list") {
                    for (const el of kids(v)) if (el.type === "alias") forTypeList.push(resolveAliasO(el.text))
                    forType = forTypeList.length > 0 ? forTypeList[0] : "Unknown"
                  } else forType = resolveAliasO(v.text)
                }
              }
            }
            const forAlias = als.length > 1 ? resolveAliasO(als[1].text) : forType
            // ELXD6/ELXD7 mirror: for-less nested defimpl targets the
            // enclosing scope; defmacro heads are not implementations.
            const implName = forAlias && forAlias !== "Unknown" ? forAlias : (stack.length > 0 ? stack[stack.length - 1].name : protocol)
            if (forTypeList.length > 0) {
              for (const t of forTypeList) if (t && t !== "Unknown" && t !== protocol) push("implements", t, protocol)
            } else if (implName !== protocol) push("implements", implName, protocol)
            const implMfr = new Map<string, string>()
            stack.push({ node: n, name: implName, kind: "class", afm: implMfr })
            aliasFrameOf.set(n.startIndex, implMfr)
            aliasFrames.push(implMfr)
            pushed = true
          }
        } else if (DEFS.has(target) && !isHead(n) && !isAttr(n)) {
          const nm = declName(n)
          if (nm) {
            decl(ownerOf(stack), nm)
            const fnMfr = new Map<string, string>()
            stack.push({ node: n, name: nm, kind: (target === "defmacro" || target === "defmacrop" || target === "defguard" || target === "defguardp") ? "macro" : "function", afm: fnMfr })
            aliasFrameOf.set(n.startIndex, fnMfr)
            aliasFrames.push(fnMfr)
            pushed = true
          }
        } else if (DIRECTIVES.has(target)) {
          const args = find(n, (c) => c.type !== "identifier")
          if (args) {
            const rawModuleName = modName(args)
            // ELXD21 mirror: __MODULE__ resolves against the enclosing
            // module scope (never a function scope).
            let modScopeO = ""
            for (let i = stack.length - 1; i >= 0; i--) {
              if (stack[i].kind === "module" || stack[i].kind === "interface") { modScopeO = stack[i].name; break }
            }
            const resolveSelfO = (name: string): string => {
              if (!name.startsWith("__MODULE__") || !modScopeO) return name
              return modScopeO + name.slice("__MODULE__".length)
            }
            // X3 mirror: aliases resolve on directive module names too.
            const moduleName = resolveAliasO(resolveSelfO(rawModuleName))
            // Dependency targets: exactly one module, except multi-alias
            // (`alias Foo.{Bar, Baz}`) which expands per member (ELXD20).
            let depModules: string[] = [moduleName]
            if (target === "alias") {
              const multiDot = find(args, (c) => c.type === "dot" && !!find(c, (d) => d.type === "tuple"))
              const tuple = multiDot ? find(multiDot, (c) => c.type === "tuple") : undefined
              if (tuple) {
                depModules = []
                const rawPrefix = find(multiDot, (c: any) => c.type === "alias")?.text
                  ?? find(multiDot, (c: any) => c.type === "identifier" && c.text === "__MODULE__")?.text ?? ""
                const prefix = resolveAliasO(resolveSelfO(rawPrefix))
                for (let i = 0; i < tuple.namedChildCount; i++) {
                  const kid = tuple.namedChild(i)
                  if (!kid || (kid.type !== "alias" && kid.type !== "dot")) continue
                  const full = prefix ? `${prefix}.${kid.text}` : kid.text
                  const key = kid.text.split(".").pop()
                  if (key && full) {
                    aliasSetCurrent(key, full)
                    depModules.push(full)
                  }
                }
              } else {
                let asName: string | null = null
                const kwn = find(args, (c) => c.type === "keywords")
                if (kwn) {
                  for (let i = 0; i < kwn.namedChildCount; i++) {
                    const pair = kwn.namedChild(i)
                    if (!pair || pair.type !== "pair") continue
                    const kk = find(pair, (c) => c.type === "keyword")
                    if (kk && stripAfterColon(kk.text) === "as" && pair.namedChildCount > 1) {
                      const v = pair.namedChild(1)
                      if (v) asName = v.text
                    }
                  }
                }
                const parts = moduleName.split(".")
                const key = asName ?? parts[parts.length - 1]
                if (key) aliasSetCurrent(key, moduleName)
              }
            }
            if (target === "import" && moduleName) {
              // ELXD17 mirror: :only name sets for call resolution.
              let only: Set<string> | undefined
              const kwn = find(args, (c) => c.type === "keywords")
              if (kwn) {
                for (let i = 0; i < kwn.namedChildCount; i++) {
                  const pair = kwn.namedChild(i)
                  if (!pair || pair.type !== "pair") continue
                  const kk = find(pair, (c) => c.type === "keyword")
                  if (!kk || stripAfterColon(kk.text) !== "only" || pair.namedChildCount < 2) continue
                  const val = pair.namedChild(1)
                  if (val?.type !== "list") continue
                  const names = new Set<string>()
                  for (let a = 0; a < val.namedChildCount; a++) {
                    const grp = val.namedChild(a)
                    if (!grp || grp.type !== "keywords") continue
                    for (let j = 0; j < grp.namedChildCount; j++) {
                      const fp = grp.namedChild(j)
                      if (!fp || fp.type !== "pair") continue
                      const fk = find(fp, (c) => c.type === "keyword")
                      if (fk?.text) names.add(stripAfterColon(fk.text))
                    }
                  }
                  if (names.size > 0) only = names
                }
              }
              importList.push({ module: moduleName, only, scope: stack.length > 0 ? stack[stack.length - 1].name : "" })
            }
            for (const dep of depModules) {
              if (!dep) continue
              // ELXD8 mirror: self-directives are lexical no-ops as
              // dependencies — never a self-loop edge (alias map stands).
              const owner = stack.length > 0 ? stack[stack.length - 1].name : ""
              if (dep !== owner) push("references", owner || "Global", dep)
            }
          }
        }
      } else if (t === "unary_operator" && n.childCount > 0 && n.child(0)?.text === "@" && !isQuoted(n)) {
        // X1 mirror: quoted attributes are data (the analyzer's guard —
        // previously BOTH sides leaked `@behaviour`/`@type` out of quote
        // blocks; the analyzer was fixed first, the oracle now follows).
        const attrCall = n.child(1)
        const attrTarget = attrCall?.type === "call" ? callTarget(attrCall) : ""
        if (attrTarget === "behaviour" || attrTarget === "behavior") {
          const args = find(attrCall, (c: any) => c.type === "arguments")
          const first = args && args.namedChildCount > 0 ? args.namedChild(0) : undefined
          let bhvRaw = first ? stripQuotes(first.text).trim() : ""
          // W23 mirror (fixture behaviour-atom): the atom form's leading
          // colon is syntax, not part of the behaviour's identity.
          if (bhvRaw.startsWith(":")) bhvRaw = bhvRaw.slice(1)
          const bhv = bhvRaw ? resolveAliasO(bhvRaw) : ""
          if (bhv) push("implements", stack.length > 0 ? innerOf(stack) : "Global", bhv)
        }
        if (attrTarget === "derive") {
          // ELXD11 + X10 mirror: alias / tuple / list-of-(alias|tuple)
          // forms; aliases resolve like the analyzer's, and the analyzer
          // requires an enclosing scope (top-level @derive emits nothing).
          const args = find(attrCall, (c: any) => c.type === "arguments")
          const first = args && args.namedChildCount > 0 ? args.namedChild(0) : undefined
          const protos: string[] = []
          if (first?.type === "alias") protos.push(first.text)
          else if (first?.type === "tuple") { const a = find(first, (c: any) => c.type === "alias"); if (a) protos.push(a.text) }
          else if (first?.type === "list") {
            for (let li = 0; li < first.namedChildCount; li++) {
              const el = first.namedChild(li)
              if (!el) continue
              if (el.type === "alias") protos.push(el.text)
              else if (el.type === "tuple") { const a = find(el, (c: any) => c.type === "alias"); if (a) protos.push(a.text) }
            }
          }
          for (const proto of protos) if (proto && stack.length > 0) push("implements", innerOf(stack), resolveAliasO(proto))
        }
      }
      if (pushed) work.push({ n, exit: true })
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) work.push({ n: c }) }
    }
  }

  // ---- Pass 2: calls + instantiates ----
  const skipCall = (node: any, target: string): boolean => {
    if (SPECIAL.has(target)) return true
    if (KERNEL.has(target)) return true
    if (isQuoted(node)) return true
    if (isAttr(node)) return true
    if (isHead(node)) return true
    // ELXD18 mirror: only a lowercase-rooted dot without arguments is a
    // field read / dynamic dispatch — capitalized (or atom/sigil) roots
    // name real remote references and emit.
    const tgt = find(node, (c) => c.type === "identifier" || c.type === "dot")
    if (tgt?.type === "dot" && !find(node, (c) => c.type === "arguments")) {
      const r = (tgt.text.split(".")[0] ?? "")
      if (r.length > 0 && r[0] >= "a" && r[0] <= "z") return true
    }
    return false
  }
  const emitCall = (node: any, rawTarget: string, stack: Scope[]) => {
    if (!rawTarget) return
    let finalTarget = rawTarget
    // X4 mirror: a chained receiver call (`Mix.shell().error`) names the
    // METHOD leaf — never call syntax (see the analyzer).
    if (finalTarget.indexOf("(") !== -1) {
      const lastDot = finalTarget.lastIndexOf(".")
      finalTarget = lastDot >= 0 ? finalTarget.slice(lastDot + 1) : finalTarget
      const paren = finalTarget.indexOf("(")
      if (paren !== -1) finalTarget = finalTarget.slice(0, paren)
      if (finalTarget) push("calls", stack.length === 0 ? "Global" : innerOf(stack), finalTarget)
      return
    }
    // X5 mirror: `__MODULE__.fun` resolves to the enclosing module scope.
    if (finalTarget.startsWith("__MODULE__.")) {
      let modScope = ""
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].kind === "module" || stack[i].kind === "interface") { modScope = stack[i].name; break }
      }
      if (!modScope) return
      finalTarget = modScope + finalTarget.slice("__MODULE__".length)
    }
    // X9 mirror: qualified Kernel builtins are the same noise as bare ones.
    if (finalTarget.startsWith("Kernel.")) {
      const leaf = finalTarget.slice("Kernel.".length)
      if (KERNEL.has(leaf) || SPECIAL.has(leaf)) return
    }
    const parts = finalTarget.split(".")
    if (parts.length > 1) {
      const hit = aliasLookup(parts[0] ?? "")
      if (hit) {
        parts[0] = hit
        finalTarget = parts.join(".")
      }
    }
    if (!finalTarget) return
    if (finalTarget.indexOf(".") !== -1) {
      const r = finalTarget.split(".")[0]
      if (!r || r[0] !== r[0].toUpperCase()) return
    } else {
      const enclosing = ownerOf(stack)
      if (enclosing && !(declaredByScope.get(enclosing)?.has(finalTarget))) {
        // ELXD17 mirror: :only-import fallback, last import wins. Bare and
        // :except imports cannot confirm a target — those stay dropped.
        let resolved: string | undefined
        for (let i = importList.length - 1; i >= 0; i--) {
          const imp = importList[i]
          if (imp.scope !== enclosing) continue
          if (imp.only && imp.only.has(finalTarget)) { resolved = `${imp.module}.${finalTarget}`; break }
        }
        if (!resolved) return
        finalTarget = resolved
      }
    }
    push("calls", innerOf(stack) === "Global" && stack.length === 0 ? "Global" : innerOf(stack), finalTarget)
  }
  {
    const stack: Scope[] = []
    const work: { n: any; exit?: boolean }[] = [{ n: root }]
    while (work.length > 0) {
      const { n, exit } = work.pop()!
      if (exit) {
        if (stack.length > 0 && stack[stack.length - 1].node === n) {
          const sc: any = stack.pop()!
          // W23-E1 mirror: leave the frame's alias map; the implied alias
          // hidden at entry (if any) goes back into the map that held it.
          if (sc.afm) aliasFrames.pop()
          if (sc.hiddenImplied && sc.hiddenIn) sc.hiddenIn.set(sc.hiddenImplied, sc.name)
        }
        continue
      }
      const t = n.type
      let pushed = false
      if (t === "call" && !isQuoted(n)) {
        const target = callTarget(n)
        if ((target === "defmodule" || target === "defprotocol") && !isHead(n) && !isAttr(n)) {
          const args = find(n, (c) => c.type !== "identifier" && c.type !== "do_block")
          const nm = args ? modName(args) : ""
          if (nm) {
            const full = stack.length > 0 ? `${stack[stack.length - 1].name}.${nm}` : nm
            // EX-L5 mirror (CLJ1 session): the module's OWN implied alias
            // must be hidden while walking its body (pass 1 registered it at
            // scope EXIT; pass 2 walks in source order), or body-time
            // references resolve to the module itself (`use Supervisor`
            // inside Registry.Supervisor). W23-E1: with scoped frames the
            // pair may live in the root OR any enclosing frame map — find
            // the map that holds exactly (impliedKey -> full) and hide
            // there; restore at close. Search BEFORE entering this frame's
            // own map so body directives are never false-hidden.
            const impliedKey = String(full).split(".").pop() ?? ""
            let hiddenIn: Map<string, string> | null = null
            if (impliedKey && aliasLookup(impliedKey) === full) {
              for (let i = aliasFrames.length - 1; i >= 0; i--) {
                const m = aliasFrames[i]!
                if (m.get(impliedKey) === full) { hiddenIn = m; m.delete(impliedKey); break }
              }
              if (!hiddenIn && aliasesRoot.get(impliedKey) === full) { hiddenIn = aliasesRoot; aliasesRoot.delete(impliedKey) }
            }
            const frame: any = { node: n, name: full, kind: target === "defmodule" ? "module" : "interface" }
            const p2m = aliasFrameOf.get(n.startIndex)
            if (p2m) { frame.afm = p2m; aliasFrames.push(p2m) }
            if (hiddenIn) { frame.hiddenImplied = impliedKey; frame.hiddenIn = hiddenIn }
            stack.push(frame)
            pushed = true
          }
        } else if (target === "defimpl" && !isHead(n) && !isAttr(n)) {
          const args = find(n, (c) => c.type !== "identifier" && c.type !== "do_block")
          if (args) {
            const als = kids(args).filter((c: any) => c.type === "alias")
            const protocol = als.length > 0 && als[0] ? resolveAliasO(als[0].text) : "Unknown"
            let forType = "Unknown"
            const kw = find(args, (c: any) => c.type === "keywords")
            if (kw) {
              for (let i = 0; i < kw.namedChildCount; i++) {
                const pair = kw.namedChild(i)
                if (!pair || pair.type !== "pair") continue
                const kwn = find(pair, (c: any) => c.type === "keyword")
                if (kwn && stripAfterColon(kwn.text) === "for" && pair.namedChildCount > 1) {
                  const v = pair.namedChild(1)
                  if (v) forType = resolveAliasO(v.text)
                }
              }
            }
            const forAlias = als.length > 1 ? resolveAliasO(als[1].text) : forType
            // ELXD6/ELXD7 mirror (scope naming must match pass 1 exactly —
            // resolution sets diverge otherwise).
            const implName = forAlias && forAlias !== "Unknown" ? forAlias : (stack.length > 0 ? stack[stack.length - 1].name : protocol)
            const implP2 = aliasFrameOf.get(n.startIndex)
            stack.push({ node: n, name: implName, kind: "class", afm: implP2 })
            if (implP2) aliasFrames.push(implP2)
            pushed = true
          }
        } else if (DEFS.has(target) && !isHead(n) && !isAttr(n)) {
          const nm = declName(n)
          if (nm) {
            const fnP2 = aliasFrameOf.get(n.startIndex)
            stack.push({ node: n, name: nm, kind: (target === "defmacro" || target === "defmacrop" || target === "defguard" || target === "defguardp") ? "macro" : "function", afm: fnP2 })
            if (fnP2) aliasFrames.push(fnP2)
            pushed = true
            if (target === "defdelegate") {
              // X8 mirror: the delegation to `to:` (as: renames the target
              // segment) is a real call from the declared function.
              let toMod = ""
              let asName = ""
              const dscan: any[] = [n]
              while (dscan.length > 0) {
                const x = dscan.pop()!
                if (x.type === "pair") {
                  const k = find(x, (c: any) => c.type === "keyword")
                  const kt = k ? stripAfterColon(k.text) : ""
                  if (kt === "to" && x.namedChildCount > 1) {
                    const v = x.namedChild(1)
                    if (v?.type === "alias") toMod = v.text
                  } else if (kt === "as" && x.namedChildCount > 1) {
                    const v = x.namedChild(1)
                    if (v?.type === "atom") asName = v.text.startsWith(":") ? v.text.slice(1) : v.text
                  }
                  continue
                }
                if (x !== n && (x.type === "do_block" || x.type === "anonymous_function")) continue
                for (let i = x.namedChildCount - 1; i >= 0; i--) { const c = x.namedChild(i); if (c) dscan.push(c) }
              }
              if (toMod) push("calls", innerOf(stack), `${resolveAliasO(toMod)}.${asName || nm}`)
            }
          }
        } else if ((target === "struct" || target === "struct!") && !isAttr(n) && !isHead(n)) {
          // ELXD19 mirror: struct(User, attrs) constructs the named type;
          // dynamic first args stay silent. (Quote already excluded above.)
          const structArgs = find(n, (c: any) => c.type === "arguments")
          const first = structArgs && structArgs.namedChildCount > 0 ? structArgs.namedChild(0) : undefined
          if (first?.type === "alias") push("instantiates", stack.length > 0 ? innerOf(stack) : "Global", resolveAliasO(first.text))
          else if (first?.type === "identifier" && first.text === "__MODULE__") {
            let modScope = ""
            for (let i = stack.length - 1; i >= 0; i--) {
              if (stack[i].kind === "module" || stack[i].kind === "interface") { modScope = stack[i].name; break }
            }
            if (modScope) push("instantiates", stack.length > 0 ? innerOf(stack) : "Global", modScope)
          }
        } else if (target && !DECL_KW.has(target) && !DIRECTIVES.has(target) && !DEFS.has(target)) {
          if (!skipCall(n, target)) emitCall(n, target, stack)
        }
      } else if (t === "unary_operator" && n.childCount > 0 && n.child(0)?.text === "&") {
        // EX-L7 mirror (CLJ1 session): `&name/arity` captures a NAMED
        // function — a real reference (previously the oracle derived no
        // capture edges; 7 corpus sites surfaced as UNEXPLAINED on the
        // elixir lane). `&(&1 + 1)` has a non-`/` operator inside and stays
        // silent; skipCall mirrors the analyzer's full guard set.
        const inner = n.child(1)
        if (inner?.type === "binary_operator" && inner.childCount > 2 && inner.child(1)?.text === "/") {
          const fnNode = inner.child(0)
          let fnName = ""
          if (fnNode?.type === "identifier") fnName = fnNode.text
          else if (fnNode?.type === "call" && !find(fnNode, (c: any) => c.type === "arguments")) {
            const tgt = find(fnNode, (c: any) => c.type === "identifier" || c.type === "dot")
            if (tgt) fnName = tgt.text
          }
          const leaf = fnName.split(".").pop() ?? fnName
          // Qualified captures are remote references with leaf collisions
          // (`&String.length/1`) — only unqualified captures consult the
          // Kernel set (analyzer mirror).
          const skipName = fnName.includes(".") ? fnName : leaf
          if (fnName && !skipCall(n, skipName)) emitCall(n, fnName, stack)
        }
      } else if (t === "map" && !isQuoted(n) && !isAttr(n) && !isHead(n) && !isPattern(n)) {
        const st = find(n, (c: any) => c.type === "struct")
        const al = st ? find(st, (c: any) => c.type === "alias") : undefined
        if (al?.text) push("instantiates", stack.length > 0 ? innerOf(stack) : "Global", resolveAliasO(al.text))
        else {
          // ELXD12 mirror: %__MODULE__{} resolves to the nearest
          // module/interface scope; with no such scope it stays silent.
          const self = st ? find(st, (c) => c.type === "identifier" && c.text === "__MODULE__") : undefined
          if (self) {
            let modScope = ""
            for (let i = stack.length - 1; i >= 0; i--) {
              if (stack[i].kind === "module" || stack[i].kind === "interface") { modScope = stack[i].name; break }
            }
            if (modScope) push("instantiates", stack.length > 0 ? innerOf(stack) : "Global", modScope)
          }
        }
      } else if (t === "binary_operator" && n.childCount > 1 && n.child(1)?.text === "|>") {
        const right = n.childCount > 2 ? n.child(2) : undefined
        if (right) {
          let pipeTarget = ""
          if (right.type === "call") pipeTarget = callTarget(right)
          else if (right.type === "identifier" || right.type === "dot") pipeTarget = right.text
          if (pipeTarget && !skipCall(right, pipeTarget)) emitCall(right, pipeTarget, stack)
        }
      }
      if (pushed) work.push({ n, exit: true })
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) work.push({ n: c }) }
    }
  }
  return edges
}

// Erlang oracle (ER wave, M14 #275 F5 + #880 obligation 4): mirrors
// real-erlang-analyzer.ts edge-for-edge on the compared kinds — calls,
// implements, instantiates. Mirrored decisions, not approximations:
//   - a local call fires only when the callee is DECLARED in the file (the
//     analyzer's forward-reference prepass) AND the file carries -module
//     (the analyzer's ctx.currentModule gate; a module-less file emits no
//     local calls on either side);
//   - remote call targets keep their module qualification `mod:fun` (ER-D1:
//     the separator is semantic — a bare leaf would conflate every module's
//     reply; pinned by mutant erlang/remote-target-unqualified);
//   - -behaviour(b) emits implements -> b, never a symbol;
//   - record construction (record_expr outside a clause head) emits
//     instantiates -> record name; head-position record_expr is a pattern;
//   - spawn/spawn_link/spawn_monitor are BIFs — pattern flags, never edges
//     (and a file that declares its own spawn/1 emits calls on both sides).
// Call-site arity (ER-D2) is metadata on the analyzer side and rides the
// (label, target) comparison identically — f/1 and f/2 sites collapse to one
// compared edge per side, so the lane stays apples-to-apples.
/**
 * M14.6 perl: the tree-truth oracle for the Perl lane.
 *
 * Written from the PINNED tree-sitter-perl grammar's tree shapes (probed with
 * script/m14/tmp/perl-*.mts) and mirroring the analyzer's RULES, not its code:
 * the traversal here is independent, the two facts it must agree with the
 * analyzer on are the ones the differential is supposed to audit — which
 * constructs produce an edge, and what the edge is LABELLED and NAMED.
 *
 * Grammar facts this oracle encodes (each measured, not assumed):
 *  - `package`/`class`/`role` BLOCK forms do not leak the package past the
 *    closing brace; the STATEMENT form `package N;` does. The walk therefore
 *    keeps the lexical package in mutable state and only assigns it for the
 *    statement form — the same rule perl itself applies (proved by executing
 *    perl 5.34 and reading __PACKAGE__).
 *  - `variable_declaration`'s scope (`our`/`my`/`state`/`field`) is an UNNAMED
 *    child token, so the scope scan walks the RAW child list.
 *  - `left`/`right`/`arguments`/`invocant` are MULTI-CHILD fields: a
 *    parenthesised side shares the field across `(`, payload and `)`, so
 *    `childForFieldName` returns the empty bracket marker. Both sides collect
 *    every child carrying the field.
 *  - `no` is an unnamed first token of the same node type as `use`; a `no`
 *    pragma DISABLES a feature and is never a dependency.
 *  - `use constant` declares names (fat-comma keys) and is not an import.
 *  - a bare `sub f` signature lives in the `signature` FIELD
 *    (mandatory/optional/slurpy_parameter), never in a `parameters` field —
 *    the pinned grammar declares no such field.
 */
export function derivePerlEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, from: string, target: string) => {
    if (!from || !target) return
    const k = `${label}|${from}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label, from, target })
  }
  const leaf = (name: string): string => {
    const c = name.lastIndexOf("::")
    return c >= 0 ? name.slice(c + 2) : name
  }
  const kids = (n: any): any[] => {
    const r: any[] = []
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) { const c = n.namedChild(i); if (c) r.push(c) }
    return r
  }
  const byType = (n: any, t: string): any => kids(n).find((c) => c.type === t)
  /** EVERY child carrying `f` as its field (multi-child fields, see above). */
  const fieldAll = (n: any, f: string): any[] => {
    const r: any[] = []
    for (let i = 0; i < (n.childCount ?? 0); i++) { const c = n.child(i); if (c && n.fieldNameForChild(i) === f) r.push(c) }
    return r
  }
  const scopeOf = (n: any): string => {
    for (let i = 0; i < (n.childCount ?? 0); i++) {
      const c = n.child(i)
      if (c && (c.type === "our" || c.type === "my" || c.type === "state" || c.type === "field")) return c.type
    }
    return "unknown"
  }
  const variablesOf = (n: any): any[] =>
    [...fieldAll(n, "variable"), ...fieldAll(n, "variables")].filter((c) => c.type === "scalar" || c.type === "array" || c.type === "hash")
  // Words and arguments are read with the ANALYZER'S OWN exported rules, not a
  // second copy: the two copies disagreed on the non-parenthesised
  // `use Module 'Name'` form (whose payload carries no field under 1.2.1), and
  // that divergence - not a defect in either side - was 47 of mojo's
  // unexplained rows. See perlArgumentNodes's own comment.
  const words = (n: any, out: string[] = []): string[] => {
    if (!n) return out
    out.push(...perlWordValues(n))
    return out
  }
  const argumentNodes = (n: any): any[] => perlArgumentNodes(n)

  /** Fat-comma KEYS of a (possibly parenthesised) list. */
  const fatKeys = (n: any): any[] => {
    let list: any = n
    if (n.type !== "list_expression") {
      list = byType(n, "list_expression")
      // `use constant { A => 1, B => 2 }` nests the list one level deeper than
      // the bare form, inside an anonymous_hash_expression. Both this oracle and
      // the analyzer carried the same dead `n.type === "anonymous_hash_expression"`
      // branch — the caller passes the use_statement, never the hash — so the
      // brace form's 13 constants on mojo (Mojo::Util's PC_* table and
      // Mojo::WebSocket's WS_* set) were lost on BOTH sides, and the agreement
      // between two independent implementations was agreement on a wrong reading
      // of the grammar. validation/m14/fixtures/perl/imports-and-exports.pm line
      // 8 is what broke the tie.
      if (!list) {
        const hash = byType(n, "anonymous_hash_expression")
        if (hash) list = byType(hash, "list_expression")
      }
      if (!list) return []
    }
    const keys: any[] = []
    let pending: any = null
    for (let i = 0; i < (list.childCount ?? 0); i++) {
      const c = list.child(i)
      if (!c) continue
      if (c.type === "=>") { if (pending) keys.push(pending); pending = null; continue }
      if (c.isNamed) pending = c
    }
    return keys
  }
  const isOption = (v: string): boolean => v.length > 0 && v[0] === "-"
  /** Perl's compile-time tokens; as an invocant they name no class. */
  const MAGIC = new Set(["__PACKAGE__", "__FILE__", "__LINE__", "__SUB__", "__DATA__", "__END__"])

  // Two passes: declarations first (a package's bases and methods decide the
  // extends/implements/overrides truth), then the call/instantiation walk.
  const bases = new Map<string, string[]>()
  const methods = new Map<string, Set<string>>()
  const classMethodNames: { owner: string; method: string }[] = []
  const packageOf = (n: any): string => {
    const nameNode = n.childForFieldName?.("name") || byType(n, "package")
    return nameNode?.text ?? ""
  }

  // ---- pass 1: packages, classes, roles, subs, bases -------------------
  /**
   * Returns the lexical package in force AFTER this node, so the sibling loop
   * can thread it forward. Without the return value the STATEMENT form
   * (`package Mojo::Asset;`) set `cur` on a local that no later sibling ever
   * saw, and every `use Mojo::Base 'X'` in the file was attributed to `main` —
   * 47 unexplained inheritance rows on mojo's 60-file draw, all of them this
   * threading bug and none of them a defect in the analyzer.
   */
  const scanDecls = (n: any, pkg: string, insideSub: boolean): string => {
    let cur = pkg
    if (!insideSub) {
      if (n.type === "package_statement" || n.type === "class_statement" || n.type === "role_statement") {
        const name = packageOf(n)
        const block = byType(n, "block")
        if (name && block) {
          for (const c of kids(block)) scanDecls(c, name, false)
          return cur // BLOCK form: the package does NOT leak past the brace
        }
        if (name) cur = name // statement form: leaks to siblings
        if (n.type !== "package_statement") return cur
      }
      if (n.type === "use_statement" && n.child(0)?.type !== "no") {
        const mod = n.childForFieldName?.("module")
        const module = mod?.text ?? ""
        if (module === "constant") {
          // `use constant NAME => value` declares a package constant, so the
          // package OWNS it — the same ownership fact the analyzer's symbol
          // table records. The pre-fix line added the name to a `methods` set
          // that was never created, so it was a no-op and every constant's
          // `contains` edge surfaced as unexplained (6 on plack's 226 files).
          for (const k of fatKeys(n)) { const nm = words(k)[0]; if (nm && cur) { push("contains", cur, nm); const set = methods.get(cur) ?? new Set(); set.add(nm); methods.set(cur, set) } }
        } else if (module === "parent" || module === "base") {
          const args: string[] = []
          for (const a of argumentNodes(n)) words(a, args)
          if (cur) {
            const list = bases.get(cur) || []
            for (const a of args) if (a && !isOption(a) && !list.includes(a)) list.push(a)
            bases.set(cur, list)
          }
        } else if (module === "Mojo::Base" && cur) {
          // `use Mojo::Base 'Base::Class'` names the parent; the flag-only forms
          // (`-base`, `-strict`, `-utf8`) subclass Mojo::Base ITSELF. 53 of
          // mojo's 118 inheritance sites are the flag-only form.
          const args: string[] = []
          for (const a of argumentNodes(n)) words(a, args)
          const named = args.find((a) => a && !isOption(a)) ?? module
          const list = bases.get(cur) || []
          if (!list.includes(named)) list.push(named)
          bases.set(cur, list)
        }
      }
      if (n.type === "subroutine_declaration_statement" || n.type === "method_declaration_statement") {
        const nameNode = n.childForFieldName?.("name") || byType(n, "bareword")
        const raw = nameNode?.text ?? ""
        if (raw && cur) {
          let set = methods.get(cur)
          if (!set) { set = new Set(); methods.set(cur, set) }
          set.add(raw)
          classMethodNames.push({ owner: cur, method: raw })
        }
        const body = n.childForFieldName?.("body") || byType(n, "block")
        if (body) for (const c of kids(body)) scanDecls(c, cur, true)
        return cur
      }
      if (n.type === "assignment_expression" && cur) {
        const leftVar = fieldAll(n, "left").flatMap((l) => variablesOf(l).map((v) => byType(v, "varname"))).find(Boolean)
        if (leftVar?.text === "ISA") {
          const right = fieldAll(n, "right").find((r) => r.isNamed && (r.namedChildCount ?? 0) > 0)
          if (right) {
            const vals = words(right)
            const list = bases.get(cur) || []
            for (const v of vals) if (v && !list.includes(v)) list.push(v)
            bases.set(cur, list)
          }
        }
      }
      if (n.type === "ambiguous_function_call_expression" || n.type === "function_call_expression") {
        const fn = n.childForFieldName?.("function") || byType(n, "function")
        const target = fn?.text ?? ""
        if ((target === "with" || target === "extends") && cur) {
          for (const a of fieldAll(n, "arguments")) {
            const v = words(a)[0]
            if (v) bases.set(cur, [...(bases.get(cur) || []), ...(target === "with" ? [] : [v])])
          }
        }
      }
    }
    for (const c of kids(n)) cur = scanDecls(c, cur, insideSub)
    return cur
  }
  scanDecls(root, "", false)

  // ---- pass 2: relationships ------------------------------------------
  type S = { pkg: string; fn?: string; inSub: boolean; inClass: boolean }
  const walk = (n: any, st: S): string => {
    let pkg = st.pkg
    let fn = st.fn
    let inSub = st.inSub
    let inClass = st.inClass
    const src = () => fn || "global"

    if (!inSub) {
      if (n.type === "package_statement" || n.type === "class_statement" || n.type === "role_statement") {
        const name = packageOf(n)
        const block = byType(n, "block")
        if (name && block) {
          for (const c of kids(block)) walk(c, { pkg: name, fn: undefined, inSub: false, inClass: n.type !== "package_statement" })
          return pkg // BLOCK form: no leak past the brace
        }
        if (name) pkg = name // statement form: the sibling loop threads it on
        return pkg
      }
      if (n.type === "use_statement" && n.child(0)?.type !== "no") {
        const mod = n.childForFieldName?.("module")
        const module = mod?.text ?? ""
        if (module === "parent" || module === "base" || module === "Mojo::Base") {
          const args: string[] = []
          for (const a of argumentNodes(n)) words(a, args)
          for (const a of args) {
            if (!a || isOption(a)) continue
            if (module === "Mojo::Base" && args.indexOf(a) !== 0) continue
            if (pkg) push("extends", pkg, leaf(a))
          }
        } else if (module === "role") {
          const args: string[] = []
          for (const a of argumentNodes(n)) words(a, args)
          for (const a of args) if (a && !isOption(a)) push("implements", pkg || "global", leaf(a))
        } else if (module === "constant") {
          // descend (see pass 1)
        } else {
          return pkg
        }
        if (module !== "constant") return pkg
      }
      if (n.type === "subroutine_declaration_statement" || n.type === "method_declaration_statement") {
        const nameNode = n.childForFieldName?.("name") || byType(n, "bareword")
        const raw = nameNode?.text ?? ""
        const owner = pkg
        const name = raw === "new" ? "constructor" : raw
        if (owner && name) push("contains", owner, name)
        const body = n.childForFieldName?.("body") || byType(n, "block")
        if (body) for (const c of kids(body)) walk(c, { pkg: owner, fn: name, inSub: true, inClass })
        return owner
      }
      if (n.type === "variable_declaration" && scopeOf(n) === "our") {
        for (const v of variablesOf(n)) {
          const vn = byType(v, "varname")
          const nm = vn?.text ?? ""
          if (nm && nm !== "_" && pkg && nm !== "ISA") push("contains", pkg, nm)
        }
      }
      if (n.type === "ambiguous_function_call_expression" || n.type === "function_call_expression") {
        const fnNode = n.childForFieldName?.("function") || byType(n, "function")
        const target = fnNode?.text ?? ""
        if (target === "has") {
          const argNodes = argumentNodes(n)
          const first = argNodes[0]
          const prop = first ? words(first)[0] : undefined
          if (prop && pkg) push("contains", pkg, prop)
        } else if (target === "with" || target === "extends") {
          for (const a of argumentNodes(n)) {
            const v = words(a)[0]
            if (v) push(target === "with" ? "implements" : "extends", pkg || "global", leaf(v))
          }
        } else if (target === "new") {
          const argNodes = argumentNodes(n)
          const requested = argNodes[0] ? words(argNodes[0])[0] : undefined
          const inst = requested && !requested.includes("$") ? `${leaf(requested)}.constructor` : "constructor"
          push("instantiates", src(), inst)
        } else if (target && !PERL_BUILTINS.has(target) && target !== "use" && target !== "no") {
          push("calls", src(), leaf(target))
        }
      }
    }
    // Method and function calls are walked at BOTH scopes. Perl's dominant
    // real-world shape is a FILE-SCOPE script — Mojo::Lite apps, `.t` files,
    // `use Mojolicious::Lite; get '/' => ...` — where the whole DSL is
    // `Mojo::IOLoop->start`, `$ua->get(...)->result`. Restricting the call walk
    // to inside a sub left every one of those edges with no truth row, and they
    // surfaced as unexplained (measured: 85 of 115 unexplained on mojo's 60-file
    // draw before this was corrected).
    if (n.type === "method_call_expression") {
      const m = byType(n, "method")
      const method = m?.text ?? ""
      if (method === "new") {
        const invocant = fieldAll(n, "invocant").find((c) => c.isNamed)
        const t = invocant?.text ?? ""
        if (MAGIC.has(t)) {
          // `__PACKAGE__->new` constructs the CURRENT package; with a package in
          // scope that is the honest target, and with none it is not derivable.
          if (pkg && pkg !== "main") push("instantiates", src(), `${leaf(pkg)}.constructor`)
        } else if (t && !t.includes("$") && !t.includes("->")) {
          push("instantiates", src(), `${leaf(t)}.constructor`)
        }
      } else if (method && !PERL_BUILTINS.has(method)) {
        push("calls", src(), leaf(method))
      }
    } else if (inSub && (n.type === "ambiguous_function_call_expression" || n.type === "function_call_expression")) {
      const fnNode = n.childForFieldName?.("function") || byType(n, "function")
      const target = fnNode?.text ?? ""
      if (target && !PERL_BUILTINS.has(target) && target !== "use" && target !== "no" && target !== "has" && target !== "with" && target !== "extends" && target !== "new") {
        push("calls", src(), leaf(target))
      }
    }
    for (const c of kids(n)) pkg = walk(c, { pkg, fn, inSub, inClass })
    return pkg
  }
  walk(root, { pkg: "", fn: undefined, inSub: false, inClass: false })

  // ---- pass 3: inheritance-derived edges ------------------------------
  // FULL-name self-reference guard, mirroring the analyzer.
  for (const [owner, list] of bases) for (const b of list) if (b !== owner) push("extends", owner, leaf(b))
  // Overrides: the first declared base, per method. With no companion index the
  // analyzer emits the deterministic first-parent guess for every method of the
  // class, so the truth side derives the same set from the same two facts.
  for (const { owner, method } of classMethodNames) {
    const list = bases.get(owner)
    if (!list || !list.length) continue
    // FULL-name self-reference guard, mirroring the analyzer: a leaf comparison
    // would also fire for `package Foo::Bar` whose base is a different
    // `Other::Bar`, deleting a real override edge.
    if (list[0] === owner) continue
    const baseLeaf = leaf(list[0])
    const local = methods.get(list[0]) || methods.get(baseLeaf)
    if (local?.has(method)) push("overrides", `${owner}.${method}`, `${baseLeaf}.${method}`)
    else push("overrides", `${owner}.${method}`, `${baseLeaf}.${method}`)
  }
  return edges
}

export function deriveErlangEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, from: string, target: string) => {
    if (!from || !target) return
    const k = `${label}|${from}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label, from, target })
  }

  const kids = (n: any): any[] => {
    const r: any[] = []
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) r.push(c) }
    return r
  }
  const childByType = (n: any, t: string): any => {
    for (const c of kids(n)) if (c.type === t) return c
    return undefined
  }
  // namedChild(0) mirror (the analyzer's callee read): unnamed nodes are not
  // candidates on either side.
  const firstNamed = (n: any): any => {
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) return c }
    return undefined
  }
  const collectAtoms = (n: any, out: string[]) => {
    if (n.type === "atom" && n.isNamed && n.text) out.push(n.text)
    for (let i = 0; i < n.childCount; i++) collectAtoms(n.child(i), out)
  }

  // Prepass mirror (collectDeclaredFunctions): every declared function name,
  // stopping at fun_decl (no descent into its body for more declarations).
  const declared = new Set<string>()
  const collectDecls = (n: any): void => {
    if (n.type === "fun_decl") {
      for (const c of kids(n)) {
        if (c.type !== "function_clause") continue
        const nameNode = childByType(c, "atom") || childByType(c, "var")
        if (nameNode?.text) declared.add(nameNode.text)
      }
      return
    }
    for (const c of kids(n)) collectDecls(c)
  }
  collectDecls(root)

  // Module name (-module attribute). Absent => the analyzer suppresses local
  // calls entirely — mirrored by the `modName` gate below.
  let modName = ""
  const findModule = (n: any): void => {
    if (modName) return
    if (n.type === "module_attribute") {
      const a = childByType(n, "atom")
      if (a?.text) modName = a.text
      return
    }
    for (const c of kids(n)) { if (modName) return; findModule(c) }
  }
  findModule(root)

  // isInFunHead mirror: a record_expr is construction only outside a
  // function head (clause_body boundary before function_clause/fun_clause).
  const inFunHead = (n: any): boolean => {
    let cur = n.parent
    while (cur) {
      if (cur.type === "clause_body") return false
      if (cur.type === "function_clause" || cur.type === "fun_clause") return true
      cur = cur.parent
    }
    return false
  }
  const stripLeadingHash = (t: string) => (t.startsWith("#") ? t.slice(1) : t)

  // Main walk mirror: currentFunction is set on entering a fun_decl and
  // cleared on leaving it (record_expr attribution follows it); calls are
  // extracted per function_clause subtree.
  const walk = (n: any, fn: string): void => {
    const t = n.type
    if (t === "behaviour_attribute") {
      const b = childByType(n, "atom")
      if (b?.text) push("implements", modName, b.text)
    } else if (t === "record_expr") {
      if (!inFunHead(n)) {
        const nameNode = childByType(n, "record_name") || childByType(n, "atom")
        const rec = nameNode ? stripLeadingHash(nameNode.text) : ""
        if (rec) push("instantiates", fn || modName || "Global", rec)
      }
    } else if (t === "fun_decl") {
      let funcName = ""
      for (const c of kids(n)) {
        if (c.type !== "function_clause") continue
        const nameNode = childByType(c, "atom") || childByType(c, "var")
        if (nameNode?.text) funcName = nameNode.text
        // extractCallsFromFunction mirror: every call node in the clause.
        const cs: any[] = [c]
        while (cs.length > 0) {
          const node = cs.pop()
          if (node.type === "call") {
            const callee = firstNamed(node)
            const remoteNode = childByType(node, "remote")
            if (remoteNode) {
              const atoms: string[] = []
              collectAtoms(remoteNode, atoms)
              if (atoms.length >= 2) push("calls", funcName, `${atoms[0]}:${atoms[1]}`)
            } else if (callee?.type === "atom" && callee.text && modName) {
              if (declared.has(callee.text)) push("calls", funcName, callee.text)
            }
          }
          for (let i = node.childCount - 1; i >= 0; i--) { const ch = node.child(i); if (ch) cs.push(ch) }
        }
      }
      for (const c of kids(n)) walk(c, funcName)
      return
    }
    for (const c of kids(n)) walk(c, fn)
  }
  walk(root, "")
  return edges
}



// ---------------------------------------------------------------------------
// M14 F5-cert wave (CLJ): dedicated clojure oracle — calls / references /
// implements / instantiates, written from the pinned grammar's tree shapes
// (@yogthos/tree-sitter-clojure 0.0.14) and the RULED CLJ1 contract
// (script/m14/spec/clojure-completeness.json CLJ-D1..D7), not by importing
// the analyzer's walk. The core-builtin exclusion set is a LANGUAGE FACT
// shared by import (the php/ruby/python precedent above). Independent rules,
// shared name list — list drift is a transcription hazard, rule drift is
// what the differential exists to catch.
export function deriveClojureEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, from: string, target: string) => {
    if (!from || !target) return
    if (label !== "calls" && from === target) return
    const k = `${label}|${from}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label, from, target })
  }
  const CORE = CLOJURE_CORE_BUILTINS
  const kids = (n: any): any[] => {
    const r: any[] = []
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) { const c = n.namedChild(i); if (c) r.push(c) }
    return r
  }
  const symName = (nd: any): string => {
    if (!nd) return ""
    if (nd.type === "sym_lit") {
      const nm = nd.childForFieldName ? nd.childForFieldName("name") : null
      const ns = nd.childForFieldName ? nd.childForFieldName("namespace") : null
      if (nm && ns) return `${ns.text}/${nm.text}`
      if (nm) return nm.text
      return nd.text ?? ""
    }
    return nd.text ?? ""
  }
  const execHead = (list: any): any => {
    for (let i = 0; i < list.namedChildCount; i++) {
      const c = list.namedChild(i)
      if (c && c.type !== "comment" && c.type !== "dis_expr" && c.type !== "meta_lit") return c
    }
    return null
  }
  const formNameOf = (list: any): string => {
    const first = execHead(list)
    if (!first) return ""
    if (first.type !== "sym_lit") return ""
    return symName(first)
  }
  // Clause dispatch name (kwd-headed lists) — ns branch + libspec guard only;
  // declaration dispatch is SYM-headed only (F5-cert: `(:ns (meta var))` data
  // fired the analyzer's ns branch and reset its alias table mid-file).
  const clauseNameOf = (list: any): string => {
    const first = execHead(list)
    if (first && first.type === "kwd_lit") return first.childForFieldName?.("name")?.text || ""
    return ""
  }
  // CLJ-D6: forms whose direct list children are METHOD DEFINITIONS.
  const IMPL_PARENTS = new Set(["defrecord", "deftype", "reify", "extend-type", "extend-protocol", "proxy", "defprotocol", "definterface"])
  // CLJ-D7: the direct list children of a libspec site are DATA.
  const LIBSITE_FORMS = new Set(["require", "use", "import", "refer", "refer-clojure"])
  let nsName = "user"
  const aliases = new Map<string, string>()
  // W24-mr2 mirror: `:refer [a b]` names resolve unqualified calls — a
  // CONFIRMED target, resolved to its source lib (last libspec wins).
  const refers = new Map<string, string>()
  // W24-mr2 mirror: names defined in-file (def family) shadow `:refer`ed
  // names at resolution time (Clojure's ns mapping).
  const localNames = new Set<string>()
  // #881 + W23-b mirror: the comment macro can be shadowed — but only
  // REGIONALLY and in ORDER. Ranges: def-family NAME binds at form end
  // (order-aware from there on); a binding vector covers its ENCLOSING form
  // only (params live inside their fn/defn form; a multi-arity clause's
  // param covers that clause). See the analyzer for the full rationale.
  const shadowRanges: Array<{ start: number; end: number }> = []
  {
    const DEF_NAME_HEADS = new Set(["def", "defn", "defn-", "defmacro", "defonce", "defmulti"])
    const BINDING_VEC_HEADS = new Set(["let", "let*", "loop", "loop*", "when-let", "if-let", "when-some", "if-some", "when-first", "binding", "for", "doseq", "dotimes", "with-open", "with-local-vars", "with-bindings", "letfn"])
    const FN_PARAM_HEADS = new Set(["fn", "defn", "defn-", "defmacro", "defmethod", "deftest"])
    const shadowRangeOf = (c: any): { start: number; end: number } | null => {
      const p = c.parent
      if (!p) return null
      if (p.type === "list_lit") {
        const head = formNameOf(p)
        if (DEF_NAME_HEADS.has(head) && p.namedChild(1)?.startIndex === c.startIndex) {
          return { start: p.endIndex, end: Infinity }
        }
        // W24-mr1 mirror: a letfn fn-spec head — `[(comment [args] body) …]`
        // — binds the name for the whole enclosing letfn form.
        if (p.namedChild(0)?.startIndex === c.startIndex) {
          const specVec = p.parent
          if (specVec && specVec.type === "vec_lit") {
            const letfnForm = specVec.parent
            if (letfnForm && letfnForm.type === "list_lit" && formNameOf(letfnForm) === "letfn"
                && letfnForm.namedChild(1)?.startIndex === specVec.startIndex) {
              return { start: letfnForm.startIndex, end: letfnForm.endIndex }
            }
          }
        }
        return null
      }
      if (p.type === "vec_lit") {
        const gp = p.parent
        if (!gp || gp.type !== "list_lit") return null
        const head = formNameOf(gp)
        if (FN_PARAM_HEADS.has(head)) {
          for (let i = 0; i < gp.namedChildCount; i++) {
            const cc = gp.namedChild(i)
            if (cc?.type === "vec_lit") return cc.startIndex === p.startIndex ? { start: gp.startIndex, end: gp.endIndex } : null
          }
          return null
        }
        if (BINDING_VEC_HEADS.has(head) && gp.namedChild(1)?.startIndex === p.startIndex) {
          return { start: gp.startIndex, end: gp.endIndex }
        }
        if (gp.namedChild(0)?.startIndex === p.startIndex) {
          const ggp = gp.parent
          if (ggp && ggp.type === "list_lit" && FN_PARAM_HEADS.has(formNameOf(ggp))) {
            return { start: gp.startIndex, end: gp.endIndex }
          }
        }
        // W24-mr1b mirror: a letfn fn-spec PARAM vector — `[(f [comment] …)]`
        // — the param covers its own spec form only.
        {
          const specVec = gp.parent
          if (specVec && specVec.type === "vec_lit") {
            const letfnForm = specVec.parent
            if (letfnForm && letfnForm.type === "list_lit" && formNameOf(letfnForm) === "letfn"
                && letfnForm.namedChild(1)?.startIndex === specVec.startIndex) {
              return { start: gp.startIndex, end: gp.endIndex }
            }
          }
        }
        return null
      }
      return null
    }
    const scan: any[] = [root]
    while (scan.length > 0) {
      const c = scan.pop()!
      if (c.type === "dis_expr" || c.type === "quoting_lit") continue
      if (c.type === "sym_lit" && symName(c) === "comment") {
        const range = shadowRangeOf(c)
        if (range) shadowRanges.push(range)
      }
      for (const k of kids(c)) scan.push(k)
    }
  }
  const isShadowedAt = (pos: number): boolean => {
    for (const r of shadowRanges) if (pos >= r.start && pos < r.end) return true
    return false
  }
  const resolveQualified = (name: string): string => {
    const slash = name.indexOf("/")
    if (slash <= 0) return name
    const a = name.slice(0, slash)
    const rest = name.slice(slash + 1)
    const r = aliases.get(a)
    return r ? `${r}/${rest}` : name
  }
  const handleLib = (raw: any) => {
    const spec = raw.type === "quoting_lit" ? (raw.namedChild(0) ?? raw) : raw
    if (spec.type === "read_cond_lit" || spec.type === "splicing_read_cond_lit") {
      // F12 mirror: read-cond transparency for libspecs (union of platforms).
      for (let i = 0; i < spec.namedChildCount; i++) {
        const c = spec.namedChild(i)
        if (!c) continue
        if (c.type === "vec_lit" || c.type === "list_lit" || c.type === "sym_lit" || c.type === "quoting_lit" || c.type === "read_cond_lit" || c.type === "splicing_read_cond_lit") handleLib(c)
      }
      return
    }
    if (spec.type === "vec_lit") {
      const libName = symName(spec.namedChild(0))
      if (!libName) return
      let hasAsAlias = false
      for (let k = 1; k < spec.namedChildCount; k++) {
        const part = spec.namedChild(k)
        if (!part) continue
        if (part.type === "kwd_lit") {
          const kw = part.childForFieldName?.("name")?.text || ""
          if ((kw === "as" || kw === "as-alias") && k + 1 < spec.namedChildCount) {
            const a = symName(spec.namedChild(k + 1))
            if (a) aliases.set(a, libName)
            // F12 mirror: `:as-alias` registers the alias but the lib is not
            // loaded — no references edge for the alias-only form.
            if (kw === "as-alias") hasAsAlias = true
          }
          // W24-mr2 mirror: `:refer [a b]` names resolve unqualified calls.
          if (kw === "refer" && k + 1 < spec.namedChildCount) {
            const refVec = spec.namedChild(k + 1)
            if (refVec && refVec.type === "vec_lit") {
              for (let r = 0; r < refVec.namedChildCount; r++) {
                const rn = refVec.namedChild(r)
                if (rn && rn.type === "sym_lit") refers.set(symName(rn), libName)
              }
            }
          }
        } else if (part.type === "vec_lit") {
          // PREFIX-LIST spec mirror: `[prefix [sub :as a] …]` — alias a -> prefix.sub.
          // A vec directly after a keyword is a name list (`:refer [foo bar]`) — skip.
          const prev = spec.namedChild(k - 1)
          if (prev && prev.type === "kwd_lit") continue
          const sub = symName(part.namedChild(0))
          if (!sub) continue
          const full = `${libName}.${sub}`
          for (let q = 1; q < part.namedChildCount; q++) {
            const pp = part.namedChild(q)
            if (pp && pp.type === "kwd_lit" && (pp.childForFieldName?.("name")?.text || "") === "as") {
              const av = part.namedChild(q + 1)
              const subAlias = av ? symName(av) : ""
              if (subAlias) aliases.set(subAlias, full)
            }
          }
          push("references", nsName, full)
        }
      }
      if (!hasAsAlias) push("references", nsName, libName)
    } else if (spec.type === "list_lit") {
      const pkg = symName(spec.namedChild(0))
      if (!pkg) return
      push("references", nsName, pkg)
      for (let k = 1; k < spec.namedChildCount; k++) {
        const cls = spec.namedChild(k)
        if (!cls) continue
        if (cls.type === "list_lit") {
          // F15 mirror: paren prefix-list `(adv.prefix (sub :as sp))`.
          const subName = symName(cls.namedChild(0))
          if (!subName) continue
          const full = `${pkg}.${subName}`
          for (let q = 1; q < cls.namedChildCount; q++) {
            const pp = cls.namedChild(q)
            if (pp && pp.type === "kwd_lit" && (pp.childForFieldName?.("name")?.text || "") === "as") {
              const av = cls.namedChild(q + 1)
              const subAlias = av ? symName(av) : ""
              if (subAlias) aliases.set(subAlias, full)
            }
          }
          push("references", nsName, full)
        }
      }
    } else if (spec.type === "sym_lit") {
      const libName = symName(spec)
      if (libName) push("references", nsName, libName)
    }
  }
  const frames: { name: string; isFn: boolean }[] = []
  const currentName = (): string => (frames.length > 0 ? frames[frames.length - 1].name : nsName)
  const isFnContext = (): boolean => frames.length > 0 && frames[frames.length - 1].isFn
  const work: { n: any; exit?: boolean; qd: number }[] = [{ n: root, qd: 0 }]
  while (work.length > 0) {
    const { n, exit, qd } = work.pop()!
    if (exit) { frames.pop(); continue }
    if (!n) continue
    if (n.type === "dis_expr") continue
    // F5 mirror: metadata is compile-time DATA — the subtree is never walked.
    if (n.type === "meta_lit") continue
    if (n.type === "syn_quoting_lit" || n.type === "unquoting_lit" || n.type === "unquote_splicing_lit" || qd > 0) {
      let childDepth = qd
      if (n.type === "syn_quoting_lit") childDepth++
      else if (n.type === "unquoting_lit" || n.type === "unquote_splicing_lit") childDepth--
      const cs = kids(n)
      for (let i = cs.length - 1; i >= 0; i--) work.push({ n: cs[i], qd: childDepth })
      continue
    }
    if (n.type === "quoting_lit") continue
    if (n.type === "tagged_or_ctor_lit") {
      // CLJ-D1: vec/map payload + final UPPERCASE segment => constructor
      // (instantiates); anything else is reader data, never walked.
      const tagNode = n.namedChild(0)
      const payload = n.namedChild(1)
      const tag = symName(tagNode)
      if (tag && payload && (payload.type === "vec_lit" || payload.type === "map_lit")) {
        const namePart = tag.includes("/") ? tag.slice(tag.indexOf("/") + 1) : tag
        const lastSeg = namePart.includes(".") ? namePart.slice(namePart.lastIndexOf(".") + 1) : namePart
        const c0 = lastSeg.charCodeAt(0)
        if (c0 >= 65 && c0 <= 90) push("instantiates", currentName(), resolveQualified(tag))
      }
      continue
    }
    if (n.type === "anon_fn_lit") {
      const lname = `lambda_${n.startPosition.row}_${n.startPosition.column}`
      frames.push({ name: lname, isFn: true })
      // F1 mirror: `#(f …)` — the first named child is the callee.
      const anonHead = n.namedChild(0)
      if (anonHead && anonHead.type === "sym_lit") {
        const hName = symName(anonHead)
        if (hName && !/^%(\d+|&)?$/.test(hName) && !CORE[hName]) {
          if (hName.includes("/")) {
            const [a, f] = hName.split("/")
            const resolvedNs = aliases.get(a) || a
            push("calls", lname, `${resolvedNs}/${f}`)
            push("references", nsName, resolvedNs)
          } else {
            push("calls", lname, hName)
          }
        }
      }
      work.push({ n, exit: true, qd })
      const cs = kids(n)
      for (let i = cs.length - 1; i >= 0; i--) work.push({ n: cs[i], qd })
      continue
    }
    if (n.type === "list_lit") {
      const form = formNameOf(n)
      // F10 mirror: spelling-independent data-form skip.
      const canon = resolveQualified(form)
      if (canon === "quote" || canon === "clojure.core/quote" || canon === "clojure.core/comment" || (canon === "comment" && !isShadowedAt(n.startIndex))) continue
      if (n.parent?.type === "list_lit" && LIBSITE_FORMS.has(clauseNameOf(n.parent) || formNameOf(n.parent))) continue
      if (n.parent?.type === "list_lit" && IMPL_PARENTS.has(formNameOf(n.parent)) && execHead(n.parent)?.startIndex !== n.startIndex) {
        // CLJ-D6: method definition, not a call (defprotocol/definterface sigs
        // are symbols-only in the analyzer — nothing to derive for them).
        // (Span compare, not object identity: web-tree-sitter hands out fresh
        // wrappers per access — the F7 scan flagged the analyzer's twin of
        // this idiom; both sides now compare startIndex.)
        const parentForm = formNameOf(n.parent)
        const mName = symName(n.namedChild(0))
        if (parentForm !== "defprotocol" && parentForm !== "definterface" && mName && !CORE[mName]) {
          frames.push({ name: mName, isFn: true })
          work.push({ n, exit: true, qd })
        }
        const cs = kids(n)
        for (let i = cs.length - 1; i >= 0; i--) work.push({ n: cs[i], qd })
        continue
      }
      let pushedFrame = false
      if (form === "ns") {
        const nm = symName(n.namedChild(1))
        if (nm) nsName = nm
        // F2/F12 mirror: refer-clojure is data (never a libspec); read-cond
        // clauses unwrap; require-macros is a require sibling.
        const clauses: any[] = []
        for (let i = 1; i < n.namedChildCount; i++) {
          const clause = n.namedChild(i)
          if (!clause) continue
          if (clause.type === "list_lit") clauses.push(clause)
          else if (clause.type === "read_cond_lit" || clause.type === "splicing_read_cond_lit") {
            for (let c = 0; c < clause.namedChildCount; c++) {
              const inner = clause.namedChild(c)
              if (inner && inner.type === "list_lit") clauses.push(inner)
            }
          }
        }
        for (const clause of clauses) {
          const ct = clauseNameOf(clause)
          if (ct !== "require" && ct !== "use" && ct !== "import" && ct !== "require-macros") continue
          for (let j = 1; j < clause.namedChildCount; j++) {
            const libNode = clause.namedChild(j)
            if (libNode) handleLib(libNode)
          }
        }
      } else if ((form === "require" || form === "use" || form === "import" || form === "refer" || form === "require-macros") && execHead(n)?.type === "sym_lit") {
        // CLJ-D7: top-level directive forms after the ns (the kwd-headed ns
        // clauses were consumed by the ns branch above).
        for (let j = 1; j < n.namedChildCount; j++) {
          const libNode = n.namedChild(j)
          if (libNode) handleLib(libNode)
        }
      } else if (form === "defn" || form === "defn-" || form === "defmacro" || form === "s/defn" || form === "mu/defn") {
        const dn0 = symName(n.namedChild(1))
        if (dn0) localNames.add(dn0)
        frames.push({ name: dn0 || "unknown", isFn: true })
        pushedFrame = true
      } else if (form === "deftest") {
        const dn1 = symName(n.namedChild(1))
        if (dn1) localNames.add(dn1)
        frames.push({ name: dn1 || `test_${n.startPosition.row}`, isFn: true })
        pushedFrame = true
      } else if (form === "defmethod") {
        const dn2 = symName(n.namedChild(1))
        if (dn2) localNames.add(dn2)
        frames.push({ name: dn2 || "unknown", isFn: true })
        pushedFrame = true
      } else if (form === "fn") {
        frames.push({ name: `lambda_${n.startPosition.row}_${n.startPosition.column}`, isFn: true })
        pushedFrame = true
      } else if (n.parent?.type === "vec_lit" && n.parent.parent?.type === "list_lit" && formNameOf(n.parent.parent) === "letfn") {
        // F8 mirror: a letfn binding-vector list is a DEFINITION (a frame),
        // never a call.
        const fName = symName(n.namedChild(0))
        if (fName && !CORE[fName]) {
          frames.push({ name: fName, isFn: true })
          pushedFrame = true
        }
      } else if (form === "def" || form === "defonce" || form === "defmulti") {
        // W24-mr2 mirror: a def-family name IS a local declaration (shadows
        // `:refer`ed names at resolution; no frame — mirroring the analyzer).
        const dn3 = symName(n.namedChild(1))
        if (dn3) localNames.add(dn3)
      } else if (form === "defrecord" || form === "deftype") {
        const rn = symName(n.namedChild(1))
        for (let pi = 3; pi < n.namedChildCount; pi++) {
          const protoNode = n.namedChild(pi)
          if (protoNode && protoNode.type === "sym_lit" && rn) {
            const p = resolveQualified(symName(protoNode))
            if (p) push("implements", rn, p)
          }
        }
      } else if (form === "reify" || form === "extend-type" || form === "extend-protocol" || form === "proxy") {
        if (form === "reify") {
          for (let i = 1; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "sym_lit") {
              const p = resolveQualified(symName(c))
              if (p) push("implements", currentName(), p)
            }
          }
        } else if (form === "extend-protocol") {
          const proto = resolveQualified(symName(n.namedChild(1)))
          for (let i = 2; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "sym_lit" && proto) push("implements", symName(c), proto)
          }
        } else if (form === "extend-type") {
          const typeName = symName(n.namedChild(1))
          for (let i = 2; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "sym_lit") {
              const p = resolveQualified(symName(c))
              if (p && typeName) push("implements", typeName, p)
            }
          }
        } else {
          const ifaces = n.namedChild(1)
          if (ifaces && ifaces.type === "vec_lit") {
            for (let i = 0; i < ifaces.namedChildCount; i++) {
              const c = ifaces.namedChild(i)
              if (c && c.type === "sym_lit") {
                const f = resolveQualified(symName(c))
                if (f) push(i === 0 ? "extends" : "implements", currentName(), f)
              }
            }
          }
        }
      } else if (form === "recur") {
        if (isFnContext()) push("calls", currentName(), currentName())
      } else if (form === "s/def" || form === "s/fdef" || form === "clojure.spec.alpha/def" || form === "clojure.spec.alpha/fdef") {
        // spec declaration forms are symbols-only in the analyzer — consumed,
        // no edges (a generic-call fallthrough would fabricate one).
      } else if (form.startsWith("->") && form.length > 2 && form !== "->>") {
        // F14 mirror: final-segment uppercase (aligns with CLJ-D1), alias-resolved.
        // `->>` falls through to the threading branch below.
        const cls = form.slice(2)
        const namePart = cls.includes("/") ? cls.slice(cls.indexOf("/") + 1) : cls
        const lastSeg = namePart.includes(".") ? namePart.slice(namePart.lastIndexOf(".") + 1) : namePart
        const c0 = lastSeg.charCodeAt(0)
        if (c0 >= 65 && c0 <= 90) push("instantiates", currentName(), resolveQualified(cls))
      } else if (form === "new") {
        // F14 mirror: `(new Class args…)` instantiates the named class.
        const clsName = symName(n.namedChild(1))
        if (clsName) push("instantiates", currentName(), resolveQualified(clsName))
      } else if (form.endsWith(".") && form.length > 1 && !form.startsWith(".")) {
        push("instantiates", currentName(), resolveQualified(form.slice(0, -1)))
      } else if (form === "->" || form === "->>" || form === "some->" || form === "some->>" || form === "cond->" || form === "cond->>" || form === "doto") {
        // F13 mirror (CLJ-D10): threading steps are calls; bare symbol steps
        // emit; builtin/dotted steps follow the site policy.
        const isCond = form === "cond->" || form === "cond->>"
        for (let i = 2; i < n.namedChildCount; i++) {
          if (isCond && i % 2 === 0) continue
          const step = n.namedChild(i)
          if (!step) continue
          const head = step.type === "list_lit" ? execHead(step) : step
          if (!head || head.type !== "sym_lit") continue
          const hName = symName(head)
          if (!hName || CORE[hName] || hName.startsWith(".") || hName.startsWith("->") || hName.endsWith(".")) continue
          if (hName.includes("/")) {
            const [a, f] = hName.split("/")
            const resolvedNs = aliases.get(a) || a
            push("calls", currentName(), `${resolvedNs}/${f}`)
            push("references", nsName, resolvedNs)
          } else {
            push("calls", currentName(), hName)
          }
        }
      } else if (form.startsWith(".")) {
        // Java member/field access — the `uses` family; this oracle derives
        // no uses truth for clojure (label not compared for the lane).
      } else if (form && !CORE[form]) {
        if (form.includes("/")) {
          const [a, f] = form.split("/")
          const resolvedNs = aliases.get(a) || a
          push("calls", currentName(), `${resolvedNs}/${f}`)
          push("references", nsName, resolvedNs)
        } else {
          push("calls", currentName(), form)
        }
      }
      if (pushedFrame) work.push({ n, exit: true, qd })
      const cs = kids(n)
      // F7 mirror: case constant-position LISTs are data groups — never walked.
      // W23 mirror: the trailing DEFAULT (last child whenever present — odd
      // child count) is an EXPRESSION, never a constant group; the parity
      // rule must not swallow it.
      const isCase = form === "case"
      const caseDefaultIdxO = isCase && cs.length % 2 === 1 ? cs.length - 1 : -1
      for (let i = cs.length - 1; i >= 0; i--) {
        if (isCase && i >= 2 && i % 2 === 0 && cs[i].type === "list_lit" && i !== caseDefaultIdxO) continue
        work.push({ n: cs[i], qd })
      }
      continue
    }
    const cs = kids(n)
    for (let i = cs.length - 1; i >= 0; i--) work.push({ n: cs[i], qd })
  }
  // W24-mr2 mirror: bare calls to `:refer`-ed names resolve to the source
  // lib, locals win (Clojure's ns mapping) — the analyzer's post-walk shape.
  for (const e of edges) {
    if (e.label !== "calls") continue
    if (!e.target || e.target.indexOf("/") !== -1 || e.target.indexOf(".") !== -1) continue
    if (localNames.has(e.target)) continue
    const lib = refers.get(e.target)
    if (lib) e.target = `${lib}/${e.target}`
  }
  {
    const seenFinal = new Set<string>()
    for (let i = edges.length - 1; i >= 0; i--) {
      const e = edges[i]!
      const k = `${e.label}|${e.from}|${e.target}`
      if (seenFinal.has(k)) edges.splice(i, 1)
      else seenFinal.add(k)
    }
  }
  return edges
}

// Clean calls/instantiates/implements/references oracle (F5 wave).
//
// The clean lane had NO read oracle, so `differential.ts --repo Clyde` refused
// with `derived ZERO truth edges` rather than certify a 0/0 row. This is
// derived from the PINNED v1.2.7 grammar's tree shapes (probed: application's
// `function:`/`argument:` fields, qualified_identifier's module:constructor/
// name:identifier pair, function_declaration's `name` field, class_member ->
// type_signature -> signature_name, instance_declaration's
// name:instance_class/argument:constructor) and the analyzer's declared
// contract (src/ast/real-clean-analyzer.ts):
//
//   - module_declaration names the file's module; each `module:` field child of
//     an import_declaration emits module -> imported-module `references`
//     (multiple names in one import emit one edge each);
//   - instance_declaration emits `implements` target-type -> class and names
//     the implementation after the TARGET type (the universal impl-naming
//     contract: Rust `impl User`, Elixir `defimpl`, Haskell instance Stream);
//   - an `application` emits `calls` for a qualified_identifier head (full
//     qualified text, module qualification preserved) or an identifier head
//     ONLY when that name is DECLARED in-file (forward references resolve via
//     the pre-pass; imported/StdEnv names and pattern variables emit nothing),
//     and `instantiates` for a constructor head outside pattern position;
//   - an `operator_definition` (a DIFFERENT node from function_declaration) is a
//     callable wherever it lives — the Clean norm for Eq/Ord instance members,
//     and the definition half of a module-level operator declaration — so its
//     body attributes to the operator's unparenthesized name; inside a where
//     block it is scoped noise, and a comma/brace pattern mis-shape names
//     nothing;
//   - where-local functions and their bodies attribute to NOTHING (M11.11
//     closure boundary), and an application outside any function emits
//     nothing (the analyzer gates every call on `ctx.currentFunction`).
//
// Written as a straight pre-order walk with an explicit scope stack, from the
// grammar rather than translated line-by-line from the analyzer, so a
// disagreement surfaces as MISSING/UNEXPLAINED instead of being copied.
// Clean's node shapes make the case/function pattern gate nearly inert
// (patterns are constructor_pattern/paren_pattern nodes, never applications)
// but it is mirrored so a future grammar that app-lifts a pattern cannot
// silently start fabricating instantiates.
export function deriveCleanEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const push = (label: string, from: string, target: string) => {
    // NO self-edge guard, deliberately: the analyzer's pushRel has none, and
    // Clean makes self-loops REAL for every label here. A recursive call to an
    // uppercase-named function (`Concat xs ys` inside `Concat`) has a head typed
    // `constructor` — Clean's lexical rule cannot tell it from a constructor
    // application — so the analyzer emits `instantiates Concat -> Concat` and the
    // oracle must derive the same edge or report a phantom MISSING (measured:
    // 19 such edges across Clyde, e.g. UtilStrictLists.icl).
    if (!from || !target) return
    const k = `${label}|${from}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label, from, target })
  }

  const kids = (n: any): any[] => {
    const out: any[] = []
    for (let i = 0; i < (n.namedChildCount ?? 0); i++) { const c = n.namedChild(i); if (c) out.push(c) }
    return out
  }
  const firstOf = (n: any, type: string): any => kids(n).find((c: any) => c.type === type)
  // module_name children compose dotted names (Data + Map -> "Data.Map").
  const modName = (node: any): string => {
    if (!node) return ""
    let out = ""
    for (const c of kids(node)) {
      const leaf = c.type === "module_name" ? modName(c) : c.text
      if (out) out += "."
      out += leaf
    }
    return out || node.text
  }
  // The declared name comes from the grammar's `name` FIELD, not the first
  // `identifier` child: an uppercase definition's name is typed `constructor`,
  // so the heuristic read the first PARAMETER instead (measured at HEAD: 447 of
  // 4,647 declarations under v1.2.7; e.g. `NSMakeSize w h ...` -> `w`). The
  // field is used when present, the heuristic stays as a fallback.
  const declName = (fn: any): string => {
    const byField = fn.childForFieldName?.("name")
    if (byField?.text) return byField.text
    return firstOf(fn, "identifier")?.text ?? ""
  }
  // Inner text of `(x)`, or null when the parens hold a PATTERN, not a name —
  // `# (a,b,c) = expr;` and `# (r,{gst & ls=s})` are tuple/record mis-shapes, and
  // publishing them would fabricate a symbol no source declares. Mirror of the
  // analyzer's `unparenthesize`.
  const unparenthesize = (text: string): string | null => {
    const inner = text.replace(/^\(|\)$/g, "").trim()
    if (!inner || /[,{}]/.test(inner)) return null
    return inner
  }
  // The name a `type_signature` declares, across all four shapes the grammar
  // puts inside `signature_name`: `identifier`, `constructor` (Clean lets an
  // uppercase name be a FUNCTION), `parenthesized_operator` (`(%.`), and
  // `parenthesized_name` (`(bitxor)`). The old oracle added `signature_name.text`
  // verbatim, so a parenthesized declaration entered the declared set as `(==)`
  // where the analyzer now records `==`.
  const sigDeclName = (node: any): string | null => {
    const sig = firstOf(node, "signature_name")
    const kid = sig && (sig.namedChildCount ?? 0) > 0 ? sig.namedChild(0) : null
    if (!kid) return null
    if (kid.type === "identifier" || kid.type === "constructor") return kid.text
    if (kid.type === "parenthesized_operator" || kid.type === "parenthesized_name") return unparenthesize(kid.text)
    return null
  }
  // The name an `operator_definition` declares — module-level operators are a
  // DIFFERENT node from `function_declaration` (39 module-level and 192
  // instance-member definitions on this lane's corpora), so an oracle that knew
  // only the latter derived no callable for their bodies. Mirror of the
  // analyzer's `operatorDefinitionName` (the `name` FIELD, unparenthesized).
  const operatorName = (node: any): string | null => {
    const nm =
      node.childForFieldName?.("name") ??
      firstOf(node, "parenthesized_operator") ??
      firstOf(node, "parenthesized_name")
    if (!nm?.text) return null
    return unparenthesize(nm.text)
  }

  // Pre-pass: in-file declared function/method names (forward references).
  // Mirrors the analyzer's collectDeclaredFunctions, INCLUDING its early stop:
  // a declaration's body is not descended, so a where-local's name is never
  // declared (and its body therefore attributes to nothing).
  const declared = new Set<string>()
  {
    const stack: any[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()
      if (n.type === "function_declaration") { const nm = declName(n); if (nm) declared.add(nm); continue }
      if (n.type === "type_signature") { const nm = sigDeclName(n); if (nm) declared.add(nm); continue }
      if (n.type === "operator_definition") { const nm = operatorName(n); if (nm) declared.add(nm); continue }
      for (const c of kids(n)) stack.push(c)
    }
  }

  // Pattern gate (analyzer mirror): an application before a case-alternative's
  // `->`, or anywhere under a function head, is pattern territory.
  const isBeforeArrow = (alt: any, node: any): boolean => {
    for (const c of kids(alt)) {
      if (c.type === "arrow") return node.startIndex < c.startIndex
      if (c === node) return true
    }
    return false
  }
  // Mirror of the analyzer's `isBeforeEquals`: pattern territory is everything
  // before the body FIELD. The pre-fix form looked for a child typed `operator`
  // with text `=`, which the pinned grammar never produces (a definition's
  // children are name/pattern…/body; the 1,576 `operator` nodes on the corpora
  // are operator symbols under binary_expression/unary_expression/paren_pattern),
  // so the gate could not fire on either side. Both sides now compare against
  // the field — an oracle that mirrored the dead form would keep agreeing with
  // the analyzer for the wrong reason.
  const isBeforeEquals = (fn: any, node: any): boolean => {
    const body = fn.childForFieldName?.("body")
    if (!body) return false
    return node.startIndex < body.startIndex
  }
  const isPatternPosition = (node: any): boolean => {
    let cur = node.parent
    while (cur) {
      if (cur.type === "case_alternative") return cur.namedChild(0) === node || isBeforeArrow(cur, node)
      if (cur.type === "function_declaration") return isBeforeEquals(cur, node)
      if (cur.type === "type_definition" || cur.type === "class_declaration" || cur.type === "instance_declaration") return false
      cur = cur.parent
    }
    return false
  }

  // Straight pre-order walk. `scopeStack` mirrors the analyzer's symbol scopes
  // (only `kind` matters here: a `namespace` scope marks where-local territory);
  // `currentFunction` is the enclosing function a call attributes to.
  let currentModule: string | undefined
  let currentFunction: string | undefined
  const scopeStack: { node: any; name: string; kind: string }[] = []
  const stack: { node: any; exit?: boolean; restore?: string; hasRestore?: boolean }[] = [{ node: root }]
  while (stack.length > 0) {
    const frame = stack.pop()!
    const node = frame.node
    if (frame.exit) {
      if (frame.hasRestore) currentFunction = frame.restore
      else if (
        node.type === "function_declaration" ||
        node.type === "operator_definition" ||
        node.type === "type_definition" ||
        node.type === "class_declaration" ||
        node.type === "instance_declaration"
      ) currentFunction = undefined
      if (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].node === node) scopeStack.pop()
      continue
    }
    if (node.isMissing) continue

    let pushedScope = false
    const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined

    if (node.type === "module_declaration") {
      const nameNode = firstOf(node, "module_name")
      if (nameNode) currentModule = modName(nameNode)
    } else if (node.type === "import_declaration") {
      const mods = node.childrenForFieldName?.("module") ?? []
      for (const mod of mods) {
        if (!mod) continue
        push("references", currentModule || "", modName(mod))
      }
    } else if (node.type === "type_definition") {
      const nameNode = firstOf(node, "constructor")
      if (nameNode?.text) { scopeStack.push({ node, name: nameNode.text, kind: "type" }); pushedScope = true }
    } else if (node.type === "class_declaration") {
      const nameNode = firstOf(node, "class_name")
      if (nameNode?.text) { scopeStack.push({ node, name: nameNode.text, kind: "interface" }); pushedScope = true }
    } else if (node.type === "instance_declaration") {
      const className = firstOf(node, "instance_class")?.text || ""
      const targetType = firstOf(node, "constructor")?.text || ""
      if (className && targetType) {
        push("implements", targetType, className)
        scopeStack.push({ node, name: targetType, kind: "class" })
        pushedScope = true
      }
    } else if (node.type === "function_declaration") {
      const localScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined
      if (localScope?.kind === "namespace") {
        // Where-local function: scoped noise — its internals attribute to
        // nothing (M11.11 closure boundary), and the enclosing function is
        // restored afterwards.
        stack.push({ node, exit: true, hasRestore: true, restore: currentFunction })
        currentFunction = undefined
        scopeStack.push({ node, name: "local", kind: "namespace" })
      } else {
        const nm = declName(node)
        if (nm) {
          currentFunction = nm
          const kind = currentScope && (currentScope.kind === "interface" || currentScope.kind === "class") ? "method" : "function"
          scopeStack.push({ node, name: nm, kind })
          pushedScope = true
        }
      }
    } else if (node.type === "operator_definition") {
      // An operator definition is a CALLABLE wherever it lives (the Clean norm
      // for Eq/Ord instance members, and the definition half of a module-level
      // operator declaration) EXCEPT inside a where block, where it is scoped
      // noise like a where-local function (M11.11). A pattern mis-shape
      // (`# (a,b,c) = expr;`) names nothing and attributes nothing. Same
      // three-way split as the analyzer's operator_definition branch.
      if (currentScope?.kind === "namespace") {
        stack.push({ node, exit: true, hasRestore: true, restore: currentFunction })
        currentFunction = undefined
        scopeStack.push({ node, name: "local", kind: "namespace" })
      } else {
        const nm = operatorName(node)
        if (nm) {
          currentFunction = nm
          const kind = currentScope && (currentScope.kind === "interface" || currentScope.kind === "class") ? "method" : "function"
          scopeStack.push({ node, name: nm, kind })
          pushedScope = true
        }
      }
    } else if (node.type === "where_block") {
      // where-locals: scoped noise (the current function is NOT cleared here —
      // only the local's own function_declaration clears it).
      scopeStack.push({ node, name: "local", kind: "namespace" })
      pushedScope = true
    } else if (node.type === "application") {
      const head = (node.namedChildCount ?? 0) > 0 ? node.namedChild(0) : null
      if (head && currentFunction) {
        if (head.type === "qualified_identifier") {
          push("calls", currentFunction, head.text)
        } else if (head.type === "constructor") {
          if (!isPatternPosition(node)) push("instantiates", currentFunction, head.text)
        } else if (head.type === "identifier") {
          if (declared.has(head.text)) push("calls", currentFunction, head.text)
        }
      }
    } else if (node.type === "type_signature") {
      // A signature is a TYPE tree — no call sites inside, and the analyzer
      // skips its children, so the oracle does too.
      continue
    }

    if (pushedScope) stack.push({ node, exit: true })
    const children = kids(node)
    for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i] })
  }
  return edges
}

export function deriveZigEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seenCalls = new Set<string>()
  const seenUses = new Set<string>()
  // ZGD1/ZGD5/ZGD5b oracle mirroring (zig wave M37 #600): F5 previously only
  // compared calls/uses here, so these facets were gate-invisible on BOTH
  // sides. Now the oracle is the independent derivation the differential
  // was always meant to be.
  const TYPE_POSITIONS = new Set(["parameter", "container_field", "function_declaration"])
  const leafOf = (fe: any): string | undefined => {
    if (!fe) return undefined
    const last = fe.namedChildCount > 0 ? fe.namedChild(fe.namedChildCount - 1) : null
    if (last && last.type === "identifier") return last.text
    return undefined
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "call_expression") {
      const callee = n.namedChildCount > 0 ? n.namedChild(0) : null
      let leaf: string | undefined
      if (callee && callee.type === "identifier") leaf = callee.text
      else if (callee && callee.type === "field_expression") leaf = leafOf(callee)
      // ZGD4 mirror: usingnamespace is an import operator, not a user symbol.
      if (leaf === "usingnamespace") leaf = undefined
      if (leaf && !seenCalls.has("call:" + leaf)) {
        seenCalls.add("call:" + leaf)
        edges.push({ label: "calls", from: "(expr)", target: leaf })
      }
    }
    if (n.type === "field_expression") {
      const parent = (n as any).parent
      const isCallee = !!parent && parent.type === "call_expression"
      // ZGD5: single-named-child field_expression is `.bad` enum literal /
      // `.{...}` init field — no base, not a member read.
      const isEnumLiteral = n.namedChildCount < 2
      // ZGD1: zig assignments parse as variable_declaration, LHS = first
      // named child (probe-verified). An assignment LHS is a WRITE.
      const isAssignLhs = !!parent && parent.type === "variable_declaration" && parent.namedChild(0)?.id === n.id
      // ZGD5b: type-annotation positions are declared-type facts, not reads.
      const isTypePos = !!parent && TYPE_POSITIONS.has(parent.type)
      if (!isCallee && !isEnumLiteral && !isAssignLhs && !isTypePos) {
        const leaf = leafOf(n)
        if (leaf && !seenUses.has("use:" + leaf)) {
          seenUses.add("use:" + leaf)
          edges.push({ label: "uses", from: "(expr)", target: leaf })
        }
      }
    }
    for (let k = n.namedChildCount - 1; k >= 0; k--) {
      const c = n.namedChild(k)
      if (c) stack.push(c)
    }
  }
  return edges
}

export function deriveZigBareUses(root: any, symbols: any[] = []): { label: string; from: string; target: string }[] {
  // Z3 mirror (zig review): bare value reads (`return MAX`) — the analyzer
  // and this oracle were BOTH blind to them. Same contract as the analyzer,
  // rule for rule: file-scope const/var/fn/enum-member resolution (plus the
  // global error-member set for `error.X` value leaves), declaration
  // positions (first-identifier rule), call-callee span climb, member
  // leaves (field path owns them), qualified non-leaves, labels, blank,
  // LHS writes, shadowing via walk-order lexical scopes.
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const fileValues = new Set<string>()
  const enumMembers = new Set<string>()
  // Name inventory comes from the analyzer's own symbols (passed by the
  // lane): file-scope Constant/Variable/Function/EnumMember kinds plus ALL
  // EnumMember names globally. Truth still derives every EDGE independently
  // from tree structure (positions, gates, shadowing) — only the name
  // inventory is shared ground truth, exactly like the grammar itself. This
  // permanently closes the pre-pass-divergence class (owner-blindness,
  // kind-dispatch order, container attribution) that produced 70+ phantom
  // MISSING edges when the oracle re-derived declarations on its own.
  for (const s of symbols ?? []) {
    if (!s || typeof s.name !== "string") continue
    const k = String(s.kind ?? "");
    const isEnumMember = k === "EnumMember" || k === "enummember" || k === "enum_member";
    if (isEnumMember) enumMembers.add(s.name);
    const isValue = k === "Constant" || k === "constant" || k === "Variable" || k === "variable" || k === "Function" || k === "function" || isEnumMember;
    if (isValue && !s.ownerName && !s.owner) fileValues.add(s.name);
  }
  const scopes: Array<Set<string>> = []
  const shadowed = (name: string): boolean => {
    for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(name)) return true
    return false
  }
  const bindIds = (node: any, out: Set<string>): void => {
    const w: any[] = [node]
    while (w.length > 0) {
      const m = w.pop()!
      if (m !== node && (m.type === "call_expression" || m.type === "composite_literal" || m.type === "func_literal" || m.type === "block" || m.type === "block_expression")) continue
      if (m.type === "identifier" && m.text !== "_") out.add(m.text)
      for (let i = m.namedChildCount - 1; i >= 0; i--) { const c = m.namedChild(i); if (c) w.push(c) }
    }
  }
  // Z7 mirror: a parameter binds its declared NAME only (see the analyzer).
  const bindFirstIdent = (node: any, out: Set<string>): void => {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === "identifier") {
        if (c.text !== "_") out.add(c.text)
        return
      }
    }
  }
  const isDefining = (n: any): boolean => {
    const p = n.parent
    if (!p) return false
    // Error sets declare EVERY direct member (mirrors the analyzer).
    if (p.type === "error_set_declaration" && n.type === "identifier") return true
    if (p.type === "variable_declaration") {
      for (let i = 0; i < p.namedChildCount; i++) {
        const c = p.namedChild(i)
        if (c && c.type === "identifier") return c.startIndex === n.startIndex && c.endIndex === n.endIndex
      }
      return false
    }
    if (
      p.type === "function_declaration" || p.type === "test_declaration" ||
      p.type === "struct_item" || p.type === "enum_item" ||
      p.type === "union_item" || p.type === "type_item" ||
      p.type === "mod_item" || p.type === "package_clause" ||
      p.type === "container_field"
    ) {
      for (let i = 0; i < p.namedChildCount; i++) {
        const c = p.namedChild(i)
        if (c && (c.type === "identifier" || c.type === "type_identifier" || c.type === "field_identifier")) {
          return c.startIndex === n.startIndex && c.endIndex === n.endIndex
        }
      }
    }
    return false
  }
  const isCallee = (n: any): boolean => {
    let top: any = n
    let p: any = n.parent
    while (p && p.type !== "call_expression" && p.type !== "block" && p.type !== "function_declaration") {
      top = p
      p = p.parent
    }
    if (!p || p.type !== "call_expression") return false
    const first = p.namedChildCount > 0 ? p.namedChild(0) : null
    return !!first && top.startIndex >= first.startIndex && top.endIndex <= first.endIndex
  }
  const hasToken = (n: any, tok: string): boolean => {
    for (let i = 0; i < (n.childCount ?? 0); i++) {
      const c = n.child(i)
      if (c && !c.isNamed && c.type === tok) return true
    }
    return false
  }
  const stack: any[] = [{ n: root, exit: false, pushed: false }]
  while (stack.length > 0) {
    const { n, exit, pushed } = stack.pop()!
    if (exit) {
      if (pushed) scopes.pop()
      continue
    }
    const t = n.type
    let pushedScope = false
    if (t === "function_declaration") {
      const frame = new Set<string>()
      const pw: any[] = [n]
      while (pw.length > 0) {
        const m = pw.pop()!
        if (m.type !== "function_declaration" || m === n) {
          if (m.type === "parameter") bindFirstIdent(m, frame)
          for (let i = m.namedChildCount - 1; i >= 0; i--) {
            const c = m.namedChild(i)
            if (c && c.type !== "block" && c.type !== "block_expression" && c.type !== "function_declaration") pw.push(c)
          }
        }
      }
      scopes.push(frame)
      pushedScope = true
    } else if (t === "block" || t === "block_expression") {
      scopes.push(new Set<string>())
      pushedScope = true
    } else if (t === "switch_case") {
      // Z6 mirror: captures are scoped to their own switch arm (see the
      // analyzer). Same push/pop mechanics, same empty-at-entry property.
      scopes.push(new Set<string>())
      pushedScope = true
    } else if (t === "payload") {
      if (scopes.length > 0) bindIds(n, scopes[scopes.length - 1])
    } else if (t === "variable_declaration") {
      if (scopes.length > 0 && (hasToken(n, "var") || hasToken(n, "const"))) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "identifier") {
            if (c.text !== "_") scopes[scopes.length - 1].add(c.text)
            break
          }
          break
        }
      }
    } else if (t === "identifier") {
      const name = n.text
      const p = n.parent
      let inError = false
      if (p && p.type === "error_type" && p.namedChildCount > 0) {
        const last = p.namedChild(p.namedChildCount - 1)
        if (last && last.startIndex === n.startIndex && last.endIndex === n.endIndex) {
          let q: any = p.parent
          let typePos = false
          while (q) {
            if (q.type === "parameter" || q.type === "container_field") { typePos = true; break }
            if (
              q.type === "variable_declaration" || q.type === "arguments" ||
              q.type === "return_expression" || q.type === "call_expression" ||
              q.type === "function_declaration" || q.type === "block" ||
              q.type === "block_expression"
            ) break
            q = q.parent
          }
          if (!typePos) inError = true
        }
      }
      const isLabel = p && (p.type === "labeled_statement" || p.type === "label_name" || p.type === "block_label" || p.type === "break_label" || p.type === "continue_label")
      let qualified = false
      {
        let cur: any = n.parent
        while (cur) {
          if (cur.type === "qualified_type") { qualified = true; break }
          if (
            cur.type === "call_expression" || cur.type === "field_declaration" ||
            cur.type === "function_declaration" || cur.type === "block" ||
            cur.type === "block_expression" || cur.type === "composite_literal" ||
            cur.type === "variable_declaration" || cur.type === "assignment_statement"
          ) break
          cur = cur.parent
        }
      }
      let lhsWrite = false
      if (p && p.type === "field_expression") {
        lhsWrite = true
      } else if (p && (p.type === "assignment_statement" || p.type === "compound_assignment_statement")) {
        const lhs = p.namedChild(0)
        lhsWrite = !!lhs && lhs.startIndex === n.startIndex && (lhs.endIndex ?? 0) >= n.endIndex
      }
      // Field path owns member leaves AND objects (leaf-only contract,
      // mirroring the analyzer's parent check exactly).
      const underField = !!p && p.type === "field_expression"
      if (
        name && name !== "_" && !name.startsWith("$") &&
        !isDefining(n) && !isCallee(n) && !underField && !qualified && !isLabel &&
        !shadowed(name) &&
        (fileValues.has(name) || (inError && enumMembers.has(name)))
      ) {
        const k = "uses|" + name
        if (!seen.has(k)) { seen.add(k); edges.push({ label: "uses", from: "(expr)", target: name }) }
      }
    }
    stack.push({ n, exit: true, pushed: pushedScope })
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push({ n: c, exit: false, pushed: false })
    }
  }
  return edges
}
// Rust truth: call edges (identifier + member-leaf callees), implements
// (impl <Trait> for Type), extends (supertrait bounds on trait items).
// Exported like the zig/cpp oracles so lane replicas and probes can verify
// the mirror directly.
export function deriveRustEdges(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seenCalls = new Set<string>()
  const impls: { ty: string; trait: string }[] = []
  const supertraits: Record<string, string[]> = {}
  // D2 mirror (rust extreme review): the analyzer resolves `Self` to the
  // enclosing impl type in struct literals (`Self { }`), `Self::new()` and
  // bare `Self(..)` (cargo src/compiler/rustdoc.rs + manifest/mod.rs lanes:
  // oracle emitted raw Self while the analyzer emitted RustdocExternMap /
  // RegistryName — one disagreement surfacing as a MISSING+UNEXPLAINED
  // pair). Same rule here: resolve via the enclosing impl_item's type leaf,
  // fall back exactly like the analyzer (struct literals keep raw "Self",
  // calls drop it).
  const enclosingImplType = (n: any): string | null => {
    let cur: any = n ? n.parent : null
    while (cur) {
      // R10 mirror: `Self` is the implemented TYPE, so it resolves to that
      // type's nominal LEAF — and when the type has none, to ABSENCE.
      if (cur.type === "impl_item") return rustImplSelfTypeName(cur.childForFieldName?.("type"))
      cur = cur.parent
    }
    return null
  }

  // In-file declared type names (struct/enum/type-alias/impl targets),
  // mirroring the analyzer's deferred-instantiation contract: ctor
  // instantiates resolve ONLY to types declared in this file (std/foreign
  // receivers like String::new() are deliberately not truth). Impl types
  // are stored as FULL text (io::Error) to mirror the analyzer's inFile
  // symbol names - a foreign type implemented here is not a local
  // declaration and must not resolve io::Error::new() to the leaf Error.
  const declaredTypes = new Set<string>()
  {
    const pre: any[] = [root]
    while (pre.length > 0) {
      const n = pre.pop()!
      if (n.type === "struct_item" || n.type === "enum_item" || n.type === "type_item") {
        const nm = n.childForFieldName?.("name") ?? n.namedChild(0)
        if (nm) declaredTypes.add(nm.text)
      } else if (n.type === "impl_item") {
        // R10 mirror: the impl participates in the deferred ctor filter under
        // the name the analyzer PUBLISHES for it (the type's own un-wrapped
        // spelling, or the declared synthetic when it has no nominal name).
        const typeN = n.childForFieldName?.("type")
        if (typeN) declaredTypes.add(rustImplSymbolName(typeN) ?? "anonymous_impl")
      }
      for (let k = 0; k < n.namedChildCount; k++) pre.push(n.namedChild(k))
    }
  }

  const stack: any[] = [root]
  const leafOf = (fn: any): string | undefined => {
    if (!fn) return undefined
    if (fn.type === "identifier") {
      // R10 mirror: `Self(..)` calls the enclosing impl type's constructor —
      // `Self` is a KEYWORD, never a symbol name, so the callee's name is the
      // type's; unresolvable (a trait default body) means the callee has no
      // name and the edge is not truth either.
      if (fn.text === "Self") return enclosingImplType(fn) ?? undefined
      return fn.text
    }
    // turbofish: foo::<T>() wraps the real callee - unwrap it.
    if (fn.type === "generic_function") {
      const inner = fn.childForFieldName?.("function")
      return leafOf(inner)
    }
    if (fn.type === "field_expression" || fn.type === "scoped_identifier") {
      const leaf = fn.namedChildren[fn.namedChildCount - 1]
      return leaf?.type === "field_identifier" || leaf?.type === "identifier" ? leaf.text : undefined
    }
    return undefined
  }
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "macro_invocation") {
      // macro invocations are real call sites (format!/write!/vec!...)
      const mn = n.namedChildren.find((c: any) => c.type === "identifier" || c.type === "scoped_identifier")
      let mname = mn ? mn.namedChildren[mn.namedChildCount - 1]?.text ?? mn.text : undefined
      if (mname && !seenCalls.has("macro:" + mname)) {
        seenCalls.add("macro:" + mname)
        edges.push({ label: "calls", from: "(expr)", target: mname })
      }
    }
    if (n.type === "call_expression") {
      const fn = n.childForFieldName?.("function")
      const name = leafOf(fn)
      if (name && !seenCalls.has(name)) {
        seenCalls.add(name)
        edges.push({ label: "calls", from: "(expr)", target: name })
      }
      // ::new / Type() constructor instantiation truth mirrors the family:
      // receiver-type leaf for ::new, PascalCase leaf for tuple ctors.
      // FILTERED to in-file declared types - the analyzer resolves ctor
      // instantiates only for locally-declared types (deferred resolution),
      // so std/foreign receivers (String::new(), Arc::new()) are not truth.
      if (fn) {
        // Mirror the analyzer's ctor contract EXACTLY:
        //   Foo::new() on a field/scoped receiver -> instantiates(Foo leaf)
        //   Bare PascalCase Foo(...) identifier callee -> instantiates(Foo)
        // Enum-variant constructions (Token::Literal('.')) are CALLS, not
        // instantiates - the analyzer emits calls Literal there and never
        // instantiates Token (fixture-pinned contract). Bare identifiers
        // have no named children, so calleeLeaf is undefined - use fn.text.
        const calleeLeaf = fn.namedChildren[fn.namedChildCount - 1]
        const isNewCtor = calleeLeaf?.text === "new"
        const barePascal = fn.type === "identifier" && /^[A-Z]/.test(fn.text)
        if (
          (isNewCtor && (fn.type === "field_expression" || fn.type === "scoped_identifier")) ||
          (barePascal && fn.type === "identifier")
        ) {
          let recv: string | undefined
          if (fn.type === "identifier") recv = fn.text
          else {
            const r2 = fn.childForFieldName?.("value") ?? fn.childForFieldName?.("path")
            recv = lastSegment((r2?.text ?? "").split("<")[0].trim())
          }
          // D2 mirror: a `Self` receiver / bare `Self(..)` constructs the
          // enclosing impl type (matches the analyzer's enclosingImplType
          // rule; unresolvable Self drops like the analyzer's ?? null).
          if (recv === "Self") recv = enclosingImplType(n) ?? ""
          if (recv && /^[A-Z]/.test(recv) && declaredTypes.has(recv) && !seenCalls.has("inst:" + recv)) {
            seenCalls.add("inst:" + recv)
            edges.push({ label: "instantiates", from: "(expr)", target: recv })
          }
        }
      }
    } else if (n.type === "struct_expression") {
      const typeNode = n.childForFieldName?.("name") ?? n.namedChild(0)
      // CARGO-D1 (two-corpus gate, cargo tree.rs:242): a QUALIFIED struct
      // literal `cargo_tree::TreeOptions { .. }` carries a scoped_type_
      // identifier whose text starts LOWERCASE (the crate/module path), so a
      // whole-text /^[A-Z]/ test silently dropped the construction while the
      // analyzer (leaf contract) emitted instantiates TreeOptions. Casing is
      // judged on the LEAF segment (the type), matching the analyzer.
      if (typeNode) {
        const rawLeaf = lastSegment(typeNode.text)
        // D2 mirror: `Self { }` constructs the enclosing impl type
        // (analyzer emits the resolved type immediately with no in-file
        // filter; unresolvable Self keeps the raw leaf on both sides).
        let t2 = rawLeaf.split("<")[0].trim()
        // R10 mirror: an unresolvable `Self` literal constructs an UNNAMED
        // type, and the analyzer now emits nothing for it (R7 absence) — the
        // old `?? "Self"` kept a target no symbol has.
        if (t2 === "Self") t2 = enclosingImplType(n) ?? ""
        if (/^[A-Z]/.test(t2) && !seenCalls.has("struct:" + t2)) {
          seenCalls.add("struct:" + t2)
          edges.push({ label: "instantiates", from: "(expr)", target: t2 })
        }
      }
    } else if (n.type === "impl_item") {
      const traitN = n.childForFieldName?.("trait")
      const typeN = n.childForFieldName?.("type")
      if (traitN && typeN) {
        // R10 mirror: the edge's SOURCE is the impl symbol's published name.
        const tName = rustImplSymbolName(typeN) ?? "anonymous_impl"
        const trName = lastSegment(traitN.text.split("<")[0].trim())
        if (tName && trName) {
          edges.push({ label: "implements", from: tName, target: trName })
          impls.push({ ty: tName, trait: trName })
        }
      }
    } else if (n.type === "trait_item") {
      const nameNode = n.childForFieldName?.("name")
      const boundsNode = n.childForFieldName?.("bounds")
      if (nameNode && boundsNode) {
        const supers: string[] = []
        for (const c of boundsNode.namedChildren) {
          if (!c || c.type === "type_parameters" || c.type === "where_clause") continue
          let bn = c.text.split("<")[0].split(":").pop() || ""
          bn = lastSegment(bn.trim())
          if (/^[A-Za-z_]/.test(bn)) supers.push(bn)
        }
        if (supers.length) supertraits[nameNode.text] = supers
      }
    }
    for (let k = 0; k < n.namedChildCount; k++) stack.push(n.namedChild(k))
  }
  // supertrait extends truth
  for (const [tr, supers] of Object.entries(supertraits)) {
    for (const sp of supers) edges.push({ label: "extends", from: tr, target: sp })
  }
  return edges
}

// Rust truth: bare value reads AND field reads (`uses`). R1 mirror (rust
// review #798): the analyzer emitted both while this oracle derived neither,
// so rust's entire read surface sat OUTSIDE the comparison by construction —
// a restored read rode a fixture and its mutant but no corpus lane, which is
// the declared limitation the issue recorded (and the same gap groovy's G7
// closed the same way).
//
// Same contract as the analyzer, rule for rule: file-scope VALUE resolution
// (const/static/fn/enum-variant/struct/enum/union/type, module-scoped),
// use-imported leaves (alias- and scoped-path-aware), declaration positions
// (item-name rule), call callees (turbofish `generic_function` +
// `parenthesized_expression` climb), member leaves owned by the field path,
// qualified non-leaves, LHS writes, macro-rule bodies vs invocation args,
// attributes, use paths, where-bounds, and shadowing via per-function
// pattern bindings (incl. closure params, destructured/let-condition/for/
// match-arm patterns and the uppercase path-pattern rule).
//
// DISCLOSED, not hidden: this is a mirror, so it cannot adjudicate the one
// thing it shares with the analyzer — a wrong RULE reads green on both sides.
// It catches dropouts and fabrications against the rule, which is what a
// coverage oracle is for; the independent evidence for the rule itself stays
// the fixtures (rust/bare-value-reads) and the six reverting mutants.
export function deriveRustBareUses(root: any): { label: string; from: string; target: string }[] {
  const out: { label: string; from: string; target: string }[] = []
  const owners = new Map<string, Set<string>>()
  const useImported = new Set<string>()

  const addOwner = (name: string | null, mods: string[]): void => {
    if (!name) return
    let s = owners.get(name)
    if (!s) { s = new Set<string>(); owners.set(name, s) }
    if (mods.length === 0) s.add("")
    else for (const m of mods) s.add(m)
  }
  const leftmostId = (n: any): string | null => {
    let cur: any = n
    while (cur) {
      if (cur.type === "identifier") return cur.text
      cur = cur.namedChild(0)
    }
    return null
  }
  // The analyzer's useLeafNames: a bare path binds its leaf; a scoped path
  // binds its LAST segment (only when it is a direct path or a group leaf);
  // `as` binds the alias.
  const useLeafNames = (node: any): string[] => {
    const res: string[] = []
    const walk = (n: any): void => {
      if (!n) return
      if (n.type === "identifier" || n.type === "type_identifier") {
        if (n.parent && (n.parent.type === "use_declaration" || n.parent.type === "use_list")) res.push(n.text)
        return
      }
      if (n.type === "scoped_identifier") {
        const par = n.parent
        if (par && (par.type === "use_declaration" || par.type === "use_list")) {
          const last = n.namedChild(n.namedChildCount - 1)
          if (last && (last.type === "identifier" || last.type === "type_identifier")) {
            const t = last.text
            if (t && t !== "self" && t !== "super" && t !== "crate") res.push(t)
          }
        }
        return
      }
      if (n.type === "use_as_clause") {
        const alias = n.childForFieldName?.("alias") || n.namedChild(n.namedChildCount - 1)
        if (alias) res.push(alias.text)
        return
      }
      if (n.type === "self") return
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type !== "visibility_modifier" && c.type !== "use" && c.type !== "crate") walk(c)
    }
    return res
  }

  // ---- inventory: file-visible VALUES with their module scopes -----------
  {
    const stack: Array<{ n: any; mods: string[]; inFn: boolean; inImpl: boolean }> = [
      { n: root, mods: [], inFn: false, inImpl: false },
    ]
    while (stack.length > 0) {
      const { n, mods, inFn, inImpl } = stack.pop()!
      const t = n.type
      if (t === "mod_item") {
        const nm = n.childForFieldName?.("name")?.text
        const body = n.namedChild(n.namedChildCount - 1)
        const hasBody = !!body && body.type === "declaration_list"
        if (nm && hasBody) {
          for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push({ n: n.namedChild(i), mods: [...mods, nm], inFn, inImpl })
          continue
        }
      } else if (t === "function_item") {
        if (!inImpl) {
          const nm = n.childForFieldName?.("name")?.text
          if (nm) addOwner(nm, mods)
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push({ n: n.namedChild(i), mods, inFn: true, inImpl })
        continue
      } else if (t === "impl_item" || t === "trait_item") {
        for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push({ n: n.namedChild(i), mods, inFn, inImpl: true })
        continue
      } else if (!inFn && (t === "const_item" || t === "static_item")) {
        const nm = n.childForFieldName?.("name")?.text ?? leftmostId(n)
        if (nm && nm !== "_" && !inImpl) addOwner(nm, mods)
        for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push({ n: n.namedChild(i), mods, inFn: true, inImpl })
        continue
      } else if (!inFn && !inImpl && (t === "struct_item" || t === "enum_item" || t === "union_item" || t === "type_item")) {
        const nm = n.childForFieldName?.("name")?.text
        if (nm) addOwner(nm, mods)
      } else if (t === "enum_variant") {
        const nm = n.childForFieldName?.("name")?.text ?? n.namedChild(0)?.text
        if (nm && !inFn) addOwner(nm, mods)
      } else if (t === "use_declaration") {
        for (const leaf of useLeafNames(n)) {
          if (leaf && leaf !== "self" && leaf !== "*") useImported.add(leaf)
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push({ n: n.namedChild(i), mods, inFn, inImpl })
    }
  }

  const enclosingMods = (node: any): string[] => {
    const res: string[] = []
    let cur: any = node ? node.parent : null
    while (cur) {
      if (cur.type === "mod_item") {
        const nm = cur.childForFieldName?.("name")?.text
        if (nm) res.unshift(nm)
      }
      cur = cur.parent
    }
    return res
  }
  const resolves = (nm: string, mods: string[]): boolean => {
    const o = owners.get(nm)
    if (!o) return useImported.has(nm)
    if (o.has("")) return true
    if (useImported.has(nm)) return true
    for (const m of mods) if (o.has(m)) return true
    return false
  }

  const collectPatternIds = (node: any, bound: Set<string>, mods: string[], isDecl: boolean): void => {
    if (!node) return
    if (node.type === "identifier") {
      const nm = node.text
      if (!nm || nm === "_" || nm.startsWith("$")) return
      const first = nm.charCodeAt(0)
      if (first >= 65 && first <= 90 && !isDecl && resolves(nm, mods)) return
      bound.add(nm)
      return
    }
    if (
      node.type === "type_identifier" || node.type === "scoped_identifier" ||
      node.type === "field_identifier" || node.type === "lifetime" ||
      node.type === "primitive_type"
    ) return
    if (node.type === "tuple_struct_pattern") {
      for (let i = 1; i < node.namedChildCount; i++) collectPatternIds(node.namedChild(i), bound, mods, isDecl)
      return
    }
    for (let i = 0; i < node.namedChildCount; i++) collectPatternIds(node.namedChild(i), bound, mods, isDecl)
  }

  // ---- per-function bound-name sets (shadowing) --------------------------
  const fnBindings = new Map<number, Set<string>>()
  {
    const stack: any[] = [root]
    const fns: any[] = []
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "function_item") fns.push(n)
      for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
    }
    for (const fn of fns) {
      const bound = new Set<string>()
      const fnMods = enclosingMods(fn)
      const params = fn.childForFieldName?.("parameters")
      if (params) {
        for (let i = 0; i < params.namedChildCount; i++) {
          const p = params.namedChild(i)
          if (!p || p.type === "self_parameter") continue
          const pat = p.childForFieldName?.("pattern") ?? p
          collectPatternIds(pat, bound, fnMods, true)
        }
      }
      const body: any[] = [fn]
      while (body.length > 0) {
        const m = body.pop()!
        if (m.type === "let_declaration") {
          const pat = m.childForFieldName?.("pattern") ?? m.namedChild(0)
          collectPatternIds(pat, bound, fnMods, true)
        } else if (m.type === "let_condition") {
          collectPatternIds(m.namedChild(0), bound, fnMods, false)
        } else if (m.type === "for_expression") {
          collectPatternIds(m.namedChild(0), bound, fnMods, true)
        } else if (m.type === "closure_expression") {
          for (let i = 0; i < m.namedChildCount; i++) {
            const c = m.namedChild(i)
            if (c && c.type === "closure_parameters") collectPatternIds(c, bound, fnMods, true)
          }
        } else if (m.type === "match_arm") {
          const patField = m.childForFieldName?.("pattern")
          if (patField) {
            const psub: any[] = [patField]
            while (psub.length > 0) {
              const q = psub.pop()!
              if (q !== patField && (q.type === "let_declaration" || q.type === "let_condition" || q.type === "for_expression")) continue
              if (
                q.type === "match_pattern" || q.type === "identifier" ||
                q.type === "tuple_pattern" || q.type === "struct_pattern" ||
                q.type === "tuple_struct_pattern" || q.type === "ref_pattern" ||
                q.type === "or_pattern" || q.type === "slice_pattern"
              ) collectPatternIds(q, bound, fnMods, false)
              for (let i = q.namedChildCount - 1; i >= 0; i--) psub.push(q.namedChild(i))
            }
          }
          const sub: any[] = [m]
          while (sub.length > 0) {
            const q = sub.pop()!
            if (q !== m && (q.type === "let_declaration" || q.type === "let_condition" || q.type === "for_expression")) continue
            if (
              q.type === "tuple_pattern" || q.type === "struct_pattern" ||
              q.type === "tuple_struct_pattern" || q.type === "ref_pattern" ||
              q.type === "or_pattern" || q.type === "slice_pattern"
            ) collectPatternIds(q, bound, fnMods, false)
            for (let i = q.namedChildCount - 1; i >= 0; i--) sub.push(q.namedChild(i))
          }
        }
        if (m !== fn && (m.type === "function_item" || m.type === "const_item" || m.type === "static_item")) continue
        for (let i = m.namedChildCount - 1; i >= 0; i--) body.push(m.namedChild(i))
      }
      fnBindings.set(fn.startIndex, bound)
    }
  }

  const hasAncestor = (node: any, types: string | string[], stopAt: string[] | null): boolean => {
    const want = Array.isArray(types) ? types : [types]
    let cur: any = node.parent
    while (cur) {
      if (want.includes(cur.type)) return true
      if (stopAt) for (const s of stopAt) if (cur.type === s) return false
      cur = cur.parent
    }
    return false
  }
  const isItemNamePosition = (node: any, parent: any): boolean => {
    switch (parent.type) {
      case "function_item": case "struct_item": case "enum_item":
      case "trait_item": case "mod_item": case "type_item":
      case "associated_type": case "static_item": case "const_item":
      case "enum_variant": case "field_declaration": case "extern_crate_declaration":
        break
      default: return false
    }
    for (let i = 0; i < parent.namedChildCount; i++) {
      const c = parent.namedChild(i)
      if (c && (c.type === "identifier" || c.type === "type_identifier" || c.type === "field_identifier")) {
        return c.startIndex === node.startIndex && c.endIndex === node.endIndex
      }
    }
    return false
  }

  // ---- reads -------------------------------------------------------------
  const seen = new Set<string>()
  const emit = (target: string): void => {
    if (!target || seen.has(target)) return
    seen.add(target)
    out.push({ label: "uses", from: "global", target })
  }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "identifier") {
      const name = n.text
      const p = n.parent
      let skip = !name || name === "_" || name === "self" || name === "Self" || name === "super" || name === "crate" || name.startsWith("$")
      if (!skip) {
        if (hasAncestor(n, "macro_definition", ["macro_invocation"])) skip = true
        else if (hasAncestor(n, "attribute_item", ["function_item", "struct_item", "enum_item", "impl_item", "trait_item", "mod_item"])) skip = true
        else if (hasAncestor(n, "use_declaration", null)) skip = true
        else if (hasAncestor(n, "where_predicate", null)) skip = true
      }
      if (!skip) {
        // callee (climbs turbofish + parenthesized wrappers)
        let top: any = n
        let up: any = p
        while (up && (up.type === "generic_function" || up.type === "parenthesized_expression")) { top = up; up = up.parent }
        if (up && up.type === "call_expression") {
          const fnField = up.childForFieldName?.("function")
          if (fnField && fnField.startIndex === top.startIndex && fnField.endIndex >= top.endIndex) skip = true
          const first = up.namedChild(0)
          if (!skip && first && first.startIndex === top.startIndex && first.endIndex >= top.endIndex) skip = true
        }
      }
      if (!skip && p && p.type === "field_expression") {
        const field = p.childForFieldName?.("field")
        if (field && field.startIndex === n.startIndex) skip = true
      }
      if (!skip && p && p.type === "scoped_identifier") {
        const last = p.namedChild(p.namedChildCount - 1)
        if (!last || last.startIndex !== n.startIndex) skip = true
      } else if (!skip && hasAncestor(n, "scoped_identifier", ["call_expression", "field_expression"])) {
        skip = true
      }
      if (!skip && p && (p.type === "assignment_expression" || p.type === "compound_assignment_expr")) {
        const lhs = p.namedChild(0)
        if (lhs && lhs.startIndex === n.startIndex && lhs.endIndex >= n.endIndex) skip = true
      }
      if (!skip && p && isItemNamePosition(n, p)) skip = true
      if (!skip) {
        let fnNode: any = p
        while (fnNode && fnNode.type !== "function_item") fnNode = fnNode.parent
        if (fnNode) {
          const bound = fnBindings.get(fnNode.startIndex)
          if (bound && bound.has(name)) skip = true
        }
      }
      if (!skip && resolves(name, enclosingMods(n))) emit(name)
    } else if (n.type === "field_expression") {
      // The analyzer's field branch: a field_identifier read is a `uses` edge
      // unless it is the LHS of a write or the callee of a call (tuples parse
      // as field_expression with an integer_literal field — not a symbol).
      const field = n.childForFieldName?.("field")
      const par = n.parent
      let isAssignLhs = false
      if (par && (par.type === "assignment_expression" || par.type === "compound_assignment_expr")) {
        const left = par.namedChild(0)
        if (left && left.startIndex === n.startIndex && left.endIndex === n.endIndex) isAssignLhs = true
      }
      if (
        !isAssignLhs && field && field.type === "field_identifier" &&
        String(field.text).trim() && par?.type !== "call_expression"
      ) emit(field.text)
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
  }
  return out
}

// Rust truth: declared-type `references` (R13). The analyzer published these
// from fn params/returns, struct/union/enum field types, type aliases and
// const/static types, while the oracle derived none of it — 2,883 edges over
// 84 of ripgrep's 110 files sat outside the comparison. Rule for rule mirror
// (generic-parameter exclusion incl. the enclosing-item climb, `Self` → the
// enclosing impl type, macro-rule bodies excluded, where-bounds and
// type-parameter lists never collected, field NAME identifiers never types).
export function deriveRustDeclaredTypeRefs(root: any): { label: string; from: string; target: string }[] {
  const out: { label: string; from: string; target: string }[] = []
  const emitted = new Set<string>()
  const enclosingImplType = (n: any): string | null => {
    let cur: any = n ? n.parent : null
    while (cur) {
      // R10 mirror: `Self` is the implemented TYPE, so it resolves to that
      // type's nominal LEAF — and when the type has none, to ABSENCE (R7).
      if (cur.type === "impl_item") return rustImplSelfTypeName(cur.childForFieldName?.("type"))
      cur = cur.parent
    }
    return null
  }
  const genericParamsOf = (item: any): Set<string> => {
    const res = new Set<string>()
    let gcur: any = item
    while (gcur) {
      if (
        gcur.type === "function_item" || gcur.type === "trait_item" ||
        gcur.type === "struct_item" || gcur.type === "enum_item" ||
        gcur.type === "type_item" || gcur.type === "impl_item"
      ) {
        const tp = gcur.childForFieldName?.("type_parameters")
        if (tp) {
          const pw: any[] = [tp]
          while (pw.length > 0) {
            const m = pw.pop()!
            if (m.type === "type_identifier" || m.type === "identifier") res.add(m.text)
            for (let k = 0; k < m.namedChildCount; k++) pw.push(m.namedChild(k))
          }
        }
        break
      }
      gcur = gcur.parent
    }
    return res
  }
  const push = (source: string, leafNode: any, gparams: Set<string>): void => {
    let target = leafNode.text
    if (!target || target === "Self") {
      const resolved = enclosingImplType(leafNode)
      if (!resolved) return
      target = resolved
    }
    if (gparams.has(target)) return
    // Dedupe keyed by TARGET alone, i.e. by (label, target) here, because this
    // oracle emits exactly one label. That is the file-wide TRUTH-SIDE
    // INVARIANT every oracle in this harness keeps (see the note at the
    // analyzer-collapse site: "The tree-truth oracles already emit UNIQUE
    // (label,target) edges per file") and it is what the coverage match reads —
    // the match is deliberately site-agnostic, comparing label+normTarget and
    // never `from`. A source-scoped key was tried and reverted: it made truth
    // carry duplicate (references, Err) rows for `fn b<..>() -> T::Err` and
    // `fn c<..>() -> T::Err`, so treeEdgesTotal inflated 6,309 -> 8,278 on
    // ripgrep and the lane's number stopped being comparable to its peers'
    // (the analyzer side is collapsed to unique (label,target), so the same
    // edge counted twice on one side and once on the other). An oracle must
    // mirror the GATE; a synthetic probe that compares `from` as well is
    // asking a question this comparison does not ask.
    if (emitted.has(target)) return
    emitted.add(target)
    out.push({ label: "references", from: source, target })
  }
  // R8/R15 mirror: the generic parameters bound by EVERY enclosing generic item
  // (the analyzer walks the whole chain — see real-rust-analyzer.ts), used to
  // exclude locally-bound names from a where predicate.
  const chainGenericParams = (n: any): Set<string> => {
    const res = new Set<string>()
    let cur: any = n ? n.parent : null
    while (cur) {
      if (
        cur.type === "function_item" || cur.type === "function_signature_item" ||
        cur.type === "trait_item" || cur.type === "struct_item" ||
        cur.type === "enum_item" || cur.type === "type_item" || cur.type === "impl_item"
      ) {
        const tp = cur.childForFieldName?.("type_parameters")
        if (tp) {
          const pw: any[] = [tp]
          while (pw.length > 0) {
            const m = pw.pop()!
            if (m.type === "type_identifier" || m.type === "identifier") res.add(m.text)
            for (let k = 0; k < m.namedChildCount; k++) pw.push(m.namedChild(k))
          }
        }
      }
      cur = cur.parent
    }
    return res
  }
  const collectLeaves = (typeNode: any): any[] => {
    const res: any[] = []
    if (!typeNode) return res
    const w: any[] = [typeNode]
    while (w.length > 0) {
      const m = w.pop()!
      if (m !== typeNode && (m.type === "where_clause" || m.type === "type_parameters")) continue
      if (m.type === "type_identifier") res.push(m)
      for (let i = m.namedChildCount - 1; i >= 0; i--) w.push(m.namedChild(i))
    }
    return res
  }
  const fieldTypeLeaves = (owner: any, src: string, gparams: Set<string>): void => {
    const fw: any[] = [owner]
    while (fw.length > 0) {
      const m = fw.pop()!
      if (m !== owner && (m.type === "where_clause" || m.type === "type_parameters")) continue
      if (m.type === "field_declaration") {
        for (let i = 0; i < m.namedChildCount; i++) {
          const c = m.namedChild(i)
          if (c && c.type !== "field_identifier" && c.type !== "visibility_modifier" && c.type !== "attribute_item") {
            for (const leaf of collectLeaves(c)) push(src, leaf, gparams)
          }
        }
        continue
      }
      if (m.type === "ordered_field_declaration_list") {
        for (let i = 0; i < m.namedChildCount; i++) {
          const c = m.namedChild(i)
          if (c) for (const leaf of collectLeaves(c)) push(src, leaf, gparams)
        }
        continue
      }
      for (let i = m.namedChildCount - 1; i >= 0; i--) fw.push(m.namedChild(i))
    }
  }
  const walk: any[] = [root]
  while (walk.length > 0) {
    const n = walk.pop()!
    const t = n.type
    if (t === "macro_definition") continue
    if (t === "function_item") {
      const src = n.childForFieldName?.("name")?.text ?? "global"
      const gparams = genericParamsOf(n)
      const params = n.childForFieldName?.("parameters")
      if (params) {
        for (let i = 0; i < params.namedChildCount; i++) {
          const p = params.namedChild(i)
          if (!p || p.type === "self_parameter") continue
          const ty = p.type === "parameter" ? p.childForFieldName?.("type") : null
          for (const leaf of collectLeaves(ty)) push(src, leaf, gparams)
        }
      }
      const ret = n.childForFieldName?.("return_type")
      for (const leaf of collectLeaves(ret)) push(src, leaf, gparams)
    } else if (t === "struct_item" || t === "union_item" || t === "enum_item") {
      const src = n.childForFieldName?.("name")?.text ?? "global"
      const gparams = genericParamsOf(n)
      fieldTypeLeaves(n, src, gparams)
    } else if (t === "type_item" || t === "associated_type") {
      const src = n.childForFieldName?.("name")?.text ?? "global"
      const gparams = genericParamsOf(n)
      const nameNode = n.childForFieldName?.("name") ?? n.namedChild(0)
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (!c || c.type === "type_parameters" || c.type === "where_clause") continue
        if (nameNode && c.startIndex === nameNode.startIndex && c.endIndex === nameNode.endIndex) continue
        for (const leaf of collectLeaves(c)) push(src, leaf, gparams)
        break
      }
    } else if (t === "const_item" || t === "static_item") {
      const nm = n.childForFieldName?.("name")?.text
      if (nm && nm !== "_") {
        const ty = n.childForFieldName?.("type")
        const gparams = genericParamsOf(n)
        for (const leaf of collectLeaves(ty)) push(nm, leaf, gparams)
      }
    } else if (t === "where_clause") {
      // R8/R15: the bounded side emits its TYPE LEAVES (never raw text), and a
      // predicate whose left side names a locally-bound generic parameter — of
      // ANY enclosing item — is not a dependency. A lifetime outlives bound
      // (`where 'a: 's`) yields no type leaf at all, which is exactly right: a
      // lifetime is not a symbol.
      const gparams = chainGenericParams(n)
      const src = n.parent?.childForFieldName?.("name")?.text ?? "global"
      // The bounded side contributes its type NAME(S): a scoped path yields its
      // `name` leaf (`anyhow::Error` -> Error, `T::Err` -> Err, `<T as X>::Err`
      // -> Err — never the module prefix or the raw text), lifetimes are not
      // types, and a name bound by ANY enclosing generic item is locally bound.
      const boundNames = (b: any): any[] => {
        if (!b) return []
        if (b.type === "scoped_type_identifier" || b.type === "scoped_identifier" || b.type === "qualified_type") {
          const nm = b.childForFieldName?.("name")
          if (nm) return [nm]
          const last = b.namedChild(b.namedChildCount - 1)
          return last && (last.type === "type_identifier" || last.type === "identifier") ? [last] : []
        }
        const res: any[] = []
        const w: any[] = [b]
        while (w.length > 0) {
          const m = w.pop()!
          if (m.type === "lifetime") continue
          if (m.type === "type_identifier") res.push(m)
          for (let k = m.namedChildCount - 1; k >= 0; k--) w.push(m.namedChild(k))
        }
        return res
      }
      // Shares `emitted` with the declared-type paths above, so the two
      // together still yield unique (label,target) per file (one label here):
      // a bound that the declared-type pass already published is not emitted
      // twice. The analyzer, by contrast, may push the same target from
      // several owners — the harness collapses its side for exactly that
      // reason, so the two are equivalent under the comparison.
      for (let i = 0; i < n.namedChildCount; i++) {
        const pred = n.namedChild(i)
        if (!pred || pred.type !== "where_predicate") continue
        for (const leaf of boundNames(pred.namedChild(0))) {
          if (!leaf.text || gparams.has(leaf.text)) continue
          if (emitted.has(leaf.text)) continue
          emitted.add(leaf.text)
          out.push({ label: "references", from: src, target: leaf.text })
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) walk.push(n.namedChild(i))
  }
  return out
}

// Independent oracle: derive extends/implements/instantiates edges straight
// from clause node structure — no analyzer code involved.
export function deriveTreeEdges(root: any, lang: string): TreeEdge[] {
  const edges: TreeEdge[] = []
  const TYPE = /type_identifier|scoped_type_identifier|generic_type|^identifier$/

  // ----------------------------------------------------------------- XML
  // A DIFFERENT ALGORITHM from the analyzer's, on purpose. The analyzer
  // (real-xml-analyzer.ts) walks RECURSIVELY, resolving each element's namespace
  // as it descends and reading declaration attributes inline as it writes the
  // edge. This oracle runs in TWO PHASES over a FLAT pre-order node list:
  //   phase 1  a scoped-stack pass that resolves, for every element, its
  //            effective namespace and its INHERITED prefix bindings
  //   phase 2  a second flat pass that reads names out of the tree and emits
  //            edges from the phase-1 tables
  //
  // Splitting resolution from emission is not style. The previous attempt at
  // this oracle resolved the namespace while sweeping and lost every root-level
  // prefix binding below the root: on grails-context.xsd it resolved the XSD
  // namespace for 1 of 62 elements, published owners as `xsd:element` where the
  // analyzer correctly published `component-scan`, and manufactured 76,372
  // "spurious" relationships and a contains-attribute recall of 0.910. A
  // second implementation that is wrong does not corroborate the first one, so
  // resolution is now a phase whose output is a TABLE the emission phase can be
  // read against, and phase 1 uses an explicit push/pop stack rather than
  // "inherit from the parent's map", which is the line that was wrong.
  if (lang === "xml") {
    // Declaration vocabularies, written out from the W3C namespace URIs rather
    // than imported from the analyzer's table, so the two can disagree.
    const XML_DECL_NS = new Set([
      "http://www.w3.org/2001/XMLSchema",
      "http://www.w3.org/1999/XSL/Transform",
      "http://relaxng.org/ns/structure/1.0",
    ])
    // The attribute a construct declares its NAME with, per vocabulary. Also
    // written independently; the analyzer keys this off node type, which is a
    // different source of truth on purpose.
    const XML_NAME_ATTR = new Set(["name", "id"])

    const nodes: any[] = []
    {
      const stack: any[] = [root]
      while (stack.length) {
        const n = stack.pop()!
        nodes.push(n)
        for (let i = n.childCount - 1; i >= 0; i--) stack.push(n.child(i))
      }
    }
    const named = (n: any, t: string) => {
      const out: any[] = []
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c?.type === t) out.push(c)
      }
      return out
    }
    const first = (n: any, t: string) => named(n, t)[0]
    const textOf = (n: any | undefined) => (n ? n.text : "")
    // first whitespace-delimited token, as a CHAR WALK. Not a regex: this file
    // must not contain one, and a name is a token exactly as often as it is a
    // bare Name node.
    const firstToken = (t: string) => {
      let i = 0
      while (i < t.length && (t.charCodeAt(i) === 0x20 || t.charCodeAt(i) === 0x09 || t.charCodeAt(i) === 0x0a || t.charCodeAt(i) === 0x0d)) i++
      let j = i
      while (j < t.length && !(t.charCodeAt(j) === 0x20 || t.charCodeAt(j) === 0x09 || t.charCodeAt(j) === 0x0a || t.charCodeAt(j) === 0x0d)) j++
      return t.slice(i, j)
    }
    const unquote = (t: string) => {
      const s = t.trim()
      if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) return s.slice(1, -1)
      return s
    }

    // ---- phase 1: namespace + inherited prefix bindings, per element
    //
    // The traversal recurses through EVERY node and only does resolution work on
    // `element` nodes. Two earlier versions got this wrong in opposite ways, and
    // both failures were silent:
    //   - returning early on a non-element node stopped the walk at the `content`
    //     node, so only the document element was ever resolved (nameOf=1 on a file
    //     with 16 elements) and every derived edge carried from:"";
    //   - descending through everything is correct precisely because only an
    //     `element` node can open a scope, so bindings cannot leak sideways out of
    //     a subtree. `document`, `content` and `prolog` are pure containers.
    const nsOf = new Map<any, string>()
    const nameOf = new Map<any, string>()
    const ownerOf = new Map<any, any>()
    {
      // Two statements on purpose: a scope must be resolved for an element's
      // CHILDREN using the scope that element OPENS, while the element's own
      // name resolution uses the scope it INHERITS. Doing both in one recursion
      // is the bug this shape exists to prevent — a declaration construct would
      // then be able to read its own `xmlns` and resolve itself into a
      // vocabulary, which is how a prefix leaks across a boundary.
      const walkScoped = (n: any, scopeNs: string, scopePfx: Map<string, string>, owner: any) => {
        if (n.type === "element") {
          resolveElement(n, scopeNs, scopePfx, owner)
          for (let i = 0; i < n.childCount; i++) walkScoped(n.child(i), nsOf.get(n)!, pfxOf.get(n)!, n)
          return
        }
        for (let i = 0; i < n.childCount; i++) walkScoped(n.child(i), scopeNs, scopePfx, owner)
      }
      const pfxOf = new Map<any, Map<string, string>>()
      const resolveElement = (n: any, scopeNs: string, scopePfx: Map<string, string>, owner: any) => {
        let ns = scopeNs
        const pfx = new Map(scopePfx)
        const tag = n.children.find((c: any) => c.type === "STag" || c.type === "EmptyElemTag")
        const written = first(tag, "Name")?.text ?? ""
        for (const a of named(tag, "Attribute")) {
          const k = first(a, "Name")?.text ?? ""
          const v = unquote(textOf(first(a, "AttValue")))
          if (k === "xmlns") ns = v
          else if (k.startsWith("xmlns:")) { const p = k.slice(6); if (p) pfx.set(p, v) }
        }
        nsOf.set(n, ns)
        pfxOf.set(n, pfx)
        const colon = written.indexOf(":")
        const pre = colon >= 0 ? written.slice(0, colon) : ""
        const eff = pre ? pfx.get(pre) : ns
        if (eff && XML_DECL_NS.has(eff)) {
          const decl = named(tag, "Attribute")
            .map((a: any) => ({ k: first(a, "Name")?.text ?? "", v: unquote(textOf(first(a, "AttValue"))) }))
            .find((x: any) => XML_NAME_ATTR.has(x.k) && x.v.length > 0)
          if (decl) nameOf.set(n, decl.v)
        }
        if (!nameOf.has(n)) nameOf.set(n, written)
        if (owner) ownerOf.set(n, owner)
      }
      walkScoped(root, "", new Map(), null)
    }

    // ---- phase 2: emit edges from the tables
    const pushed = new Set<string>()
    const push = (from: string, to: string, label: string, cls?: string) => {
      const k = `${from}\u0000${label}\u0000${to}`
      if (pushed.has(k)) return
      pushed.add(k)
      // `label` is the relationship TYPE the analyzer emits, because that is what
      // the matcher compares. `class` is a finer label kept for the diff samples,
      // so a MISSING row says WHICH kind of containment went missing instead of
      // just "contains".
      edges.push(cls ? ({ label, from, target: to } as any) : { label, from, target: to })
      if (cls) (edges[edges.length - 1] as any).edgeClass = cls
    }
    for (const n of nodes) {
      if (n.type !== "element") continue
      const self = nameOf.get(n) ?? ""
      const own = ownerOf.get(n)
      const owner = own ? nameOf.get(own) ?? "" : ""
      const tag = n.children.find((c: any) => c.type === "STag" || c.type === "EmptyElemTag")
      // element -> attribute, read from the tree, never from source text
      for (const a of named(tag, "Attribute")) {
        const k = first(a, "Name")?.text ?? ""
        if (k.length === 0) continue
        if (k === "xmlns") { push(owner, "default", "contains"); continue }
        if (k.startsWith("xmlns:")) { push(owner, k.slice(6), "contains"); continue }
        push(self, k, "contains")
      }
      if (!own) continue
      // NOTE: DTD declaration edges are NOT derived here yet. The obvious
      // placement for them — `elementdecl` / `attlistDecl` / `entitydecl` /
      // `notationdecl` — is unreachable, because this loop is guarded by
      // `if (n.type !== "element") continue` and none of those four node types
      // is an `element`. An earlier version carried that branch anyway: it was
      // dead code that read as coverage. Deriving them means walking the DTD
      // side of `doctypedecl`, whose owner is the DOCTYPE's `Name` and not an
      // element, and that is owed rather than faked.
      {
        // ordinary containment: an element is CONTAINED BY its nearest element
        // ancestor, read off the tree.
        push(owner, self, "contains")
      }
    }
    return edges
  }

  // ---------------------------------------------------------------- HCL
  // M60 HCL wave (2026-09-26). HCL has no heritage, no call graph and no type
  // declarations, so the generic machinery below derives nothing for it and the
  // sweep's "parsed but derived ZERO truth edges" guard fired — correctly: a
  // 0/0 row would have been a fabricated pass. What IS independently derivable
  // in HCL is the reference graph, and that is what this branch reads.
  //
  // IT IS DELIBERATELY A DIFFERENT ALGORITHM from the analyzer's. The analyzer
  // (real-hcl-analyzer.ts) walks recursively, threads a `loopVars` set down
  // through `for`-expressions and `dynamic` iterators, and reads an object's
  // value through the grammar's `val` FIELD. This oracle sweeps the tree FLAT,
  // precomputes the byte ranges that must stay silent, and matches them by
  // OFFSET. Two implementations that agree are evidence; one implementation
  // counted twice is not.
  if (lang === "hcl") {
    // HCL's language builtins: reference roots that resolve to nothing in the
    // index because no file can declare them. Written out here rather than
    // imported from the analyzer, so the two can disagree.
    const HCL_BUILTIN_ROOTS = new Set(["count", "each", "self", "path", "terraform"])
    // Byte ranges that never yield a reference: an object literal's `key` FIELD
    // (data, not a read). `for_intro` is NOT one of these and neither is
    // `for_cond` — `[for d in data.x.y : d.z]` puts a REAL reference inside
    // for_intro, and the `if …` tail of a for-expression is an ordinary
    // expression over ordinary references. Both were measured wrong first
    // (29 real references lost) and are recorded here so it cannot recur.
    const silent: { start: number; end: number }[] = []
    // Loop locals, scoped to the whole for-expression: declaration + result +
    // condition, which is the scope HCL itself gives them.
    const loopScopes: { vars: Set<string>; start: number; end: number }[] = []
    // `dynamic` block loop locals, scoped to the block's body: the `iterator`
    // attribute's value, or the block's own first LABEL when there is none.
    const dynScopes: { vars: Set<string>; start: number; end: number }[] = []
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()
      if (!n) continue
      const t = n.type
      if (t === "object_elem") {
        const k = n.childForFieldName ? n.childForFieldName("key") : null
        if (k) silent.push({ start: k.startIndex, end: k.endIndex })
      }
      if (t === "for_expr" || t === "for_tuple_expr" || t === "for_object_expr") {
        const vars = new Set<string>()
        for (let i = 0; i < n.namedChildCount; i++) {
          const intro = n.namedChild(i)
          if (intro?.type !== "for_intro") continue
          for (let j = 0; j < intro.namedChildCount; j++) {
            const id = intro.namedChild(j)
            if (id?.type === "identifier") vars.add(id.text)
          }
        }
        if (vars.size) loopScopes.push({ vars, start: n.startIndex, end: n.endIndex })
      }
      if (t === "block") {
        let isDynamic = false
        let firstLabel: string | null = null
        let blockType: string | null = null
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "identifier" && blockType === null) blockType = c.text
          else if (c.type === "string_lit" && firstLabel === null) {
            const lit = c.namedChildren.find((x: any) => x.type === "template_literal")
            if (lit) firstLabel = lit.text
          }
        }
        if (blockType === "dynamic") {
          isDynamic = true
          const vars = new Set<string>()
          const body = n.namedChildren.find((c: any) => c.type === "body")
          if (body) {
            for (const a of body.namedChildren) {
              if (a.type !== "attribute") continue
              const k = a.namedChildren.find((c: any) => c.type === "identifier")
              if (k?.text !== "iterator") continue
              const e = a.namedChildren.find((c: any) => c.type === "expression")
              const ve = e?.namedChild(0)
              if (ve?.type !== "variable_expr") continue
              const id = ve.namedChildren.find((c: any) => c.type === "identifier")
              if (id) vars.add(id.text)
            }
          }
          if (vars.size === 0 && firstLabel) vars.add(firstLabel)
          if (vars.size && body) dynScopes.push({ vars, start: body.startIndex, end: body.endIndex })
        }
        void isDynamic
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    const suppressed = (i: number) => silent.some((r) => i >= r.start && i < r.end)
    const isLoopVar = (i: number, name: string) =>
      loopScopes.some((s) => i >= s.start && i < s.end && s.vars.has(name)) ||
      dynScopes.some((s) => i >= s.start && i < s.end && s.vars.has(name))

    // MAXIMAL CONSECUTIVE runs over ALL children. Reading only named children
    // walks over a binary operator and welds `var.a + var.b` into
    // `var.a.var.b` — measured, and the reason this scan is over `child()`.
    const flat: any[] = [root]
    while (flat.length) {
      const n = flat.pop()
      if (!n) continue
      for (let i = 0; i < n.childCount; i++) {
        const first = n.child(i)
        if (!first || (first.type !== "variable_expr" && first.type !== "get_attr")) continue
        const parts: string[] = []
        let j = i
        for (; j < n.childCount; j++) {
          const c = n.child(j)
          if (!c || (c.type !== "variable_expr" && c.type !== "get_attr")) break
          const id = c.namedChildren.find((x: any) => x.type === "identifier")
          if (!id) break
          parts.push(id.text)
        }
        // A real Terraform reference is always qualified; a bare identifier is a
        // type-constraint keyword (`type = string`) or a function name.
        if (parts.length >= 2 && !suppressed(first.startIndex) && !isLoopVar(first.startIndex, parts[0])) {
          // The LABEL follows the reference ROOT, and the root is read here from
          // the grammar's own identifier — not from the analyzer's output, so a
          // disagreement between the two is a FINDING rather than a tautology.
          // `count`/`each`/`self`/`path`/`terraform` are language builtins that
          // resolve to nothing in the index, so they are the `uses` class (the
          // global namespace, per real-sql-analyzer.ts:1569); every other root is
          // a project address and stays `references`. Deriving it here is what
          // lets the sweep AUDIT the distinction instead of tolerating it — the
          // first run after the analyzer adopted this reported MISSING=1/18 purely
          // because the allowlist still admitted only `references`.
          const path = parts.join(".")
          const label = HCL_BUILTIN_ROOTS.has(parts[0]) ? "uses" : "references"
          edges.push({ label, from: "", target: path })
        }
        i = j - 1
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) flat.push(c)
      }
    }
    return edges.filter((e, i) => edges.findIndex((x) => x.label === e.label && x.target === e.target) === i)
  }

  // ---------------------------------------------------------------- VB
  // M60 VB wave (2026-09-27). VB.NET has no published tree-sitter grammar that
  // can represent the language, so this lane's grammar is a vendored and patched
  // one (grammars/tree-sitter-vbnet/PIN.md) — which means an oracle written
  // against the grammar alone would be measuring the same artefact twice. The
  // discipline that survives that is ALGORITHM DIVERGENCE, and this branch is
  // built to diverge from real-vb-analyzer.ts on every axis that could hide a
  // shared mistake:
  //
  //   analyzer                          this oracle
  //   ---------------------------------  ----------------------------------------
  //   recursive walk, switch on type     ONE flat cursor sweep, no recursion and
  //                                       no dispatch: a list of every node, built
  //                                       by walking children in a loop
  //   name = childForFieldName("name")   name = the FIRST `identifier` leaf in
  //   then wrapper descent                DOCUMENT ORDER inside the declaration
  //   owner = a push/pop stack            owner = the NEAREST node in the flat
  //                                       list whose byte range CONTAINS this one
  //   callee = the `function` FIELD      callee = the LAST identifier leaf inside
  //   then wrapper descent                the callee subtree, in document order
  //   heritage = statement children +    heritage = by BYTE OFFSET: every
  //   a scan for the header `:` token     identifier leaf that lies between the
  //                                       declaration's own name and its first
  //                                       member, which needs no node type at all
  //
  // Two implementations that agree are evidence. One implementation counted twice
  // is not — which is the whole reason the F5 differential exists, and the reason
  // this branch is not allowed to call anything in the analyzer.
  if (lang === "vb") {
    // ---------------------------------------------------------------- sweep
    // Every node, once, flat. `all` is in document order because the traversal
    // is pre-order, which is what makes "first leaf" and "last leaf" mean
    // something.
    const all: any[] = []
    {
      const stack: any[] = [root]
      while (stack.length > 0) {
        const n = stack.pop()
        if (!n) continue
        all.push(n)
        for (let i = n.childCount - 1; i >= 0; i--) {
          const c = n.child(i)
          if (c) stack.push(c)
        }
      }
    }
    /** Every `identifier` leaf at or under `n`, in document order. */
    const identLeaves = (n: any, out: any[] = []): any[] => {
      if (n.type === "identifier") { out.push(n); return out }
      // `(Of ...)` holds the type's ARGUMENTS, and an argument is not the name
      // of the thing being named: `New List(Of Integer)` constructs `List`. The
      // analyzer excludes the same subtree, so both sides apply one definition.
      if (n.type === "type_argument_list") return out
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) identLeaves(c, out)
      }
      return out
    }
    /** The last identifier leaf at or under `n` — the CALLEE of `a.b.C()` is `C`. */
    const lastIdent = (n: any): any => {
      const leaves = identLeaves(n)
      return leaves.length > 0 ? leaves[leaves.length - 1] : null
    }
    /** The first identifier leaf at or under `n` — a declaration's OWN name. */
    const firstIdent = (n: any): any => {
      const leaves = identLeaves(n)
      return leaves.length > 0 ? leaves[0] : null
    }
    /** As `firstIdent`, but skipping any leaf inside a node of type `skipType`. */
    const firstIdentOutside = (n: any, skipType: string): any => {
      const walk = (x: any): any => {
        if (x.type === skipType) return null
        if (x.type === "identifier") return x
        for (let i = 0; i < x.childCount; i++) {
          const c = x.child(i)
          if (!c) continue
          const r = walk(c)
          if (r) return r
        }
        return null
      }
      return walk(n)
    }
    // `field_declaration` is in this set and its absence was measured, not
    // overlooked: without it a field is invisible to the oracle, so every
    // `contains owner -> field` the analyzer published came back UNEXPLAINED
    // while the analyzer was right. (P3D's Item.vb alone: 6 such rows.)
    /** Is this leaf inside a `(Of ...)` type-argument list? */
    const inTypeArgumentList = (leaf: any): boolean => {
      let cur: any = leaf.parent
      for (let i = 0; cur && i < 6; i++) {
        if (cur.type === "type_argument_list") return true
        cur = cur.parent
      }
      return false
    }
    // A CONSTRUCTOR IS NAMED BY THE CONTRACT, on both sides of every edge.
    // `Public Sub New()` has no `name` field — `New` is an anonymous token, so
    // there is no identifier leaf to read. One helper, because a name that is
    // right for a target and wrong for a source is still a wrong name: the
    // analyzer publishes `constructor` with the class in ownerName, and an edge
    // whose SOURCE this oracle cannot name is an edge it silently drops
    // (measured: `calls constructor -> AchieveMailman`).
    const contractName = (d: any): string =>
      d.type === "constructor_declaration" ? "constructor" : nameOfDecl(d)
    const isDecl = (t: string) =>
      t === "class_declaration" || t === "structure_declaration" ||
      t === "interface_declaration" || t === "module_declaration" ||
      t === "enum_declaration" || t === "delegate_declaration" ||
      t === "method_declaration" || t === "constructor_declaration" ||
      t === "property_declaration" || t === "event_declaration" ||
      t === "operator_declaration" || t === "declare_statement" ||
      t === "field_declaration" || t === "enum_member_declaration" ||
      // A NAMESPACE is a declaration and it CONTAINS its types. Leaving it out
      // meant `ownerOf` returned null for every class, so the oracle derived no
      // namespace->class containment at all -- and it agreed with the analyzer
      // only because the analyzer was also missing those edges. When the
      // analyzer's containment was centralised (so every symbol with an owner
      // emits one) the disagreement became visible: 48 `contains Namespace ->
      // Class` rows the analyzer published and the oracle could not derive.
      t === "namespace_declaration"

    // ------------------------------------------------- ownership by RANGE
    // The nearest enclosing declaration, found by byte containment over the flat
    // list. The analyzer derives the same fact from a push/pop stack; if the two
    // disagree, one of them is wrong about nesting, which is exactly the class of
    // defect a recursion-vs-sweep divergence can find.
    const declNodes = all.filter((n) => isDecl(n.type))
    const ownerOf = (node: any): any => {
      let best: any = null
      for (const d of declNodes) {
        if (d.id === node.id) continue
        // strict containment by byte range, and TIGHTER wins
        if (d.startIndex <= node.startIndex && node.endIndex <= d.endIndex) {
          if (!best || (d.endIndex - d.startIndex) < (best.endIndex - best.startIndex)) best = d
        }
      }
      return best
    }
    // The name of a declaration, read as the first identifier leaf that is NOT
    // inside an attribute list.
    //
    // The attribute exclusion is the whole point of this function and it was
    // found by measurement: in this grammar `attribute_list` is a CHILD of
    // `class_declaration`, so a document-order "first identifier" over the node
    // returns the attribute's own type name. `<Item(269, "Earth Plate")>` made
    // the class read as `Item`, and every containment and heritage edge on
    // `EarthPlate` was published under the wrong owner -- which is why the same
    // target appeared as MISSING in one file and UNEXPLAINED in another: the two
    // sides were each right about a different owner.
    const nameOfDecl = (d: any): string => {
      // No constructor branch here, on purpose. There was one — a scan for the
      // `New` token among the declaration's own children — and it was wrong in a
      // way the two definitions disagreed on: it returned "" for a
      // `constructor_declaration` that had no `New` child, while `contractName`
      // returns `constructor` for every one. A name that is right for a target
      // and wrong for a source is still a wrong name, so the rule now lives in
      // ONE place and every edge reads it from there.
      // The attribute exclusion is the whole point of the rest: in this grammar
      // `attribute_list` is a CHILD of `class_declaration`, so a document-order
      // "first identifier" over the node returns the attribute's own type name.
      // `<Item(269, "Earth Plate")>` made the class read as `Item`.
      const f = firstIdentOutside(d, "attribute_list")
      return f ? String(f.text).trim() : ""
    }

    // ------------------------------------------------------- declarations
    for (const d of declNodes) {
      // A field's declaration unit is the DECLARATOR. `Dim X, Y, width As Integer`
      // is one `field_declaration` with three `variable_declarator` children and
      // therefore three members; reading one name per field_declaration made the
      // other two look like analyzer fabrications. Measured on P3D's ItemObject.vb:
      // 8 `contains` rows the analyzer published and the oracle could not derive.
      const units: any[] = d.type === "field_declaration"
        ? (() => { const out: any[] = []; for (let i = 0; i < d.namedChildCount; i++) { const c = d.namedChild(i); if (c && c.type === "variable_declarator") out.push(c) } return out })()
        : [d]
      for (const unit of units) {
        // A CONSTRUCTOR IS NAMED BY THE CONTRACT, and so is this oracle.
        // `Public Sub New()` has no `name` field: `New` is an anonymous token, so
        // there is no identifier leaf to read and the name loop skipped every
        // constructor in the corpus. The analyzer publishes the family's literal
        // (`constructor`, with the class in ownerName) and the oracle has to
        // agree, or the fixed analyzer simply reads as 54 unexplained edges.
        const nm = contractName(unit)
        if (nm.length === 0) continue
        const owner = ownerOf(d)
        if (owner) {
          const on = nameOfDecl(owner)
          if (on.length > 0) edges.push({ label: "contains", from: on, target: nm })
        }
      }
    }

    // ------------------------------------------------------------ heritage
    // BY BYTE OFFSET, with no node type involved in reading the header. A type
    // declaration's own name ends at `nameEnd` and its first MEMBER begins the
    // body, so the header is the span between them — and the header is where
    // `Inherits`/`Implements` live whether the grammar spells them as a
    // statement child (`Inherits Bar` on its own line) or inline. The span is
    // what stays deliberately crude: if it disagrees with the analyzer's
    // field-and-token reading, the disagreement is the finding.
    //
    // What is NOT crude is which node inside the span counts as a name. The first
    // version took every identifier leaf, and a dotted base type then published
    // one edge per SEGMENT; that rule is replaced below, per name expression.
    const TYPE_DECLS = new Set(["class_declaration", "structure_declaration", "interface_declaration", "module_declaration"])
    for (const t of all) {
      if (!TYPE_DECLS.has(t.type)) continue
      const nm = nameOfDecl(t)
      if (nm.length === 0) continue
      // The SAME node the name was read from. Reading the window's start from a
      // different node is how `inherits SunStone -> SunStone` happened: the name
      // skipped the `<Item(169, ...)>` attribute, the window start did not, so
      // the class's own name sat inside its own header.
      const nameNode = firstIdentOutside(t, "attribute_list")
      const nameEnd = nameNode ? nameNode.endIndex : t.startIndex
      // The window must end at the first MEMBER of any kind, and the first
      // version got this wrong in a way that manufactured heritage edges by the
      // hundred: it looked only for nodes in the DECLARATION set, so a type whose
      // first member is a `field_declaration` had no boundary at all, the window
      // ran to the end of the class body, and every identifier in every member
      // signature was published as a base type. Measured on P3D: a class's own
      // name and its real base both came back as `inherits` targets of the
      // enclosing type. A member is any child that is not part of the header.
      const HEADER_PARTS = new Set(["attribute_list", "modifiers", "identifier", "simple_name",
        "qualified_name", "global_qualified_name", "generic_name", "type_parameter_list",
        "inherits_statement", "implements_statement", "inherits_clause", "implements_clause",
        "member_modifier", "local_declaration_modifier", "comment", "preprocessor_directive"])
      let firstMember = Number.POSITIVE_INFINITY
      for (let ci = 0; ci < t.childCount; ci++) {
        const ch = t.child(ci)
        if (!ch || ch.endIndex <= nameEnd) continue
        if (HEADER_PARTS.has(ch.type)) continue
        // a wrapper around a header part is still a header part
        const inner = identLeaves(ch)
        if (inner.length > 0 && ch.namedChildCount > 0 && HEADER_PARTS.has(ch.namedChild(0).type)) continue
        if (ch.startIndex < firstMember) firstMember = ch.startIndex
      }
      const limit = Number.isFinite(firstMember) ? firstMember : t.endIndex
      // ONE edge per heritage NAME EXPRESSION, not per identifier leaf.
      //
      // A dotted base type is a single name: `Inherits System.Windows.Forms.Form`
      // says the class derives from ONE type, and the target a reader navigates
      // to is its last segment, `Form` — the same last-segment contract the
      // analyzer's `namingToken` applies and the same one `calls` uses below.
      // Iterating the leaves instead published `extends X -> System`,
      // `-> Windows` and `-> Forms` as if the class derived from three types it
      // never mentions. Measured on DISMTools: 64 such rows across the
      // `.Designer.vb` files, which is where the fully-qualified bases live.
      //
      // A `(Of ...)` argument list is skipped for the same reason it is skipped
      // in `calls`: `Inherits List(Of Player)` makes `List(Of Player)` the base,
      // so `Player` is what it is parameterised over, not what it inherits.
      const NAME_NODES = new Set(["simple_name", "qualified_name", "global_qualified_name",
        "generic_name", "predefined_type", "type_identifier"])
      const isNameNode = (x: any): boolean => NAME_NODES.has(x.type)
      /** The name expressions directly under `n` (not nested in another name). */
      const topLevelNames = (n: any): any[] => {
        const out: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "type_argument_list") continue
          if (isNameNode(c)) { out.push(c); continue }
          // `Inherits C(a).B` nests a call; the names still count, so recurse
          // into anything that is not itself a name.
          if (!isNameNode(c)) out.push(...topLevelNames(c))
        }
        return out
      }
      const heritageEdge = (owner: any, nameNode: any, label: "extends" | "implements") => {
        if (!owner) return
        const on = contractName(owner)
        if (on.length === 0) return
        const leaf = lastIdent(nameNode)
        if (!leaf) return
        edges.push({ label, from: on, target: String(leaf.text).trim() })
      }
      for (const n of all) {
        if (n.type === "inherits_statement" || n.type === "inherits_clause" || n.type === "inherits_member_clause") {
          for (const nn of topLevelNames(n)) heritageEdge(ownerOf(n), nn, "extends")
        } else if (n.type === "implements_statement" || n.type === "implements_clause" || n.type === "implements_member_clause") {
          for (const nn of topLevelNames(n)) heritageEdge(ownerOf(n), nn, "implements")
        }
      }
    }

    // ---------------------------------------------------------------- calls
    // The callee is the LAST identifier leaf inside the `function` subtree. For
    // `a.b.C(1)` that is `C`; for a bare `Foo(1)` it is `Foo`. The source is the
    // nearest enclosing DECLARATION by range — a method, not the file — because
    // an edge from nothing is a phantom and an edge from `root` cannot be
    // navigated to.
    // A CONSTRUCTION IS A CALL, and the grammar gives it one of TWO node types.
    // `New Box()` is an `invocation_expression`; `New Box(1, 2)` — any
    // construction with arguments — is an `array_creation_expression` with a
    // `type` field and no `function` field. Keying on the invocation alone is how
    // 15,577 call edges across 1,718 of 2,660 corpus files went missing, and it
    // is also how this oracle and the analyzer agreed on a shared blind spot and
    // the differential reported 100 %: two implementations that both assume the
    // same node type are one implementation with a witness. Divergence has to
    // include the ASSUMPTIONS, not only the traversal.
    for (const n of all) {
      if (n.type === "array_creation_expression") {
        const ty = n.childForFieldName?.("type")
        const leaf = ty ? lastIdent(ty) : null
        if (!leaf) continue
        const from = ownerOf(n)
        if (!from) continue
        const fromName = contractName(from)
        if (fromName.length === 0) continue
        edges.push({ label: "calls", from: fromName, target: String(leaf.text).trim() })
        continue
      }
      if (n.type !== "invocation_expression") continue
      const fn = n.childForFieldName?.("function")
      if (!fn) continue
      const leaf = lastIdent(fn)
      if (!leaf) continue
      const from = ownerOf(n)
      if (!from) continue
      const fromName = contractName(from)
      if (fromName.length === 0) continue
      edges.push({ label: "calls", from: fromName, target: String(leaf.text).trim() })
    }

    // -------------------------------------------------------------- imports
    for (const n of all) {
      if (n.type !== "imports_statement") continue
      // ONE edge per imported NAMESPACE, spelled as written. `Imports P3D.Items`
      // is a single import of `P3D.Items`; the first version of this loop walked
      // the identifier leaves and published `imports -> P3D` AND
      // `imports -> Items`, and the first of those is not a thing VB imports --
      // so it was an unsatisfiable truth row. The dotted text is read off the
      // statement's own extent, which is the only place the qualifier exists.
      const seenLocal = new Set<string>()
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        // Comments are `extras`, so one can sit inside the statement's extent
        // and be a NAMED child of it. Reading every named child published
        // `imports -> ' General Information about an assembly is controlled ...`
        // — the first version of this loop did exactly that, on P3D's
        // AssemblyInfo.vb, and no analyzer can ever satisfy a comment as an
        // import. An import is a NAME and only a name.
        if (c.type === "comment" || c.type === "preprocessor_directive") continue
        const txt = String(c.text ?? "").trim()
        if (txt.length === 0) continue
        if (seenLocal.has(txt)) continue
        seenLocal.add(txt)
        edges.push({ label: "imports", from: "", target: txt })
      }
    }

    return edges.filter((e, i) => edges.findIndex((x) => x.label === e.label && x.target === e.target) === i)
  }
  const collect = (x: any, label: string, clsName: string) => {
    if (!x) return
    // DAD3 fix (dart): the flat dart parse (`_i1.SmartFake` -> two adjacent
    // type_identifiers joined by an anonymous `.`) made blanket descent emit
    // the import-ALIAS as a base (extends -> _i1) and generic ARGUMENTS as
    // implemented interfaces (implements -> T1). Dart heritage must emit
    // resolved leaves only: skip type_arguments entirely, and skip a type
    // name whose next raw sibling is a `.` token (alias prefix). Mirrors
    // RealDartAnalyzer.resolvedHeritageNames exactly (probed shapes:
    // dart-heritage-shapes.ts 2026-09-03).
    if (lang === "dart") {
      if (x.type === "type_arguments") return
      if (x.type === "type_identifier" || x.type === "identifier") {
        // NOTE: web-tree-sitter returns FRESH node objects per child() call,
        // so indexOf-style reference identity never matches. Find the sibling
        // by source position instead (startIndex/endIndex are exact).
        let next: any = null
        if (x.parent) {
          for (let k = 0; k < x.parent.childCount; k++) {
            const s = x.parent.child(k)
            if (s && s.startIndex === x.startIndex && s.endIndex === x.endIndex) {
              next = x.parent.child(k + 1)
              break
            }
          }
        }
        if (next && next.type === ".") return // alias prefix
        edges.push({ label, from: clsName, target: x.text })
        return
      }
      for (let k = 0; k < x.childCount; k++) collect(x.child(k), label, clsName)
      return
    }
    if (TYPE.test(x.type)) {
      // M49.S1: heritage targets must be CLEAN head names. Decl keys are
      // bracket-stripped at registration (M37.9), so a target like groovy's
      // `Cache<T>` (the pinned grammar folds type args into the supertype
      // token text) could never match its interface's decl — the override
      // chain died silently (geb CachingDriverFactory:
      // SimpleCache.get -> Cache.get surfaced unexplained). Strip type
      // arguments; dotted paths keep the full path (M14 #419 kotlin rule).
      let target = x.text
      const ltIdx = target.indexOf("<")
      if (ltIdx !== -1) target = target.slice(0, ltIdx)
      edges.push({ label, from: clsName, target })
    } else for (let k = 0; k < x.namedChildCount; k++) collect(x.namedChild(k), label, clsName)
  }
  const walk = (n: any) => {
    const t = n.type
    if (/^(class|interface|record|trait|object)_declaration$|^enum_declaration$|^class_definition$|^trait_definition$|^object_definition$|^(class|struct|union)_specifier$/.test(t) || (lang === "scala" && t === "enum_definition")) {
      const nameNode =
        n.childForFieldName?.("name") ??
        n.namedChildren.find((c: any) => c.type === "identifier" || c.type === "type_identifier")
      const clsName = nameNode?.text ?? "?"
      // extends side: superclass (classes), extends_interfaces+type_list
      // (java-style interfaces), extends_type_clause (typescript interfaces),
      // base_class_clause (cpp - flat children, access specifiers skipped)
      const sup = n.childForFieldName?.("superclass") ?? n.namedChildren.find((c: any) => c.type === "superclass" || c.type === "extends_interfaces" || c.type === "extends_type_clause")
      const cppClause = t === "class_specifier" || t === "struct_specifier"
        ? n.namedChildren.find((c: any) => c.type === "base_class_clause")
        : undefined
      if (cppClause) {
        for (const c of cppClause.namedChildren) {
          if (!c || c.type === "access_specifier") continue
          // base NAME only: the first type node inside the child. Blanket
          // collection descended into template argument lists and pushed
          // TYPE PARAMETERS (Char, T...) as fake bases.
          const typeNode =
            c.childForFieldName?.("name") ??
            c.namedChildren.find((x: any) => /type_identifier|qualified_identifier|template_type/.test(x.type)) ?? c
          let baseName = typeNode.text
          const lt2 = baseName.indexOf("<")
          if (lt2 !== -1) baseName = baseName.slice(0, lt2)
          baseName = lastSegment(baseName)
          if (baseName && /^[A-Za-z_]/.test(baseName)) {
            edges.push({ label: "extends", from: clsName, target: baseName })
          }
        }
      }
      if (sup) {
        if (sup.type === "superclass" || sup.type === "extends_interfaces") {
          if (lang === "dart") {
            // dart superclass = seq(base_type, type_arguments?, mixins?) —
            // type ARGUMENTS are arguments, not inherited bases (same rule
            // as the typescript extends_type_clause fix below), and mixins
            // are `uses`, not `extends` (deriveDartEdges emits them as uses).
            // Without this, `class _X extends State<X>` pushed extends->X
            // (the generic arg) as a fake base.
            for (const c of sup.namedChildren) {
              if (!c || c.type === "type_arguments" || c.type === "mixins") continue
              collect(c, "extends", clsName)
            }
          } else {
            collect(sup, "extends", clsName)
          }
        } else if (sup.type === "extends_type_clause") {
          // typescript interface heritage: type_arguments are ARGUMENTS,
          // not inherited bases - descend only into real type nodes
          // (mirrors the analyzer's fix for phantom "<string>" targets)
          for (const c of sup.namedChildren) {
            if (!c || c.type === "type_arguments") continue
            collect(c, "extends", clsName)
          }
        }
      }
      // implements side
      const impls = n.childForFieldName?.("interfaces") ?? n.namedChildren.find((c: any) => c.type === "super_interfaces")
      if (impls) collect(impls, "implements", clsName)
      // typescript: class_heritage > extends_clause / implements_clause
      if (t === "class_declaration" || t === "interface_declaration") {
        const heritage = n.namedChildren.find((c: any) => c.type === "class_heritage")
        if (heritage) {
          const ext2 = heritage.namedChildren.find((c: any) => c.type === "extends_clause")
          // type_arguments are ARGUMENTS, not inherited bases - descending
          // into them pushed type PARAMETERS (K, Props, Events...) as fake
          // extends targets (svelte repo .d.ts corpus).
          if (ext2) {
            for (const c of ext2.namedChildren) {
              if (!c || c.type === "type_arguments" || c.type === "type_parameters") continue
              collect(c, "extends", clsName)
            }
          }
          const imp2 = heritage.namedChildren.find((c: any) => c.type === "implements_clause")
          if (imp2) {
            for (const c of imp2.namedChildren) {
              if (!c || c.type === "type_arguments") continue
              collect(c, "implements", clsName)
            }
          }
          // M49 W12 svelte/JS heritage blind spot: tree-sitter-JAVASCRIPT's
          // class_heritage holds the base EXPRESSION directly —
          // `(class_heritage (identifier))` or `(class_heritage
          // (member_expression))` — the `extends` keyword is an UNNAMED token
          // and there is NO extends_clause node (that wrapper is a TYPESCRIPT
          // grammar shape). The extends_clause branch above therefore never
          // fired and the oracle derived ZERO extends edges for every pure-JS
          // parse. The svelte lane derives its script-side truth with this
          // walker (`deriveTreeEdges(st, "javascript")`), so
          // RealSvelteAnalyzer's custom-element edge (`class
          // MyCustomElement extends HTMLElement`, merged from the JS
          // sub-analyzer) had no truth to match and surfaced as a fabrication
          // (probe 2026-09-13, attribute-casing-custom-element/main.svelte:
          // analyzer emits extends->HTMLElement, oracle []). Mirrors the
          // analyzer's contract EXACTLY (RealJavaScriptAnalyzer L252-262):
          // a direct-child `identifier`, else a direct-child
          // `member_expression` whose FULL dotted text is the target
          // (`extends Lib.Base` -> Lib.Base).
          if (!ext2 && !imp2) {
            const base =
              heritage.namedChildren.find((c: any) => c.type === "identifier") ??
              heritage.namedChildren.find((c: any) => c.type === "member_expression")
            if (base) edges.push({ label: "extends", from: clsName, target: base.text })
          }
        }
      }
      // scala extends_clause: first supertype extends, rest implements;
      // on trait_definition all are extends
      // M49.S1 #715 (J3-class shared blind spot closed): enum_definition
      // heritage. `enum Color(val hex: Int) extends Serializable` emitted
      // ZERO extends on BOTH sides before (the oracle never matched
      // enum_definition, so no differential could ever flag it). The oracle
      // mirror joins handleEnum's S1-NEW-1 fix: all supertypes are extends
      // (an enum cannot extend a class in Scala 3).
      if (t === "class_definition" || t === "trait_definition" || t === "object_definition" || t === "enum_definition") {
        const extClause = n.namedChildren.find((c: any) => c.type === "extends_clause")
        if (extClause) {
        const isTraitDecl = t === "trait_definition"
        const isEnumDecl = t === "enum_definition"
          let first = true
          for (let i = 0; i < extClause.namedChildCount; i++) {
            const st = extClause.namedChild(i)
            if (!st) continue
            // head segment only for generic supertypes (Something[Test.A] -> Something)
            let target = ""
            if (/type_identifier|user_type|stable_type_identifier|generic_type$/.test(st.type)) {
              target = st.text
              const lt = target.indexOf("[")
              if (lt !== -1) target = target.slice(0, lt)
            } else if (st.type === "generic_type" && st.namedChildCount > 0) {
              const head = st.namedChild(0)
              target = head?.text ?? ""
              const lt = target.indexOf("[")
              if (lt !== -1) target = target.slice(0, lt)
            }
            if (!target) continue
            if (isTraitDecl || isEnumDecl || first) edges.push({ label: "extends", from: clsName, target })
            else edges.push({ label: "implements", from: clsName, target })
            first = false
          }
        }
      }
      // kotlin delegation_specifiers: first constructor_invocation = extends,
      // every other user_type = implements; on interface_declaration all extends
      // M14 #419 kotlin wave: tree-sitter-kotlin parses `interface X : Y` as
      // class_declaration with an `interface` keyword child (there is NO
      // interface_declaration node type), so interface detection must check
      // the keyword too — otherwise every kotlin interface was mislabelled
      // implements (the analyzer emits extends; the oracle emitted implements,
      // fabricating a permanent MISSING+UNEXPLAINED pair per interface).
      // NOTE: the `interface` keyword is an UNNAMED child of class_declaration
      // in tree-sitter-kotlin, so namedChildren cannot see it — scan child()
      // like the analyzer's walk does (someSymbol(n.children)).
      let hasInterfaceKeyword = false
      for (let ci = 0; ci < n.childCount; ci++) {
        if (n.child(ci)?.type === "interface") { hasInterfaceKeyword = true; break }
      }
      const isInterfaceDecl = t === "interface_declaration" || (t === "class_declaration" && hasInterfaceKeyword)
      let extendsUsed = false
      for (let i = 0; i < n.namedChildCount; i++) {
        const d = n.namedChild(i)
        if (!d || d.type !== "delegation_specifier") continue
        const ctor = d.namedChildren?.find((c: any) => c.type === "constructor_invocation")
        const userType = ctor
          ? ctor.namedChild(0)?.type === "user_type" ? ctor.namedChild(0) : d.namedChildren?.find((c: any) => c.type === "user_type")
          : d.namedChildren?.find((c: any) => c.type === "user_type")
        // M14 #419 kotlin wave: dotted supertypes (class Builder :
        // DatabaseConfig.Builder()) keep the FULL path — the analyzer emits
        // DatabaseConfig.Builder, so truncating to the first identifier
        // (DatabaseConfig) fabricated an unmatched oracle edge. Only DIRECT
        // type_identifier children are joined; type ARGUMENTS
        // (SuspendExecutable<Int, ...>) stay nested under type_arguments and
        // never leak in as phantom supertypes.
        const tids = userType ? (userType.namedChildren ?? []).filter((c: any) => c.type === "type_identifier") : []
        const head = tids.length > 0 ? { text: tids.map((c: any) => c.text).join(".") } : userType
        if (ctor && head && !isInterfaceDecl && !extendsUsed) {
          edges.push({ label: "extends", from: clsName, target: head.text })
          extendsUsed = true
        } else if (head) {
          edges.push({ label: isInterfaceDecl ? "extends" : "implements", from: clsName, target: head.text })
        }
      }
    }
    if (t === "object_creation_expression") {
      const typeNode = n.namedChildren.find((c: any) => /type_identifier|scoped_type_identifier|generic_type$/.test(c.type))
      if (typeNode) edges.push({ label: "instantiates", from: "(expr)", target: typeNode.text })
    }
    // typescript/javascript: `new X()` parses as new_expression
    const GLOBAL_CTORS = new Set(["Promise","Date","Map","Set","WeakMap","WeakSet","Symbol","Proxy","Error","TypeError","RangeError","SyntaxError","URIError","EvalError","AggregateError","RegExp","Array","Object","Function","Boolean","Number","String","BigInt","ArrayBuffer","SharedArrayBuffer","DataView","Int8Array","Uint8Array","Uint8ClampedArray","Int16Array","Uint16Array","Int32Array","Uint32Array","Float32Array","Float64Array","BigInt64Array","BigUint64Array","WeakRef","FinalizationRegistry","AbortController","FormData","Blob","File","URL","URLSearchParams","Headers","Request","Response","Intl","Image","Worker","SharedWorker","CustomEvent","Event","MouseEvent","KeyboardEvent","FocusEvent","InputEvent","PointerEvent","TouchEvent","DragEvent","ErrorEvent","UIEvent","StorageEvent","PromiseRejectionEvent","HashChangeEvent","PageTransitionEvent","PopStateEvent","ProgressEvent","AnimationEvent","TransitionEvent","ClipboardEvent","WheelEvent","CompositionEvent","ResizeObserver","MutationObserver","IntersectionObserver","PerformanceObserver","FileReader","XMLHttpRequest","WebSocket","TextEncoder","TextDecoder","DOMParser","Notification","BroadcastChannel","MessageChannel"])
    if (t === "new_expression") {
      const tn = n.namedChild(0)
      if (tn) {
        // Construction candidates are NAMEABLE leaves only: identifier or
        // dotted member path. Anonymous constructor expressions —
        // `new (Backbone.Collection.extend({...}))()`, `new (fn())()` —
        // have no honest target name; deriving their raw expression text
        // fabricated unmatchable oracle edges (lodash corpus).
        const isNameable =
          tn.type === "identifier" || tn.type === "member_expression" ||
          tn.type === "qualified_identifier" || tn.type === "template_type" ||
          tn.type === "generic_type" || tn.type === "type_identifier" ||
          tn.type === "type_descriptor" || tn.type === "primitive_type"
        let name = isNameable ? tn.text : ""
        const lt = name.indexOf("<") !== -1 ? name.indexOf("<") : name.indexOf("(")
        if (lt !== -1) name = name.slice(0, lt)
        // `new` keyword alone is the construction signal - casing is
        // irrelevant (lowercase classes are legal TypeScript)
        if (isNameable && !GLOBAL_CTORS.has(name.split(".").pop() ?? name) && (/^[A-Za-z_$]/.test(name) || name.includes(".") || name.includes("::"))) {
          // normalize to LEAF segment - analyzers emit leaf names
          edges.push({ label: "instantiates", from: "(expr)", target: lastSegment(name.split("<")[0].split("(")[0]) })
        }
      }
    }
    // scala: every `new X` / `new X(...)` / `new X[T](...)` parses as
    // instance_expression
    if (t === "instance_expression") {
      const tn = n.namedChild(0)
      if (tn) {
        let name = tn.text
        if (tn.type === "generic_type" && tn.namedChildCount > 0) name = tn.namedChild(0).text
        // ScalaD-I (M37.21 #610, cats-effect SecureRandomCompanionPlatform):
        // the analyzer strips bracketed type args ITERATIVELY from the raw
        // constructor text (`ScalaRandom[F](Applicative[F].pure(random)) with
        // SecureRandom[F]` -> `ScalaRandom(Applicative.pure(random)) with
        // SecureRandom`), so truth must normalize identically or the pair
        // never matches. Iterative strip covers nested args List[(A[B], C)].
        let prevName
        do { prevName = name; name = name.replace(/\[[^\[\]]*\]/g, "").replace(/<[^<>]*>/g, "").trim() } while (name !== prevName)
        edges.push({ label: "instantiates", from: "(expr)", target: name })
      }
    }
    // kotlin/scala: constructions appear as call_expressions whose callee
    // leaf follows the PascalCase type convention - RECEIVER-LESS only
    // (MEASURED twice: kotlin Exposed wave and scala3 300-file sample found
    // qualified obj.Method() calls are enum-case/module member accesses;
    // treating them as constructions fabricated hundreds of edges).
    // Scala additionally has explicit `new X` (object_creation_expression)
    // and instance_expression, both handled above regardless of casing.
    if ((lang === "kotlin" || lang === "scala") && t === "call_expression") {
      const callee = n.namedChild(0)
      // Curried application wrapper: `List.fill(2)("a")` parses as an outer
      // call whose function is the inner call. Analyzers emit the inner
      // call only (documented curried-application rule) - deriving an edge
      // from the wrapper would count a phantom instantiates. SKIP DERIVATION
      // ONLY - recursion into children must continue (nested
      // instance_expressions inside e.g. let(new Foo) still count).
      const curried = callee?.type === "call_expression"
      if (!curried) {
      let leaf = ""
      let qualified = false
      if (callee?.type === "navigation_expression") {
        qualified = true
        const sel = callee.namedChild(callee.namedChildCount - 1)
        leaf = sel?.text ?? ""
      } else if (callee?.type === "field_expression") {
        // scala3 qualified call `Util.escapeChar(...)`: only the FINAL
        // selector is the called name - the receiver path must not leak
        // into the target (Util.escapeChar was being emitted whole).
        qualified = true
        const kids = callee.namedChildren
        const last = kids[kids.length - 1]
        leaf = last && /identifier|_type$/.test(last.type) ? last.text : ""
      } else if (callee?.type === "generic_function") {
        // M49.S1 #715 lockstep mirror of deriveScalaEdges's S1.10 handler:
        // scala3 parses dotted/typed callees as generic_function — the raw
        // text fell through to the generic fallback, fabricating junk truth
        // like `instantiates CC.ff()\n + CC.ff("abc")\n + CC.ff` (infix
        // chains) and `instantiates Comparator.reverseOrder` (dotted factory
        // calls). Extract the LAST identifier leaf BEFORE the bracket strip,
        // exactly as deriveScalaEdges does. Shared-blind-spot class: the
        // dedicated oracle was fixed while the generic oracle (the live scala
        // sweep path) kept the stale fallback — no differential could flag it
        // because truth vs truth was never compared.
        qualified = true
        const kids: string[] = []
        const findLeaves = (nn: any): void => {
          if (nn.type === "identifier") { kids.push(nn.text); return }
          if (nn.type === "type_arguments") return
          for (let i = 0; i < nn.namedChildCount; i++) { const c = nn.namedChild(i); if (c) findLeaves(c) }
        }
        findLeaves(callee)
        if (kids.length > 0) leaf = kids[kids.length - 1]
      } else if (callee) {
        leaf = callee.text.split("<")[0]
      }
      leaf = leaf.replace(/\(.*$/, "").replace(/^['`]/, "").trim()
      // scala type args use SQUARE brackets (List[(A, B)](...)): strip them
      // so oracle targets are clean base names, matching analyzer output.
      // Iterative strip: nested type args List[(A[B], C)] need repeated passes.
      let prevLeaf
      do { prevLeaf = leaf; leaf = leaf.replace(/\[[^\[\]]*\]/g, "") } while (leaf !== prevLeaf)
      leaf = leaf.trim()
      // M49.S1 #715 refinement (scala3 @200: 9 MISSING were exactly this
      // class): the construction rule is RECEIVER-LESS per the measured
      // contract — a qualified call whose LEAF is lowercase-style
      // (`Comparator.reverseOrder()`, `CC.ff()`) is a FACTORY-METHOD call,
      // not a construction; fabricating `instantiates Comparator.reverseOrder`
      // produced unmatchable dotted targets the analyzer (correctly emitting
      // calls -> reverseOrder) could never cover. Construction requires the
      // leaf itself to be the type (capitalized): `Foo.make(...)`.
      const leafIsTypeStyle = leaf.length > 0 && leaf[0] >= "A" && leaf[0] <= "Z"
      if (leaf && leafIsTypeStyle && !qualified) edges.push({ label: "instantiates", from: "(expr)", target: leaf })
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
  // dedupe identical edges (oracle double-push guard)
  // overrides truth: same-name methods across in-file inheritance chains.
  // CPPD-R1 (M37.9): cpp overrides are NOT independently derivable — same-
  // name across a base chain conflates C++ NAME-HIDING with virtual override
  // (chrono.h: null_chrono_spec_handler.on_24_hour(numeric_system) vs
  // chrono_format_checker.on_24_hour(numeric_system, pad_type) — different
  // arity hides, it does not override; the analyzer's type-only signature
  // check is correct). Signature-aware override truth would just mirror the
  // analyzer's own virtual-registry contract (shared blind spot), so cpp
  // overrides are excluded here and stay pinned by the analyzer fixtures
  // (cpp/override-signature-aware, cpp/virtual-override-resolution).
  // Only declarations related by extends/implements within THIS file count -
  // cross-file override resolution is the analyzer's job, not the oracle's.
  const decls: Record<string, { parents: string[]; methods: Set<string>; sigs: Map<string, Set<string>> }> = {}
  const declParents: { child: string; parent: string }[] = []
  // M49.S1 #715 scala companion-union guard: per-occurrence provenance.
  // decls[nm] unions methods across same-named declarations (ScalaD-F
  // companion semantics) but parents arrive per derived extends edge — so
  // object IsEq inherited the trait IsEq's `toProp` while carrying the
  // object's own `extends IsEqLowPriorityImplicits` link, fabricating
  // `IsEq.toProp -> IsEqLowPriorityImplicits.toProp` (cats-effect IsEq.scala;
  // the analyzer resolves per-symbol and emits nothing). Scala declarations
  // therefore register per-occurrence method sets and parent links from
  // their OWN extends_clause; scala override emission (below) verifies the
  // first hop against the exact occurrence, never the pooled entry.
  /**
   * M49/M37 #867 (scala3 `tests/pos/typeclasses-this.scala`): a Scala 3
   * `extension (x: Self) def m(...)` GROUP is an `extension_definition` node, so
   * its `def`s are grandchildren of the template body, not children. The
   * analyzer registers those defs as members of the ENCLOSING type (#825's
   * extension work: `trait Functor { extension (x: Self[A]) def map ... }` emits
   * `map` owned by `Functor`), so the override truth must see them too. Without
   * this the analyzer's legitimate `Monad.map -> Functor.map` (implicit override
   * through `trait Monad extends Functor`) was reported as unexplained
   * FABRICATION by the scala lane — a confident edge the oracle simply could not
   * derive. Only the group's own defs are promoted; nested bodies are untouched.
   */
  const membersOf = (body: any): any[] => {
    const out: any[] = []
    for (let i = 0; i < body.namedChildCount; i++) {
      const m = body.namedChild(i)
      if (!m) continue
      if (m.type === "extension_definition") {
        for (let j = 0; j < m.namedChildCount; j++) {
          const mm = m.namedChild(j)
          if (mm) out.push(mm)
        }
        continue
      }
      out.push(m)
    }
    return out
  }
  const occMethods = new Map<string, Set<string>>()
  const occSigs = new Map<string, Map<string, Set<string>>>()
  const occParents: { childOcc: string; childName: string; parentName: string }[] = []
  const scalaOccCounter: Record<string, number> = {}
  // Best-effort parameter TYPE signature for a method node (java/kotlin/scala/
  // groovy/csharp/dart style typed params). Empty/unknown -> the language keeps
  // the legacy name-only pairing (never a false negative from a missing sig).
  const extractSig = (m: any): string | undefined => {
    const container = m.namedChildren.find((c: any) =>
      /^(formal_parameters|parameters|parameter_list|parameter_clause|method_parameters|function_value_parameters)$/.test(c?.type ?? ""))
    if (!container) return undefined
    const types: string[] = []
    for (let i = 0; i < container.namedChildCount; i++) {
      const p = container.namedChild(i)
      if (!p) continue
      let pt = p.childForFieldName?.("type")
      // M49.K1 kotlin: this pinned wasm exposes NO named fields, so
      // childForFieldName("type") is null on every language — java/cpp get
      // their types positionally elsewhere, but kotlin `parameter` nodes
      // carry the type as the LAST named child (name pattern first,
      // `:` separator is anonymous). Falling back to it restores exact
      // overload separation to match the analyzer's metadata params
      // (probe: {name:"x",type:"Int"}); without it every kotlin sig was
      // undefined and override matching degraded to name-only.
      if (!pt && lang === "kotlin" && p.type === "parameter") {
        pt = p.namedChild(p.namedChildCount - 1)
      }
      if (pt?.text) types.push(pt.text.replace(/\s+/g, ""))
      else return undefined // untyped parameter form — fall back to name-only
    }
    return types.length > 0 || container.namedChildCount === 0 ? "(" + types.join(",") + ")" : undefined
  }
  // ScalaD-E (M37.21 #610, scala3 byname-implicits-13.scala): textual sig
  // comparison is invalid when a param type is a GENERIC TYPE VARIABLE —
  // trait Eq's abstract `def eqv[T](x: T, y: T)` has sig (T,T) while its
  // anonymous implementations carry the substituted (Int,Int)/(String,String).
  // That is a genuine override (type-parameter substitution), not an
  // overload. Rule: if EITHER side's sig contains a type-variable token
  // (single-capital identifier, possibly in a compound type like `H :: T`),
  // fall back to name-only pairing — mirroring the analyzer's own name-based
  // findDeclaringAncestor. Concrete types keep strict sig checks so overloads
  // still never pair.
  // M49.S1 #715: bracket-aware token scan mirrors the analyzer's
  // sigHasTypeVar char-scan — the old regex missed bracketed vars
  // (`def m(x: List[A])` vs `def m(x: List[Int])` never paired).
  const hasTypeVar = (sig: string | undefined): boolean => {
    if (!sig) return false
    const n = sig.length
    let i = 0
    while (i < n) {
      const c = sig[i]
      if (c === "(" || c === "," || c === ":" || c === "|" || c === "[" || c === "<" || c === "&" || i === 0) {
        let j = i
        while (j < n && (sig[j] === "(" || sig[j] === "[" || sig[j] === " " || sig[j] === ":" || sig[j] === ",")) j++
        if (j < n && sig[j] >= "A" && sig[j] <= "Z") {
          let end = j + 1
          while (end < n && ((sig[end] >= "A" && sig[end] <= "Z") || (sig[end] >= "a" && sig[end] <= "z") || (sig[end] >= "0" && sig[end] <= "9") || sig[end] === "_")) end++
          if (end === j + 1) return true
          i = end
          continue
        }
        i = j > i ? j : i + 1
        continue
      }
      i++
    }
    return false
  }
  // #905: a BARE `private` member is NOT inherited (Scala/JLS) — it is part of
  // nobody's inheritance interface, so it can neither declare the member a
  // subclass overrides nor itself be an override. A QUALIFIED `private[pkg]`
  // IS inheritable (the analyzer models it as package-scoped), so it stays.
  // Mirrors RealScalaAnalyzer.getVisibility exactly; before this the scala
  // truth derivation had no privacy notion at all, so it paired
  // Transformation.submitWithValue -> DefaultPromise.submitWithValue through a
  // `private final def` base member (Promise.scala:473/488) that the analyzer
  // correctly refuses (#905, MISSING=1 on the scala3 depth draw).
  const scalaMemberIsBarePrivate = (member: any): boolean => {
    for (let i = 0; i < member.childCount; i++) {
      const c = member.child(i)
      if (!c || c.type !== "modifiers") continue
      for (let j = 0; j < c.childCount; j++) {
        const mod = c.child(j)
        if (!mod) continue
        if (mod.type === "private") return true
        if (mod.type !== "access_modifier") continue
        if (mod.text.includes("[")) continue // `private[pkg]` — inheritable
        if (mod.text.trim() === "private") return true
        const inner = mod.child(0)
        if (inner?.type === "private") return true
      }
    }
    return false
  }
  const sigCompatible = (child: any, parent: any, m: string): boolean => {
    const cs = child.sigs?.get(m)
    const ps = parent.sigs?.get(m)
    if (cs && ps && cs.size > 0 && ps.size > 0) {
      for (const s of cs) if (ps.has(s)) return true
      // Generic-substitution fallback: type-variable sigs cannot be compared
      // textually across instantiation — name-only pairing (analyzer mirror).
      for (const s of cs) if (hasTypeVar(s)) return true
      for (const s of ps) if (hasTypeVar(s)) return true
      return false // same name, different signature = OVERLOAD, not an override
    }
    return true // signature unavailable on a side -> legacy name-only pairing
  }
  const collectDecl = (n: any) => {
    const t2 = n.type
    if (/^(class|interface|record|trait|object)_declaration$|^class_definition$|^trait_definition$|^object_definition$|^(class|struct|union)_specifier$/.test(t2)) {
      const nameNode = n.childForFieldName?.("name") ?? n.namedChildren.find((c: any) => c.type === "identifier" || c.type === "type_identifier")
      // M37.9 cpp: class names are CLEANED like the analyzer's — template
      // class declarations/partial specs carry their args in the name node
      // text (`IteratorImpl<IndexSequence<I...>>`); the class is
      // IteratorImpl. Without the strip, truth emitted override pairs the
      // analyzer (leaf-named) could never match.
      let nm = nameNode?.text
      if (nm) {
        const lt = nm.indexOf("<")
        if (lt !== -1) nm = nm.slice(0, lt).trim()
        nm = lastSegment(nm)
      }
      // ScalaD-F (M37.21 #610, scala3 HashSet.scala): scala companions share a
      // NAME (object SetNode at L394 + sealed abstract class SetNode at L404).
      // The old `!decls[nm]` first-wins guard dropped the class's 19 abstract
      // methods because the companion registered first — the analyzer's
      // methodSigsByOwner unions methods across same-named owners, so every
      // BitmapIndexedSetNode override of SetNode surfaced as unexplained
      // fabrication. Always ensure the decl entry exists and MERGE members
      // across every same-named declaration (companion union semantics).
      if (nm) {
        if (!decls[nm]) decls[nm] = { parents: [], methods: new Set(), sigs: new Map() }
        // cpp classes use field_declaration_list (no 'body' substring)
        const body = n.namedChildren.find((c: any) => /body|field_declaration_list/.test(c.type))
        if (body) {
          for (const m of membersOf(body)) {
            // Method/function nodes only. The old trailing `|declaration`
            // catch-all ALSO admitted NESTED class/interface/enum_declaration
            // nodes, counting the nested type's name as a method of the
            // enclosing class (two-corpus wave 2026-09: SubVector "overrides"
            // its own nested Iterator/Spliterator/Object).
            // M49 W4 (T2, ledger): `property_signature` joins the member set.
            // TypeScript's .d.ts corpus re-declares INTERFACE PROPERTIES in a
            // derived interface (`interface HTMLAttributes<T> extends
            // DOMAttributes<T> { ontoggle?: … }`), which the analyzer's
            // heritage rule emits as `overrides DOMAttributes.ontoggle` — the
            // oracle registered only method_signature, so all 19 rotated-sample
            // .d.ts edges (elements.d.ts, legacy-nodes.d.ts, phases/types.d.ts,
            // index.d.ts, reactivity/types.d.ts) surfaced as unexplained. The
            // analyzer also emits NOTHING for class FIELDS
            // (public_field_definition), so class fields must stay out of the
            // mirror or truth would outrun the analyzer (probe-verified).
            if (/function_definition|function_declaration|method_declaration|method_definition|method_signature|property_signature|field_declaration/.test(m?.type ?? "")) {
              // cpp class members are field_declaration > function_declarator;
              // other families keep the name as a direct identifier child.
              const fd = m.namedChildren.find((c: any) => c.type === "function_declarator")
              let mn: any = null
              // Member VARIABLES, not methods. Must be field_declaration ONLY:
              // java/kotlin/dart methods are method_declaration/function_declaration
              // and were wrongly skipped by the old /declaration/ regex, silently
              // disabling override truth for those languages (two-corpus wave
              // 2026-09: clojure:java SubVector.spliterator -> APersistentVector).
              if (!fd && m.type === "field_declaration") continue
              // M49.K1 kotlin mirror: tree-sitter-kotlin function_declaration
              // carries its name as a `simple_identifier` child, so the
              // generic branch below (childForFieldName("name") ??
              // identifier) never matched — kotlin methods were never
              // REGISTERED in override truth and every analyzer override
              // (0.9/structural after the K2 verification fix) would surface
              // unexplained. Kotlin's name is a direct simple_identifier
              // child; sigs flow through extractSig (function_value_parameters
              // now in the container regex).
              if (!fd && lang === "kotlin" && m.type === "function_declaration") {
                const kName = m.namedChildren.find((c: any) => c.type === "simple_identifier")
                if (kName && kName.text !== nm && kName.text !== "constructor") {
                  decls[nm].methods.add(kName.text)
                  const sig = extractSig(m)
                  if (sig) {
                    let ss = decls[nm].sigs.get(kName.text)
                    if (!ss) { ss = new Set(); decls[nm].sigs.set(kName.text, ss) }
                    ss.add(sig)
                  }
                }
                continue // generic branch must not double-register
              }
              if (fd) {
                // cpp nests the name: function_declarator has a `declarator`
                // FIELD holding the method name (field_identifier, possibly
                // wrapped in pointer/reference_declarator) and a separate
                // `parameters` field. Walking the WHOLE subtree in LIFO order
                // grabs a parameter identifier instead (e.g. `Send(const
                // std::string& message)` -> `message`), fabricating
                // override pairs that the analyzer rightly rejects. Only the
                // declarator field carries the name.
                const declField = fd.childForFieldName?.("declarator")
                const st2: any[] = [declField ?? fd]
                while (st2.length && !mn) {
                  const x = st2.pop()!
                  // Class-member methods carry field_identifier as the name;
                  // a bare `identifier` in a class body is a MACRO invocation
                  // (`GTEST_DISALLOW_COPY_AND_ASSIGN_(A);` parses as
                  // declaration > function_declarator > identifier). Treating
                  // the macro as a method fabricates override pairs shared by
                  // every class that disables copies.
                  if (x.type === "field_identifier") { mn = x; break }
                  for (let k = 0; k < x.namedChildCount; k++) st2.push(x.namedChild(k))
                }
              } else {
                // The METHOD NAME, never the return type. The old
                // /identifier/ test matched `type_identifier` FIRST, so any
                // method with a class/interface return type (`public Iterator
                // iterator()`) was registered under its RETURN TYPE
                // (`Iterator`) — fabricating override pairs (two-corpus wave
                // 2026-09: clojure SubVector.Iterator "overrides"
                // APersistentVector.Iterator). Prefer the grammar `name`
                // field, then a plain (non-type) identifier child.
                mn = m.childForFieldName?.("name") ??
                  m.namedChildren.find((c: any) => c.type === "identifier") ?? null
              }
              // constructors are NOT virtually dispatched - no family
              // analyzer emits ctor-overrides, so truth must not either.
              // (cpp ctor name == class name; also skip same-name-as-class
              // members to avoid self/hierarchy name collisions)
              if (mn && mn.text !== "constructor" && mn.text !== nm) {
                decls[nm].methods.add(mn.text)
                // Record the parameter-type signature (when extractable) so
                // overloads (same name, different signature) never pair as
                // overrides — java/kotlin-style overloading is common
                // (two-corpus gate 2026-09: SubVector.nth(int) is NOT an
                // override of APersistentVector.nth(int, Object)).
                const sig = extractSig(m)
                if (sig) {
                  let ss = decls[nm].sigs.get(mn.text)
                  if (!ss) { ss = new Set(); decls[nm].sigs.set(mn.text, ss) }
                  ss.add(sig)
                }
              }
            }
          }
        }
        // M49.S1 #715 scala per-occurrence provenance (companion-union
        // guard, see occMethods above): register this DECLARATION's own
        // method set and its OWN extends_clause parents. Scala only — the
        // pooled path stays truth for every other family.
        if (lang === "scala") {
          const occKey = `${nm}#${scalaOccCounter[nm] = (scalaOccCounter[nm] ?? -1) + 1}`
          const ownMethods = new Set<string>()
          const ownSigs = new Map<string, Set<string>>()
          if (body) {
            for (const m of membersOf(body)) {
              if (!/function_definition|function_declaration/.test(m?.type ?? "")) continue
              // #905: exclude a BARE-`private` member from the occurrence set.
              // One filter, both directions: this set is the child frontier AND
              // the parent lookup, so a private base member can never seed an
              // override chain and a private child member is never paired.
              if (scalaMemberIsBarePrivate(m)) continue
              const smn = m.childForFieldName?.("name") ?? m.namedChildren.find((c: any) => c.type === "identifier")
              if (smn && smn.text !== "constructor" && smn.text !== nm) {
                ownMethods.add(smn.text)
                const sig = extractSig(m)
                if (sig) {
                  let ss = ownSigs.get(smn.text)
                  if (!ss) { ss = new Set(); ownSigs.set(smn.text, ss) }
                  ss.add(sig)
                }
              }
            }
          }
          occMethods.set(occKey, ownMethods)
          if (ownSigs.size > 0) occSigs.set(occKey, ownSigs)
          // Parents come from this declaration's OWN extends_clause — never
          // from the pooled extends-edge walk, which is what conflated the
          // companion's link with the same-named trait. Head names only;
          // dotted targets are EXTERNAL inheritance (SCALA-D1) and seed no
          // in-file override chain.
          const extClause = n.namedChildren.find((c: any) => c.type === "extends_clause")
          if (extClause) {
            for (let i = 0; i < extClause.namedChildCount; i++) {
              const h = extClause.namedChild(i)
              if (!h) continue
              let hName = h.type === "generic_type" && h.namedChildCount > 0 ? h.namedChild(0).text : h.text
              const hBracket = hName.indexOf("[")
              if (hBracket !== -1) hName = hName.slice(0, hBracket)
              if (hName && !hName.includes(".")) {
                occParents.push({ childOcc: occKey, childName: nm, parentName: hName })
              }
            }
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) collectDecl(n.namedChild(i))
  }
  collectDecl(root)
  // M37.21 #610 scala anonymous bodies (JD18 mirror): `new Sync[F] { ... }`
  // parses as instance_expression + template_body — the analyzer now emits
  // anonymous_<Super> class symbols whose members attribute to the ANONYMOUS
  // type, so the oracle must register the same synthetic declaration with
  // its supertype as a parent (an extends edge the tree never derives).
  // Mirrors RealScalaAnalyzer's anonymous-symbol push: generic supertypes
  // collapse to the head name, bracketed args stripped.
  const anonScalaDecl = (n: any) => {
    if (n.type !== "instance_expression") return
    const body = n.namedChildren.find((c: any) => c.type === "template_body")
    if (!body) return
    const tn = n.namedChild(0)
    if (!tn) return
    let superName = tn.text
    if (tn.type === "generic_type" && tn.namedChildCount > 0) superName = tn.namedChild(0).text
    superName = superName.replace(/\[[^\[\]]*\]/g, "").replace(/<[^<>]*>/g, "").trim()
    if (!superName) return
    const anonName = `anonymous_${superName}`
    if (!decls[anonName]) {
      decls[anonName] = { parents: [], methods: new Set(), sigs: new Map() }
      for (const m of membersOf(body)) {
        if (!/function_definition|function_declaration/.test(m?.type ?? "")) continue
        const mn = m.childForFieldName?.("name") ?? m.namedChildren.find((c: any) => c.type === "identifier")
        if (mn && mn.text !== "constructor" && mn.text !== anonName) {
          decls[anonName].methods.add(mn.text)
          const sig = extractSig(m)
          if (sig) {
            let ss = decls[anonName].sigs.get(mn.text)
            if (!ss) { ss = new Set(); decls[anonName].sigs.set(mn.text, ss) }
            ss.add(sig)
          }
        }
      }
      // M49.S1 scala per-occurrence registration for the anonymous body —
      // same provenance discipline as named declarations above.
      if (lang === "scala" && !superName.includes(".")) {
        const occKey = `${anonName}#0`
        const ownMethods = new Set<string>()
        const ownSigs = new Map<string, Set<string>>()
        for (const m of membersOf(body)) {
          if (!/function_definition|function_declaration/.test(m?.type ?? "")) continue
          if (scalaMemberIsBarePrivate(m)) continue // #905: bare private is not inherited
          const smn = m.childForFieldName?.("name") ?? m.namedChildren.find((c: any) => c.type === "identifier")
          if (smn && smn.text !== "constructor" && smn.text !== anonName) {
            ownMethods.add(smn.text)
            const sig = extractSig(m)
            if (sig) {
              let ss = ownSigs.get(smn.text)
              if (!ss) { ss = new Set(); ownSigs.set(smn.text, ss) }
              ss.add(sig)
            }
          }
        }
        occMethods.set(occKey, ownMethods)
        if (ownSigs.size > 0) occSigs.set(occKey, ownSigs)
        occParents.push({ childOcc: occKey, childName: anonName, parentName: superName })
      }
    }
    if (!decls[superName]) decls[superName] = { parents: [], methods: new Set(), sigs: new Map() }
    declParents.push({ child: anonName, parent: superName })
  }
  anonScalaDecl(root)
  const anonStack: any[] = []
  for (let i = 0; i < root.namedChildCount; i++) { const c = root.namedChild(i); if (c) anonStack.push(c) }
  while (anonStack.length) {
    const x = anonStack.pop()!
    anonScalaDecl(x)
    // M37.21 C30 mirror (java twin of the scala block): `new QueryHandler()
    // { public int handle(...) {...} }` — the analyzer now declares
    // anonymous_${Super} class symbols, attributes the body's methods to
    // the anonymous type, and registers the supertype in classHierarchy so
    // @Override methods resolve (exact-in-file). The oracle must register
    // the same synthetic declaration or every verified
    // anonymous_X.m -> Super.m edge surfaces as unexplained fabrication
    // (grails-core JpaQueryBuilder: 13 anon bodies, 1 unexplained @200).
    // Scoped supertypes collapse to the base segment; generic args stripped
    // — mirrors extractJavaTypeBaseName.
    if (x.type === "object_creation_expression") {
      const jbody = x.namedChildren.find((c: any) => c.type === "class_body")
      const jtn = x.namedChildren.find((c: any) => /type_identifier|scoped_type_identifier|generic_type$/.test(c.type))
      if (jbody && jtn) {
        let jSuper = jtn.text
        if (jtn.type === "generic_type" && jtn.namedChildCount > 0) jSuper = jtn.namedChild(0).text
        jSuper = jSuper.replace(/<[^<>]*>/g, "").trim()
        const jDot = jSuper.lastIndexOf(".")
        if (jDot !== -1) jSuper = jSuper.slice(jDot + 1)
        if (jSuper) {
          const jAnon = `anonymous_${jSuper}`
          if (!decls[jAnon]) {
            decls[jAnon] = { parents: [], methods: new Set(), sigs: new Map() }
            for (let i = 0; i < jbody.namedChildCount; i++) {
              const m = jbody.namedChild(i)
              if (m?.type !== "method_declaration") continue
              const mn = m.childForFieldName?.("name")
              if (mn) {
                decls[jAnon].methods.add(mn.text)
                const sig = extractSig(m)
                if (sig) {
                  let ss = decls[jAnon].sigs.get(mn.text)
                  if (!ss) { ss = new Set(); decls[jAnon].sigs.set(mn.text, ss) }
                  ss.add(sig)
                }
              }
            }
          }
          if (!decls[jSuper]) decls[jSuper] = { parents: [], methods: new Set(), sigs: new Map() }
          declParents.push({ child: jAnon, parent: jSuper })
        }
      }
    }
    // M49.K1 kotlin twin: `object : Runnable { override fun run() {...} }`
    // parses as object_literal + class_body. RealKotlinAnalyzer declares an
    // anonymous_<Super> class symbol, attributes the body's methods to it,
    // and its K2 override BFS verifies through metadata.superTypes — the
    // oracle must register the same synthetic declaration or every verified
    // anonymous_X.m -> Super.m edge surfaces as unexplained fabrication.
    // Supertypes resolve through delegation_specifier > user_type >
    // type_identifier (nested — the analyzer recurses too).
    if (x.type === "object_literal") {
      const kbody = x.namedChildren.find((c: any) => c.type === "class_body")
      const kdeleg = x.namedChildren.find((c: any) => c.type === "delegation_specifier")
      if (kbody && kdeleg) {
        const findKType = (nn: any): any => {
          if (nn.type === "type_identifier") return nn
          for (let i = 0; i < nn.namedChildCount; i++) { const c = nn.namedChild(i); if (c) { const r = findKType(c); if (r) return r } }
          return null
        }
        const ktn = findKType(kdeleg)
        if (ktn?.text) {
          const kSuper = ktn.text
          const kAnon = `anonymous_${kSuper}`
          if (!decls[kAnon]) {
            decls[kAnon] = { parents: [], methods: new Set(), sigs: new Map() }
            for (let i = 0; i < kbody.namedChildCount; i++) {
              const m = kbody.namedChild(i)
              if (m?.type !== "function_declaration") continue
              const mn = m.namedChildren.find((c: any) => c.type === "simple_identifier")
              if (mn && mn.text !== "constructor" && mn.text !== kAnon) {
                decls[kAnon].methods.add(mn.text)
                const sig = extractSig(m)
                if (sig) {
                  let ss = decls[kAnon].sigs.get(mn.text)
                  if (!ss) { ss = new Set(); decls[kAnon].sigs.set(mn.text, ss) }
                  ss.add(sig)
                }
              }
            }
          }
          if (!decls[kSuper]) decls[kSuper] = { parents: [], methods: new Set(), sigs: new Map() }
          declParents.push({ child: kAnon, parent: kSuper })
        }
      }
    }
    for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c) anonStack.push(c) }
  }
  // hierarchy from already-derived extends edges (head-segment normalized)
  // SCALA-D1 (two-corpus gate finding, cats-effect Queue.scala): a QUALIFIED
  // heritage target (`with unsafe.BoundedQueue[F, A]`) must never seed an
  // override chain. unsafe.BoundedQueue is an EXTERNAL trait (different
  // package/file); lastSegment() collapsed it onto the unrelated IN-FILE
  // sync class `BoundedQueue extends AbstractQueue`, fabricating
  // `BoundedAsyncQueue.offer -> AbstractQueue.offer` through a chain the
  // analyzer (correctly descending BaseBoundedAsyncQueue -> Queue) never
  // emits. Override truth is in-file verification: a dotted target cannot
  // resolve to a declaration in THIS file, so qualified names are excluded
  // from declParents on every language (external inheritance is the
  // analyzer's cross-file job, not the oracle's).
  for (const e of edges) {
    if (e.label !== "extends" && e.label !== "implements") continue
    if (e.target.includes(".")) continue // qualified = external, not in-file
    const parent = lastSegment(e.target)
    if (decls[e.from] && decls[parent] && e.from !== parent) {
      declParents.push({ child: e.from, parent })
    }
  }
  for (const rel of declParents) {
    if (lang === "cpp") break // CPPD-R1: no cpp overrides truth (see above)
    // M49.S1: scala never uses pooled emission — per-occurrence loop below.
    if (lang === "scala") continue
    const childDecl = decls[rel.child]
    if (!childDecl) continue
    // M37.9 cpp: overrides resolve TRANSITIVELY (A->B->C: a method defined
    // only in A and C still overrides through B) with a depth cap — mirrors
    // the analyzer's classBases BFS. The old code checked DIRECT parents
    // only, so every transitive override the analyzer emitted surfaced as
    // unexplained fabrication.
    for (const m of childDecl.methods) {
      const seenBase = new Set<string>()
      const queue = [rel.child]
      let depth = 0
      while (queue.length && depth < 10) {
        depth++
        const cls = queue.shift()!
        if (seenBase.has(cls)) continue
        seenBase.add(cls)
        for (const b of declParents.filter((r2) => r2.child === cls)) {
          if (b.parent === rel.child) continue // self-collision guard
          const parentDecl = decls[b.parent]
          if (parentDecl?.methods.has(m) && !seenBase.has(b.parent) &&
              sigCompatible(childDecl, parentDecl, m)) {
            edges.push({ label: "overrides", from: `${rel.child}.${m}`, target: `${b.parent}.${m}` })
          }
          if (decls[b.parent]) queue.push(b.parent)
        }
      }
    }
  }
  // M49.S1 #715 scala per-occurrence override emission. Same transitive BFS
  // and sigCompatible gate as the pooled loop, but methods and every hop's
  // parent links come from ONE declaration occurrence — companion-union
  // conflation (object IsEq × trait IsEq) can never fabricate again. The
  // first hop uses the occurrence's OWN sigs; further hops fall back to the
  // pooled sigs (the union) — signature over-strictness at depth only
  // suppresses a truth edge in a name-collision case the analyzer's own
  // name-based BFS would also have paired, never fabricates one.
  if (lang === "scala") {
    for (const [occKey, methods] of occMethods) {
      const occName = occKey.slice(0, occKey.lastIndexOf("#"))
      const ownSigs = occSigs.get(occKey)
      for (const m of methods) {
        const seenOcc = new Set<string>()
        // Frontier entries are EXACT occurrence keys. Matching parents by
        // childOcc only (never by name) is the whole point of the guard: a
        // name fallback would let the trait IsEq#1 inherit the companion
        // object's extends link (IsEq#0 -> IsEqLowPriorityImplicits) — the
        // exact conflation this block exists to kill. Every scala
        // declaration (collectDecl) and anonymous body (anonScalaDecl)
        // registers an occurrence, so exact-key resolution always closes.
        let frontier: string[] = [occKey]
        let depth = 0
        while (frontier.length && depth < 10) {
          depth++
          const next: string[] = []
          for (const cur of frontier) {
            if (seenOcc.has(cur)) continue
            seenOcc.add(cur)
            for (const op of occParents.filter((p) => p.childOcc === cur)) {
              if (op.parentName === occName) continue // self-collision guard
              const parentOccKeys = [...occMethods.keys()].filter((k) => k.startsWith(op.parentName + "#"))
              if (parentOccKeys.length === 0) {
                // No per-occurrence registration (defensive only): the
                // pooled decls entry still carries its methods so a parent
                // known only through companion sharing stays reachable.
                const parentDecl = decls[op.parentName]
                if (parentDecl?.methods.has(m)) {
                  const cs = ownSigs?.get(m)
                  const ps = parentDecl.sigs.get(m)
                  const compat = cs && ps ? [...cs].some((s) => ps.has(s) || hasTypeVar(s) || [...ps].some((p2) => hasTypeVar(p2))) : true
                  if (compat) edges.push({ label: "overrides", from: `${occName}.${m}`, target: `${op.parentName}.${m}` })
                }
              } else {
                for (const pk of parentOccKeys) {
                  const pm = occMethods.get(pk)
                  if (!pm?.has(m)) continue
                  const cs = ownSigs?.get(m)
                  const ps = occSigs.get(pk)?.get(m)
                  const compat = cs && ps ? [...cs].some((s) => ps.has(s) || hasTypeVar(s) || [...ps].some((p2) => hasTypeVar(p2))) : true
                  if (compat) edges.push({ label: "overrides", from: `${occName}.${m}`, target: `${op.parentName}.${m}` })
                }
                next.push(...parentOccKeys)
              }
            }
          }
          frontier = next
        }
      }
    }
  }

  return edges.filter((e, i) => edges.findIndex(x => x.label === e.label && x.from === e.from && x.target === e.target) === i)
}

export interface DifferentialEvaluation {
  comparable: boolean
  regressions: string[]
  perfRegressions: string[]
  /** Lanes whose drawn file set differs from the one the baseline recorded
   * (cold-pool rotation): their counts are NOT comparable to the baseline, so
   * an increase is a new-sample finding to triage, never a regression. */
  resampled: string[]
  /** Baseline lanes that carry no recorded file-set hash, i.e. their counts
   * were pinned without recording WHICH files produced them. Those keep the
   * strict count comparison (it is the only claim available) but the gap is
   * reported so it can only shrink. */
  unpinnedLanes: string[]
  /** #871: perf rows we refused to score (baseline carries no load context).
   * Refusing beats mislabelling a busy machine as a regression; disclosed so
   * the list can only shrink. */
  perfUnscored: string[]
  /** #871: lane-vs-run-median outlier ratios. DISCLOSED, never scored: the
   * ratio cannot be told apart from a busy machine (measured firing at load
   * 3.9, 8.7 and ~22 across three ceremonies while the run median stayed put).
   * The failing perf gate is the baseline ratio, which is context-gated. */
  medianOutliers: string[]
  checks: { id: string; description: string; status: "pass" | "fail"; detail: string }[]
}

/**
 * Evaluate a differential report before evidence is emitted. Keeping this
 * pure makes the evidence decision testable without parsing a corpus.
 */
export function evaluateDifferential(
  report: Record<string, any>,
  current: Record<string, any>,
  baseline: Record<string, any>,
  baselineSample: number | undefined,
  samplePerLang: number,
  repo: string | ((lang: string) => string),
  baselineHashes: Record<string, string> = {},
): DifferentialEvaluation {
  const repoOf = typeof repo === "function" ? repo : () => repo
  const comparable = !baselineSample || baselineSample === samplePerLang
  const perfRegressions: string[] = []
  const regressions: string[] = []
  // Sample-set awareness (M49 G5). Two distinct situations, never merged:
  //   resampled  — the baseline recorded a hash for this lane and this run's
  //                drawn set hashes differently. The counts measure a
  //                different file set, so growth is UNATTRIBUTABLE.
  //   unpinned   — the baseline recorded no hash at all (pre-G5 rows). The
  //                strict count comparison is kept, because it is the only
  //                claim available, but the lane is reported as unpinned so
  //                the gap is visible and can only shrink.
  const resampled = new Set<string>()
  const unpinnedLanes: string[] = []
  const perfUnscored: string[] = []
  const medianOutliers: string[] = []
  for (const l of Object.keys(current)) {
    const cur = current[l]?.sampleHash
    const base = baselineHashes[l]
    if (!baseline[l]) continue
    if (!base) { unpinnedLanes.push(l); continue }
    if (cur && cur !== base) resampled.add(l)
  }
  // A resampled lane's own parity still verifies the analyzer against the
  // oracle on the files it drew (that is `checks`), but its counts may not be
  // scored against the pinned baseline.
  if (comparable) {
    for (const l of Object.keys(current)) {
      if (resampled.has(l)) continue
      const bPerf = baseline[l]?.perf
      const bAvg = bPerf?.avgMsPerFile
      const cAvg = current[l]?.perf?.avgMsPerFile
      if (!bAvg || !cAvg) continue
      // #871 §1: a baseline row recorded before load context existed cannot be
      // told apart from a busy-machine measurement. REFUSE to score it
      // (disclosed via perfUnscored) rather than mislabel; re-pin with
      // --update-baseline at a stable tree to restore scoring for the lane.
      if (typeof bPerf?.loadAvg1 !== "number") { perfUnscored.push(`${l}: baseline row records no load context (pin with --update-baseline)`); continue }
      if (cAvg > Math.max(3 * bAvg, bAvg + 50)) {
        perfRegressions.push(`${l}: avg ${bAvg}ms -> ${cAvg}ms per file`)
      }
    }
    const avgs = Object.values(current)
      .map((c: any) => c.perf?.avgMsPerFile)
      .filter((x: any) => typeof x === "number" && x > 0)
      .sort((a: number, b: number) => a - b)
    if (avgs.length >= 3) {
      const median = avgs[Math.floor(avgs.length / 2)]
      for (const l of Object.keys(current)) {
        const cAvg = current[l]?.perf?.avgMsPerFile
        if (cAvg && median && cAvg > Math.max(3 * median, median + 200)) {
          // #871 §2: DISCLOSED, never scored. The ratio cannot separate a busy
          // machine from lane slowness — lodash:javascript fired on all three
          // ceremonies (load 3.9 / 8.7 / ~22) while its own avg barely moved
          // relative to the run median's stability. The failing perf gate is
          // the baseline ratio above, which is context-gated.
          medianOutliers.push(`${l}: outlier vs median (${cAvg}ms vs ${median}ms median) — unscored (median ratio cannot separate machine load from lane slowness; see #871)`)
        }
      }
    }
    for (const l of Object.keys(current)) {
      if (resampled.has(l)) continue
      if (baseline[l] && (current[l].missing > baseline[l].missing || current[l].unexplained > baseline[l].unexplained || current[l].heuristic > baseline[l].heuristic)) {
        regressions.push(l)
      }
    }
  }
  // Lane-aware failed set: report rows (and current/baseline rows) are keyed
  // `repo:lang` under the two-corpus gate, so regressions carry the FULL lane
  // key and mark that lane's check failed. The function also still accepts the
  // legacy bare-`lang` report shape (unit tests / single-corpus probe callers):
  // a regression key `repo:lang` then marks the bare-lang check by matching on
  // the language part (also added to the set below).
  const failed = new Set([...regressions])
  for (const key of regressions) {
    const parts = key.split(":")
    if (parts.length >= 2) failed.add(parts[parts.length - 1])
  }
  // Perf messages are `repo:lang: avg Xms -> Yms` — derive the full lane key
  // (`repo:lang`) plus the bare lang so both shapes of report keys match.
  for (const x of perfRegressions) {
    const parts = x.split(":")
    if (parts.length >= 3) failed.add(`${parts[0]}:${parts[1]}`)
    if (parts.length >= 2) failed.add(parts[1])
  }
  // Same key-shape tolerance as `failed`: current rows are `repo:lang` keyed
  // while the primary report is bare-`lang` keyed, so a resampled `repo:lang`
  // lane must also mark its bare-lang check.
  const resampledForReport = new Set<string>(resampled)
  for (const key of resampled) {
    const parts = key.split(":")
    if (parts.length >= 2) resampledForReport.add(parts[parts.length - 1])
  }
  // A resampled lane cannot be scored against the PINNED allowance (that
  // allowance belongs to a different file set), so the row's own anomalies are
  // the only honest verdict available. Split by kind, because the two kinds are
  // not the same claim:
  //   missing / unexplained — a real parity anomaly (a dropped edge, or an
  //     edge the tree truth does not corroborate). Unscorable against the
  //     pinned allowance, so it must FAIL and be triaged; it must never pass
  //     silently just because the baseline row was generous.
  //   heuristic — an edge the analyzer itself declares low-confidence. It is
  //     documented suspicion, not a fabrication claim, so it does not fail a
  //     lane; it is disclosed in the detail as unscored on this sample.
  const resampledDirty = new Set<string>()
  const resampledHeuristic = new Map<string, number>()
  for (const key of resampled) {
    const c = current[key]
    const offenders: string[] = []
    if (c) {
      if ((c.missing ?? 0) > 0) offenders.push(`${c.missing} missing`)
      if ((c.unexplained ?? 0) > 0) offenders.push(`${c.unexplained} unexplained`)
      if ((c.heuristic ?? 0) > 0) resampledHeuristic.set(key, c.heuristic)
    }
    if (offenders.length === 0) continue
    resampledDirty.add(key)
    const parts = key.split(":")
    if (parts.length >= 2) resampledDirty.add(parts[parts.length - 1])
  }
  const checks = Object.entries(report).map(([lang, r]: any) => {
    const laneFailed = failed.has(lang)
    const laneResampled = resampledForReport.has(lang)
    const laneResampledDirty = resampledDirty.has(lang)
    const laneHeuristic = [...resampledHeuristic.entries()]
      .filter(([k]) => k === lang || k.endsWith(`:${lang}`))
      .reduce((a, [, v]) => a + v, 0)
    return {
      id: `differential-${lang}`,
      description: `${repoOf(lang)}: tree-truth vs analyzer diff`,
      status: comparable && !laneFailed && !laneResampledDirty ? "pass" as const : "fail" as const,
      detail: comparable
        ? `${r.filesSampled} files, coverage ${r.coveragePct}%, unexplained ${r.fabricationPct}%`
          + (laneFailed ? "; regression detected" : "")
          + (laneResampledDirty
            ? "; drew a different file set than the baseline AND carries its own missing/unexplained anomalies - the pinned allowance (from a different sample) cannot score them, so this is a new-sample finding that needs triage"
            : laneResampled
              ? `; drew a different file set than the baseline (resampled) - clean on the fresh sample, so parity verified but counts not compared${laneHeuristic > 0 ? `; ${laneHeuristic} declared-heuristic edge(s) on the fresh sample left unscored (triage)` : ""}`
              : "")
        : `${r.filesSampled} files; NOT COMPARABLE: baseline sampled ${baselineSample ?? "unknown"}/lang, run ${samplePerLang}/lang`,
    }
  })
  return { comparable, regressions, perfRegressions, resampled: [...resampled], unpinnedLanes, perfUnscored, medianOutliers, checks }
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  // #871 §1: the load context of the whole sweep, recorded in evidence and
  // pinned into the baseline so a future breach can be told apart from a busy
  // machine.
  const runLoadAvgStart = loadAvg1()

  // Two-corpus gate: active repos = primary set ∪ second-corpus set.
  // `--lang a,b` restricts the lanes (see ONLY_LANGS), so it must restrict the
  // corpus-presence check to the SAME set. It did not: the check below walked
  // every LANG_REPOS/SECOND_CORPUS value, so a one-language run still demanded
  // all 24 other languages' checkouts and died on the first absent one — which
  // made the flag unusable for exactly the case it was added for (M60 groovy:
  // re-measure one lane and emit its own artifact). Measured here with
  // `--lang hcl`, where only terraform and tf-aws-components are present.
  const activeRepos = REPO
    ? [REPO]
    : [
        ...new Set(
          Object.keys(LANGS)
            .filter((l) => !ONLY_LANGS || ONLY_LANGS.includes(l))
            .flatMap((l) => [LANG_REPOS[l], SECOND_CORPUS[l]])
            .filter((r): r is string => typeof r === "string"),
        ),
    ]
  for (const rp of activeRepos) {
    const rd = path.join(CORPUS_ROOT, rp)
    if (!fs.existsSync(rd)) throw new Error(`corpus repo missing: ${rd}`)
  }
  const repoPins: Record<string, string> = {}
  for (const rp of activeRepos) {
    repoPins[rp] = execSync("git rev-parse HEAD", { cwd: path.join(CORPUS_ROOT, rp) }).toString().trim()
  }
  // M49 W16 (defect 1): a lane-batch child inherits the parent's frozen state,
  // so a corpus commit mid-sweep can no longer split the journal. The parent
  // read these pins before any child started, and the parent owns the evidence
  // write; a child's own live read is only a fallback for repos the parent
  // never pinned (there are none in a canonical sweep).
  const isChildRun = !!CHILD_SLICE
  if (isChildRun) {
    const inherited = resolveSweepPins(repoPins, process.env[SWEEP_PINS_ENV], isChildRun)
    const moved = Object.keys(inherited).filter(r => inherited[r] !== repoPins[r])
    Object.assign(repoPins, inherited)
    if (moved.length > 0) {
      console.log(`[state] inherited the parent's pin for ${moved.length} repo(s) that moved after the parent read them: ${moved.slice(0, 6).join(", ")}${moved.length > 6 ? ", …" : ""}`)
    }
  }
  const repoFor = (lang: string) => {
    if (REPO) return REPO
    const mapped = LANG_REPOS[lang]
    if (!mapped) throw new Error(`no corpus repo mapped for language ${lang} — extend LANG_REPOS`)
    return mapped
  }

  const report: Record<string, any> = {}
  const reportSecond: Record<string, any> = {}
  // Crash-resume: seed from the per-lane journal (written after every lane).
  // Only for canonical full sweeps — probe runs (--repo/--sample) always
  // recompute and never read the journal.
  const resume = !REPO && !process.argv.includes("--sample")
  // One grammar + parser per LANGUAGE, reused by that language's second-corpus
  // lane. The wasm heap is fixed size: loading a language module and
  // constructing a Parser for EVERY lane (42 allocations for 21 languages)
  // exhausted it and aborted the sweep mid-run with
  // `RuntimeError: Out of bounds call_indirect` at `new ParserClass()` — after
  // which no evidence is written at all, which is why M14.0.F5 was the one
  // artifact that stayed pre-#761 `__LEGACY__` while everything else acquired
  // lineage: it could not be regenerated. Halving the allocations is the cheap
  // half of the fix; the zero-truth guard below catches the dead-parser state
  // this can still produce.
  const PARSER_CACHE = new Map<string, { grammar: any }>()
  let resumedLanes = 0
  // Lane sweep: primary + second corpus per gated language (two-corpus gate).
  // Lanes are (lang, repo) pairs; rows keyed `repo:lang` in the baseline map so
  // regressions on EITHER corpus fail the language's check.
  const lanes: { lang: string; repo: string; isSecond: boolean }[] = []
  for (const lang of Object.keys(LANGS)) {
    if (ONLY_LANGS && !ONLY_LANGS.includes(lang)) continue
    lanes.push({ lang, repo: repoFor(lang), isSecond: false })
    // Probe mode (--repo X): single corpus only — the second lane would point
    // at an unrelated repo and defeat the probe's intent.
    if (REPO) continue
    const second = SECOND_CORPUS[lang]
    if (second && second !== repoFor(lang)) lanes.push({ lang, repo: second, isSecond: true })
  }

  // ---------------------------------------------------------------------
  // M49 W11: state-addressed journal + batched lanes (Defects 2 and 3).
  //
  // The journal is a per-SWEEP-state artifact: same corpus pins and same
  // analyzer/oracle code ⇒ a lane's row is reusable; anything else ⇒ a
  // different file, nothing to inherit. A probe run (--repo/--sample without
  // batching) neither reads nor writes it, so it can no longer inherit rows it
  // did not measure — nor overwrite the rows a canonical run measured.
  //
  // Batched execution is how a full sweep now COMPLETES: each child is a fresh
  // process with a fresh web-tree-sitter module, so the fixed wasm heap is
  // never pushed to the abort point (measured: one module dies after ~19-31
  // lanes), and the parent — which measures nothing itself — resumes every
  // lane from the journal and owns the evidence write and the baseline gate.
  // ---------------------------------------------------------------------
  const stateKey = resolveSweepState(
    sweepStateKey(repoPins, `${SAMPLE_PER_LANG}/lang ${lanes.map(l => `${l.repo}:${l.lang}`).sort().join(",")}`),
    process.env[SWEEP_STATE_ENV],
    isChildRun,
  )
  const LANE_JOURNAL = `${LANE_JOURNAL_PREFIX}-${stateKey}.json`
  // M49 W16 (defect 2): measure the PIN. A lane whose repo is not exactly at
  // its pin is measured in a detached worktree of that pin — materialized once
  // per (state, repo) and removed once the parent has written the evidence.
  // The substitution is logged here and carried in the evidence's `pinDrift`,
  // so a measurement can never claim a pin it did not read.
  const FROZEN_ROOT = path.join(WORK_ROOT, `m14-frozen-corpus-${stateKey}`)
  const frozenTrees = new Map<string, string>()
  const laneDirCache = new Map<string, string>()
  const pinDrift: Record<string, string> = {}
  const laneRepoDir = (repo: string): string => {
    const cached = laneDirCache.get(repo)
    if (cached) return cached
    const live = path.join(CORPUS_ROOT, repo)
    const pin = repoPins[repo]
    if (!pin) throw new Error(`differential: no pin recorded for corpus repo ${repo}`)
    const head = execSync("git rev-parse HEAD", { cwd: live }).toString().trim()
    let dirty = false
    try {
      dirty = execSync("git status --porcelain --untracked-files=normal", { cwd: live, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().length > 0
    } catch { dirty = true }
    if (!pinNeedsFrozenTree(head, pin, dirty)) {
      laneDirCache.set(repo, live)
      return live
    }
    const reason = pinDriftReason(head, pin, dirty)
    pinDrift[repo] = `live checkout ${reason} (pin ${pin.slice(0, 10)})`
    const dest = path.join(FROZEN_ROOT, repo)
    if (!frozenTrees.has(repo)) {
      if (!fs.existsSync(path.join(dest, ".git"))) {
        fs.mkdirSync(FROZEN_ROOT, { recursive: true })
        try {
          execSync(`git worktree add --detach ${JSON.stringify(dest)} ${pin}`, { cwd: live, stdio: ["ignore", "pipe", "pipe"] })
        } catch (e: any) {
          // A sibling batch may have won the race for this repo's tree.
          if (!fs.existsSync(path.join(dest, ".git"))) {
            throw new Error(`differential: ${repo} is not at its pin (${reason}) and its pinned tree could not be materialized: ${e?.message ?? e}`)
          }
        }
      }
      frozenTrees.set(repo, dest)
      console.log(`[frozen] ${repo}@${pin.slice(0, 10)} — live checkout is ${reason}; measuring the pinned tree at ${dest}`)
    }
    laneDirCache.set(repo, dest)
    return dest
  }
  // Canonical sweeps only: a --repo probe routes EVERY language at one repo,
  // where most languages legitimately have no files (`files=0 SKIPPED` — not
  // measured, so not journaled), which is not a lane the completeness check
  // below can or should demand. Probes stay single-process, as they always
  // were; they are interactive diagnosis, and the dead-parser guard still makes
  // a module abort loud rather than silent.
  const willBatch = !CHILD_SLICE && !NO_BATCH && !REPO && lanes.length > BATCH_SIZE
  const useJournal = !!CHILD_SLICE || resume || willBatch
  const loadJournal = (): Record<string, any> => {
    if (!useJournal || !fs.existsSync(LANE_JOURNAL)) return {}
    try {
      const parsed = JSON.parse(fs.readFileSync(LANE_JOURNAL, "utf8"))
      // Addressed by state (below) AND validated against it, so a hand-copied
      // or stale file can never be resumed across states.
      if (parsed?.stateKey !== stateKey) {
        console.log(`[journal] ignoring ${LANE_JOURNAL}: written for state ${parsed?.stateKey ?? "?"}, this run is ${stateKey}`)
        return {}
      }
      return parsed.lanes ?? {}
    } catch { return {} }
  }
  const saveJournal = (rows: Record<string, any>) => {
    fs.mkdirSync(path.dirname(LANE_JOURNAL), { recursive: true })
    fs.writeFileSync(LANE_JOURNAL, JSON.stringify({ stateKey, corpusPins: repoPins, lanes: rows }, null, 2))
  }
  const laneJournal: Record<string, any> = loadJournal()
  const jKeyOf = (l: { lang: string; repo: string; isSecond: boolean }) => (l.isSecond ? `${l.repo}:${l.lang}` : l.lang)
  if (willBatch) {
    const missing = lanes.filter(l => !laneJournal[jKeyOf(l)]).length
    const batches = Math.ceil(lanes.length / BATCH_SIZE)
    if (missing > 0) {
      console.log(`[batch] ${lanes.length} lane(s), ${missing} to measure, ${batches} batch(es) of <=${BATCH_SIZE} — one fresh wasm module per batch (state ${stateKey})`)
      for (let b = 0; b < batches; b++) {
        const args = [...process.argv.slice(2), `--lane-batch=${b}/${batches}`]
        const r = spawnSync(process.execPath, [process.argv[1], ...args], { stdio: "inherit", cwd: ROOT, env: { ...process.env, [SWEEP_STATE_ENV]: stateKey, [SWEEP_PINS_ENV]: JSON.stringify(repoPins) } })
        if (r.error) throw new Error(`differential: batch ${b}/${batches} could not start: ${r.error.message}`)
        if (r.status !== 0) throw new Error(`differential: batch ${b}/${batches} exited ${r.status} — a lane in it failed (log above); NOT writing evidence from an incomplete sweep`)
      }
    } else {
      console.log(`[batch] all ${lanes.length} lane(s) already journaled for state ${stateKey} — resuming, no child spawned`)
    }
    // Pick up what the children measured, then verify completeness: the parent
    // must never emit evidence from a partial sweep.
    Object.assign(laneJournal, loadJournal())
    const stillMissing = lanes.filter(l => !laneJournal[jKeyOf(l)])
    if (stillMissing.length > 0) {
      throw new Error(`differential: ${stillMissing.length} lane(s) unmeasured after batching (${stillMissing.map(jKeyOf).join(", ")}) — no evidence written`)
    }
  }
  for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
    const lane = lanes[laneIndex]
    // This child owns exactly one slice of the lanes; the rest belong to its
    // siblings (lane order is deterministic, so every child agrees on it).
    if (CHILD_SLICE && laneIndex % CHILD_SLICE.n !== CHILD_SLICE.i) continue
    const { lang, repo: langRepo } = lane
    // Crash-resume: a lane already in the journal — measured in THIS state — is
    // trusted verbatim.
    const jKey = lane.isSecond ? `${langRepo}:${lang}` : lang
    if (useJournal && laneJournal[jKey]) {
      const jRow = laneJournal[jKey].row
      if (lane.isSecond) reportSecond[jKey] = jRow
      else report[lang] = jRow
      resumedLanes++
      console.log(`[${langRepo}] ${lang}: RESUMED from journal (files=${jRow.filesSampled} cov=${jRow.coveragePct}% missing=${jRow.missingInAnalyzer} unexp=${jRow.unexplainedInAnalyzer})`)
      continue
    }
    const cfg = LANGS[lang]
    const repoDir = laneRepoDir(langRepo)
    const repoPin = repoPins[langRepo]
    const files: string[] = []
    const scan = (d: string) => {
      if (files.length > DISCOVERY_CAP) return
      let entries
      try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (!/^(\.|node_modules|build|target)/.test(e.name)) scan(p) }
        else {
          if (!cfg.ext.split(",").some((x: string) => e.name.endsWith("." + x))) continue
          // A content-routed extension cannot be admitted by name. `h` is C, C++
          // and Objective-C at once: language-detection.ts sniffs
          // @interface/@protocol and hands the file to objective-c. Admitting
          // every `.h` here would grade C and C++ headers with the Objective-C
          // analyzer; admitting none (this lane's state before the change) left
          // production's header half ungraded — measured, 169 of the 322
          // objc-routed files in the lane's own two pinned repos carried 1,812
          // symbols and 2,025 relationships no gate had ever looked at. So the
          // router decides per file and the lane takes only what it is handed.
          if (cfg.routeByContent?.includes(extOf(e.name))) {
            let head = ""
            try { head = fs.readFileSync(p, "utf8").slice(0, 65536) } catch { continue }
            if (detectLanguageFromPath(p, head) !== (ROUTER_LANGUAGE[lang] ?? lang)) continue
          }
          files.push(p)
        }
      }
    }
    scan(repoDir)
    // Probe mode: --repo X with an off-language repo would report files=0 as a
    // vacuous pass. Explicitly reporting the skip keeps probe output honest
    // (the vacuous-pass THROW below applies only to full-sweep default runs,
    // where every language has a mapped repo that MUST contain it).
    if (files.length === 0 && REPO) {
      console.log(`[${langRepo}] ${lang}: files=0 SKIPPED (repo probe mode; no ${lang} files in ${langRepo})`)
      continue
    }

    // The grammar is cached per language (21 loads for 42 lanes) and the Parser
    // is per-lane, freed when the lane ends: both allocations live in the
    // fixed-size wasm heap and neither is reclaimed by JS GC. With the grammar
    // cached and the parser freed, only 21 grammar modules are ever live.
    let cached = PARSER_CACHE.get(lang)
    if (!cached) {
      cached = { grammar: await Language.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm))) }
      PARSER_CACHE.set(lang, cached)
    }
    const parser = new ParserClass()
    parser.setLanguage(cached.grammar)
    const mod: any = await import(`../../src/ast/${cfg.analyzerFile}`)
    const analyzer = new mod[cfg.className]()

    // Cross-file type-kind aid for csharp (CSD1): the analyzer resolves a
    // base-list entry's interface-vs-class kind via a cross-file symbol
    // companion. The per-file oracle can't see other files, so give it the
    // corpus-level set of all C# INTERFACE names (regex pass over the corpus
    // text — cheap, no second parse) so `class X : ICommandRuntime2` and
    // `interface Y : IWSManConnectionOptions` resolve deterministically to
    // implements / extends the same way the analyzer does.
    const CSHARP_INTERFACES = new Set<string>()
    if (lang === "csharp") {
      const re = /\binterface\s+([A-Za-z_][A-Za-z0-9_]*)/g
      for (const f of files) {
        let s: string
        try { s = fs.readFileSync(f, "utf8") } catch { continue }
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(s))) if (m[1]) CSHARP_INTERFACES.add(m[1])
      }
      // Same corpus knowledge handed to the ANALYZER as its cross-file
      // `context.typeKinds` companion (values = SymbolKind.Interface string).
      // Now `class X : IArgumentCompleter` resolves to implements on BOTH
      // sides — the analyzer with a real companion and the oracle with the
      // same set — instead of the analyzer falling back to deterministic
      // extends (which the oracle would then contradict).
    }
    const CSHARP_INTERFACE_KINDS = new Map<string, string>()
    if (lang === "csharp") for (const nm of CSHARP_INTERFACES) CSHARP_INTERFACE_KINDS.set(nm, "interface")

    // Swift: same cross-file companion for protocol adoption. A class's first
    // base is extends ONLY if it is a class — a first-base protocol is still
    // implements (SWIFTD1 resolution). The corpus protocol-name set (regex
    // pass, cheap) is handed to BOTH the analyzer (context.typeKinds) and the
    // oracle so `class X: SomeProtocol` resolves to implements identically.
    const SWIFT_PROTOCOLS = new Set<string>()
    const SWIFT_TYPE_KINDS = new Map<string, string>()
    if (lang === "swift") {
      const re = /\bprotocol\s+([A-Za-z_][A-Za-z0-9_]*)/g
      for (const f of files) {
        let s: string
        try { s = fs.readFileSync(f, "utf8") } catch { continue }
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(s))) if (m[1]) SWIFT_PROTOCOLS.add(m[1])
      }
      for (const nm of SWIFT_PROTOCOLS) SWIFT_TYPE_KINDS.set(nm, "interface")
    }

    // M49 #760: cold-pool rotation — prefer never-sampled files each wave.
    // Falls back to warm files only when the fresh pool is exhausted.
    const pool = coldPoolPick(files, SAMPLE_PER_LANG, `${langRepo}:${lang}`,
      // Corpus-relative, so a frozen-worktree measurement and an in-place one
      // describe the same file (see coldPoolPick).
      (f: string) => path.relative(repoDir, f))
    const sample = pool.picked
    console.log(`  [cold-pool] ${langRepo}:${lang}: ${pool.coldCount}/${sample.length} fresh (rot ${pool.rotation}, corpus ${pool.total})`)
    // Which files were measured, on request. The row records filesSampled and
    // the drawn set's HASH, which answers "same sample?" but never "which
    // files?" — and for a corpus too large for one process (dart/proxicall:
    // 2211 files, measured in chunks because the wasm heap dies mid-sweep and
    // the parsed-but-empty guard refuses the fabricated 0/0 row) the honest
    // question is exactly the union of the chunks. Printing the drawn paths
    // under a flag keeps the artifact unchanged while making that union
    // verifiable from the run log.
    if (process.env.BB_F5_SHOW_FILES) {
      for (const f of sample) console.log(`    [file] ${path.relative(laneRepoDir(langRepo), f)}`)
    }
    let treeEdgesTotal = 0, coveredByAnalyzer = 0, missingInAnalyzer = 0
    let analyzerEdgesTotal = 0, explainableByTree = 0, unexplainedInAnalyzer = 0
    let heuristicUnexplained = 0
    // Sharpness counters (BB_F5_STRICT only). strictMissing counts truth rows the
    // written-target rule cannot match; strictMasks counts the subset the
    // PUBLISHED rule passes anyway, both sides qualified and disagreeing — i.e.
    // rows the current rule hides rather than reports.
    let strictCovered = 0, strictMissing = 0, strictHidden = 0, strictHard = 0, strictSoft = 0
    const strictSamples: string[] = []
    const strictSoftSamples: string[] = []
    const samples: any[] = []
    const samplesHeuristic: any[] = []

    const durations: number[] = []
    // Perf under load: this gate is a CORRECTNESS gate with a perf budget on
    // top, but the box runs several agent sessions in parallel (measured: load
    // avg 10-12 on 8 cores, kswapd0 active) and one-off scheduler stalls
    // inflated kotlin 25.5ms -> 96ms (3.5x) while other languages ran FASTER
    // than baseline (svelte 0.35x) — impossible for a real regression, classic
    // noise. When the 1-minute load average exceeds 4, the timed loop is run a
    // second time and the per-file average takes the MINIMUM of the two runs:
    // min over runs converges on true steady-state cost under any load
    // profile. Correctness counts are computed once and never re-derived.
    let retryDurations: number[][] | null = null
    if (loadAvg1() > 4) {
      // Up to 3 spaced attempts; per-file average takes the MINIMUM across
      // the primary run and every attempt. min-over-runs converges on the
      // true steady-state cost; a budget breach surviving 3 min-taken runs
      // under load is treated as a REAL regression.
      retryDurations = []
      for (let attempt = 0; attempt < 3; attempt++) {
        const durs: number[] = []
        for (const f of sample) {
          const content = fs.readFileSync(f, "utf8")
          let r0
          try { r0 = parser.parse(content).rootNode } catch { continue }
          if (!r0) continue
          const t0 = performance.now()
          try {
            if (lang === "vue" || lang === "svelte") {
              const eng = await import("../../src/ast/engine")
              await (eng as any).ASTEngine.parseFile(f, content)
            } else {
              await analyzer.analyze(r0, content, path.relative(repoDir, f))
            }
          } catch { continue }
          durs.push(performance.now() - t0)
        }
        if (durs.length) retryDurations.push(durs)
        if (loadAvg1() <= 4) break
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
    // Warm-up: the first parse of a language in this process pays one-time
    // wasm compilation (measured: ~15s for tree-sitter core + grammar init,
    // which poisoned a 52-file average as +280ms/file and tripped the F9
    // budget spuriously). The perf budget measures steady-state per-file
    // analysis cost, so one untimed warm-up parse precedes the timed loop.
    try {
      parser.parse("class WarmUp { void m() {} }")
    } catch {
      /* warm-up is best-effort; timing proceeds regardless */
    }
    for (const f of sample) {
      const content = fs.readFileSync(f, "utf8")
      const relPath = path.relative(repoDir, f)
      let root
      let result
      const tf0 = performance.now()
      try { root = parser.parse(content).rootNode } catch { continue }
      if (!root) continue
      try {
        if (lang === "vue" || lang === "svelte") {
          // SFC parity: script blocks must be pre-parsed by the engine or
          // the script-side edges never appear.
          const eng = await import("../../src/ast/engine")
          result = await (eng as any).ASTEngine.parseFile(f, content)
        } else {
          result = await analyzer.analyze(root, content, relPath, lang === "csharp" ? { typeKinds: CSHARP_INTERFACE_KINDS as Map<string, string> } : lang === "swift" ? { typeKinds: SWIFT_TYPE_KINDS as Map<string, string> } : undefined)
        }
      } catch { continue }
      durations.push(performance.now() - tf0)

      const truth = deriveTreeEdges(root, lang)
      if (lang === "vue") {
        // template component-usage oracle: independent HTML-core filter
        for (const e of deriveVueComponentUsages(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "typescript") {
        // M37.21 #611: dedicated typescript calls/instantiates oracle (web
        // family precedent — the generic tree walker never audited the call
        // surface; truth was 25 edges per 60 files vs java's 739).
        for (const e of deriveTypeScriptEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "javascript") {
        // M37.21 #611: wire the dedicated JS calls oracle into the plain
        // javascript lane's truth. The analyzer-side filter already compares
        // calls for javascript, but without this push the truth side emitted
        // ZERO calls — every real analyzer call surfaced as unexplained
        // (vue-core:javascript 294 in the first gated run; per-file parity
        // was already proven on scripts/verify-commit.js).
        for (const e of deriveJavaScriptEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "vue" || lang === "svelte") {
        // M37.21 #611: web-embedded-script CALLS truth (the JD-oracle gap).
        // The analyzers emit script-side calls (vue merges the JS/TS
        // sub-analyzer's relationships; svelte ditto + template handlers);
        // the truth previously carried only structural edges. The embedded
        // tree's calls derive with the SAME leaf-target contract (site-
        // agnostic label+target matching). lang=ts blocks run the TS oracle.
        const subTrees = await deriveEmbeddedScriptTrees(root, content, lang)
        // Vue's merge pass filters compiler macros (VUE_COMPILER_MACROS:
        // defineProps/defineEmits/withDefaults/...) from sub-analyzer
        // relationships — they are LANGUAGE keywords, not call edges. The
        // oracle mirrors that filter or every macro call is a fake MISSING
        // (30/60 element-plus files). Svelte's rune filter is separate and
        // handled inside the analyzer contract (SVELTE_RUNES — the JS oracle
        // never emits $-prefixed targets, so no mirror needed there).
        const MACROS = new Set(["defineProps", "defineEmits", "defineExpose", "withDefaults", "defineModel", "defineSlots", "defineOptions"])
        // Svelte rune mirror (SVELTE_RUNES + RUNE_LEAF_SEGMENTS contract):
        // the analyzer gates on isRuneCallee(FULL callee text) — `$derived.by`
        // and `$effect.pre` are member calls whose LEAF lands in the oracle's
        // target, so a target-side `$`-prefix check never fires (4 fake
        // MISSING in the svelte repo: by/pre). The TS oracle carries
        // fullCallee; the mirror re-derives the exact isRuneCallee ruling.
        const SVELTE_RUNES = new Set(["$state", "$state.raw", "$state.snapshot", "$derived", "$derived.by", "$effect", "$effect.pre", "$effect.tracking", "$effect.root", "$effect.untracked", "$props", "$props.id", "$props.is_safe", "$bindable", "$host", "$inspect", "$inspect.trace", "$render"])
        const RUNE_LEAFS = new Set(["state", "raw", "snapshot", "derived", "by", "effect", "pre", "tracking", "root", "untracked", "props", "id", "is_safe", "bindable", "host", "inspect", "trace", "render"])
        const isRuneCalleeMirror = (callee: string): boolean => {
          if (!callee.startsWith("$")) return false
          if (SVELTE_RUNES.has(callee)) return true
          return RUNE_LEAFS.has(callee.split(".").pop() ?? "")
        }
        for (const st of subTrees) {
          for (const e of deriveTypeScriptEdges(st)) {
            if (lang === "vue" && e.label === "calls" && MACROS.has(e.target)) continue
            if (lang === "svelte" && e.label === "calls" && isRuneCalleeMirror(e.fullCallee ?? e.target)) continue
            ;(truth as any[]).push(e)
          }
        }
        // M37.21 #611 svelte TEMPLATE call truth — the analyzer's template
        // pass emits calls the embedded-script trees cannot express:
        //   on:click={inc} / on:click={() => bump()} → handler (0.85)
        //   onclick={save} on intrinsic tags          → handler (0.85, Svelte 5)
        //   {@attach handler} / {@attach handler(args)} → handler (0.8)
        //   {@render children(...)}                    → snippet name (0.9)
        // The svelte grammar exposes attribute values as opaque
        // svelte_raw_text leaves, so all of these are scanned with the
        // analyzer's pure-String contract, mirrored verbatim here.
        if (lang === "svelte") {
          const isIdent = (s: string): boolean => {
            if (!s) return false
            const ok = (c: string, first: boolean) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$" || (!first && c >= "0" && c <= "9")
            for (let i = 0; i < s.length; i++) if (!ok(s[i], i === 0)) return false
            return true
          }
          const rawText = (attr: any): string => {
            const value = attr.namedChildren?.find((c: any) => c.type === "expression")
            if (!value) return ""
            const st2: any[] = [value]
            while (st2.length > 0) {
              const m = st2.pop()!
              if (m.type === "svelte_raw_text") return m.text
              for (let i = (m.namedChildCount ?? 0) - 1; i >= 0; i--) { const c = m.namedChild(i); if (c) st2.push(c) }
            }
            return ""
          }
          // #898 closure: the handler derivation IS the analyzer's
          // onHandlerCall contract (src/ast/real-svelte-analyzer.ts), mirrored
          // rule for rule — the previous leaf-only scan derived member-call
          // property names the analyzer stopped emitting (the #898 fabrication
          // class: `rest?.onclick()` → onclick) and missed the dotted-leaf
          // method-reference form it emits. 1: free identifier followed by
          // `(`; 2: bare identifier; 3: dotted member leaf. Else: nothing.
          const handlerCall = (text: string): string | undefined => {
            for (let i = 0; i < text.length; i++) {
              const ch = text[i]
              if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$") {
                let end = i
                while (end < text.length) {
                  const c = text[end]
                  if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "$") end++
                  else break
                }
                const ident = text.slice(i, end)
                if (end < text.length && text[end] === "(") {
                  let back = i - 1
                  while (back >= 0 && (text[back] === " " || text[back] === "\t" || text[back] === "\n")) back--
                  if (back < 0 || text[back] !== ".") return ident
                }
                i = end
              }
            }
            if (isIdent(text)) return text
            const parts = text.split(".")
            if (parts.length > 1 && parts.every((p) => isIdent(p))) return parts[parts.length - 1]
            return undefined
          }
          const moduleName = path.basename(relPath, path.extname(relPath))
          const seenRender = new Set<string>()
          const twalk = (n: any): void => {
            const t = n.type
            if (t !== "script_element" && t !== "style_element") {
              if (t === "element" || t === "self_closing_tag") {
                const startTag = n.namedChildren?.find((c: any) => c.type === "start_tag") ?? (t === "self_closing_tag" ? n : undefined)
                if (startTag) {
                  const tagName = startTag.namedChildren?.find((c: any) => c.type === "tag_name")?.text ?? ""
                  for (const attr of startTag.namedChildren ?? []) {
                    if (attr.type !== "attribute") continue
                    const nameNode = attr.namedChildren?.find((c: any) => c.type === "attribute_name")
                    const attrName = nameNode?.text ?? ""
                    // #898 closure: both event spellings, the analyzer's gates
                    // character for character. on: directives are universal;
                    // Svelte-5 on* attributes only on intrinsic tags — on a
                    // component, onclick is a prop and deriving it would
                    // fabricate. Short words (`once`, len 4) are never events.
                    const isOnDirective = attrName.startsWith("on:")
                    const isOnclickAttr =
                      !isOnDirective &&
                      /^on[a-z]+$/.test(attrName) &&
                      attrName.length > 4 &&
                      tagName.length > 0 &&
                      tagName[0] === tagName[0].toLowerCase() &&
                      !tagName.includes(".") &&
                      (!tagName.includes(":") || tagName.startsWith("svelte:"))
                    if (!isOnDirective && !isOnclickAttr) continue
                    const handler = handlerCall(rawText(attr))
                    if (handler && handler !== moduleName && !seenRender.has("h|" + handler)) {
                      seenRender.add("h|" + handler)
                      ;(truth as any[]).push({ label: "calls", from: "(template)", target: handler })
                    }
                  }
                  // #898 closure: {@attach handler} / {@attach handler(args)} —
                  // the pinned grammar has no rule for the directive; it parses
                  // as a stable ERROR shape (`{`, `@`, ERROR[attach], handler
                  // expression, `}`), measured in
                  // script/m14/tmp/web-adv-attach-tree.ts. The analyzer lane
                  // reads that shape structurally, so the oracle mirrors the
                  // same gates — identifier and call forms only; arrow params,
                  // member chains etc. stay silent (no fabrication). Attach is
                  // a behavior hook on intrinsic AND component tags.
                  for (let ci = 0; ci < (startTag.childCount ?? 0); ci++) {
                    const directive = startTag.child(ci)
                    if (!directive || directive.type !== "ERROR") continue
                    const kids: any[] = []
                    for (let j = 0; j < directive.childCount; j++) { const c = directive.child(j); if (c) kids.push(c) }
                    const attachIdx = kids.findIndex((k: any) => k.type === "ERROR" && k.text === "attach")
                    if (attachIdx < 0) continue
                    const nameTok = kids[attachIdx + 1]
                    if (!nameTok || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(nameTok.text)) continue
                    const afterText = (kids[attachIdx + 2]?.text ?? "}").trim()
                    if (afterText !== "}" && afterText !== "(") continue
                    const attachHandler = nameTok.text
                    if (attachHandler === moduleName || seenRender.has("a|" + attachHandler)) continue
                    seenRender.add("a|" + attachHandler)
                    ;(truth as any[]).push({ label: "calls", from: "(template)", target: attachHandler })
                  }
                }
              }
              if (t === "render_tag") {
                const text = n.text.replace("{@render", "").trim()
                let end = 0
                while (end < text.length && isIdent(text.slice(0, end + 1))) end++
                let target = text.slice(0, end)
                // Sv2 #736-D4 mirror: dotted render targets resolve to the
                // callable LEAF (`{@render ns.row(it)}` -> row), same as the
                // on: dotted-leaf rule. All-identifier segments only;
                // otherwise the leading-identifier fallback stands
                // (`children?.()` -> children).
                const afterLead = text.slice(end).trimStart()
                if (target && (afterLead.startsWith(".") || afterLead.startsWith("?."))) {
                  let body = text.trim()
                  if (body.endsWith("}")) body = body.slice(0, -1)
                  const paren = body.indexOf("(")
                  if (paren >= 0) body = body.slice(0, paren)
                  const parts = body.split(".").map((p) => {
                    let q = p.trim()
                    if (q.endsWith("?")) q = q.slice(0, -1).trim()
                    return q
                  })
                  if (parts.length >= 2 && parts.every((p) => isIdent(p))) target = parts[parts.length - 1]
                }
                if (target && !seenRender.has("r|" + target)) {
                  seenRender.add("r|" + target)
                  ;(truth as any[]).push({ label: "calls", from: "(template)", target })
                }
              }
            }
            for (let k = 0; k < (n.namedChildCount ?? 0); k++) { const c = n.namedChild(k); if (c) twalk(c) }
          }
          twalk(root)
        }
      }
      if (lang === "java") {
        // M37.21 #610: dedicated java calls oracle (first JVM language with
        // one — the generic walker never audited the call surface).
        for (const e of deriveJavaEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "kotlin") {
        // M37.21 #610: kotlin calls oracle (JD-oracle gap, java precedent).
        for (const e of deriveKotlinEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "scala") {
        // M37.21 #610: scala calls oracle (JD-oracle gap, java precedent).
        for (const e of deriveScalaEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "groovy") {
        // M37.21 #610: groovy calls oracle (JD-oracle gap, java precedent).
        // M49 W22: carries the source text — the typed-closure-parameter
        // discriminator measures the text after the juxt node (the analyzer's
        // same source rule; tree compositions are the fallback).
        for (const e of deriveGroovyEdges(root, content)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "c") {
        // CGD40: the line-anchor gate needs the raw text (directive lines
        // spliced into code by parse recovery are physically '#' lines).
        for (const e of deriveCCalls(root, content)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "cpp") {
        // M37.9: dedicated cpp oracle — calls + member-read uses truth so the
        // fmt differential audits the analyzer's real surface (previously
        // neither label was compared for cpp).
        for (const e of deriveCppEdges(root)) {
          ;(truth as any[]).push(e)
        }
        // CP1 (cpp review): bare value-read uses truth — mirrors the
        // analyzer's identifier-read contract rule for rule (declaration
        // positions, callees, member leaves, qualified limitation,
        // preprocessor text, labels, attributes, capture bindings, LHS
        // writes, shadowing, resolvability).
        for (const e of deriveCppBareUses(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "rust") {
        for (const e of deriveRustEdges(root)) {
          ;(truth as any[]).push(e)
        }
        // R1 (rust review #798): bare value-read + field-read `uses` truth —
        // mirrors the analyzer's read contract rule for rule (item-name
        // positions, callees incl. turbofish climb, member leaves, qualified
        // non-leaves, LHS writes, macro-rule bodies vs invocation args,
        // attributes, use paths, where-bounds, shadowing, resolvability).
        for (const e of deriveRustBareUses(root)) {
          ;(truth as any[]).push(e)
        }
        // R13: declared-type `references` truth — the fn-param/return,
        // field-type, alias and const/static type surface.
        for (const e of deriveRustDeclaredTypeRefs(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "go") {
        for (const e of deriveGoEdges(root)) {
          ;(truth as any[]).push(e)
        }
        for (const e of deriveGoImplements(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "nim") {
        // NIM truth is a SEPARATE module (script/m14/nim-truth-oracle.ts), not a
        // block inside this file: it is an independent derivation written against
        // the grammar, and a 13k-line file hides that. The analyzer's own symbol
        // list is passed in as the shared name inventory (the same precedent the
        // zig bare-uses oracle follows: the OWNER/contains assignment is not what
        // the differential is auditing, so it is shared ground truth, not a
        // re-derivation that could only add a second place to be wrong).
        for (const e of deriveNimEdges(root, result?.symbols ?? [])) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "zig") {
        for (const e of deriveZigEdges(root)) {
          ;(truth as any[]).push(e)
        }
        // Z3 (zig review): bare value-read uses truth — mirrors the
        // analyzer's identifier-read contract rule for rule (declaration
        // positions, callees, member leaves, qualified non-leaves, labels,
        // blank, preprocessor-free, LHS writes, shadowing, resolvability
        // incl. the error-type leaf rule). Name inventory comes from the
        // analyzer's own symbols (shared ground truth, not re-derived).
        for (const e of deriveZigBareUses(root, result?.symbols ?? [])) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "csharp") {
        for (const e of deriveCSharpEdges(root, CSHARP_INTERFACES)) {
          // C923 (#923): the truth now DERIVES the member-level interface contract, but
          // `overrides` is excluded from csharp's comparison on the ANALYZER side too (the
          // harness allowlist below), so pushing it here would read every one of those TRUE
          // edges as MISSING — the mirror image of the #910/fabricated-MISSING class this file
          // already documents twice. The exclusion is applied on BOTH sides, one place each, and
          // the class's independent evidence is script/m60/verify-c923-interface-members.ts
          // (tree-derivation vs oracle vs lane, both corpora in full extent) plus its fixture and
          // its two mutants. A round that starts comparing `overrides` for csharp must remove
          // this line and the analyzer-side entry TOGETHER, or the pair desyncs silently.
          if (e.label === "overrides") continue
          ;(truth as any[]).push(e)
        }
        // R9 (#804): declared-type references — the analyzer emits them, so the
        // truth must derive them from the same rule or every depth draw reads the
        // new edges as analyzer-only (the dart #752 / swift #754 precedent).
        for (const e of deriveCSharpDeclaredTypeEdges(root)) {
          ;(truth as any[]).push(e)
        }
        // The lane's OTHER `references` class — using directives — is truth too, now
        // that the label is compared (the harness allowlist): without it every using
        // reference would be reported as fabrication.
        for (const e of deriveCSharpUsingReferences(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "dart") {
        for (const e of deriveDartEdges(root)) {
          ;(truth as any[]).push(e)
        }
        // #752: bare member-read uses — mirrors the analyzer's identifier-read
        // contract rule for rule (declared-member resolution from the shared
        // symbol inventory, CGD15 local shadowing, declaration/selector/callee/
        // write gates). Without this the new edges read as analyzer-only.
        for (const e of deriveDartBareUses(root, result?.symbols ?? [])) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "swift") {
        for (const e of deriveSwiftEdges(root, SWIFT_PROTOCOLS)) {
          ;(truth as any[]).push(e)
        }
        // #754: bare member-read uses — without this the new edges read as
        // analyzer-only (the #752 dart precedent).
        for (const e of deriveSwiftBareUses(root, result?.symbols ?? [])) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "objc") {
        for (const e of deriveObjcEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "php") {
        for (const e of derivePhpEdges(root)) {
          ;(truth as any[]).push(e)
        }
        // R9 (#835): declared-type references — the analyzer emits them, so the truth
        // must derive them from the same rule or every depth draw reads the new edges
        // as analyzer-only.
        for (const e of derivePhpDeclaredTypeEdges(root, result?.symbols ?? [])) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "ruby") {
        for (const e of deriveRubyEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "python") {
        for (const e of derivePythonEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "haskell") {
        for (const e of deriveHaskellEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "elixir") {
        // #274 F5: dedicated elixir calls/instantiates/implements/references
        // oracle (the generic tree walker audits no elixir surface — Elixir
        // has no class/interface heritage declarations).
        for (const e of deriveElixirEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "erlang") {
        // ER wave (M14 #275 F5): dedicated erlang
        // calls/implements/instantiates oracle mirroring
        // real-erlang-analyzer.ts — local calls gated on the file's declared
        // functions, remote targets keep module qualification (ER-D1),
        // record construction outside clause heads instantiates.
        for (const e of deriveErlangEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "perl") {
        // M14.6 perl: dedicated perl calls/instantiates/extends/implements/
        // contains/overrides oracle (derivePerlEdges) — the generic tree walker
        // audits NO perl surface, because this grammar's declarations are
        // `package_statement`/`class_statement`/`role_statement` and none of
        // them match the harness's class/interface/trait regexes.
        for (const e of derivePerlEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "clojure") {
        // F5-cert wave (CLJ): dedicated clojure
        // calls/references/implements/instantiates oracle written from the
        // pinned grammar's tree shapes and the RULED CLJ1 contract
        // (script/m14/spec/clojure-completeness.json CLJ-D1..D7) — quote-as-
        // data, builtin exclusion, libspec-child guard, method-impl
        // definitions, top-level attribution, tagged/ctor literals.
        for (const e of deriveClojureEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "clean") {
        // F5 wave (CLEAN): dedicated clean
        // calls/instantiates/implements/references oracle. Before it existed
        // the lane derived ZERO truth edges and the sweep refused the row
        // (a 0/0 pass is a fabrication), so Clean held no differential at all.
        for (const e of deriveCleanEdges(root)) {
          ;(truth as any[]).push(e)
        }
      }
      if (lang === "svelte") {
        // Script-side truth: the svelte grammar stores script bodies as
        // opaque raw_text - re-parse them and derive the SAME structural
        // edges (extends/implements/instantiates) the non-SFC languages get.
        // (Computed FIRST because the dynamic-component mirror below needs the
        // script's import bindings and member names; the edge objects are
        // pushed once, unchanged.)
        const subTrees = await deriveEmbeddedScriptTrees(root, content, "svelte")
        const scriptEdges: any[] = []
        for (const st of subTrees) {
          for (const e of deriveTreeEdges(st, "javascript")) scriptEdges.push(e)
        }
        // M49 W13: the analyzer's H2 rule emits `instantiates X` for a
        // `<svelte:component this={X}/>` target when X is an import-bound bare
        // identifier; the oracle skipped the tag and the edge surfaced
        // unexplained (W12's last open web residual).
        //
        // MEASURED, not assumed: the embedded-script truth walk
        // (`deriveTreeEdges(st, "javascript")`) emits NOTHING for an import
        // statement (probed: `import Widget from './Widget.svelte'` -> 0
        // edges), so the bindings cannot be read off scriptEdges — they are
        // walked off the script tree directly, mirroring the analyzer's
        // `imports[].items` (default clause, namespace_import, and the LOCAL
        // side of `{ a as b }`).
        const importBindings = new Set<string>()
        const collectImportBindings = (n: any): void => {
          if (n.type === "import_statement") {
            const clause = n.namedChildren.find((c: any) => c.type === "import_clause")
            if (clause) {
              for (let i = 0; i < clause.namedChildCount; i++) {
                const c = clause.namedChild(i)
                if (c.type === "identifier") importBindings.add(c.text)
                else if (c.type === "namespace_import") {
                  const id = c.namedChildren.find((x: any) => x.type === "identifier")
                  if (id) importBindings.add(id.text)
                } else if (c.type === "named_imports") {
                  for (let j = 0; j < c.namedChildCount; j++) {
                    const s = c.namedChild(j)
                    if (s.type !== "import_specifier") continue
                    const ids = s.namedChildren.filter((x: any) => x.type === "identifier")
                    const local = ids[ids.length - 1]
                    if (local) importBindings.add(local.text)
                  }
                }
              }
            }
          }
          for (let i = 0; i < n.namedChildCount; i++) collectImportBindings(n.namedChild(i))
        }
        for (const st of subTrees) collectImportBindings(st)
        for (const e of deriveSvelteComponentUsages(root, importBindings)) {
          ;(truth as any[]).push(e)
        }
        // Snippet render-call truth ({@render X()} where X is a declared
        // {#snippet X}) — see deriveSvelteSnippetCalls.
        for (const e of deriveSvelteSnippetCalls(root)) {
          ;(truth as any[]).push(e)
        }
        for (const e of scriptEdges) (truth as any[]).push(e)
      }
      if (lang === "vue") {
        const subTrees = await deriveEmbeddedScriptTrees(root, content, "vue")
        for (const st of subTrees) {
          for (const e of deriveTreeEdges(st, "typescript")) (truth as any[]).push(e)
        }
      }
      if (lang === "typescript" && process.argv.includes("--debug-truth")) {
        console.log(`[debug] ${relPath}: truth=${truth.length} declRoot=${root.type}`)
      }
      const rels = (result.relationships ?? []).map((r: any) => ({
        label: String(r.type ?? r.relationshipType ?? ""),
        target: String(r.target ?? r.to ?? r.toSymbol ?? ""),
        // CLJ1/F5-certification wave: carry the SOURCE so diff samples can
        // name the analyzer edge (previously dropped — an UNEXPLAINED sample
        // printed a target with no caller, and triage had to re-derive).
        from: String(r.source ?? r.from ?? r.fromSymbol ?? ""),
        line: r.line_number ?? 0,
        confidence: typeof r.confidence === "number" ? r.confidence : 1,
      // c, rust and go compare CALL edges too (their independently derivable
      // truth); zig derives calls AND uses; other languages do not derive
      // call truth, so including calls there would flag every real call edge
      // as unexplained. CGD (M37 #601): c's oracle now derives member/bare
      // USES truth as well (write-gated), so c joins the uses-audited set.
      //
      // M60/#910: c joins the IMPORTS-audited set. Its include edges are the
      // first-class `imports` kind now, and without the allowance below the
      // allowlist silently dropped them from the ANALYZER side — measured 129
      // MISSING on a 40-file sqlite draw (3462 truth edges, 96.3% coverage)
      // the moment the oracle started emitting the new label, i.e. the change
      // would have read as an analyzer regression when it was a harness gap.
      //
      // M49.G7: groovy joins it too, and the round is why. Groovy had NO read
      // oracle, so `uses` was excluded from its comparison by construction (the
      // W20 note recorded that as a declared limitation: a restored read rode
      // the fixture and its mutant but no corpus lane). G7 then added
      // interpolation truths, which ARE `uses`, into a lane that could not
      // match them — so every interpolated name surfaced as a permanent false
      // MISSING (measured: 8 on the grails-core groovy lane, across 4 named
      // files, every target one the analyzer DOES emit). The fix is the full
      // mirror, not the silence: the oracle now derives all four groovy `uses`
      // sources (field_access, paren-less leading_dot_call, array_access,
      // interpolation), so the label is comparable and the lane audits groovy
      // reads for the first time.
      }))      .filter((r: any) => ["extends", "implements", "instantiates", ...(lang !== "csharp" && lang !== "dart" && lang !== "swift" && lang !== "cpp" ? ["overrides"] : []), ...(lang === "c" || lang === "cpp" || lang === "rust" || lang === "go" || lang === "dart" || lang === "objc" || lang === "php" || lang === "ruby" || lang === "python" || lang === "haskell" || lang === "elixir" || lang === "erlang" || lang === "java" || lang === "kotlin" || lang === "scala" || lang === "groovy" || lang === "typescript" || lang === "vue" || lang === "svelte" || lang === "javascript" || lang === "clojure" || lang === "clean" || lang === "perl" ? ["calls"] : []), ...(lang === "perl" || lang === "xml" ? ["contains"] : []),   // XML joins the CONTAINS-audited set, and ONLY contains. Its oracle
        // derives containment and the DTD declaration classes and nothing else, so
        // auditing `imports`/`references`/`calls` here would score every such edge
        // UNEXPLAINED against an oracle that never derives them — a false alarm by
        // construction, which is worse than not auditing. Widening the audited set
        // is owed to the same derivation work that would justify it. This is also
        // why the lane first reported `analyzer-edges=0` on 504 real tree-truth
        // edges: every emitted edge was filtered out by an allowlist xml was not
        // in, which reads exactly like an analyzer that emits nothing.
          // NIM wave (2026-09-27): the nim oracle derives calls, uses, contains AND the
          // declared-type `references` graph, so all four labels are comparable. It is
          // the FIRST lane to join `contains` alongside perl, because the analyzer's
          // owner->member edges are structural facts the oracle re-derives from the
          // SAME owner names the analyzer published (shared ground truth, not a
          // second derivation of ownership).
          ...(lang === "nim" ? ["calls", "uses", "contains", "references", "imports"] : []),
          // M60 VB wave (2026-09-27): the vb oracle derives `calls`, `contains`,
          // `imports`, `extends` and `implements`, so all five are comparable.
          // This matters and the reason is the #910 lesson recorded above: a
          // truth edge whose label is dropped from the ANALYZER side cannot be
          // covered, so it is counted MISSING and the lane reads as broken when
          // nothing is. Measured before this line: MISSING=631 of 680 truth
          // edges with `unexplained=0` -- i.e. the analyzer published nothing the
          // oracle could not derive, and the row was failing purely because the
          // harness was comparing labels it had agreed not to compare.
          // `references` is deliberately NOT here. The oracle does not derive it,
          // and the #910 lesson is exactly that comparing a label the truth side
          // does not derive counts every analyzer edge of that label as
          // fabrication. Measured: with `references` allowlisted, unexplained was
          // 271 of 886 analyzer edges, and `references` is the analyzer's single
          // largest class (13,832 of 33,910 edges over 435 files). Auditing a
          // class with no independent derivation of it would be a manufactured
          // red, which is the failure mode the gate exists to prevent.
          ...(lang === "vb" ? ["calls", "contains", "imports"] : []),          // Rust joins the uses-audited set (#798 R1): its read oracle now
          // exists, so the label is comparable and the corpus audits rust
          // reads for the first time. Before this, the allowlist dropped the
          // whole class from the ANALYZER side — the same harness gap the
          // #910 (c imports) and G7 (groovy uses) notes below record.
          ...(lang === "zig" || lang === "swift" || lang === "objc" || lang === "php" || lang === "python" || lang === "c" || lang === "cpp" || lang === "rust" ? ["calls", "uses"] : []),
          // hcl joins the USES-audited set only, and `calls` is excluded on
          // measurement rather than assumption. HCL declares no function, class or
          // type of any kind — 0 of its 64 named node types — and across 12,977
          // `function_call` nodes in 9,079 files NOT ONE callee resolves to a
          // symbol the project declares. The 5 distinct apparent matches are
          // provable name collisions: four are Terraform globals (`length`,
          // `file`, `timestamp`, `lower`) and the fifth (`object`) is a TYPE
          // KEYWORD in `type = object({…})` sitting beside a declared
          // `output "object"`. So every `calls` edge would dangle, which is the
          // shape the house precedent suppresses (java and groovy carry explicit
          // builtin filters for println/printf). Adjudication:
          // fixtures/hcl/out/calls-feasibility.json.
          ...(lang === "hcl" ? ["uses"] : []), ...(lang === "c" ? ["references", "imports"] : []), ...(lang === "rust" || lang === "hcl" ? ["references"] : []), ...(lang === "dart" || lang === "ruby" || lang === "javascript" || lang === "groovy" ? ["uses"] : []),        // R9 (#804): csharp joins the REFERENCES-audited set. Its `references` class
        // (using directives, and now the declared-type graph) had truth that the
        // allowlist dropped from the ANALYZER side, so the new truth read as MISSING —
        // the mirror image of the #910 gap recorded below, and the same root cause.
        ...(lang === "csharp" ? ["calls", "references"] : []), ...(lang === "swift" || lang === "objc" || lang === "php" || lang === "python" || lang === "elixir" || lang === "clojure" || lang === "clean" ? ["references"] : [])].includes(r.label))
        // The tree-truth oracles already emit UNIQUE (label,target) edges per
        // file (each oracle keeps a `seen` set keyed by label+target). The
        // analyzer, by contrast, emits one edge per source SEARCH HIT, so a
        // target constructed/called N times yields N duplicate (label,target)
        // edges. Because the coverage match below is deliberately site-agnostic
        // (it compares label+target only, never the source line), those
        // duplicates were being double-counted as fabrication. Collapsing them
        // to one edge per (label,target) aligns the analyzer side with the
        // truth-side semantics. This never removes a match a truth edge relied
        // on (the kept occurrence still matches), so it is safe for every
        // already-gated language -- it can only remove duplicate fabrication.
        .filter((r: any, i: number, arr: any[]) => { const k = r.label + "|" + r.target; return i === arr.findIndex((x: any) => (x.label + "|" + x.target) === k) })

      treeEdgesTotal += truth.length
      analyzerEdgesTotal += rels.length

      for (const te of truth) {
        const hit = rels.some((r: any) => r.label === te.label && normTarget(r.target) === normTarget(te.target))
        if (hit) coveredByAnalyzer++
        else { missingInAnalyzer++; if (samples.length < 300) samples.push({ dir: "MISSING", file: relPath, ...te }) }
      }
      for (const r of rels) {
        const hit = truth.some(te => te.label === r.label && (normTarget(te.target) === normTarget(r.target) || te.target.includes(normTarget(r.target))))
        if (hit) { explainableByTree++; continue }
        // Evidence-tier split for unmatched analyzer edges: a low-confidence
        // edge is DECLARED HEURISTIC (honest suspicion), not fabrication.
        // Only confident unmatched edges count as fabrications.
        const conf = typeof r.confidence === "number" ? r.confidence : 1
        if (conf < 0.7) {
          heuristicUnexplained++
          if (samples.length < 300 && samplesHeuristic.length < 100) samplesHeuristic.push({ dir: "HEURISTIC", file: relPath, ...r })
        } else {
          unexplainedInAnalyzer++
          if (samples.length < 300) samples.push({ dir: "UNEXPLAINED", file: relPath, ...r })
        }
      }
      // Sharpness pass (BB_F5_STRICT only): re-match this file's truth rows on the
      // target AS WRITTEN, and count the ones the published rule PASSES anyway —
      // those are the rows it hides. Inside the per-file loop by necessity: both
      // `truth` and `rels` are scoped to it.
      if (BB_F5_STRICT) {
        const strictSet = new Set(rels.map((r: any) => strictKey(r.label, r.target)))
        for (const te of truth) {
          if (strictSet.has(strictKey(te.label, te.target))) { strictCovered++; continue }
          strictMissing++
          // `sameLeaf` is the PUBLISHED rule's own predicate, so a strict miss
          // that has one is a row the rule PASSES: it printed `MISSING=0` over a
          // target that is not the one the analyzer published.
          const sameLeaf = rels.filter((r: any) => r.label === te.label && normTarget(r.target) === normTarget(te.target))
          if (sameLeaf.length === 0) continue
          strictHidden++
          const tQual = qualifierOf(te.target) !== ""
          const qualified = sameLeaf.filter((r: any) => qualifierOf(r.target) !== "")
          if (tQual && qualified.length > 0) {
            // HARD: the rule matched a DIFFERENT qualified target. This is the
            // shape that hid the groovy anonymous-body rows (one call to
            // `lastSegment` discarded `anonymous_X` and `PropertyDecoder`
            // alike, and the first row that happened to share the leaf won).
            strictHard++
            if (strictSamples.length < 200) {
              strictSamples.push(
                `${relPath} :: ${te.label} truth=${te.from ?? "?"} -> ${te.target}   vs analyzer -> ${qualified.map((r: any) => r.target).join(" / ")}`,
              )
            }
          } else {
            // SOFT: one side is spelled qualified and the other bare, so the leaf
            // match crossed a spelling asymmetry. Not automatically a defect —
            // it is a CONTRACT question (which side owes the qualifier) and is
            // counted separately so a lane with a bare-target convention is not
            // reported as if it hid rows.
            strictSoft++
            if (strictSoftSamples.length < 200) {
              strictSoftSamples.push(
                `${relPath} :: ${te.label} truth=${te.from ?? "?"} -> ${te.target}${tQual ? "" : " (truth bare)"}   vs analyzer -> ${sameLeaf.map((r: any) => r.target).join(" / ")}`,
              )
            }
          }
        }
      }
    }

    const row = {
      filesSampled: sample.length,
      treeTruthEdges: treeEdgesTotal,
      coveredByAnalyzer,
      missingInAnalyzer,
      analyzerEdges: analyzerEdgesTotal,
      explainableByTree,
      unexplainedInAnalyzer,
      heuristicUnexplained,
      coveragePct: treeEdgesTotal ? +(100 * coveredByAnalyzer / treeEdgesTotal).toFixed(1) : null,
      fabricationPct: analyzerEdgesTotal ? +(100 * unexplainedInAnalyzer / analyzerEdgesTotal).toFixed(1) : null,
      perf: {
        avgMsPerFile: durations.length
          ? +Math.min(
              durations.reduce((a, b) => a + b, 0) / durations.length,
              ...(retryDurations ?? []).map((d) => d.reduce((a, b) => a + b, 0) / d.length),
            ).toFixed(1)
          : null,
        maxMsPerFile: durations.length ? +Math.max(...durations).toFixed(1) : null,
        samplesTimed: durations.length,
        loadAvgRetried: retryDurations !== null,
        // #871: the load this measurement ran under. A perf budget cannot be
        // scored against a baseline that records none, so the evaluator
        // refuses instead of mislabelling a busy machine as a regression.
        loadAvg1: loadAvg1(),
      },
      // M49 G5: identity of the drawn file set, so the baseline gate can tell
      // "same sample, counts grew" (regression) from "different sample"
      // (resampled — triage). See sampleSetHash().
      sampleSetHash: sampleSetHash(sample.map((f: any) => path.relative(repoDir, f))),
      samples,
      // BB_F5_STRICT only, so a canonical run's artifact stays byte-identical to
      // what the gate compares.
      ...(BB_F5_STRICT ? { strict: { coveredAsWritten: strictCovered, strictMissing, hidden: strictHidden, hard: strictHard, soft: strictSoft } } : {}),
    }
    if (sample.length === 0) {
      // Vacuous-pass guard: a repo with zero files of this language produces a
      // 0/0 row that "passes" without verifying anything. That dishonesty
      // shipped before (php/ruby on grails-core logged files=0 as pass). The
      // language must be re-routed to a repo that contains it. Applies to BOTH
      // primary and second lanes (a second corpus with no files is a routing
      // error, never a silent skip).
      throw new Error(`differential: corpus repo ${langRepo} contains no ${lang} files — fix LANG_REPOS/SECOND_CORPUS routing for ${lang}`)
    }
    if (treeEdgesTotal === 0) {
      // Parsed-but-empty guard (F5 refresh, 2026-09-12). When the
      // web-tree-sitter heap dies mid-sweep it does not always throw: it
      // returns EMPTY trees, and the lane then reports
      // `files=60 tree-truth=0 covered=0 (null%) MISSING=0 unexplained=0` — a
      // row that passes while verifying nothing (observed on [ripgrep] rust
      // immediately before `Out of bounds call_indirect`). Worse, the
      // crash-resume journal PERSISTS that row as a finished lane, so the
      // fabrication survives the crash that caused it. A non-empty sample that
      // derives zero truth edges is a dead parser or a dead oracle, never a
      // clean lane: either re-route the lane or fix the oracle.
      throw new Error(`differential: ${langRepo}:${lang} parsed ${sample.length} file(s) and derived ZERO truth edges — the parser or the oracle is dead, not clean (a 0/0 row is a fabricated pass)`)
    }
    if (lane.isSecond) reportSecond[`${langRepo}:${lang}`] = row
    else report[lang] = row
    // `heuristic`/`hash` are printed because they are what the gate COMPARES:
    // the declared-heuristic count is one of the three counts a regression is
    // scored on (`evaluateDifferential`), and the drawn-set hash is what makes
    // two runs comparable at all. A lane line that omits them forces a
    // re-derivation to answer "did this grow?", which is how a rotated sample
    // gets misread as a code regression.
    console.log(`[${langRepo}] ${lang}: files=${sample.length} tree-truth=${treeEdgesTotal} covered=${coveredByAnalyzer} (${row.coveragePct}%) MISSING=${missingInAnalyzer} | analyzer-edges=${analyzerEdgesTotal} unexplained=${unexplainedInAnalyzer} (${row.fabricationPct}%) heuristic=${heuristicUnexplained} hash=${row.sampleSetHash}`)
    // CLJ1/F5-certification wave: the samples (dir/file/label/from/target)
    // were captured for exactly this purpose and then had no output path —
    // triage of a MISSING/UNEXPLAINED diff required re-deriving the lane by
    // hand. BB_F5_SHOW_SAMPLES=1 prints them for lane probes.
    if (BB_F5_STRICT) {
      console.log(
        `  [strict] ${lang}: truth=${treeEdgesTotal} covered-as-written=${strictCovered} strict-missing=${strictMissing}` +
          ` hidden=${strictHidden} hard=${strictHard} soft=${strictSoft}` +
          `  (published rule: covered=${coveredByAnalyzer} missing=${missingInAnalyzer})`,
      )
      const breaches = sharpnessInvariants({
        truth: treeEdgesTotal,
        covered: strictCovered,
        missing: strictMissing,
        hidden: strictHidden,
        hard: strictHard,
        publishedMissing: missingInAnalyzer,
      })
      for (const b of breaches) console.log(`    STRICT-INVARIANT BREACH ${lang}: ${b}`)
      if (breaches.length === 0 && strictHidden === 0) {
        console.log(`    [strict] ${lang}: identities hold, and the published rule hid nothing on this corpus`)
      }
      for (const s of strictSamples.slice(0, 25)) console.log(`    HARD ${s}`)
      if (strictSamples.length > 25) console.log(`    … +${strictSamples.length - 25} more HARD row(s)`)
      for (const s of strictSoftSamples.slice(0, 10)) console.log(`    SOFT ${s}`)
      if (strictSoftSamples.length > 10) console.log(`    … +${strictSoftSamples.length - 10} more SOFT row(s)`)
    }
    if (process.env.BB_F5_SHOW_SAMPLES && row.samples.length > 0) {
      for (const s of row.samples.slice(0, 40)) {
        console.log(`    ${s.dir} ${s.file} :: ${s.label} ${s.from ?? "?"} -> ${s.target}${s.line ? ` (line ${s.line})` : ""}`)
      }
      if (row.samples.length > 40) console.log(`    … +${row.samples.length - 40} more diff sample(s)`)
    }

    // M37.21 #610 operational lesson (web-tree-sitter WASM heap aborts kill
    // the sweep mid-run — twice during the JVM wave): persist each completed
    // lane immediately so a crash never loses finished lanes again. The
    // final emitEvidence still writes the complete artifact; this is a
    // crash-resume journal keyed by lane, re-read on startup.
    laneJournal[lane.isSecond ? `${langRepo}:${lang}` : lang] = { row, repo: langRepo, isSecond: !!lane.isSecond }
    // Release the lane's parser now that its row is durable (the grammar stays
    // cached for the language's second corpus).
    try { (parser as any).delete?.() } catch { /* already torn down by a parser abort */ }
    if (useJournal) saveJournal(laneJournal)
  }

  // A lane-batch child measures its slice and exits here: it must NOT evaluate
  // the baseline or emit evidence (the parent owns both, from the journal).
  if (CHILD_SLICE) {
    console.log(`[batch ${CHILD_SLICE.i}/${CHILD_SLICE.n}] slice done — journal holds ${Object.keys(laneJournal).length} lane(s) for state ${stateKey}`)
    process.exit(0)
  }

  // Evaluate against the pinned baseline BEFORE emitting F5 evidence. The
  // previous implementation emitted every check as `pass`, then performed
  // the comparison afterward, allowing stale evidence to claim green.
  const parsedBaseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : {}
  const baselineCounts = parsedBaseline.counts ?? parsedBaseline
  // Two-corpus gate: the current map carries the PRIMARY lane (repo:lang key,
  // derived from the lang-keyed report) AND every SECOND lane (repo:lang keys
  // from reportSecond). Baseline rows are repo:lang-keyed, so regressions on
  // either corpus compare 1:1 against their pinned row. The F5 evidence
  // keeps the per-language checks (differential-<lang>, consumed by the
  // completeness inventory) PLUS a per-language second-corpus check.
  const current: Record<string, any> = {}
  for (const [lang, r] of Object.entries<any>(report)) current[`${repoFor(lang)}:${lang}`] = {
    missing: r.missingInAnalyzer, unexplained: r.unexplainedInAnalyzer,
    heuristic: r.heuristicUnexplained,
    // #871 was half-wired: the lane row RECORDS `perf.loadAvg1`, and the scorer
    // REFUSES any baseline row without it — but this reducer rebuilt `perf` from
    // `avgMsPerFile` alone, so the context was measured and then thrown away one
    // line later. Every pinned row in the repo therefore lacked it and perf
    // scoring was inert for all 178 lanes: F could read a number and no breach
    // could ever be called. The whole perf context is carried now, so a pinned
    // row can be scored at all.
    perf: { ...r.perf },
    sampleHash: r.sampleSetHash,
  }
  const currentSecond: Record<string, any> = {}
  for (const [key, r] of Object.entries<any>(reportSecond)) currentSecond[key] = {
    missing: r.missingInAnalyzer, unexplained: r.unexplainedInAnalyzer,
    heuristic: r.heuristicUnexplained,
    perf: { ...r.perf },
    sampleHash: r.sampleSetHash,
  }
  const baselineHashes: Record<string, string> = parsedBaseline.hashes ?? {}
  const evaluation = evaluateDifferential(report, current, baselineCounts, parsedBaseline.samplePerLang, SAMPLE_PER_LANG, (lang: string) => repoFor(lang), baselineHashes)
  // Second-corpus evaluation: same baseline file (repo:lang rows), report keyed
  // repo:lang, so evaluateDifferential's failed-set must match full lane keys.
  const evaluationSecond = evaluateDifferential(reportSecond, currentSecond, baselineCounts, parsedBaseline.samplePerLang, SAMPLE_PER_LANG, (key: string) => key.split(":")[0], baselineHashes)

  // M49 W14: a SCOPED run must never emit M14.0.F5.
  //
  // The artifact claims the canonical 60-file, 21-language, two-corpus sweep —
  // it says so in its own `samplingRule`. A run scoped by `--repo` or
  // `--sample` measures a different object, so its rows are not that claim.
  // Reading the journal was already guarded (`resume` above); EMITTING was not,
  // and emitting is the destructive half: there is one artifact path, so a
  // scoped run silently replaced the canonical file with its own rows. Measured
  // 2026-09-13 — `bun run script/m14/differential.ts --repo cython --lang python`,
  // a probe whose only purpose was to inspect one lane, took a completed
  // 42-check canonical artifact and left a 4-check one in its place (the run's
  // own log line reads `evidence written: … (resumed 0 lane(s) from journal)`).
  // That is the mechanism behind the earlier "F5 evidence was truncated by a
  // --lang run" observations, and it is how an artifact can name a commit whose
  // sweep never completed.
  //
  // The sweep-completion path also CLEARS the resume journal, so a scoped run
  // reaching it discards the canonical run's completed-lane record as well.
  // Probe runs keep everything they were for — the per-lane diffs above, and
  // the baseline comparison below — and simply do not claim the artifact.
  // M49 W16: a probe's pinned trees are scratch too — remove them before exit,
  // so diagnosing one lane never leaves a corpus checkout behind.
  const removeFrozenTrees = (): void => {
    if (frozenTrees.size === 0) return
    for (const [repo, dest] of frozenTrees) {
      try { execSync(`git worktree remove --force ${JSON.stringify(dest)}`, { cwd: path.join(CORPUS_ROOT, repo), stdio: ["ignore", "pipe", "pipe"] }) } catch { /* leave it; /tmp is scratch */ }
    }
    try { fs.rmSync(FROZEN_ROOT, { recursive: true, force: true }) } catch { /* empty dir left behind */ }
    console.log(`[frozen] removed ${frozenTrees.size} pinned-tree worktree(s): ${[...frozenTrees.keys()].join(", ")}`)
  }
  const SCOPED_RUN = !!REPO || process.argv.includes("--sample") || !!ONLY_LANGS
  if (SCOPED_RUN) {
    const measured = Object.keys(report).length + Object.keys(reportSecond).length
    const measuredKeys = [...Object.keys(report), ...Object.keys(reportSecond)]
    const scope = ONLY_LANGS ? ONLY_LANGS.join("+") : REPO!
    // A SCOPED run may emit its OWN lane-scoped artifact, never the canonical
    // one. M14.0.F5 claims the whole ${Object.keys(LANGS).length}-language, two-corpus sweep in its own
    // `samplingRule`, and there is one artifact path — so a probe writing it
    // replaces that claim with a smaller one. `--emit` writes
    // `M14.0.F5.<scope>` instead; the unscoped sweep keeps the canonical name.
    //
    // This is the F10/F11 precedent applied to F5 (see verify-parse-success.ts
    // and verify-grammar-leaves.ts): a lane's own evidence is the honest way to
    // record a lane-scoped measurement when the canonical artifact belongs to a
    // different (or, as when this was written, an in-flight) claim.
    if (process.argv.includes("--emit")) {
      const codeInputs = readCodeInputs(ROOT)
      // The claim a LANE-SCOPED artifact makes is about THIS lane's rows, so the
      // code-input check is scoped to the producers of those rows — the lane's
      // analyzer plus the shared oracle/harness (and, when a lane has one, its
      // spec) — not the whole checkout. Another lane's in-flight analyzer edit
      // did not produce these rows, so it must not mark them unclaimable; but the
      // lane's own uncommitted code MUST, so the oracle stays inside the set.
      // Split so the artifact cannot be misread: the lane's OWN code (its
      // analyzer, its spec) is the lane's claim, while the SHARED harness
      // (the oracle + evidence harness) is everybody's — a shared-file dirt is
      // named as such rather than reported as this lane's defect.
      const ownInputs = new Set<string>([
        ...Object.keys(report).map(l => `src/ast/${(LANGS as any)[l]?.analyzerFile}.ts`),
        ...Object.keys(report).map(l => `script/m14/spec/${l}-completeness.json`),
      ])
      const sharedInputs = new Set<string>(["script/m14/differential.ts", "script/m14/evidence-harness.ts"])
      const laneInputs = new Set<string>([...ownInputs, ...sharedInputs])
      const laneDirt = codeInputs.dirty.filter(p => ownInputs.has(p))
      const sharedDirt = codeInputs.dirty.filter(p => sharedInputs.has(p))
      const otherDirt = codeInputs.dirty.filter(p => !laneInputs.has(p))
      const { emitEvidence } = await import("./evidence-harness")
      const rowCheck = (key: string, row: any) => ({
        id: `differential-${key}`,
        description: `${key}: analyzer vs oracle agreement on the drawn file set`,
        status: (row.missingInAnalyzer === 0 && row.unexplainedInAnalyzer === 0 ? "pass" : "fail") as "pass" | "fail",
        detail:
          `files=${row.filesSampled} tree-truth=${row.treeTruthEdges} covered=${row.coveredByAnalyzer} (${row.coveragePct}%) MISSING=${row.missingInAnalyzer} ` +
          `| analyzer-edges=${row.analyzerEdges} unexplained=${row.unexplainedInAnalyzer} (${row.fabricationPct}%) heuristic=${row.heuristicUnexplained} hash=${row.sampleSetHash}`,
      })
      const base = {
        title: `Differential corpus harness, LANE-SCOPED (${scope}: ${measuredKeys.join(", ")}) — NOT the canonical ${Object.keys(LANGS).length}-language claim`,
        claimLevel: "L1",
        layers: ["differential"],
        checks: [
          {
            id: "differential-lane-code-inputs",
            description: "THIS lane's own analyzer and spec are this commit's",
            status: laneDirt.length === 0 ? "pass" : "fail",
            detail: laneDirt.length === 0
              ? `${[...ownInputs].join(", ")} clean at head ${codeInputs.head.slice(0, 10)}`
              : `${laneDirt.length} of this lane's own input(s) differ from head ${codeInputs.head.slice(0, 10)}: ${laneDirt.join(", ")}`,
          },
          {
            id: "differential-harness-code-inputs",
            description: "the SHARED oracle/harness that produced these rows is this commit's",
            status: sharedDirt.length === 0 ? "pass" : "fail",
            detail: sharedDirt.length === 0
              ? `shared harness clean at head ${codeInputs.head.slice(0, 10)}`
              : `${sharedDirt.length} shared harness file(s) differ from head ${codeInputs.head.slice(0, 10)}: ${sharedDirt.join(", ")} — the harness is shared by every lane, so this can be another lane's uncommitted work and is NOT evidence about this lane's rows`,
          },
          ...Object.entries<any>(report).map(([k, r]) => rowCheck(k, r)),
          ...Object.entries<any>(reportSecond).map(([k, r]) => rowCheck(k, r)),
        ],
        limitations: [
          { description: `LANE-SCOPED artifact: this run measured ${measured} lane(s) (${measuredKeys.join(", ")}), not the canonical two-corpus sweep. Its rows are not the M14.0.F5 claim, which carries every gated lane.` },
          { description: "second opinion is a clause-structure re-derivation from the same wasm grammars; a grammar bug shared by both paths would be invisible to this harness" },
          { description: "seeded sample of files per language, deterministic; not exhaustive over the corpus" },
          { description: `the code-input check is scoped to this lane's producers (${[...laneInputs].join(", ")}); ${otherDirt.length} OTHER measured input(s) are dirty in this checkout from other lanes (${otherDirt.slice(0, 6).join(", ")}${otherDirt.length > 6 ? ", …" : ""}) and are recorded in data.codeInputs.otherDirt — they did not produce these rows, and their dirt belongs to their lanes' own artifacts` },
        ],
        corpusPins: Object.fromEntries([...new Set(lanes.map(l => l.repo))].map(r => [r, repoPins[r]]).filter((e): e is [string, string] => Boolean(e[1]))),
        data: {
          scoped: true,
          scope,
          samplingRule: `seeded ${SAMPLE_PER_LANG} files/language, scoped to ${scope}`,
          report,
          secondCorpus: { mapping: SECOND_CORPUS, report: reportSecond },
          codeInputs: { ...codeInputs, ownInputs: [...ownInputs], sharedInputs: [...sharedInputs], laneDirt, sharedDirt, otherDirt },
        },
      }
      // The artifact id must be a PLAIN LITERAL in the emit call. M49's producer
      // register (`verify-evidence-identity`) discovers a producer by the exact
      // shape `issueId: "M14…"` inside the emit window, so a computed id leaves
      // its artifact an ORPHAN to that gate (measured while adding this: the
      // canonical M14.0.F5 kept its producer, the template `M14.0.F5.${scope}`
      // had none, and the same ternary in verify-parse-success.ts cost the
      // canonical M14.0.F10 its claim too). Hence one declared branch per lane,
      // and a REFUSAL — never a silent computed id — for an undeclared scope.
      if (scope === "clean") emitEvidence({ ...base, issueId: "M14.0.F5.clean" })
      else throw new Error(
        `differential: --emit has no declared artifact id for scope "${scope}" — add one literal emit call `
        + '(`{ ...base, issueId: "M14.0.F5.<lane>" }`) beside clean\'s, because a computed id writes an artifact that '
        + `M49 verify-evidence-identity reports as an orphan`,
      )
      console.log(`wrote validation/m14/results/M14.0.F5.${scope}.json (lane-scoped; canonical M14.0.F5.json untouched)`)
    }
    console.log(
      `probe run (${ONLY_LANGS ? `--lang ${scope}` : REPO ? `--repo ${REPO}` : "--sample"}): measured ${measured} lane(s) — M14.0.F5 NOT written. `
      + `The artifact belongs to the canonical ${SAMPLE_PER_LANG}-file, ${Object.keys(LANGS).length}-language sweep; `
      + `a scoped run is for inspecting lanes, and writing it here would replace that claim with a smaller one${process.argv.includes("--emit") ? " (its own lane-scoped artifact was written)" : ""}.`,
    )
    // The scoped guard returns HERE, which is why `--pin-baseline` has to be
    // honoured here and not only at the canonical pin below: a scoped run never
    // reaches that statement. The pin writes the floor REGISTRY only — the
    // evidence artifact is still refused above, so the canonical 30-language
    // claim stays exactly as its own sweep left it.
    if (PIN_BASELINE_FROM_SCOPE) {
      writeBaselinePin(current, currentSecond, 1, "scoped run (--pin-baseline)", runLoadAvgStart)
    }
    removeFrozenTrees()
    process.exit(evaluation.regressions.length || evaluation.perfRegressions.length ? 5 : 0)
  }

  // M49 W16 (defect 3): the artifact names a commit; the code that produced it
  // must BE that commit. Read once, carry it in the evidence as a check and as
  // data, and refuse to exit 0 while it is dirty.
  const codeInputs = readCodeInputs(ROOT)
  if (!codeInputs.clean) {
    console.error(`[code-inputs] ${codeInputs.dirty.length} measured input(s) differ from ${codeInputs.head.slice(0, 10)}: ${codeInputs.dirty.join(", ")}`)
  }
  const { emitEvidence } = await import("./evidence-harness")
  emitEvidence({
    issueId: "M14.0.F5",
    title: "Differential corpus harness (two-corpus gate)",
    claimLevel: "L1",
    layers: ["differential"],
    checks: [
      {
        id: "differential-code-inputs",
        description: "the analyzers, oracle and specs that produced these rows are this commit's",
        status: codeInputs.clean ? "pass" : "fail",
        detail: codeInputs.clean
          ? `every measured input clean at head ${codeInputs.head.slice(0, 10)}`
          : `${codeInputs.dirty.length} modified measured input(s) at head ${codeInputs.head.slice(0, 10)}: ${codeInputs.dirty.slice(0, 6).join(", ")}${codeInputs.dirty.length > 6 ? ", …" : ""}`,
      },
      ...evaluation.checks.map(check => {
        const lang = check.id.replace("differential-", "")
        return { ...check, description: `${check.description} @${repoPins[repoFor(lang)]?.slice(0, 10) ?? "?"}` }
      }),
      ...evaluationSecond.checks.map(check => {
        const repo = (check.id.replace("differential-", "")).split(":")[0]
        return { ...check, description: `${check.description} (second corpus) @${repoPins[repo]?.slice(0, 10) ?? "?"}` }
      }),
    ],
    limitations: [
      { description: "second opinion is a clause-structure re-derivation from the same wasm grammars; a grammar bug shared by both paths would be invisible to this harness" },
      { description: "seeded sample of files per language, deterministic; not exhaustive over the corpus" },
      { description: "coverage/fabrication baselines recorded; wave M14.1 must reduce missing/unexplained counts" },
      { description: "a lane whose corpus checkout was not at its pin is measured in a detached worktree of the pin (see data.pinDrift); the measurement is of committed content, so an in-flight working-tree edit in a corpus repo is deliberately excluded from the differential" },
      { description: "the measured code is this checkout's working tree, so `differential-code-inputs` fails — and the run exits 6 — when any analyzer, oracle or spec input differs from `regeneratedAtCommit`; a dirty tree can measure lanes but cannot claim them" },
      { description: "#871 §1: the heuristic metric matches (label, normalized target) only — source re-attribution is invisible to it; fixture source/line pins are the coverage for attribution moves, and 'no regressions' here must not be read as 'attribution did not change'" },
      { description: "#871 §1-2: perf rows record per-lane loadAvg1 and the run records loadAvgStart/End + slice count; a baseline row without load context is NOT scored (perfUnscoredLanes) rather than mislabelled as a regression; the lane-vs-run-median outlier check is DISCLOSED (medianOutliers) not scored — measured firing at load 3.9/8.7/~22 across ceremonies while the run median stayed put, it cannot separate machine load from lane slowness" },
    ],
    data: {
      corpusPins: repoPins,
      // M49 W16: the code the rows describe. `clean: false` means the numbers
      // above belong to uncommitted code and name no commit.
      codeInputs,
      // #871 §1: the sweep's own load context (per-lane loadAvg1 rides each
      // report row's perf). Read it before judging a perf breach.
      loadContext: { loadAvgStart: runLoadAvgStart, loadAvgEnd: loadAvg1(), sliceCount: willBatch ? Math.ceil(lanes.length / BATCH_SIZE) : 1 },
      // M49 W16: pins whose live checkout did not match, and what was measured
      // instead. Empty means every lane read exactly its pin.
      pinDrift,
      samplingRule: `seeded ${SAMPLE_PER_LANG} files/language (primary + second corpus lanes)`,
      report,
      secondCorpus: { mapping: SECOND_CORPUS, report: reportSecond },
      // M49 G5: exactly what the baseline comparison could and could not
      // claim this run. `resampledLanes` drew a different file set than the
      // pinned one, so their counts are not comparable; `unpinnedLanes` have
      // no recorded file set at all (pre-G5 rows) and keep the strict count
      // comparison. Both lists may only shrink, and they are evidence, not
      // console chatter, so a green run cannot hide them.
      baselineComparison: {
        samplePerLang: SAMPLE_PER_LANG,
        pinnedLanes: Object.keys(baselineHashes).length,
        totalBaselineLanes: Object.keys(baselineCounts).length,
        resampledLanes: [...evaluation.resampled, ...evaluationSecond.resampled],
        unpinnedLanes: [...evaluation.unpinnedLanes, ...evaluationSecond.unpinnedLanes],
        // #871 §1: perf rows REFUSED because the baseline carries no load
        // context — disclosed so the list can only shrink.
        perfUnscoredLanes: [...evaluation.perfUnscored, ...evaluationSecond.perfUnscored],
        // #871 §2: lane-vs-run-median outliers, DISCLOSED never scored.
        medianOutliers: [...evaluation.medianOutliers, ...evaluationSecond.medianOutliers],
      },
    },
  })
  console.log(`evidence written: validation/m14/results/M14.0.F5.json (resumed ${resumedLanes} lane(s) from journal)`)
  if (!codeInputs.clean) {
    console.error(
      `DIFFERENTIAL CODE INPUTS DIRTY: ${codeInputs.dirty.length} measured input(s) differ from ${codeInputs.head.slice(0, 10)} — `
      + `these rows describe uncommitted code, so they are not a claim about any commit; commit the analyzer/oracle change and re-run `
      + `(dirty: ${codeInputs.dirty.slice(0, 8).join(", ")}${codeInputs.dirty.length > 8 ? ", …" : ""})`,
    )
    removeFrozenTrees()
    process.exit(6)
  }
  // Full sweep completed: the crash-resume journal served its purpose (only for
  // the journals this run actually used — a probe run never touched one).
  if (useJournal) { try { fs.rmSync(LANE_JOURNAL, { force: true }) } catch { /* already gone */ } }
  // M49 W16: the pinned trees measured by this sweep are scratch space, removed
  // now that the evidence is written. A crash leaves them behind for the
  // resumed run, which finds them again under the same state key.
  removeFrozenTrees()

  // Improvement-forcing gate: missing/unexplained counts may never grow.
  // Baseline updates are explicit and are not silently treated as validation.
  const updateBaseline = process.argv.includes("--update-baseline")
  // `--pin-baseline` lets a SCOPED run (`--lang`, `--repo`) reach the pin. It is
  // a separate flag from `--update-baseline` on purpose: a probe must write
  // nothing by default, and only an explicit request may write the registry.
  // It changes nothing about WHAT the pin does — same function, same
  // clean-lanes-only rule, same merge, same hashes and load context — and it
  // still writes NO evidence artifact, because the scoped guard above returns
  // before that and this flag does not move the guard.
  if (updateBaseline || PIN_BASELINE_FROM_SCOPE) {
    writeBaselinePin(
      current,
      currentSecond,
      willBatch ? Math.ceil(lanes.length / BATCH_SIZE) : 1,
      PIN_BASELINE_FROM_SCOPE ? "scoped run (--pin-baseline)" : "canonical sweep",
      runLoadAvgStart,
    )
  } else if (!evaluation.comparable) {
    console.log(`differential baseline gate: SKIPPED (baseline sampled ${parsedBaseline.samplePerLang ?? "unknown"}/lang, this run ${SAMPLE_PER_LANG}/lang — probe mode, not comparable)`)
  } else {
    const resampledLanes = [...evaluation.resampled, ...evaluationSecond.resampled]
    const unpinned = [...evaluation.unpinnedLanes, ...evaluationSecond.unpinnedLanes]
    for (const r of resampledLanes) {
      console.log(`RESAMPLED ${r}: drew a different file set than the baseline (cold-pool rotation) — counts NOT comparable, so this is a new-sample finding to triage, not a regression`)
    }
    if (unpinned.length > 0) {
      console.log(`differential baseline file sets: ${unpinned.length} lane(s) unpinned (no recorded drawn set) — those keep the strict count comparison, which can false-positive after a rotation; pin with --update-baseline at a stable tree (unpinned: ${unpinned.slice(0, 8).join(", ")}${unpinned.length > 8 ? ", …" : ""})`)
    }
    for (const r of [...evaluation.regressions, ...evaluationSecond.regressions]) console.error(`DIFFERENTIAL REGRESSION ${r}: ${JSON.stringify(baselineCounts[r])} -> ${JSON.stringify(current[r] ?? currentSecond[r])}`)
    for (const r of [...evaluation.perfRegressions, ...evaluationSecond.perfRegressions]) console.error(`PERF BUDGET EXCEEDED ${r}`)
    for (const r of [...evaluation.perfUnscored, ...evaluationSecond.perfUnscored]) console.log(`PERF NOT SCORED ${r}`)
    for (const r of [...evaluation.medianOutliers, ...evaluationSecond.medianOutliers]) console.log(`PERF OUTLIER DISCLOSED ${r}`)
    if (evaluation.regressions.length || evaluation.perfRegressions.length || evaluationSecond.regressions.length || evaluationSecond.perfRegressions.length) process.exit(5)
    console.log(`differential baseline gate: no regressions on a pinned file set (primary + second corpus); perf budgets respected${resampledLanes.length ? `; ${resampledLanes.length} lane(s) resampled (triage)` : ""}`)
  }
}

if (process.argv[1]?.endsWith("differential.ts")) {
  main().catch(e => { console.error(e); process.exit(1) })
}
