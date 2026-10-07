/**
 * ERLANG ONTOLOGY CENSUS — JOB 1 of docs/analyzers/ONTOLOGY-WORKSTREAM.md.
 *
 *   bun script/m60/erlang-ontology-census.ts [--sample N] [--out path] [--repos otp,elixir] [--workers N]
 *
 * WHAT IT IS FOR. The workstream asks for one verdict per (analyzer x relationship
 * type), and the verdict must be a MEASUREMENT through the production entry
 * (`src/ast/pool-worker.parseFile`) — not a derivation from the source, which answers
 * only "can it construct it". For the eight types the analyzer already emits it also
 * asks six independent questions, and source derivation answers the first.
 *
 * The shared arbiter, `script/m14/ontology-coverage-gate.ts`, REFUSES TO REPORT for
 * erlang: its `RULED_BY_LANG` table carries an entry for `bash` and `json` only, so the
 * gate exits 2 with "no RULING TABLE for erlang" — correctly, because a gate with an
 * empty table would call every un-emitted type unjustified, which is a verdict about the
 * table and not about the lane. That file is master-owned. So this script does the
 * lane's half of the same measurement over the same corpus without touching it:
 *
 *   1 EMISSION     every one of the gate's ten types, counted through parseFile, with
 *                  the file count and the files themselves. `imports` is counted under
 *                  its ontology name; the enum serializes it `brain_import`
 *                  (src/ast/types.ts:69) and that gap is reported, not silently fixed.
 *   2 THE SIX QUESTIONS, per emitted type:
 *                    a fires?           a count > 0 on real corpus
 *                    b oracle agrees?   a second walker over the SAME grammar — a shared
 *                                        grammar bug is invisible to both, and this says
 *                                        so rather than claiming more than the harness
 *                                        supports
 *                    c labelled right?  the `context`/`exportForm` discriminator each
 *                                        class carries, histogrammed, so a neighbour
 *                                        label would show
 *                    d both ends resolve? every endpoint checked against the symbol set
 *                                        THIS file publishes, with the external class
 *                                        named rather than counted as a pass
 *                    e confident?       the full confidence histogram; anything under 0.7
 *                                        is a heuristic and must say so
 *                    f R7 clean?        no unknown symbol kind, no empty name, no
 *                                        placeholder endpoint (absolute path / sentinel /
 *                                        template literal) on either end of any edge
 *   3 DERIVATION   which emitted types any oracle actually derives. Read from the SOURCE
 *                  (`RelationshipType.X` constructions, and the shared audited-label
 *                  filter EVALUATED as a function), never restated.
 *
 * DETERMINISM — restated 2026-10-04, because the first version of this paragraph was
 * false and the false part was load-bearing.
 *
 * Eight workers parse concurrently (`await Promise.all(Array.from({length: 8}, ...))`), so
 * "the first N examples collected" is a RACE: two runs over the same corpus at the same
 * commit produced different `exampleFiles`, different `examplesSourceOnly`, a different
 * `placeholders.examples` head and a different `symbolSideExamples` head, while every COUNT
 * agreed. A header that claims "two runs agree to the digit" is a claim about the whole
 * artifact, and this one was wrong about the part a reader actually looks at when a number
 * surprises them.
 *
 * So the two are now separated, and the separation is the point:
 *
 *   EVERY COUNT IS DETERMINISTIC. Sorted file list, one parse per file, every file taken
 *   exactly once by a shared cursor, no RNG, no sampling unless `--sample` is passed, and
 *   no clock read inside any count. Re-running reproduces every count to the digit, and
 *   two runs over DIFFERENT analyzer revisions differing only in `exports` is how the stale
 *   evidence described in docs/analyzers/real-erlang-analyzer.md was caught.
 *
 *   EVERY EXAMPLE LIST IS NOW ALSO DETERMINISTIC. Examples are collected unordered and
 *   sorted by (corpus file, line, text) before they are printed, so they name the same
 *   rows in the same order on every run. `exampleFiles` names the first six DISTINCT files
 *   that emitted the type in corpus order, where the previous version printed the file name
 *   once per edge and so repeated one name six times and said nothing about which files.
 *
 * The artifact's `at` field is a timestamp and is expected to differ; it is metadata, not a
 * verdict.
 *
 * READ-ONLY apart from the artifact it writes.
 */

import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const argOf = (n: string, d?: string): string | undefined => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d)
const SAMPLE = Number(argOf("sample", "0"))
const OUT = argOf("out")
const REPOS = (argOf("repos", "otp,elixir")).split(",").map((s) => s.trim()).filter(Boolean)
const ROOT = resolve((import.meta as any).dirname ?? dirname(process.argv[1] ?? "."), "..", "..")

/** The gate's ten types, READ from that file rather than restated. Restating a constant
 *  is how an instrument keeps reporting the old number after the constant changes, so the
 *  value is parsed out of `ontology-coverage-gate.ts` and the source is named in the
 *  output; a literal is only a fallback and says so when it is used. */
const ONTOLOGY_TYPES_FALLBACK = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
function readGateTypes(): { types: string[]; source: string } {
  try {
    const src = readFileSync(join(ROOT, "script", "m14", "ontology-coverage-gate.ts"), "utf8")
    const m = /const ALL_TYPES = \[([^\]]*)\]/.exec(src)
    if (m) {
      const types = [...m[1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!)
      if (types.length === 10) return { types, source: "script/m14/ontology-coverage-gate.ts, read at run time" }
    }
    return { types: ONTOLOGY_TYPES_FALLBACK, source: "FALLBACK literal — the gate's ALL_TYPES did not parse, so these are restated and may have drifted" }
  } catch {
    return { types: ONTOLOGY_TYPES_FALLBACK, source: "FALLBACK literal — the gate file could not be read" }
  }
}
const GATE = readGateTypes()
const ALL_TYPES = GATE.types

/** The enum the ANALYZER actually uses, read from the file it imports
 *  (`ASTEngine` from `./engine`, src/ast/engine.ts:445). Two declarations of
 *  `RelationshipType` exist in this repository and they DISAGREE on one value:
 *
 *      src/ast/engine.ts:454   Imports = "imports"      <- the one the analyzers use
 *      src/ast/types.ts:69     Imports = "brain_import"  <- a divergent copy; `brain_import`
 *                                                                 is a TABLE name, not a
 *                                                                 relationship type
 *
 *  The first version of this census read the mapping off `types.ts` and reported
 *  `imports` as NOT EMITTED on a run where the analyzer had emitted 15 of them — a
 *  confident zero produced by reading the wrong one of two constants. Both are read here
 *  and the divergence is reported, because a reader who has met `types.ts` will meet the
 *  same trap. */
const SERIALIZED: Record<string, string[]> = {}
function readEnum(file: string): string[] {
  try {
    const src = readFileSync(join(ROOT, "src", "ast", file), "utf8")
    const body = src.slice(src.indexOf("export enum RelationshipType"))
    const end = body.indexOf("\n  }")
    return [...new Set([...body.slice(0, end).matchAll(/=\s*"([^"]+)"/g)].map((m) => m[1]!))].sort()
  } catch { return [] }
}
const ENUM_ENGINE = readEnum("engine.ts")
const ENUM_TYPES = readEnum("types.ts")
for (const t of ALL_TYPES) SERIALIZED[t] = [t]
const serialValues = (t: string): string[] => SERIALIZED[t] ?? [t]
const ENUM_DIVERGENCE = ENUM_ENGINE.filter((v) => !ENUM_TYPES.includes(v)).concat(ENUM_TYPES.filter((v) => !ENUM_ENGINE.includes(v)))

// ---------------------------------------------------------------- corpus
type File = { repo: string; abs: string; rel: string }
const files: File[] = []
for (const repo of REPOS) {
  const dir = join(CR, repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked.sort()) {
    if (!rel.endsWith(".erl") && !rel.endsWith(".hrl")) continue
    const abs = join(dir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
      if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "erlang") continue
    } catch { continue }
    files.push({ repo, abs, rel: `${repo}/${rel}` })
  }
}
files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
const revs: Record<string, string> = {}
for (const repo of REPOS) {
  try { revs[repo] = execFileSync("git", ["-C", join(CR, repo), "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { revs[repo] = "unknown" }
}
if (SAMPLE > 0) files.splice(SAMPLE)

// ---------------------------------------------------------------- read the repository, never restate it
/** What `real-erlang-analyzer.ts` can CONSTRUCT — question 1 of the six, read from its
 *  own source. This is the ONLY question source derivation answers. */
function readConstructed(): Set<string> {
  const src = readFileSync(join(ROOT, "src", "ast", "real-erlang-analyzer.ts"), "utf8")
  const member = new Map<string, string>([
    ["Calls", "calls"], ["Extends", "extends"], ["Implements", "implements"], ["Uses", "uses"],
    ["Imports", "imports"], ["Exports", "exports"], ["Contains", "contains"], ["Override", "overrides"],
    ["References", "references"], ["Instantiates", "instantiates"],
  ])
  const out = new Set<string>()
  for (const m of src.matchAll(/RelationshipType\.([A-Za-z]+)/g)) {
    const v = member.get(m[1]!)
    if (v) out.add(v)
  }
  return out
}
const CONSTRUCTED = readConstructed()

/** The shared audited-label filter, EVALUATED rather than restated — the same extraction
 *  `rel-type-coverage-gate.ts` does, so the two cannot disagree. A read failure is an
 *  INPUT ERROR, never an empty set that reads as "this lane audits nothing". */
function readAudited(): { set: Set<string>; error: string | null } {
  try {
    const src = readFileSync(join(ROOT, "script", "m14", "differential.ts"), "utf8")
    const HEAD = '.filter((r: any) => ["extends"'
    const i = src.indexOf(HEAD)
    if (i < 0) return { set: new Set(), error: "no audited-label filter found in differential.ts" }
    const start = i + HEAD.length - '["extends"'.length
    const end = src.indexOf('].includes(r.label)', start)
    if (end < 0) return { set: new Set(), error: "the audited-label filter is unterminated — differential.ts does not parse" }
    const literal = src.slice(start, end + 1).split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "").replace(/\s+\/\/[^\n]*$/, "")).join("\n")
    const vals = new Function("lang", "return " + literal)("erlang") as string[]
    if (!Array.isArray(vals) || vals.length === 0) return { set: new Set(), error: "the audited set evaluated EMPTY" }
    return { set: new Set(vals), error: null }
  } catch (e) {
    return { set: new Set(), error: `audited-label filter does not evaluate: ${e instanceof Error ? e.message : String(e)}` }
  }
}
const AUDITED = readAudited()

/** The labels a derivation CONSTRUCTS, read from its own source rather than declared.
 *
 *  Two ways this was got wrong first, both worth recording because they produced
 *  confident wrong numbers rather than an error:
 *
 *  - MEASURING the label set by running the oracle over a few sample files. A label the
 *    first three files happen not to exercise reads as "this oracle derives nothing",
 *    which is how `uses` and `instantiates` came back as DERIVATION debt on a lane whose
 *    shared audited set already contains them.
 *  - RESTATING the list by hand. Then the list survives the oracle changing.
 *
 *  So the labels are read out of the oracle's own `push("label", …)` calls, and for a
 *  module that exports the set explicitly, out of that export. Both are reads of the
 *  emitter, which is the only thing that can be authoritative about it.
 */
function readPushedLabels(fn: string): string[] {
  const src = readFileSync(join(ROOT, "script", "m14", "differential.ts"), "utf8")
  const start = src.indexOf(`function ${fn}(`)
  if (start < 0) return []
  // to the next top-level `function ` after the body, which is where this one ends.
  const rest = src.slice(start)
  const next = rest.indexOf("\nfunction ", 1)
  const body = next < 0 ? rest : rest.slice(0, next)
  return [...new Set([...body.matchAll(/push\("([a-z_]+)"/g)].map((m) => m[1]!))].sort()
}
function readLabelsOf(moduleFile: string, exportName: string): string[] {
  const src = readFileSync(join(ROOT, "script", "m14", "oracles", `${moduleFile}.ts`), "utf8")
  const m = new RegExp(`export const ${exportName} = \\[([^\\]]*)\\]`).exec(src)
  if (!m) return []
  return [...new Set([...m[1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!))].sort()
}

// ---------------------------------------------------------------- oracles (question b)
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(join(ROOT, "wasm", "tree-sitter-erlang.wasm"))))

let NORM_TARGET: (t: string) => string = (t: string) => t
type Deriver = (root: any) => Array<{ label: string; from: string; target: string }>
type Oracle = { name: string; derive: Deriver; labels: string[]; owner: string }
const ORACLES: Oracle[] = []
{
  // The shared differential's own erlang walkers. A SEPARATE implementation over the SAME
  // grammar, which is exactly the limit the workstream names: a grammar bug both walkers
  // inherit is invisible to this comparison, so the number bounds implementation
  // disagreement and nothing more.
  const diff: any = await import("../../script/m14/differential")
  ORACLES.push({ name: "differential.deriveErlangEdges", derive: diff.deriveErlangEdges, labels: readPushedLabels("deriveErlangEdges"), owner: "shared (master)" })
  // Imported from the LANE's module rather than from `differential.ts`: that file IMPORTS
  // `deriveErlangContainsTruth` (line 55) but does not re-export it, so reading it off the
  // differential's export object yields `undefined` and every invocation then throws. The
  // first version of this script did that and reported `contains` as "truth targets 0,
  // unexplained 3,681" — a confident, entirely false 100%-disagreement number derived
  // from a function that was never called. An oracle that cannot be REACHED is an input
  // error, and it is reported as one.
  const contains: any = await import("../../script/m14/oracles/erlang-contains")
  if (typeof contains?.deriveErlangContainsTruth !== "function") throw new Error("oracles/erlang-contains.ts does not export deriveErlangContainsTruth — the oracle census needs it")
  ORACLES.push({ name: "oracles/erlang-contains", derive: contains.deriveErlangContainsTruth, labels: ["contains"], owner: "lane, imported by the shared harness at differential.ts:55" })
  // The harness matches on `label + normTarget(target)` — the LEAF segment. The first
  // version of this census compared raw targets and reported 25 missing calls and 95
  // unexplained references per 200 files; most of that was `gen_server:call` against a
  // truth row `call`, i.e. the comparison being stricter than the one the lane is graded
  // on. Both are reported: the harness-matched number is comparable with the differential,
  // and the exact number is what a consumer of the raw target would see.
  NORM_TARGET = typeof diff.normTarget === "function" ? diff.normTarget : (t: string) => t
  const oracle: any = await import("../../script/m14/oracles/erlang-exports-imports")
  if (typeof oracle?.deriveErlangExportsTruth !== "function") throw new Error("oracles/erlang-exports-imports.ts does not export deriveErlangExportsTruth")
  ORACLES.push({ name: "oracles/erlang-exports-imports", derive: oracle.deriveErlangExportsTruth, labels: readLabelsOf("erlang-exports-imports", "ERLANG_ORACLE_LABELS"), owner: "lane (new this wave)" })
}
const LANE_ORACLE_LABELS = new Set(ORACLES.filter((o) => o.owner.startsWith("lane")).flatMap((o) => o.labels))
const ORACLE_LABELS = new Set(ORACLES.flatMap((o) => o.labels))

// ---------------------------------------------------------------- census
type Edge = { t: string; from: string; target: string; conf: number; line: number | undefined; meta: Record<string, any> }
type Bucket = {
  n: number
  files: Set<string>
  confHist: Map<number, number>
  below07: number
  noLine: number
  /** Every file that emitted this type, keyed by the file's CORPUS position (see
   *  FILE_ORDER), so the reported order does not depend on which worker saw it first. */
  exFiles: Map<string, number>
  disc: Map<string, number>
  resolve: { both: number; srcOnly: number; tgtOnly: number; neither: number; exSrcOnly: { file: string; line: number; text: string }[] }
}
const buckets = new Map<string, Bucket>()
for (const t of ALL_TYPES) buckets.set(t, { n: 0, files: new Set(), confHist: new Map(), below07: 0, noLine: 0, exFiles: new Map(), disc: new Map(), resolve: { both: 0, srcOnly: 0, tgtOnly: 0, neither: 0, exSrcOnly: [] } })

/** The corpus position of each file. `files` is sorted before any worker starts, so this
 *  is a property of the CORPUS and not of the schedule — which is what an example list has
 *  to be sorted by to be reproducible. An insertion counter is not: it records which worker
 *  got there first. */
const FILE_ORDER = new Map(files.map((f, i) => [f.rel, i]))

/** Sort an example list by the corpus file it came from, then by line, then by text.
 *  The workers run concurrently (8 of them), so "the first N seen" is a race — see
 *  DETERMINISM in this file's header. Sorting by a key that is a property of the CORPUS
 *  rather than of the schedule is what makes an example list a measurement. */
const byCorpusOrder = <T extends { file: string; line?: number; text?: string }>(a: T, b: T): number =>
  a.file < b.file ? -1 : a.file > b.file ? 1 : (a.line ?? 0) - (b.line ?? 0) || String(a.text ?? "").localeCompare(String(b.text ?? ""))
const topFiles = (m: Map<string, number>, n: number): string[] => [...m.entries()].sort((a, b) => a[1] - b[1]).slice(0, n).map((e) => e[0])

const KIND_VALUES = new Set([
  "module", "class", "interface", "function", "method", "property", "variable", "constant",
  "type", "enum", "struct", "macro", "field", "parameter", "namespace", "trait", "record",
  "object", "constructor", "event", "decorator", "annotation", "alias", "union", "file",
  "package", "protocol", "extension", "template", "concept", "operator", "label", "closure",
])
const unknownKinds = new Map<string, number>()
const symPlaceholders: Record<string, number> = {}
const symPhExAll: { file: string; line: number; text: string }[] = []
let symbols = 0, rels = 0, errFiles = 0, crashFiles = 0, unknownKind = 0, emptyName = 0, ownerless = 0
const rawTypeValues = new Map<string, number>()

/** R7: a placeholder endpoint. An absolute checkout path, a sentinel, a template literal,
 *  an empty name, or a Windows path. The absolute-path class is the one this lane has
 *  already been bitten by — ER-D32's three file-level sites used to fall back to the FILE
 *  PATH, hanging 290 headers' edges off an absolute checkout path — so it is named
 *  explicitly rather than folded into a "looks suspicious" heuristic. */
const PLACEHOLDER = (s: string): string | null => {
  if (s.length === 0) return "empty"
  if (s.startsWith("/")) return "absolute-path"
  if (/^[A-Za-z]:[\\/]/.test(s) || s.includes("\\")) return "windows-path"
  if (/^(unknown|anonymous|<anonymous>|\?\?|TODO|UNKNOWN)$/i.test(s)) return "sentinel"
  if (/^\{\{|\$\{|<%|<#/.test(s)) return "template-literal"
  return null
}
type Place = { kind: string; type: string; where: string; value: string; file: string }
const placeholders: Place[] = []

type Agg = { truth: Set<string>; analyzer: Set<string>; missing: number; unexplained: number; exMissing: string[]; exUnexplained: string[] }
const agg = new Map<string, Agg>()
/** The harness rule: coverage matched on `label + normTarget(target)`, which is what
 *  `script/m14/differential.ts` grades on. */
type Harness = { truth: number; covered: number; missing: number; unexplained: number; exMissing: string[]; exUnexplained: string[] }
const harness = new Map<string, Harness>()
const perFileRows = new Map<string, Edge[]>()
const AGG_TYPES = ALL_TYPES.filter((t) => ORACLE_LABELS.has(t))
const aggFor = (t: string): Agg => {
  const a = agg.get(t) ?? { truth: new Set(), analyzer: new Set(), missing: 0, unexplained: 0, exMissing: [], exUnexplained: [] }
  agg.set(t, a)
  return a
}

let idx = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try { r = await parseFile(f.abs, f.repo) } catch { crashFiles++; continue }
    const syms: any[] = r?.symbols ?? []
    const names = new Set<string>()
    symbols += syms.length
    for (const s of syms) {
      const nm = String(s?.name ?? "")
      if (!nm) emptyName++
      else names.add(nm)
      const kind = String(s?.kind ?? "")
      if (!KIND_VALUES.has(kind)) { unknownKind++; unknownKinds.set(kind, (unknownKinds.get(kind) ?? 0) + 1) }
      if (nm && !s?.ownerName && kind !== "module" && kind !== "file" && kind !== "namespace") ownerless++
      // R7 on the SYMBOL side. A `contains` edge whose SOURCE is an absolute checkout path
      // is the same finding seen from the other end, and ER-D32 decided that a module-less
      // file owns its declarations under the FILE PATH — which `parseFile` supplies
      // absolute. The relationship endpoint and the ownerName are therefore the same
      // defect seen twice, and counting both is what makes the class's size visible.
      if (nm) {
        const ph = PLACEHOLDER(String(s?.ownerName ?? ""))
        if (ph) { const k2 = `ownerName:${ph}`; symPlaceholders[k2] = (symPlaceholders[k2] ?? 0) + 1; symPhExAll.push({ file: f.rel, line: s?.range?.startLine ?? 0, text: `${kind} ${nm} ownerName=${String(s?.ownerName).slice(0, 90)}` }) }
        const phName = PLACEHOLDER(nm)
        if (phName) { const k3 = `name:${phName}`; symPlaceholders[k3] = (symPlaceholders[k3] ?? 0) + 1 }
      }
    }
    if ((r?.errors ?? []).length) errFiles++
    const rows: Edge[] = []
    for (const x of r?.relationships ?? []) {
      rels++
      const raw = String(x.type ?? x.relationshipType ?? "")
      rawTypeValues.set(raw, (rawTypeValues.get(raw) ?? 0) + 1)
      const t = ALL_TYPES.find((k) => serialValues(k).includes(raw))
      if (!t) continue
      const e: Edge = {
        t,
        from: String(x.source ?? ""),
        target: String(x.target ?? ""),
        conf: typeof x.confidence === "number" ? x.confidence : -1,
        line: typeof x.line_number === "number" ? x.line_number : undefined,
        meta: (x.metadata as any) ?? {},
      }
      rows.push(e)
      const b = buckets.get(t)!
      b.n++
      b.files.add(f.rel)
      if (!b.exFiles.has(f.rel)) b.exFiles.set(f.rel, FILE_ORDER.get(f.rel) ?? Number.MAX_SAFE_INTEGER)
      b.confHist.set(e.conf, (b.confHist.get(e.conf) ?? 0) + 1)
      if (e.conf >= 0 && e.conf < 0.7) b.below07++
      if (typeof e.line !== "number" || e.line <= 0) b.noLine++
      const disc = String(e.meta.context ?? e.meta.exportForm ?? e.meta.overrideForm ?? "(none)")
      b.disc.set(disc, (b.disc.get(disc) ?? 0) + 1)
      const pf = PLACEHOLDER(e.from)
      if (pf) placeholders.push({ kind: `source:${pf}`, type: t, where: "source", value: e.from.slice(0, 90), file: f.rel })
      const pt = PLACEHOLDER(e.target)
      if (pt) placeholders.push({ kind: `target:${pt}`, type: t, where: "target", value: e.target.slice(0, 90), file: f.rel })
      // Resolution: does the endpoint bind to a symbol THIS file publishes? An endpoint
      // naming a module or a type from ANOTHER file cannot bind here and is not a defect,
      // so it is its own class rather than counted as either resolved or failed.
      const fromOk = names.has(e.from)
      const leaf = e.target.includes(":") ? e.target.slice(0, e.target.indexOf(":")) : e.target
      const tgtOk = names.has(e.target) || names.has(leaf)
      if (fromOk && tgtOk) b.resolve.both++
      else if (fromOk) { b.resolve.srcOnly++; b.resolve.exSrcOnly.push({ file: f.rel, line: e.line ?? 0, text: `${e.from} -> ${e.target}` }) }
      else if (tgtOk) b.resolve.tgtOnly++
      else b.resolve.neither++
      if (AGG_TYPES.includes(t)) aggFor(t).analyzer.add(e.target)
    }
    perFileRows.set(f.rel, rows)
  }
}
// Worker count is an ARGUMENT, not a constant. Eight concurrent `parseFile` calls each
// hold their own tree-sitter WASM instance, and on a host with a few GB of free memory
// the instrument died with `memory access out of bounds` on a DIFFERENT file on each run
// (measured 2026-10-04: `ct_testspec_1_SUITE_data/suites_1/simple_1_SUITE.erl` then
// `small_SUITE_data/src/refine_bug1.erl` then `refine_failing.erl`) — the signature of a
// resource ceiling, not of a file-specific grammar fault, since a fault in the grammar
// names the same file every time. Reducing the width does not change any COUNT: every
// file is still taken exactly once by the shared cursor, and the counts are summed.
const WORKERS = (() => {
  const i = process.argv.indexOf("--workers")
  const raw = i >= 0 ? Number(process.argv[i + 1]) : 8
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 8
})()
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

// ---- oracle agreement, per file, over the same trees. Matching is on (label, target)
// ONLY, which is what the shared harness does: the source end is the analyzer's own
// ownership decision (a module-less file attributes its edges to its path, ER-D32) and
// comparing it would manufacture a disagreement over a question nobody asked.
{
  const oracleErrors: string[] = []
  for (const f of files) {
    const tree = parser.parse(readFileSync(f.abs, "utf8"))
    if (!tree) continue
    const truthByLabel = new Map<string, Set<string>>()
    for (const o of ORACLES) {
      let out: any[] = []
      try { out = o.derive(tree.rootNode) ?? [] } catch (e) { oracleErrors.push(`${o.name} on ${f.rel}: ${e instanceof Error ? e.message : String(e)}`); continue }
      for (const e of out) {
        const t = String(e.label ?? "")
        if (!AGG_TYPES.includes(t)) continue
        const s = truthByLabel.get(t) ?? new Set<string>()
        s.add(String(e.target ?? ""))
        truthByLabel.set(t, s)
      }
    }
    const gotByLabel = new Map<string, Set<string>>()
    for (const e of perFileRows.get(f.rel) ?? []) {
      if (!AGG_TYPES.includes(e.t)) continue
      const s = gotByLabel.get(e.t) ?? new Set<string>()
      s.add(e.target)
      gotByLabel.set(e.t, s)
    }
    for (const t of AGG_TYPES) {
      const a = aggFor(t)
      const truth = truthByLabel.get(t) ?? new Set<string>()
      const got = gotByLabel.get(t) ?? new Set<string>()
      for (const k of truth) a.truth.add(k)
      for (const k of truth) if (!got.has(k)) { a.missing++; if (a.exMissing.length < 12) a.exMissing.push(`${f.rel}: ${k}`) }
      for (const k of got) if (!truth.has(k)) { a.unexplained++; if (a.exUnexplained.length < 12) a.exUnexplained.push(`${f.rel}: ${k}`) }
      // The harness rule: `label + normTarget(target)`.
      const truthN = new Set([...truth].map(NORM_TARGET))
      const gotN = new Set([...got].map(NORM_TARGET))
      const h = harness.get(t) ?? { truth: 0, covered: 0, missing: 0, unexplained: 0, exMissing: [], exUnexplained: [] }
      for (const k of truthN) { h.truth++; if (!gotN.has(k)) { h.missing++; if (h.exMissing.length < 12) h.exMissing.push(`${f.rel}: ${k}`) } else h.covered++ }
      for (const k of gotN) if (!truthN.has(k)) { h.unexplained++; if (h.exUnexplained.length < 12) h.exUnexplained.push(`${f.rel}: ${k}`) }
      harness.set(t, h)
    }
    tree.delete?.()
  }
  for (const e of oracleErrors.slice(0, 5)) console.log(`  ORACLE INPUT ERROR ${e}`)
  if (oracleErrors.length) console.log(`  ${oracleErrors.length} oracle invocations failed — the agreement numbers below UNDERSTATE what was compared`)
}

// ---------------------------------------------------------------- report
const w = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)
const emitted = ALL_TYPES.filter((t) => (buckets.get(t)?.n ?? 0) > 0)
const notEmitted = ALL_TYPES.filter((t) => (buckets.get(t)?.n ?? 0) === 0)

console.log("=".repeat(104))
console.log("ERLANG ONTOLOGY CENSUS")
console.log("=".repeat(104))
console.log(`ontology types read from ${GATE.source}`)
console.log(`corpus ${files.length} admitted .erl/.hrl files over ${REPOS.join(" + ")} (sorted, one parse each, ${SAMPLE > 0 ? `SAMPLED to ${SAMPLE}` : "no sampling"})`)
for (const r of REPOS) console.log(`  ${r}@${revs[r]}`)
console.log(`enum values in src/ast/engine.ts (the one the analyzer imports): ${ENUM_ENGINE.length} — ${ENUM_ENGINE.join(", ")}`)
console.log(`enum values in src/ast/types.ts (a second declaration): ${ENUM_TYPES.length} — ${ENUM_TYPES.join(", ")}`)
console.log(`values the two declarations disagree on: ${ENUM_DIVERGENCE.length ? ENUM_DIVERGENCE.join(", ") : "none"}`)
console.log(`serialized values mapped for this census: ${JSON.stringify(SERIALIZED)}`)

console.log("\n--- PRODUCTION ENTRY (src/ast/pool-worker.parseFile) ---")
console.log(`symbols ${symbols.toLocaleString()}   relationships ${rels.toLocaleString()}   grammar-error files ${errFiles}   crash files ${crashFiles}`)
console.log(`unknown symbol kinds ${unknownKind}   empty names ${emptyName}   ownerless members ${ownerless}`)
console.log(`symbol-side placeholder fields (R7): ${Object.entries(symPlaceholders).map(([k, v]) => `${k}=${v}`).join("  ") || "none"}`)
const symPhEx = symPhExAll.slice().sort(byCorpusOrder).slice(0, 6)
if (symPhEx.length) console.log(`  e.g. ${symPhEx[0]!.file}: ${symPhEx[0]!.text}`)
if (unknownKinds.size) console.log(`  unknown kind values: ${JSON.stringify([...unknownKinds])}`)
console.log(`raw serialized relationship-type values: ${[...rawTypeValues].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ")}`)

console.log("\n--- 1. PER-TYPE VERDICT ---")
console.log(`${w("type", 14)}${w("verdict", 12)}${w("count", 12)}${w("files", 8)}${w("conf<0.7", 9)}${w("no line", 8)}confidence histogram`)
for (const t of ALL_TYPES) {
  const b = buckets.get(t)!
  const hist = [...b.confHist].sort((a, c) => a[0] - c[0]).map(([c, n]) => `${c}:${n}`).join(" ")
  console.log(`${w(t, 14)}${w(b.n > 0 ? "EMITTED" : "NOT EMITTED", 12)}${w(b.n.toLocaleString(), 12)}${w(String(b.files.size), 8)}${w(String(b.below07), 9)}${w(String(b.noLine), 8)}${hist}`)
  const exFilesSorted = topFiles(b.exFiles, 6)
  if (exFilesSorted.length) console.log(`${" ".repeat(14)}files e.g. ${exFilesSorted.slice(0, 3).join(", ")}`)
}
console.log(`\nemitted ${emitted.length}/10: ${emitted.join(", ")}`)
console.log(`not emitted ${notEmitted.length}/10: ${notEmitted.join(", ")}`)
for (const t of notEmitted) console.log(`  ${t}: constructed in the analyzer's source? ${CONSTRUCTED.has(t) ? "YES — a branch that never fires (dead code, and derivation could not have seen it)" : "no"}`)

console.log("\n--- 2. THE SIX QUESTIONS, PER EMITTED TYPE ---")
console.log("\n2a FIRES — a non-zero count from the production entry above, over real corpus files.")
for (const t of emitted) console.log(`  ${w(t, 12)}${buckets.get(t)!.n.toLocaleString()} edges across ${buckets.get(t)!.files.size} files`)
console.log("\n2b ORACLE AGREES — a SECOND walker over the SAME grammar. A grammar bug both")
console.log("    walkers inherit is invisible to this comparison BY CONSTRUCTION, so these")
console.log("    numbers bound implementation disagreement, not correctness.")
console.log(`  oracles run: ${ORACLES.map((o) => `${o.name} [${o.owner}]`).join("   |   ")}`)
for (const t of emitted) {
  const a = agg.get(t)
  if (!a) { console.log(`  ${w(t, 12)}NO ORACLE DERIVES THIS LABEL — DERIVATION debt`); continue }
  const cov = a.truth.size === 0 ? "n/a" : `${((100 * (a.truth.size - a.missing)) / a.truth.size).toFixed(2)}%`
  const h = harness.get(t)
  const hcov = !h || h.truth === 0 ? "n/a" : `${((100 * h.covered) / h.truth).toFixed(2)}%`
  console.log(`  ${w(t, 12)}EXACT target: truth ${w(a.truth.size.toLocaleString(), 10)}analyzer ${w(a.analyzer.size.toLocaleString(), 10)}MISSING ${w(String(a.missing), 7)}unexplained ${w(String(a.unexplained), 7)}coverage ${cov}`)
  console.log(`  ${" ".repeat(12)}HARNESS rule (normTarget): truth ${w(String(h?.truth ?? 0), 10)}covered ${w(String(h?.covered ?? 0), 10)}MISSING ${w(String(h?.missing ?? 0), 7)}unexplained ${w(String(h?.unexplained ?? 0), 7)}coverage ${hcov}`)
  if (a.exMissing.length) { console.log(`      MISSING e.g.`); for (const x of a.exMissing.slice(0, 4)) console.log(`        ${x}`) }
  if (a.exUnexplained.length) { console.log(`      unexplained e.g.`); for (const x of a.exUnexplained.slice(0, 4)) console.log(`        ${x}`) }
}
console.log("\n2c LABELLED — the metadata discriminator each class carries, histogrammed. A class")
console.log("    with two discriminators has two shapes; a class with `(none)` gives a consumer")
console.log("    no way to tell its rows apart.")
for (const t of emitted) {
  const b = buckets.get(t)!
  console.log(`  ${w(t, 12)}${[...b.disc].sort((a, c) => c[1] - a[1]).map(([k, n]) => `${k}=${n}`).join("  ")}`)
}
console.log("\n2d RESOLVED — does each endpoint bind to a symbol THIS file publishes? An endpoint")
console.log("    naming a module or a type declared in ANOTHER file is a real edge that cannot")
console.log("    bind here, so it is named as its own class, not counted as a pass or a failure.")
for (const t of emitted) {
  const b = buckets.get(t)!
  const tot = b.resolve.both + b.resolve.srcOnly + b.resolve.tgtOnly + b.resolve.neither
  console.log(`  ${w(t, 12)}both ${w(String(b.resolve.both), 11)}(${((100 * b.resolve.both) / Math.max(1, tot)).toFixed(1)}%)   source-only (external target) ${w(String(b.resolve.srcOnly), 11)}   target-only ${w(String(b.resolve.tgtOnly), 8)}   neither ${b.resolve.neither}`)
  const exSrcSorted = b.resolve.exSrcOnly.slice().sort(byCorpusOrder)
  if (exSrcSorted.length) console.log(`      source-only e.g. ${exSrcSorted[0]!.file}: ${exSrcSorted[0]!.text}`)
}
console.log("\n2e CONFIDENT — the full histogram is in section 1. A class below 0.7 is a heuristic,")
console.log("    not a fact, and must carry a machine-readable reason code where it is consumed.")
for (const t of emitted) console.log(`  ${w(t, 12)}below 0.7: ${buckets.get(t)!.below07}`)
console.log("\n2f R7 — placeholder endpoints (absolute path / sentinel / template / empty / windows).")
if (placeholders.length === 0) console.log("  0 across every edge of every file")
else {
  const by = new Map<string, number>()
  for (const p of placeholders) by.set(`${p.type}  ${p.kind}`, (by.get(`${p.type}  ${p.kind}`) ?? 0) + 1)
  for (const [k, n] of [...by].sort((a, c) => c[1] - a[1])) console.log(`  ${w(k, 36)}${n}`)
  placeholders.sort((a, b) => byCorpusOrder({ file: a.file, text: `${a.kind}|${a.where}|${a.value}` }, { file: b.file, text: `${b.kind}|${b.where}|${b.value}` }))
  console.log(`  e.g. ${placeholders[0]!.file}: ${placeholders[0]!.where}=${placeholders[0]!.value}`)
}

console.log("\n--- 3. DERIVATION: does an oracle exist for every type the analyzer emits? ---")
console.log(`audited set EVALUATED from script/m14/differential.ts: ${AUDITED.error ? `INPUT ERROR (${AUDITED.error})` : JSON.stringify([...AUDITED.set].sort())}`)
for (const t of ALL_TYPES) {
  const b = buckets.get(t)!
  if (b.n === 0) continue
  const shared = AUDITED.set.has(t)
  const lane = LANE_ORACLE_LABELS.has(t)
  const verdict = shared ? "shared audited set" : lane ? "lane oracle, NOT YET WIRED into differential.ts" : "DERIVATION DEBT — emitted and compared against nothing"
  console.log(`  ${w(t, 12)}${w(b.n.toLocaleString(), 11)}shared ${w(shared ? "yes" : "NO", 4)}  lane ${w(lane ? "yes" : "no", 4)}  ${verdict}`)
}

// ---------------------------------------------------------------- artifact
const out = {
  at: new Date().toISOString(),
  script: "erlang-ontology-census",
  note: "Every number is over every admitted file (or the first --sample of them, sorted), one parse each, through src/ast/pool-worker.parseFile. Deterministic: no RNG, no clock in any verdict.",
  corpus: { root: CR, repos: REPOS, revs, files: files.length, sampled: SAMPLE > 0 ? SAMPLE : null },
  ontologyTypesSource: GATE.source,
  enumValuesEngineTs: ENUM_ENGINE,
  enumValuesTypesTs: ENUM_TYPES,
  enumDeclarationsDivergeOn: ENUM_DIVERGENCE,
  serializedValueMap: SERIALIZED,
  constructedByAnalyzerSource: [...CONSTRUCTED].sort(),
  productionEntry: {
    symbols, relationships: rels, grammarErrorFiles: errFiles, crashFiles,
    unknownKinds: unknownKind, unknownKindValues: Object.fromEntries(unknownKinds),
    emptyNames: emptyName, ownerlessMembers: ownerless,
    rawTypeValues: Object.fromEntries(rawTypeValues),
  },
  perType: Object.fromEntries(ALL_TYPES.map((t) => {
    const b = buckets.get(t)!
    return [t, {
      emitted: b.n > 0,
      count: b.n,
      files: b.files.size,
      exampleFiles: topFiles(b.exFiles, 6),
      confidenceHistogram: Object.fromEntries(b.confHist),
      confidenceBelow07: b.below07,
      edgesWithoutLine: b.noLine,
      discriminatorHistogram: Object.fromEntries(b.disc),
      resolution: {
        both: b.resolve.both,
        sourceOnlyExternalTarget: b.resolve.srcOnly,
        targetOnly: b.resolve.tgtOnly,
        neither: b.resolve.neither,
        examplesSourceOnly: b.resolve.exSrcOnly.slice().sort(byCorpusOrder).slice(0, 4).map((x) => `${x.file}: ${x.text}`),
      },
    }]
  })),
  sixQuestions: Object.fromEntries(emitted.map((t) => {
    const a = agg.get(t)
    const b = buckets.get(t)!
    return [t, {
      aFires: { count: b.n, files: b.files.size },
      bOracleAgrees: a ? {
        limitation: "a second walker over the SAME grammar; a grammar bug both inherit is invisible to this comparison",
        truthTargets: a.truth.size,
        analyzerTargets: a.analyzer.size,
        missing: a.missing,
        unexplained: a.unexplained,
        coveragePct: a.truth.size === 0 ? null : +((100 * (a.truth.size - a.missing)) / a.truth.size).toFixed(2),
        examplesMissing: a.exMissing,
        examplesUnexplained: a.exUnexplained,
        harnessRule: harness.get(t) ?? null,
      } : null,
      cLabelled: Object.fromEntries(b.disc),
      dResolved: {
        both: b.resolve.both,
        srcOnly: b.resolve.srcOnly,
        tgtOnly: b.resolve.tgtOnly,
        neither: b.resolve.neither,
        exSrcOnly: b.resolve.exSrcOnly.slice().sort(byCorpusOrder).slice(0, 4).map((x) => `${x.file}: ${x.text}`),
      },
      eConfident: { histogram: Object.fromEntries(b.confHist), below07: b.below07 },
      fR7: {
        total: placeholders.filter((p) => p.type === t).length,
        byKind: placeholders.filter((p) => p.type === t).reduce((m: any, p) => { m[p.kind] = (m[p.kind] ?? 0) + 1; return m }, {}),
        examples: placeholders.filter((p) => p.type === t).slice(0, 8),
      },
    }]
  })),
  placeholders: { total: placeholders.length, examples: placeholders.slice(0, 20), symbolSide: symPlaceholders, symbolSideExamples: symPhEx.map((x) => `${x.file}: ${x.text}`) },
  harnessRuleTotals: Object.fromEntries(harness),
  derivation: {
    sharedAuditedSet: AUDITED.error ? null : [...AUDITED.set].sort(),
    sharedAuditedSetError: AUDITED.error,
    laneOracleLabels: [...LANE_ORACLE_LABELS].sort(),
    oraclesRun: ORACLES.map((o) => ({ name: o.name, labels: o.labels, owner: o.owner })),
    debt: emitted.filter((t) => !AUDITED.set.has(t) && !LANE_ORACLE_LABELS.has(t)),
    awaitingMasterWiring: emitted.filter((t) => !AUDITED.set.has(t) && LANE_ORACLE_LABELS.has(t)),
  },
}
const outPath = OUT ?? join(ROOT, "validation", "m14", "tmp", "erlang-ontology-census.json")
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`)
console.log(`\nartifact: ${outPath}`)
