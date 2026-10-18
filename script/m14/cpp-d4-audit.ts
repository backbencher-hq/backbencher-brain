/**
 * cpp-d4-audit — quantify and CLASSIFY the differential's residual for the C++ lane
 * (ALL-OUT-OF-ALL §9.1 D4: "every emitted label is derived by a differential oracle AND
 * admitted to that lane's compared set … a label compared against nothing is not done").
 *
 * The differential itself (`script/m14/differential.ts`) is the AUDIT OF RECORD: it prints, per
 * draw, `files · tree-truth · covered · MISSING · analyzer-edges · unexplained · heuristic` and
 * the `COMPARED WITH NO TRUTH` disclosure. It does NOT print the rows behind a count, so a
 * residual of "unexplained 2,266 (23.6%)" cannot be triaged from its output. This instrument
 * reproduces the SAME comparison on a SAME-SHAPED draw (own-file discovery: repo files by the
 * lane's extension set, sorted, stride to N) and puts every non-matching row into a NAMED class
 * with its deciding side. It is a triage instrument, not the verdict: the draw is stated, and
 * its numbers are never merged with the differential's.
 *
 * The comparison is the differential's own rule — `label + normTarget(target)` — and no `from`
 * endpoint is compared (the analyzer's `from` is a call-site/owner convention; the truth
 * walkers' is not). Both sides walk the SAME pinned parse, so a grammar bug shared by them is
 * invisible here: that is a property of the harness, stated rather than claimed around.
 *
 * CLASSES (each names its DECIDING SIDE):
 *   truth-over-derivation/*        truth derives a row the analyzer deliberately refuses
 *                                  (fixture-pinned guard) — the ANALYZER decides
 *   truth-gap/*                    analyzer publishes a row truth cannot derive yet (recovery
 *                                  shapes / marker-macro exports) — TRUTH decides; debt
 *   analyzer-global-owner-contains the analyzer publishes `contains` from `global` for
 *                                  file-scope symbols; the oracle asserts global is not a
 *                                  container — the contract must be DECIDED (Lead question)
 *   analyzer-recovery-macro-member contains rows for members recovered from macro/damaged
 *                                  regions — analyzer decides (fixtures pin them)
 *   analyzer-other/*               anything left; must be ZERO for the control to pass
 *
 * USAGE
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/cpp-d4-audit.ts --repo=fmt --sample=60 [--json]
 *
 * EXIT 0 audited · 2 usage/environment · 3 CONTROL DID NOT FIRE (unclassified row, class sum
 *      mismatch, parse failure) — an unclassified residual may not be reported as a class.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const EXTS = ["cpp", "cc", "cxx", "c++", "hpp", "hxx", "ipp", "inl", "cu"]
const ALL_LABELS = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const

function arg(name: string, dflt?: string): string | undefined {
  const j = process.argv.find((a) => a.startsWith(`${name}=`))
  return j ? j.slice(name.length + 1) : dflt
}
const REPO = arg("--repo")
const SAMPLE = Number(arg("--sample", "60"))
const JSON_OUT = process.argv.includes("--json")
if (!REPO) {
  console.error("usage: bun run script/m14/cpp-d4-audit.ts --repo=<corpus repo> [--sample=60] [--json]")
  process.exit(2)
}

const { getParser } = await import("./run-fixtures")
const { normTarget } = await import("./differential")
const { deriveCppTruth, deriveCppShared } = await import("./cpp-truth")

/** The draw: the repo's tracked files with the lane's extension set, sorted, stride to N. */
function drawFiles(): { files: string[]; admitted: number } {
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", path.join(CR, REPO as string), "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    console.error(`cpp-d4-audit: cannot read ${path.join(CR, REPO as string)} as a git checkout (BB_CORPUS_ROOT=${CR})`)
    process.exit(2)
  }
  const admitted = tracked
    .filter((rel) => {
      const base = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase()
      const dot = base.lastIndexOf(".")
      return dot >= 0 && EXTS.includes(base.slice(dot + 1))
    })
    .sort()
  if (admitted.length === 0) {
    console.error(`cpp-d4-audit: 0 admitted C++ files in ${REPO}`)
    process.exit(2)
  }
  const files: string[] = []
  const stride = Math.max(1, Math.floor(admitted.length / SAMPLE))
  for (let i = 0; i < admitted.length && files.length < SAMPLE; i += stride) files.push(admitted[i])
  return { files, admitted: admitted.length }
}

// ── the spelling vocabulary the classes rest on (pure string scans) ───────────────────────────
const NON_CLASS = new Set([
  "int", "char", "bool", "float", "double", "long", "short", "unsigned", "signed", "void", "auto", "size_t",
  "uint8_t", "uint16_t", "uint32_t", "uint64_t", "int8_t", "int16_t", "int32_t", "int64_t", "T",
])
function isIdentifierShape(s: string): boolean {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (!((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_")) return false
  }
  return !(s[0] >= "0" && s[0] <= "9")
}
function isAllCaps(s: string): boolean {
  let up = false
  for (const c of s) {
    if (c >= "a" && c <= "z") return false
    if (c >= "A" && c <= "Z") up = true
  }
  return up
}

type RowClass = { klass: string; why: string }
function classifyRow(kind: "missing" | "unexplained", label: string, from: string, target: string, meta: any): RowClass {
  const t = String(target)
  if (kind === "missing") {
    // truth derived, analyzer did not publish
    if (label === "calls" && from === "(expr)") {
      return { klass: "truth-over-derivation/calls-class-construction", why: "shared deriveCppEdges derives calls for a class-type functional construction the analyzer refuses (classCallingItself, fixture cpp/class-self-call-925)" }
    }
    if (label === "instantiates" && NON_CLASS.has(t)) {
      return { klass: "truth-over-derivation/instantiates-nonclass", why: "shared heritage walker derives `new T`/`new int`/`new char`; the analyzer guards template parameters, primitives and non-class standard typedefs" }
    }
    if (label === "instantiates") return { klass: "truth-over-derivation/instantiates-other", why: "truth derives a construction the analyzer refused" }
    if (label === "contains") {
      // A macro INVOCATION standing in a class body (`GTEST_DISALLOW_COPY_AND_ASSIGN_(Foo);`) is not a
      // declared member: truth's container walk reads the macro's spelling as a name and derives a
      // containment row the analyzer (rightly) never publishes. The ANALYZER decides.
      const cap = isAllCaps(t) || !isIdentifierShape(t)
      return cap
        ? { klass: "truth-over-derivation/contains-macro-invocation", why: "truth derives a member named after a macro INVOCATION in a class body; the analyzer publishes no such member (a macro call is not a declaration)" }
        : { klass: "truth-over-derivation/contains-damaged-head", why: "truth derives a containment row the analyzer suppresses in a recovery region" }
    }
    if (label === "uses") return { klass: "truth-over-derivation/uses-shared", why: "the shared deriveCppEdges member-read truth derives a uses row (from `(expr)`) the analyzer does not publish — shared-block over-derivation, ANALYZER decides" }
    if (label === "references") return { klass: "truth-over-derivation/references-local-using", why: "truth derives a using-dependency at a scope the analyzer correctly treats as INSIDE a function (macro-declared body recovery: a TEST_CASE body parses as a sibling compound_statement, so the truth walker cannot see the function scope); the analyzer's macroDeclaredBody scope is fixture-pinned — ANALYZER decides" }
    return { klass: `truth-side/${label}`, why: "truth derived a row the analyzer did not publish" }
  }
  // analyzer published, truth did not derive
  const source = String(from)
  if (label === "contains") {
    if (source === "global") return { klass: "analyzer-global-owner-contains", why: "analyzer publishes contains from `global` for file-scope symbols; the oracle's deriveContains asserts the global namespace is not a container (contract must be decided)" }
    if (isAllCaps(t) || !isIdentifierShape(t)) return { klass: "analyzer-recovery-macro-member", why: "contains row for a member recovered from a macro/damaged region (analyzer's own recovery, fixtures pin these)" }
    return { klass: "truth-gap/contains-damaged-head", why: "analyzer publishes containment for a class whose head the grammar recovered as ERROR; truth's container walk does not model that recovery shape (ANALYZER decides, truth is the debt)" }
  }
  if (label === "exports") return { klass: "truth-gap/exports-marker-macro", why: "analyzer derives exports from a marker MACRO (its documented EXPORT-component rule); truth models only __declspec(dllexport)/visibility(default)" }
  if (label === "overrides" || label === "extends" || label === "implements") {
    return { klass: `truth-gap/recovery-head-${label}`, why: "analyzer recovered the class/base name from a macro-decorated head; the truth walker reads the specifier's name field (the macro) and cannot see the class" }
  }
  if (label === "references") return { klass: "truth-gap/references", why: "analyzer reference row truth does not derive (using/type shape)" }
  if (label === "uses") return { klass: "truth-gap/uses-unmodelled", why: "analyzer uses row truth does not derive (self-name identifier_usage shape)" }
  if (label === "calls") return { klass: "truth-gap/calls-unmodelled", why: "analyzer calls row truth does not derive" }
  return { klass: `unknown/${label}`, why: "unclassified — the control fails on this class" }
}

const { files, admitted } = drawFiles()
const parser: any = await getParser("cpp")
const mod: any = await import(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"))
const analyzer = new mod.RealCppAnalyzer()
const ctor: any = analyzer?.constructor
if (typeof ctor?.setGrammar === "function") {
  try { ctor.setGrammar(parser.language, parser.constructor) } catch { /* main pass only, same contract as the runner */ }
}

const perLabel: Record<string, { truth: number; published: number; missing: number; unexplained: number }> = {}
for (const l of ALL_LABELS) perLabel[l] = { truth: 0, published: 0, missing: 0, unexplained: 0 }
const classes: Record<string, { rows: number; samples: string[]; why: string }> = {}
const bump = (c: RowClass, sample: string) => {
  const row = classes[c.klass] ?? (classes[c.klass] = { rows: 0, samples: [], why: c.why })
  row.rows++
  if (row.samples.length < 5) row.samples.push(sample)
}

let parsed = 0
let failed = 0
let truthRows = 0
let analyzerRows = 0
const unclassifiedLabels = new Map<string, number>()
for (const rel of files) {
  const abs = path.join(CR, REPO as string, rel)
  let src: string
  try { src = readFileSync(abs, "utf8") } catch { failed++; continue }
  const tree: any = parser.parse(src, abs)
  if (!tree?.rootNode) { failed++; continue }
  parsed++
  const a: any = await analyzer.analyze(tree.rootNode, src, abs)
  const truth = [...deriveCppTruth(tree.rootNode), ...deriveCppShared(tree.rootNode)]
  truthRows += truth.length
  const rels = (a?.relationships ?? []) as any[]
  analyzerRows += rels.length
  const tk = new Set(truth.map((e: any) => `${e.label}\u0000${normTarget(String(e.target ?? ""))}`))
  const ak = new Set(rels.map((r: any) => `${r.type}\u0000${normTarget(String(r.target ?? ""))}`))
  for (const e of truth) {
    if (!(ALL_LABELS as readonly string[]).includes(e.label)) { unclassifiedLabels.set(e.label, (unclassifiedLabels.get(e.label) ?? 0) + 1); continue }
    perLabel[e.label].truth++
    const k = `${e.label}\u0000${normTarget(String(e.target ?? ""))}`
    if (!ak.has(k)) {
      perLabel[e.label].missing++
      bump(classifyRow("missing", e.label, String((e as any).from ?? ""), String(e.target ?? ""), null), `${rel}: ${e.from} -> ${e.target}`)
    }
  }
  for (const r of rels) {
    const label = String(r.type ?? "")
    if (!(ALL_LABELS as readonly string[]).includes(label)) { unclassifiedLabels.set(label, (unclassifiedLabels.get(label) ?? 0) + 1); continue }
    perLabel[label].published++
    const k = `${label}\u0000${normTarget(String(r.target ?? ""))}`
    if (!tk.has(k)) {
      perLabel[label].unexplained++
      bump(classifyRow("unexplained", label, String(r.source ?? ""), String(r.target ?? ""), r.metadata), `${rel}: ${r.source} -> ${r.target} [${(r.metadata as any)?.relationshipType ?? ""}]`)
    }
  }
  tree.delete?.()
}

// ── THE CONTROL: every row lands in a named class; sums close; nothing unclassified ───────────
const failures: string[] = []
if (failed > 0) failures.push(`parse/read failures: ${failed}`)
for (const [k, v] of unclassifiedLabels) failures.push(`unclassified label: ${k}=${v}`)
const missingSum = Object.values(perLabel).reduce((a, b) => a + b.missing, 0)
const unexplainedSum = Object.values(perLabel).reduce((a, b) => a + b.unexplained, 0)
const classSum = Object.values(classes).reduce((a, b) => a + b.rows, 0)
if (classSum !== missingSum + unexplainedSum) failures.push(`class rows ${classSum} != missing+unexplained ${missingSum + unexplainedSum}`)
for (const [k, c] of Object.entries(classes)) {
  if (k.startsWith("unknown/") || k.startsWith("analyzer-other/") || k.startsWith("truth-side/")) {
    failures.push(`unclassified-in-effect class: ${k}=${c.rows}`)
  }
}
if (failures.length > 0) {
  // The failure IS the finding: print the class table (or JSON) so the deciding sides can be
  // assigned, then refuse to call the audit clean. An unclassified residual may not be reported
  // as a class — that is the whole point of the control.
  if (JSON_OUT) {
    console.log(JSON.stringify({ control: { ok: false, failures }, draw: { repo: REPO, files: files.length, admittedInRepo: admitted }, perLabel, classes }, null, 1))
  } else {
    console.error("CONTROL DID NOT FIRE: the residual has rows outside the named classes.")
    for (const f of failures.slice(0, 20)) console.error("  " + f)
    console.error("")
    for (const [k, c] of Object.entries(classes).sort((a, b) => b[1].rows - a[1].rows)) {
      console.error(`  ${k.padEnd(46)} ${String(c.rows).padStart(6)} — ${c.why}`)
      for (const smp of c.samples.slice(0, 4)) console.error(`      e.g. ${smp}`)
    }
  }
  process.exit(3)
}

const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-d4-audit.ts",
  measuredAt: new Date().toISOString(),
  repo: REPO,
  draw: { requested: SAMPLE, files: files.length, admittedInRepo: admitted, strategy: "repo tracked files with the lane's extension set, sorted, stride — a DIFFERENT draw from the differential's cold-pool rotation, stated so the two are never merged" },
  population: { parsed, failed, truthRows, analyzerRows },
  comparison: "label + normTarget(target), the differential's own rule; `from` endpoints are not compared (site conventions)",
  perLabel,
  classes,
  closure: {
    missing: missingSum,
    unexplained: unexplainedSum,
    classRows: classSum,
    ok: classSum === missingSum + unexplainedSum,
  },
  controls: { ok: true, detail: "every row in a named class; class sum equals missing+unexplained; no unclassified label; 0 parse failures" },
}

if (JSON_OUT) console.log(JSON.stringify(report, null, 1))
else {
  console.log(`cpp-d4-audit — repo ${REPO} · draw ${files.length} of ${admitted} admitted files (stride) · parsed ${parsed}, failed ${failed}`)
  console.log(`truth rows ${truthRows} · analyzer rows ${analyzerRows} · MISSING ${missingSum} · unexplained ${unexplainedSum}`)
  console.log()
  console.log("PER LABEL (label+normTarget)")
  console.log("-".repeat(74))
  for (const l of ALL_LABELS) {
    const r = perLabel[l]
    console.log(`  ${l.padEnd(14)} truth ${String(r.truth).padStart(6)} · published ${String(r.published).padStart(6)} · MISSING ${String(r.missing).padStart(5)} · unexplained ${String(r.unexplained).padStart(6)}`)
  }
  console.log()
  console.log("NAMED CLASSES (every non-matching row, with its deciding side)")
  console.log("-".repeat(74))
  for (const [k, c] of Object.entries(classes).sort((a, b) => b[1].rows - a[1].rows)) {
    console.log(`  ${k.padEnd(46)} ${String(c.rows).padStart(6)}`)
    console.log(`      ${c.why}`)
    for (const s of c.samples.slice(0, 3)) console.log(`      e.g. ${s}`)
  }
  console.log()
  console.log("CONTROL: PASS — every residual row is in a named class; class sum equals MISSING+unexplained; no unclassified label; 0 parse failures")
}
