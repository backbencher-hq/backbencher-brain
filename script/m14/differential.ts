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
import { execSync, spawnSync } from "child_process"
import { PHP_BUILTINS } from "../../src/ast/real-php-analyzer"
import { RUBY_BUILTINS, RAILS_MACRO_METHODS, isRubyStaticSuperclassName } from "../../src/ast/real-ruby-analyzer"
import { PYTHON_BUILTINS } from "../../src/ast/real-python-analyzer"
import { CLOJURE_CORE_BUILTINS } from "../../src/ast/real-clojure-analyzer"
import { csharpMemberDeclaredTypeText, csharpResolveTargetTypedNew } from "../../src/ast/real-csharp-analyzer"

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
export function sampleSetHash(relPaths: string[]): string {
  return createHash("sha256").update([...relPaths].sort().join("\n")).digest("hex").slice(0, 16)
}

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const CORPUS_ROOT = "$HOME/fixtures/repositories"
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
const LANG_REPOS: Record<string, string> = {
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
}
// M37.16 two-corpus gate (second-opinion hardening): every gated language runs
// the SAME analyzer-vs-oracle differential on a SECOND, independent real corpus
// in the default sweep, so a defect with zero occurrences in the primary repo
// (SWIFTD18 class — multi-binding in swift-nio had 0 sites) is exercised by a
// different codebase's dialect. Rows are keyed repo:lang in the baseline/current
// maps exactly like the primary rows, so regressions on EITHER corpus block
// release. Each repo is an independent git checkout under CORPUS_ROOT whose
// pin is recorded in corpusPins.
const SECOND_CORPUS: Record<string, string> = {
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
}
const REPO = process.argv.includes("--repo") ? process.argv[process.argv.indexOf("--repo") + 1] : undefined
const SAMPLE_PER_LANG = process.argv.includes("--sample") ? parseInt(process.argv[process.argv.indexOf("--sample") + 1]) : 60
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

const LANGS: Record<string, { wasm: string; analyzerFile: string; className: string; ext: string }> = {
  javascript: { wasm: "tree-sitter-javascript.wasm", analyzerFile: "real-javascript-analyzer", className: "RealJavaScriptAnalyzer", ext: "js" },
      typescript: { wasm: "tree-sitter-typescript.wasm", analyzerFile: "real-typescript-analyzer", className: "RealTypeScriptAnalyzer", ext: "ts" },
  kotlin: { wasm: "tree-sitter-kotlin.wasm", analyzerFile: "real-kotlin-analyzer", className: "RealKotlinAnalyzer", ext: "kt" },
  scala: { wasm: "tree-sitter-scala.wasm", analyzerFile: "real-scala-analyzer", className: "RealScalaAnalyzer", ext: "scala" },
  java: { wasm: "tree-sitter-java.wasm", analyzerFile: "real-java-analyzer", className: "RealJavaAnalyzer", ext: "java" },
  groovy: { wasm: "tree-sitter-groovy.wasm", analyzerFile: "real-groovy-analyzer", className: "RealGroovyAnalyzer", ext: "groovy" },
  vue: { wasm: "tree-sitter-vue.wasm", analyzerFile: "real-vue-analyzer", className: "RealVueAnalyzer", ext: "vue" },
  svelte: { wasm: "tree-sitter-svelte.wasm", analyzerFile: "real-svelte-analyzer", className: "RealSvelteAnalyzer", ext: "svelte" },
  cpp: { wasm: "tree-sitter-cpp.wasm", analyzerFile: "real-cpp-analyzer", className: "RealCppAnalyzer", ext: "cc,h" },
  c: { wasm: "tree-sitter-c.wasm", analyzerFile: "real-c-analyzer", className: "RealCAnalyzer", ext: "c" },
  rust: { wasm: "tree-sitter-rust.wasm", analyzerFile: "real-rust-analyzer", className: "RealRustAnalyzer", ext: "rs" },
  go: { wasm: "tree-sitter-go.wasm", analyzerFile: "real-go-analyzer", className: "RealGoAnalyzer", ext: "go" },
  zig: { wasm: "tree-sitter-zig.wasm", analyzerFile: "real-zig-analyzer", className: "RealZigAnalyzer", ext: "zig" },
  csharp: { wasm: "tree-sitter-c_sharp.wasm", analyzerFile: "real-csharp-analyzer", className: "RealCSharpAnalyzer", ext: "cs" },
  dart: { wasm: "tree-sitter-dart.wasm", analyzerFile: "real-dart-analyzer", className: "RealDartAnalyzer", ext: "dart" },
  swift: { wasm: "tree-sitter-swift.wasm", analyzerFile: "real-swift-analyzer", className: "RealSwiftAnalyzer", ext: "swift" },
  objc: { wasm: "tree-sitter-objc.wasm", analyzerFile: "real-objective-c-analyzer", className: "RealObjectiveCAnalyzer", ext: "m" },
  php: { wasm: "tree-sitter-php.wasm", analyzerFile: "real-php-analyzer", className: "RealPhpAnalyzer", ext: "php" },
  ruby: { wasm: "tree-sitter-ruby.wasm", analyzerFile: "real-ruby-analyzer", className: "RealRubyAnalyzer", ext: "rb" },
  python: { wasm: "tree-sitter-python.wasm", analyzerFile: "real-python-analyzer", className: "RealPythonAnalyzer", ext: "py" },
  haskell: { wasm: "tree-sitter-haskell.wasm", analyzerFile: "real-haskell-analyzer", className: "RealHaskellAnalyzer", ext: "hs" },
  elixir: { wasm: "tree-sitter-elixir.wasm", analyzerFile: "real-elixir-analyzer", className: "RealElixirAnalyzer", ext: "ex,exs" },
  erlang: { wasm: "tree-sitter-erlang.wasm", analyzerFile: "real-erlang-analyzer", className: "RealErlangAnalyzer", ext: "erl" },
  clojure: { wasm: "tree-sitter-clojure.wasm", analyzerFile: "real-clojure-analyzer", className: "RealClojureAnalyzer", ext: "clj,cljc,cljs" },
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
function coldPoolPick<T>(items: T[], n: number, laneKey: string): { picked: T[]; coldCount: number; total: number; rotation: number } {
  const state = loadColdPool()
  const seen = new Set<string>(state.seen[laneKey] ?? [])
  const rotation = (state.rotations[laneKey] ?? 0) + 1
  const paths = items.map((it) => String((it as any).path ?? (it as any).filePath ?? (it as any).file ?? it))
  const freshIdx: number[] = []
  const warmIdx: number[] = []
  for (let i = 0; i < items.length; i++) (seen.has(paths[i]) ? warmIdx : freshIdx).push(i)
  const coldFresh = seededPick(freshIdx.map((i) => items[i]), Math.min(n, freshIdx.length), `${laneKey}:rot${rotation}:fresh`)
  const coldWarm = seededPick(warmIdx.map((i) => items[i]), n - coldFresh.length, `${laneKey}:rot${rotation}:warm`)
  const picked = [...coldFresh, ...coldWarm]
  const pickedPaths = picked.map((it) => String((it as any).path ?? (it as any).filePath ?? (it as any).file ?? it))
  state.seen[laneKey] = [...new Set([...(state.seen[laneKey] ?? []), ...pickedPaths])]
  state.rotations[laneKey] = rotation
  saveColdPool(state)
  return { picked, coldCount: coldFresh.length, total: items.length, rotation }
}
function lastSegment(name: string): string {
  const parts = name.split(/::|\./).filter(Boolean)
  return parts[parts.length - 1] ?? name
}
function normTarget(t: string): string {
  // scala type args use square brackets; multi-line constructs can leave a
  // trailing unbalanced "[" in raw-text targets (List[ -> List)
  return lastSegment(t.replace(/<.*$/, "").replace(/\[.*$/, "").trim())
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
let EMBEDDED_SCRIPT_PARSERS: { js: any; ts: any } | null = null
export async function embeddedScriptParsers(): Promise<{ js: any; ts: any }> {
  if (EMBEDDED_SCRIPT_PARSERS) return EMBEDDED_SCRIPT_PARSERS
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const Lang = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const language = await Lang.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
  const parser = new P()
  parser.setLanguage(language)
  const tsLanguage = await Lang.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
  const tsParser = new P()
  tsParser.setLanguage(tsLanguage)
  EMBEDDED_SCRIPT_PARSERS = { js: parser, ts: tsParser }
  return EMBEDDED_SCRIPT_PARSERS
}

// Embedded-script truth for SFC languages: extract <script> raw_text
// blocks and parse them with the JS grammar (lang="ts" blocks included -
// the JS-family structural rules apply identically).
export async function deriveEmbeddedScriptTrees(root: any, content: string, lang: string): Promise<any[]> {
  const { js: parser, ts: tsParser } = await embeddedScriptParsers()
  const out: any[] = []
  const walk = (n: any): void => {
    if (n.type === "script_element") {
      const raw = n.namedChildren.find((c: any) => c.type === "raw_text")
      const startTag = n.namedChildren.find((c: any) => c.type === "start_tag")
      const isTs = !!startTag && /lang=["']ts["']/.test(startTag.text)
      if (raw && raw.text.trim().length > 0) {
        try {
          // ts blocks need the TS grammar or heritage clauses error-recover away
          out.push((isTs ? tsParser : parser).parse(raw.text).rootNode)
        } catch { /* skip */ }
      }
    }
    for (let k = 0; k < n.namedChildCount; k++) walk(n.namedChild(k))
  }
  walk(root)
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

export function deriveGroovyEdges(root: any): { label: string; from: string; target: string }[] {
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
        push("calls", leaf.text)
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
                if (!f) return cur.text
                cur = f
                continue
              }
              if (t === "template_function" || t === "template_method") {
                const base = cur.namedChild(0)
                if (!base) return cur.text
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
                return cur.text
              }
              if (t === "qualified_identifier" && cur.namedChildCount >= 1) {
                cur = cur.namedChild(cur.namedChildCount - 1)
                continue
              }
              if (t === "parenthesized_expression" && cur.namedChildCount >= 1) {
                cur = cur.namedChild(0)
                continue
              }
              if (t === "identifier" || t === "field_identifier" || t === "type_identifier" ||
                  t === "operator_name" || t === "destructor_name" || t === "namespace_identifier") {
                return cur.text
              }
              return cur.text
            }
            return cur?.text ?? ""
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
        const nm = qid ? qid.namedChild(qid.namedChildCount - 1)?.text : decl?.namedChildren?.find((c: any) => c.type === "identifier" || c.type === "field_identifier")?.text
        // CP7 mirror: nested qualification (`Outer::Inner::m`) nests
        // RIGHT-leaning as qid[ns Outer, qid[ns Inner, m]] — the owning
        // scope is the INNERMOST qualifier (`Inner`, matching the
        // analyzer's descended scope and the member registry keys).
        // Descend to the deepest qualifier, then take the first scope-ish
        // child (namespace/type/identifier/template).
        let scopeQid: any = qid ?? null
        while (scopeQid) {
          const last = scopeQid.namedChild(scopeQid.namedChildCount - 1)
          if (last && last.type === "qualified_identifier") scopeQid = last
          else break
        }
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
      const decl = (n.namedChildren ?? []).find((c: any) => c.type === "function_declarator")
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
        const d2 = (n.namedChildren ?? []).find((c: any) => c.type === "function_declarator")
        const q2 = d2?.namedChildren?.find((c: any) => c.type === "qualified_identifier")
        if (q2) {
          // CP7 mirror: descend to the innermost qualifier (same rule as
          // the pre-pass flush and the analyzer's getFunctionDetails).
          let sq: any = q2
          while (sq) {
            const last = sq.namedChild(sq.namedChildCount - 1)
            if (last && last.type === "qualified_identifier") sq = last
            else break
          }
          const scNode2 = sq?.namedChildren?.find((c: any) => c.type === "namespace_identifier" || c.type === "type_identifier" || c.type === "identifier" || c.type === "template_type")
          fnCls = cleanScope(scNode2)
        }
      }
      cur = { kind: "function", name: "", locals, cls: fnCls }
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
        let inFnBody = false
        let cur2: any = n.parent
        while (cur2) {
          if (cur2.type === "function_definition") { inFnBody = true; break }
          if (cur2.type === "class_specifier" || cur2.type === "struct_specifier") break
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
  {
    const pre: any[] = [root]
    while (pre.length > 0) {
      const n = pre.pop()!
      if (n.text) {
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
          if (isDeclaringIdentifier(n) && !isDirectiveConditionText(n) && !isBareFdGlueName(n) && (isMacroName || isFnDefName(n) || (!isFunctionLocal(n) && !varDeclSuppressed))) {
            declaredNames.add(n.text)
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
                if (id) locals.add(id)
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
      // CGD16: include truth mirrors the analyzer's include_dependency
      // references — target is the RAW path text (quotes/brackets
      // stripped), measured from the analyzer (`references sqliteInt.h`).
      const pathNode = n.namedChildren.find((c: any) => c.type === "string_literal" || c.type === "system_lib_string")
      if (pathNode) {
        const raw = pathNode.text.replace(/^["<]/, "").replace(/[">]$/, "")
        if (raw && !seen.has("ref:" + raw)) {
          seen.add("ref:" + raw)
          edges.push({ label: "references", from: "(expr)", target: raw })
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
      if (p && p.type !== "call_expression" && !isTopLevelErrorDebris && !isHashLine && !isDeclaringIdentifier(n) && !isDirectiveConditionText(n)) {
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
      // Composite-literal construction (`Foo{...}`, `&Foo{...}`,
      // `pkg.Foo{...}`) -> instantiates of the type leaf. Mirror of the
      // analyzer's analyzeGoCompositeLiteralConstruction (M37 #604): only
      // type_identifier / qualified_type children name a type; slice/map/
      // array literals carry wrapper type children and elided element
      // literals have none, so both fall through to no edge. Builtin guard
      // matches the analyzer.
      const typeN = n.childForFieldName?.("type") ?? (n.namedChildCount > 0 ? n.namedChild(0) : undefined)
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
              const typeN = fd.childForFieldName?.("type") ?? (fd.namedChildren ?? []).find((c: any) => c.type === "type_identifier" || c.type === "qualified_type")
              if (typeN) {
                const t = lastSegment(typeN.text)
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

export function deriveCSharpEdges(root: any, corpusInterfaces?: Set<string>): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  const leafOf = (t: string): string => {
    // generic_name: IComparer<Circle> -> IComparer; qualified: A.B.C -> C
    const lt = t.indexOf("<")
    return lastSegment(lt >= 0 ? t.slice(0, lt) : t)
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
  {
    const pre: any[] = [root]
    while (pre.length) {
      const t = pre.pop()!
      if (/^(class|interface|struct|record)_declaration$/.test(t.type)) {
        const nm = t.childForFieldName?.("name")?.text
        if (nm) declKinds.set(nm, t.type.startsWith("interface") ? "interface" : t.type.includes("struct") ? "struct" : "class")
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
      const typeNode =
        n.namedChildren.find((c: any) => c.type === "generic_name" || c.type === "identifier" || c.type === "qualified_name" || c.type === "predefined_type") ??
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
          if (own.type === "class_definition") break
          own = own.parent
        }
        const onm = own && own.type === "class_definition" ? own.childForFieldName?.("name")?.text : null
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
    if (t === "class_definition" || t === "mixin_declaration") {
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
      if (p.type === "class_definition" || p.type === "enum_declaration") {
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
  const key = (label: string, target: string) => label + ":" + target
  const push = (label: string, target: string) => {
    const k = key(label, target)
    if (!seen.has(k)) { seen.add(k); edges.push({ label, from: "(expr)", target }) }
  }
  // SW-B candidates (head + leaf), resolved post-walk against declared
  // enum cases; matched leaf calls convert to instantiates.
  const swEnumCtorCandidates: Array<{ head: string | null; owner: string | null; leaf: string; removeCalls: boolean }> = []
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
        const id = c.namedChildren.find((x: any) => x.type === "simple_identifier" || x.type === "identifier")
        leaf = id ?? c
      }
    }
    return leaf ? leaf.text : null
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
    if (t === "class_declaration") {
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
            if (o.type === "class_declaration") {
              for (let k = 0; k < o.namedChildCount; k++) {
                const c = o.namedChild(k)
                if (c && c.type === "type_identifier") return c.text
              }
              for (let k = 0; k < o.namedChildCount; k++) {
                const c = o.namedChild(k)
                if (c && c.type === "user_type") {
                  let lf: any = null
                  for (let j = 0; j < c.namedChildCount; j++) {
                    const x = c.namedChild(j)
                    if (x && x.type === "type_identifier") lf = x
                  }
                  if (lf) return lf.text
                }
              }
              return null
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
          if (recv && enclosingType) {
            const target = recv === "super" ? swSuperByClass.get(enclosingType) ?? null : enclosingType
            if (target) {
              push("instantiates", target)
              consumed = true
            }
          }
        }
        if (!consumed) {
          if (leaf && leaf !== "$0") push("calls", leaf)
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
          else push("calls", target)
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
        let a: any = n.parent
        while (a && a.type === "directly_assignable_expression") a = a.parent
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
          let a2: any = n.parent
          while (a2 && (a2.type === "directly_assignable_expression" || a2.type === "navigation_expression" || a2.type === "navigation_suffix")) a2 = a2.parent
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
      if (pn.type === "class_declaration" && hasEnumTok(pn)) {
        let enm: string | null = null
        for (let k = 0; k < pn.namedChildCount; k++) {
          const c = pn.namedChild(k)
          if (c && c.type === "type_identifier") { enm = c.text; break }
        }
        if (enm) {
          const est: any[] = [pn]
          while (est.length > 0) {
            const en = est.pop()!
            if (!en) continue
            if (en.type === "enum_entry") {
              for (let k = 0; k < en.namedChildCount; k++) {
                const c = en.namedChild(k)
                if (c && c.type === "simple_identifier") { enumCases.add(`${enm}.${c.text}`); break }
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
      for (const cand of swEnumCtorCandidates) {
        const key = cand.head ?? cand.owner
        if (!key || !enumCases.has(`${key}.${cand.leaf}`)) continue
        if (cand.removeCalls) {
          for (let k = edges.length - 1; k >= 0; k--) {
            if (edges[k].label === "calls" && edges[k].target === cand.leaf) {
              edges.splice(k, 1)
              break
            }
          }
        }
        push("instantiates", key)
      }
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
  const push = (name: string): void => {
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
    let a: any = n.parent
    while (
      a && (a.type === "directly_assignable_expression" ||
        a.type === "navigation_expression" || a.type === "navigation_suffix")
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
  const objcIsDeclaratorName = (inode: any): boolean => {
    const wrappers = new Set(["array_declarator", "pointer_declarator", "parenthesized_declarator", "attributed_declarator", "abstract_pointer_declarator", "block_pointer_declarator", "function_declarator"])
    let cur: any = inode
    let p: any = inode.parent ?? null
    while (p && wrappers.has(p.type) && cur) { cur = p; p = p.parent ?? null }
    if (!p || p.type !== "init_declarator" || !cur) return false
    return objcSpanIn(p.namedChild(0), cur)
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
        } else if (objcIsDeclaratorName(n)) {
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
  // Mirror RealPhpAnalyzer.extractIncludePath (probe-verified shapes).
  const cleanString = (t: string): string => {
    const m = t.match(/^['"](.*)['"]$/s)
    return m ? m[1] : t
  }
  const collapseWhitespace = (t: string): string => t.replace(/\s+/g, "")
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
  const extractPhpIncludePath = (node: any): string | undefined => {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "encapsed_string" || child.type === "string") return cleanString(child.text)
      if (child.type === "binary_expression") return collapseWhitespace(child.text)
      if (child.type === "name" || child.type === "qualified_name") return child.text
    }
    return undefined
  }

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
      const fn = n.childForFieldName?.("function") ?? n.namedChildren.find((c: any) => c.type === "name" || c.type === "qualified_name")
      if (fn) {
        const target = leafName(fn.text)
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
      const lhs = parent ? parent.namedChild(0) : null
      const isWrite = parent && (parent.type === "assignment_expression" || parent.type === "augmented_assignment_expression") && lhs && lhs.startIndex === n.startIndex && lhs.endIndex === n.endIndex
      if (!isWrite) {
        const nameNode = n.childForFieldName?.("name")
        if (nameNode) push("uses", nameNode.text)
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
        if (
          ptype !== "member_access_expression" && ptype !== "nullsafe_member_access_expression" &&
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
          if (sup) classBases.set(nameNode.text, leafName(sup.text.replace(/^<\s*/, "")))
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
          let receiver: string | undefined
          let receiverIsConst = false
          for (let i = 0; i < n.namedChildCount; i++) {
            const child = n.namedChild(i)
            if (child && child.id === methodNode.id) break
            if (child && (child.type === "constant" || child.type === "scope_resolution")) {
              receiver = child.text
              receiverIsConst = true
            } else if (child && child.type === "identifier") {
              receiver = child.text
            }
          }
          if (!receiver) {
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

// Go implicit interface-implementation truth (duck typing): a struct S
// implements interface I when S's receiver-method set (value OR pointer
// receivers) contains every method I declares. Mirrors the analyzer's
// checkGoInterfaceImplementation. Method-name set is compared (the analyzer
// also compares signatures, but name-set equality is the sufficient, stable
// truth — signature equality adds another oracle that must itself be
// mirrored, so it is intentionally simplified to the name set, which is
// still a correct superset check the analyzer also satisfies).
export function deriveGoImplements(root: any): { label: string; from: string; target: string }[] {
  const edges: { label: string; from: string; target: string }[] = []
  const seen = new Set<string>()
  // interfaceName -> Set<methodName>
  const interfaces: Record<string, Set<string>> = {}
  // interfaceName -> Set<embeddedInterfaceName>
  const embedded: Record<string, Set<string>> = {}
  // structName -> Set<embeddedStructName> (Go struct embedding promotion)
  const structEmbedded: Record<string, Set<string>> = {}
  // receiverType -> Set<methodName> (value AND pointer receivers merged)
  const structMethods: Record<string, Set<string>> = {}
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
        if (!ts || ts.type !== "type_spec") continue
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
            if (!structMethods[nm]) structMethods[nm] = new Set()
          for (let k = 0; k < fdl.namedChildCount; k++) {
              const fd = fdl.namedChild(k)
              if (!fd || fd.type !== "field_declaration") continue
              const nameF = fd.childForFieldName?.("name")
              if (nameF) continue // named field, not embedding
              const typeNode = fd.childForFieldName?.("type") ?? (fd.namedChildCount > 0 ? fd.namedChild(0) : undefined)
              if (!typeNode) continue
              // Descend pointer/qualified wrappers to the leaf identifier.
              let inner: any = typeNode
              let guard = 0
              while (inner && guard++ < 4 && (inner.type === "pointer_type" || inner.type === "qualified_type")) {
                inner = inner.namedChildCount > 0 ? inner.namedChild(0) : undefined
              }
              const raw = inner?.text ?? typeNode.text
              const leaf = raw.lastIndexOf(".") !== -1 ? raw.slice(raw.lastIndexOf(".") + 1) : raw
              if (leaf) { if (!structEmbedded[nm]) structEmbedded[nm] = new Set(); structEmbedded[nm].add(leaf) }
            }
          }
        }
        const interfaceN = ts.namedChildren.find((c: any) => c.type === "interface_type")
        if (nm && interfaceN) {
          const set = new Set<string>()
          for (let j = 0; j < interfaceN.namedChildCount; j++) {
            const m = interfaceN.namedChild(j)
            if (!m) continue
            if (m.type === "method_spec") {
              const mn = m.childForFieldName?.("name")
              if (mn) set.add(mn.text)
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
          interfaces[nm] = set
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
        if (!structMethods[receiverType]) structMethods[receiverType] = new Set()
        structMethods[receiverType].add(nm)
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
  const fold = (name: string, visiting: Set<string>) => {
    const target = interfaces[name]
    if (!target || visiting.has(name)) return
    visiting.add(name)
    const embs = embedded[name]
    if (embs) {
      for (const e of embs) {
        const eSet = interfaces[e]
        if (!eSet) continue
        for (const m of eSet) target.add(m)
        fold(e, visiting)
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
        const eSet = structMethods[e]
        if (eSet) for (const m of eSet) target.add(m)
        foldStruct(e, visiting)
      }
    }
    visiting.delete(name)
  }
  for (const name of Object.keys(structMethods)) foldStruct(name, new Set())
  for (const [iface, ifaceMethods] of Object.entries(interfaces)) {
    if (ifaceMethods.size === 0) continue
    // Generic pairs skipped on BOTH sides (mirrors the analyzer).
    if (genericNames.has(iface)) continue
    for (const [structName, methods] of Object.entries(structMethods)) {
      if (structName === iface) continue
      if (genericNames.has(structName)) continue
      let ok = true
      for (const m of ifaceMethods) {
        if (!methods.has(m)) { ok = false; break }
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

  // Pass 2: structural edge derivation (mirrors RealPythonAnalyzer).
  const stack: any[] = [{ n: root, parent: null, inFn: undefined as string | undefined }]
  while (stack.length > 0) {
    const { n, parent, inFn } = stack.pop()!
    const t = n.type
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
            if (m.type === "assignment" || m.type === "augmented_assignment" || m.type === "named_expression") {
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
      const fn = n.namedChild(0)
      if (fn) {
        // Leaf of the callee: identifier -> text; attribute -> last child;
        // subscript (computed/dynamic call FACTORIES[key](x)) -> SKIP, the
        // analyzer does not fabricate calls to the dict variable (PYD1).
        const calleeLeaf =
          fn.type === "identifier" ? fn.text :
          fn.type === "attribute" ? fn.namedChild(fn.namedChildCount - 1)?.text :
          undefined
        if (calleeLeaf && fn.type !== "subscript" && !isBuiltin(calleeLeaf)) {
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
  const aliases = new Map<string, string>()
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
    if (root && aliases.has(root)) {
      parts[0] = aliases.get(root)!
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
          // EX-L5 mirror (CLJ1-session correction): the implied last-segment
          // alias goes live in the ENCLOSING scope when the definition
          // CLOSES — never inside the module's own body (`use Supervisor`
          // in Task.Supervisor/Registry.Supervisor is the external one; the
          // analyzer was corrected to the same timing).
          if ((sc.kind === "module" || sc.kind === "interface") && sc.name) {
            const implied = String(sc.name).split(".").pop()
            if (implied && !aliases.has(implied)) aliases.set(implied, sc.name)
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
              stack.push({ node: n, name: full, kind: target === "defmodule" ? "module" : "interface" })
              pushed = true
            }
          }
        } else if (target === "defimpl" && !isHead(n) && !isAttr(n)) {
          const args = find(n, (c: any) => c.type !== "identifier" && c.type !== "do_block")
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
            // ELXD6/ELXD7 mirror: for-less nested defimpl targets the
            // enclosing scope; defmacro heads are not implementations.
            const implName = forAlias && forAlias !== "Unknown" ? forAlias : (stack.length > 0 ? stack[stack.length - 1].name : protocol)
            if (implName !== protocol) push("implements", implName, protocol)
            stack.push({ node: n, name: implName, kind: "class" })
            pushed = true
          }
        } else if (DEFS.has(target) && !isHead(n) && !isAttr(n)) {
          const nm = declName(n)
          if (nm) {
            decl(ownerOf(stack), nm)
            stack.push({ node: n, name: nm, kind: (target === "defmacro" || target === "defmacrop" || target === "defguard" || target === "defguardp") ? "macro" : "function" })
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
                    aliases.set(key, full)
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
                if (key) aliases.set(key, moduleName)
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
          const bhv = first ? resolveAliasO(stripQuotes(first.text).trim()) : ""
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
    if (parts.length > 1 && aliases.has(parts[0])) {
      parts[0] = aliases.get(parts[0])!
      finalTarget = parts.join(".")
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
          // EX-L5 mirror: restore the implied alias hidden at module entry —
          // pass 2 walks in source order, so the alias exists only in the
          // ENCLOSING scope AFTER the definition (analyzer timing).
          if (sc.hiddenImplied) aliases.set(sc.hiddenImplied, sc.name)
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
            // EX-L5 mirror (CLJ1 session): pass 1 registered every implied
            // alias at scope EXIT; pass 2 must HIDE this module's own alias
            // while walking its body and restore it at close, or body-time
            // references resolve to the module itself (the pre-fix analyzer
            // bug; `use Supervisor` inside Registry.Supervisor).
            const impliedKey = String(full).split(".").pop() ?? ""
            const hideImplied = !!impliedKey && aliases.get(impliedKey) === full
            if (hideImplied) aliases.delete(impliedKey)
            const frame: any = { node: n, name: full, kind: target === "defmodule" ? "module" : "interface" }
            if (hideImplied) frame.hiddenImplied = impliedKey
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
            stack.push({ node: n, name: implName, kind: "class" })
            pushed = true
          }
        } else if (DEFS.has(target) && !isHead(n) && !isAttr(n)) {
          const nm = declName(n)
          if (nm) {
            stack.push({ node: n, name: nm, kind: (target === "defmacro" || target === "defmacrop" || target === "defguard" || target === "defguardp") ? "macro" : "function" })
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
  // #881 mirror: the comment macro can be shadowed by a local definition —
  // a bare `comment` sym outside head position anywhere in the file means
  // `(comment …)` forms are ordinary calls and must be walked.
  let mayShadowComment = false
  {
    // F4 mirror: only DEFINITION evidence flips the flag (a def-family NAME
    // or a binding-vector position) — a DATA-position `comment` symbol does
    // not shadow the macro (see the analyzer; adversarial review F4).
    const DEF_NAME_HEADS = new Set(["def", "defn", "defn-", "defmacro", "defonce", "defmulti"])
    const BINDING_VEC_HEADS = new Set(["let", "let*", "loop", "loop*", "when-let", "if-let", "when-some", "if-some", "when-first", "binding", "for", "doseq", "dotimes", "with-open", "with-local-vars", "with-bindings", "letfn"])
    const FN_PARAM_HEADS = new Set(["fn", "defn", "defn-", "defmacro", "defmethod", "deftest"])
    const isShadowingComment = (c: any): boolean => {
      const p = c.parent
      if (!p) return false
      if (p.type === "list_lit") {
        const head = formNameOf(p)
        return !!(DEF_NAME_HEADS.has(head) && p.namedChild(1)?.startIndex === c.startIndex)
      }
      if (p.type === "vec_lit") {
        const gp = p.parent
        if (!gp || gp.type !== "list_lit") return false
        const head = formNameOf(gp)
        if (FN_PARAM_HEADS.has(head)) {
          for (let i = 0; i < gp.namedChildCount; i++) {
            const cc = gp.namedChild(i)
            if (cc?.type === "vec_lit") return cc.startIndex === p.startIndex
          }
          return false
        }
        if (BINDING_VEC_HEADS.has(head)) return gp.namedChild(1)?.startIndex === p.startIndex
        return false
      }
      return false
    }
    const scan: any[] = [root]
    while (scan.length > 0) {
      const c = scan.pop()!
      if (c.type === "dis_expr" || c.type === "quoting_lit") continue
      if (c.type === "sym_lit" && symName(c) === "comment" && isShadowingComment(c)) { mayShadowComment = true; break }
      for (const k of kids(c)) scan.push(k)
    }
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
      if (canon === "quote" || canon === "clojure.core/quote" || canon === "clojure.core/comment" || (canon === "comment" && !mayShadowComment)) continue
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
        frames.push({ name: symName(n.namedChild(1)) || "unknown", isFn: true })
        pushedFrame = true
      } else if (form === "deftest") {
        frames.push({ name: symName(n.namedChild(1)) || `test_${n.startPosition.row}`, isFn: true })
        pushedFrame = true
      } else if (form === "defmethod") {
        frames.push({ name: symName(n.namedChild(1)) || "unknown", isFn: true })
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
      const isCase = form === "case"
      for (let i = cs.length - 1; i >= 0; i--) {
        if (isCase && i >= 2 && i % 2 === 0 && cs[i].type === "list_lit") continue
        work.push({ n: cs[i], qd })
      }
      continue
    }
    const cs = kids(n)
    for (let i = cs.length - 1; i >= 0; i--) work.push({ n: cs[i], qd })
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
      if (cur.type === "impl_item") {
        const typeNode = cur.childForFieldName?.("type")
        if (!typeNode) return null
        const leaf = String(typeNode.text ?? "").split("<")[0].split("::").filter(Boolean).pop() ?? ""
        return leaf || null
      }
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
        const typeN = n.childForFieldName?.("type")
        if (typeN) declaredTypes.add(typeN.text.split("<")[0].trim())
      }
      for (let k = 0; k < n.namedChildCount; k++) pre.push(n.namedChild(k))
    }
  }

  const stack: any[] = [root]
  const leafOf = (fn: any): string | undefined => {
    if (!fn) return undefined
    if (fn.type === "identifier") return fn.text
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
        if (t2 === "Self") t2 = enclosingImplType(n) ?? "Self"
        if (/^[A-Z]/.test(t2) && !seenCalls.has("struct:" + t2)) {
          seenCalls.add("struct:" + t2)
          edges.push({ label: "instantiates", from: "(expr)", target: t2 })
        }
      }
    } else if (n.type === "impl_item") {
      const traitN = n.childForFieldName?.("trait")
      const typeN = n.childForFieldName?.("type")
      if (traitN && typeN) {
        const tName = lastSegment(typeN.text.split("<")[0].trim())
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

// Independent oracle: derive extends/implements/instantiates edges straight
// from clause node structure — no analyzer code involved.
export function deriveTreeEdges(root: any, lang: string): TreeEdge[] {
  const edges: TreeEdge[] = []
  const TYPE = /type_identifier|scoped_type_identifier|generic_type|^identifier$/
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
      const bAvg = baseline[l]?.perf?.avgMsPerFile
      const cAvg = current[l]?.perf?.avgMsPerFile
      if (bAvg && cAvg && cAvg > Math.max(3 * bAvg, bAvg + 50)) {
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
          perfRegressions.push(`${l}: outlier vs median (${cAvg}ms vs ${median}ms median)`)
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
  return { comparable, regressions, perfRegressions, resampled: [...resampled], unpinnedLanes, checks }
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

  // Two-corpus gate: active repos = primary set ∪ second-corpus set.
  const activeRepos = REPO ? [REPO] : [...new Set([...Object.values(LANG_REPOS), ...Object.values(SECOND_CORPUS)])]
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
      if (files.length > 4000) return
      let entries
      try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (!/^(\.|node_modules|build|target)/.test(e.name)) scan(p) }
        else if (cfg.ext.split(",").some((x: string) => e.name.endsWith("." + x))) files.push(p)
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
    const pool = coldPoolPick(files, SAMPLE_PER_LANG, `${langRepo}:${lang}`)
    const sample = pool.picked
    console.log(`  [cold-pool] ${langRepo}:${lang}: ${pool.coldCount}/${sample.length} fresh (rot ${pool.rotation}, corpus ${pool.total})`)
    let treeEdgesTotal = 0, coveredByAnalyzer = 0, missingInAnalyzer = 0
    let analyzerEdgesTotal = 0, explainableByTree = 0, unexplainedInAnalyzer = 0
    let heuristicUnexplained = 0
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
        //   on:click={inc} / on:click={() => bump()} → handler leaf (0.85)
        //   {@render children(...)}                    → snippet name (0.9)
        // The svelte grammar exposes attribute values as opaque
        // svelte_raw_text leaves, so both are scanned with the analyzer's
        // pure-String contract, mirrored verbatim here.
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
          const handlerLeaf = (text: string): string | undefined => {
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
                if (end < text.length && text[end] === "(") return ident
                i = end
              }
            }
            return isIdent(text) ? text : undefined
          }
          const moduleName = path.basename(relPath, path.extname(relPath))
          const seenRender = new Set<string>()
          const twalk = (n: any): void => {
            const t = n.type
            if (t !== "script_element" && t !== "style_element") {
              if (t === "element" || t === "self_closing_tag") {
                const startTag = n.namedChildren?.find((c: any) => c.type === "start_tag") ?? (t === "self_closing_tag" ? n : undefined)
                if (startTag) {
                  for (const attr of startTag.namedChildren ?? []) {
                    if (attr.type !== "attribute") continue
                    const nameNode = attr.namedChildren?.find((c: any) => c.type === "attribute_name")
                    const attrName = nameNode?.text ?? ""
                    if (!attrName.startsWith("on:")) continue
                    const handler = handlerLeaf(rawText(attr))
                    if (handler && handler !== moduleName && !seenRender.has("h|" + handler)) {
                      seenRender.add("h|" + handler)
                      ;(truth as any[]).push({ label: "calls", from: "(template)", target: handler })
                    }
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
        for (const e of deriveGroovyEdges(root)) {
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
      }
      if (lang === "go") {
        for (const e of deriveGoEdges(root)) {
          ;(truth as any[]).push(e)
        }
        for (const e of deriveGoImplements(root)) {
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
      }))      .filter((r: any) => ["extends", "implements", "instantiates", ...(lang !== "csharp" && lang !== "dart" && lang !== "swift" && lang !== "cpp" ? ["overrides"] : []), ...(lang === "c" || lang === "cpp" || lang === "rust" || lang === "go" || lang === "dart" || lang === "objc" || lang === "php" || lang === "ruby" || lang === "python" || lang === "haskell" || lang === "elixir" || lang === "erlang" || lang === "java" || lang === "kotlin" || lang === "scala" || lang === "groovy" || lang === "typescript" || lang === "vue" || lang === "svelte" || lang === "javascript" || lang === "clojure" ? ["calls"] : []), ...(lang === "zig" || lang === "swift" || lang === "objc" || lang === "php" || lang === "python" || lang === "c" || lang === "cpp" ? ["calls", "uses"] : []), ...(lang === "c" ? ["references"] : []), ...(lang === "dart" || lang === "ruby" || lang === "javascript" || lang === "groovy" ? ["uses"] : []), ...(lang === "csharp" ? ["calls"] : []), ...(lang === "swift" || lang === "objc" || lang === "php" || lang === "python" || lang === "elixir" || lang === "clojure" ? ["references"] : [])].includes(r.label))
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
      },
      // M49 G5: identity of the drawn file set, so the baseline gate can tell
      // "same sample, counts grew" (regression) from "different sample"
      // (resampled — triage). See sampleSetHash().
      sampleSetHash: sampleSetHash(sample.map((f: any) => path.relative(repoDir, f))),
      samples,
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
  const BASELINE = path.join(ROOT, "validation", "m14", "differential-baseline.json")
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
    perf: { avgMsPerFile: r.perf.avgMsPerFile },
    sampleHash: r.sampleSetHash,
  }
  const currentSecond: Record<string, any> = {}
  for (const [key, r] of Object.entries<any>(reportSecond)) currentSecond[key] = {
    missing: r.missingInAnalyzer, unexplained: r.unexplainedInAnalyzer,
    heuristic: r.heuristicUnexplained,
    perf: { avgMsPerFile: r.perf.avgMsPerFile },
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
  const SCOPED_RUN = !!REPO || process.argv.includes("--sample")
  if (SCOPED_RUN) {
    const measured = Object.keys(report).length + Object.keys(reportSecond).length
    console.log(
      `probe run (${REPO ? `--repo ${REPO}` : "--sample"}): measured ${measured} lane(s) — M14.0.F5 NOT written. `
      + `The artifact belongs to the canonical ${SAMPLE_PER_LANG}-file, ${Object.keys(LANGS).length}-language sweep; `
      + `a scoped run is for inspecting lanes, and writing it here would replace that claim with a smaller one.`,
    )
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
    ],
    data: {
      corpusPins: repoPins,
      // M49 W16: the code the rows describe. `clean: false` means the numbers
      // above belong to uncommitted code and name no commit.
      codeInputs,
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
  if (updateBaseline) {
    const previous = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : {}
    // Merge BOTH lanes (primary + second) into the repo:lang baseline file.
    const clean: Record<string, any> = {}
    const hashes: Record<string, string> = { ...(previous.hashes ?? {}) }
    for (const [k, v] of Object.entries<any>({ ...current, ...currentSecond })) {
      clean[k] = { missing: v.missing, unexplained: v.unexplained, heuristic: v.heuristic, perf: v.perf }
      // M49 G5: pin WHICH files produced this row. Without it a later rotation
      // is scored against a different sample and mislabelled a regression.
      if (v.sampleHash) { clean[k].sampleSetHash = v.sampleHash; hashes[k] = v.sampleHash }
    }
    const merged = {
      samplePerLang: SAMPLE_PER_LANG,
      counts: { ...(previous.counts ?? previous), ...clean },
      hashes,
    }
    fs.writeFileSync(BASELINE, JSON.stringify(merged, null, 2) + "\n")
    console.log(`differential baseline updated (primary + second lanes): ${Object.keys(clean).length} lane(s); drawn file sets pinned: ${Object.keys(hashes).length}`)
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
    if (evaluation.regressions.length || evaluation.perfRegressions.length || evaluationSecond.regressions.length || evaluationSecond.perfRegressions.length) process.exit(5)
    console.log(`differential baseline gate: no regressions on a pinned file set (primary + second corpus); perf budgets respected${resampledLanes.length ? `; ${resampledLanes.length} lane(s) resampled (triage)` : ""}`)
  }
}

if (process.argv[1]?.endsWith("differential.ts")) {
  main().catch(e => { console.error(e); process.exit(1) })
}
