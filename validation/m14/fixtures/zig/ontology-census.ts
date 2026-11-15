/**
 * ZIG ONTOLOGY CENSUS — the instrument behind every number in the zig lane's
 * ontology report.
 *
 * ## Why it exists
 *
 * The differential (`script/m14/differential.ts`) compares the analyzer against
 * an oracle. It cannot tell you whether a relationship TYPE EXISTS in the
 * language, because when the implementer ruled a type inapplicable and the
 * oracle was written after that ruling, both say nothing and "nothing" agrees
 * with "nothing". Measuring the LANGUAGE is the only instrument that closes
 * that hole, and this script is the measuring half.
 *
 * ## What it does, and what it deliberately does NOT do
 *
 * It calls the PRODUCTION entry point — `parseFile` from
 * `src/ast/pool-worker.ts` — not `analyze()`. `analyze()` is the per-file unit
 * and skips the pipeline stages (pool-worker, size limits, truncation,
 * enhancements), so a count taken from it is a count of the analyzer, not of the
 * indexer. Every figure here is a count of what the indexer would store.
 *
 * Sampling is DETERMINISTIC and PUBLISHED: files are admitted by the same
 * `git ls-files` walk the coverage gate uses, then ordered by
 * `sha256(<repo>/<rel>)` and the first N taken. A hashed order is not a
 * random sample in the statistical sense, and it is not claimed to be one; it is
 * a reproducible draw whose file set is named by one hash, so a published figure
 * can be reproduced from a clean corpus and re-drawn with `--seed`.
 *
 * ## The tallies (one per question the workstream asks)
 *
 *   - relationship type -> count, files, per-repo counts
 *   - symbol kind -> count, plus any kind outside the shared `SymbolKind`
 *   - symbols with an empty name (standing rule: none)
 *   - relationship endpoints equal to the literal `unknown` (rule R7: none)
 *   - ENDPOINT RESOLUTION per type: an edge can exist and still point at nothing,
 *     so this is measured, not assumed. A `(global)`/`(file)`/`(declared-type)`
 *     source is a SCOPE MARKER, not a symbol, and is counted separately from a
 *     source that fails to resolve — reporting the two as one number would hide
 *     a dangling caller behind a benign convention.
 *   - confidence histogram and the sub-0.7 heuristic count per type
 *   - `metadata.evidenceClass` and `metadata.relationshipType` (the reason code)
 *     histograms per type
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/zig/ontology-census.ts [--sample 400] [--seed s] [--out p] [--repos a,b]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Parser, Language } from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"
import { stripZigQuoting } from "../../../../src/ast/real-zig-analyzer"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

await Parser.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const treeLang: any = await Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-zig.wasm")))
const treeParser = new Parser()
treeParser.setLanguage(treeLang)

/**
 * Z-p22: the GRAMMAR's binding sites per file, as `name -> slot` with the slot
 * ranked `local < parameter < field < decl`.
 *
 * `analyzer-owned-miss-cause.ts` classifies a miss by asking whether the file
 * DECLARES the name the edge targets, and it can only answer that from the tree
 * — `parseFile` publishes what the analyzer chose to publish, so a dropped
 * declaration is invisible in it by construction. This census's raw dump carried
 * no such column, so the ladder had been reading a DIFFERENT instrument
 * generation's dumps for that field (the pass-19 §B defect class: a default that
 * names the wrong data). Emitting it here makes one instrument produce
 * everything the ladder reads.
 *
 * ## All sites, not one per name — the ladder does the reducing
 *
 * The first version kept the HIGHEST-ranked slot per name and emitted one entry.
 * That is the reduction `analyzer-owned-miss-cause.ts` already performs on the
 * way in (`ORD[k] > ORD[prev] ? k : prev`, over every entry), so doing it here
 * threw away the information the comparison needs: a name bound both at
 * declaration scope and inside a function body emitted only `decl`, and the
 * ladder could no longer see that `local` was ever a binding. Diffing against
 * the pass-20c dumps is what showed it — the two columns agreed on 22,401
 * bindings and disagreed on 1,266 slot values, every one of them a name the old
 * column listed under more than one slot.
 *
 * So this emits every `(name, slot)` pair the grammar binds, and the consumer
 * reduces. `ghostty/pkg/fontconfig/lang_set.zig` is the worked example: `create`
 * is `decl`, `self`/`lang` are `parameter`, and `testing` is bound as a
 * declaration at file scope AND as a local in two function bodies.
 *
 * ## Where the two remaining disagreements came from, both measured
 *
 * Diffing against the pass-20c dumps (the last generation carrying
 * `declaredNames`) named 4,670 reduced disagreements, and they had exactly two
 * causes:
 *
 * 1. **THE BINDING IS NOT AT `child(1)` FOR A `pub` DECLARATION.** The pinned
 *    grammar puts `pub` at child 0 for `pub const c = …`, so the identifier is
 *    child **2**; a plain `const c = …` has it at child 1. Reading `child(1)`
 *    silently loses every `pub const` at file scope —
 *    `ghostty/pkg/fontconfig/main.zig` lost `c`, `init`, `fini`, `initLoadConfig`,
 *    `version`, `CharSet` and 6 more, which is most of its declarations. The read
 *    is the first **NAMED** `identifier` child, which is the same rule
 *    `real-zig-analyzer.ts:323` uses (`anyChild(node, n => n.type === "identifier")`)
 *    and the reason the analyzer publishes those names at all. `anyChild` skips
 *    anonymous tokens, so `pub` and `const` do not shift the position.
 *
 * 2. **A `test` / `comptime` BODY IS EXECUTABLE SCOPE**, so its bindings are
 *    locals. `fnDepth` counted `function_declaration` only, which made
 *    `const testing = std.testing;` inside `test "…"` (lang_set.zig:32, :41) read
 *    as a file-scope declaration — the same distinction the analyzer draws at its
 *    ZGD3/Z19 branches, where a test body is marked executable scope and its
 *    locals are not symbols.
 *
 * No text matching anywhere: names come from `node.type` and named children.
 */
const SLOT_ORD: Record<string, number> = { local: 0, parameter: 1, field: 2, decl: 3 }
/** The first NAMED `identifier` child — the binding, for `const X` and `pub const X` alike. */
function bindingIdent(node: any): any {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === "identifier") return c
  }
  return null
}
/** Executable scope: a function body, a `test` body, a `comptime` body, a `block`. */
const EXECUTABLE_SCOPE = new Set(["function_declaration", "test_declaration", "comptime_declaration", "block"])

function grammarBindings(text: string, root: any): [string, string][] {
  const out: [string, string][] = []
  const note = (name: string | null, slot: string): void => {
    if (!name) return
    out.push([stripZigQuoting(name), slot])
  }
  let fnDepth = 0
  const visit = (node: any): void => {
    const t = node.type
    const inFn = fnDepth > 0
    if (t === "variable_declaration") {
      const id = bindingIdent(node)
      if (id) note(text.slice(id.startIndex, id.endIndex), inFn ? "local" : "decl")
    } else if (t === "container_field") {
      const nf = node.childForFieldName?.("name")
      if (nf) note(text.slice(nf.startIndex, nf.endIndex), "field")
    } else if (t === "parameter") {
      const nf = node.childForFieldName?.("name")
      if (nf) note(text.slice(nf.startIndex, nf.endIndex), "parameter")
    } else if (t === "function_declaration") {
      const nf = node.childForFieldName?.("name")
      if (nf) note(text.slice(nf.startIndex, nf.endIndex), inFn ? "local" : "decl")
    }
    if (EXECUTABLE_SCOPE.has(t)) {
      fnDepth++
      for (let i = 0; i < node.childCount; i++) { const c = node.child(i); if (c) visit(c) }
      fnDepth--
      return
    }
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c) visit(c)
    }
  }
  try { visit(root) } catch { /* a recovered tree yields whatever was walked */ }
  return out
}

const argv = process.argv.slice(2)
const arg = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const SAMPLE = Number(arg("sample", "400"))
const SEED = arg("seed", "ontology-census-v1")
const OUT = arg("out", "")
const ONLY = arg("repos", "")
/** Restrict the draw to an explicit list of `<repo>/<rel>` keys (one per line).
 *  This exists because the census must be run in SHARDS: `parseFile` carries
 *  cumulative WASM state, and a single-process run over 3,834 admitted files
 *  trips the engine's 120 s self-destruct guard (`[BB-HANG]`) on
 *  `zig/lib/std/builtin/assembly.zig` — a file that parses in 2.98 s on its own,
 *  so the trigger is the accumulated parse state and not the file. Sharding does
 *  not change what is counted: the shards partition the SAME hashed draw, and
 *  the merge asserts the union hash equals the single-process drawHash. */
const FILES_FROM = arg("files-from", "")
const RAW = arg("raw", "")
const ONLY_SET = ONLY ? new Set(ONLY.split(",").map((s) => s.trim()).filter(Boolean)) : null

/** The scope markers the analyzer uses for non-symbol endpoints. Counted, not
 *  hidden: a source that is `(global)` is a convention, and a source that is
 *  `foo` with no `foo` symbol is a dangling edge. */
const SOURCE_MARKERS = new Set(["(global)", "(file)", "(declared-type)", "(module)", "(package)"])

const SYMBOL_KINDS = new Set([
  "function", "class", "variable", "constant", "interface", "enum", "enum_member",
  "type", "import", "export", "method", "property", "constructor", "namespace",
  "module", "event", "delegate", "object", "record", "macro", "trait", "struct",
  "impl", "actor", "union", "mixin", "extension", "instance",
])

// ─────────────────────────────────────────────────────────── corpus (git walk)
type FileRec = { repo: string; dir: string; rel: string; abs: string }
const all: FileRec[] = []
const repoCommits: Record<string, string> = {}
const repoFileCounts: Record<string, number> = {}
for (const e of readdirSync(CR).sort()) {
  if (ONLY_SET && !ONLY_SET.has(e)) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  try {
    repoCommits[e] = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  } catch { repoCommits[e] = "unknown" }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.zig"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  repoFileCounts[e] = tracked.length
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    all.push({ repo: e, dir, rel, abs })
  }
}

const key = (f: FileRec) => `${f.repo}/${f.rel}`
const hashed = all
  .map((f) => ({ f, h: createHash("sha256").update(`${SEED}|${key(f)}`).digest("hex") }))
  .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
  .map((x) => x.f)
// `--files-from` names the population EXPLICITLY, so the sample cap must not apply to it. It used
// to be applied first, from the default of 400: every shard then drew 400 of its own ~480 files
// and the merge's union was 400, which is what pass 14 §J found. `--sample` is still honoured when
// given, because narrowing an explicit list is a legitimate request, but it is no longer the
// default that silently decides the population.
const sampleGiven = process.argv.some((a) => a === "--sample" || a.startsWith("--sample="))
const sampleCap = FILES_FROM && !sampleGiven ? 0 : SAMPLE
let draw = sampleCap > 0 && sampleCap < hashed.length ? hashed.slice(0, sampleCap) : hashed
if (FILES_FROM) {
  const want = new Set(readFileSync(path.resolve(ROOT, FILES_FROM), "utf8").split("\n").map((x) => x.trim()).filter(Boolean))
  draw = draw.filter((f) => want.has(key(f)))
}
const drawHash = createHash("sha256").update(draw.map(key).sort().join("\n")).digest("hex")

// ─────────────────────────────────────────────────────────── tallies
type TypeRow = {
  count: number
  perRepo: Record<string, number>
  exampleFiles: string[]
  sourceMarker: number
  sourceResolved: number
  sourceDangling: number
  targetResolved: number
  targetDangling: number
  bothResolved: number
  confidence: Record<string, number>
  heuristicUnder07: number
  evidenceClass: Record<string, number>
  reasonCode: Record<string, number>
}
const typeFiles = new Map<string, Set<string>>()
const filesOfType = (t: string): Set<string> => {
  let s = typeFiles.get(t)
  if (!s) { s = new Set(); typeFiles.set(t, s) }
  return s
}
const byType = new Map<string, TypeRow>()
const row = (t: string): TypeRow => {
  let r = byType.get(t)
  if (!r) {
    r = {
      count: 0, perRepo: {}, exampleFiles: [],
      sourceMarker: 0, sourceResolved: 0, sourceDangling: 0,
      targetResolved: 0, targetDangling: 0, bothResolved: 0,
      confidence: {}, heuristicUnder07: 0, evidenceClass: {}, reasonCode: {},
    }
    byType.set(t, r)
  }
  return r
}
const kinds = new Map<string, number>()
const unknownKinds = new Map<string, number>()
const emptyNameSymbols: string[] = []
const unknownEndpoints: string[] = []
/** Deferred so the corpus tier can be applied after the workers join; see the classification site. */
const unknownEndpointRecs: { t: string; src: string; tgt: string; file: number; unknownEnds: string[] }[] = []
/** Split of `unknownEndpoints`, because the TOTAL alone cannot be read either way. */
let unknownDeclaredInSource = 0
let unknownCorpusOnly = 0
let unknownPlaceholders = 0
/** The SECOND, LOOSER resolution tier. A file-local name set is the strict
 *  reading ("this name is declared in this file"); this one is the reading a
 *  whole-repository index can satisfy ("this name is declared SOMEWHERE in the
 *  sampled corpus"). Both are reported, because a single number has to pick one
 *  and each under-reports differently: the local set calls every `std.*` leaf
 *  dangling, and the corpus set turns a 400-file draw's coverage ceiling into
 *  something that reads like a resolution. */
const corpusNameList: string[] = []
const fileNames: (Set<string> | undefined)[] = []
/**
 * Z-p22: per-file QUALIFIED names, kept beside the bare-name set and never
 * folded into it.
 *
 * `fileNames` holds `symbol.name`, so an endpoint spelled `IOSurface.Error` was
 * absent from it by construction and an edge naming one read as DANGLING —
 * while `parallel-indexer.ts:3432-3438`, which is what actually binds an edge,
 * tries `endsWith("." + s.name)` and an exact `qualifiedName` match. The census
 * was therefore measuring "is this a bare name declared here", not "does the
 * graph bind this", and the two disagree on exactly the qualified endpoints.
 * Publishing both sets lets the merge report the classes SEPARATELY, so a
 * qualified endpoint that binds is not counted as an improvement and a bare
 * name that does not is not hidden.
 *
 * `corpusNameList` is deliberately NOT extended with qualified names: every
 * corpus-tier figure this lane has published is defined against bare names, and
 * widening the set would move those published numbers for reasons unrelated to
 * the analyzer. The qualified corpus set is additive, in its own field.
 */
const fileQNames: (Set<string> | undefined)[] = []
const fileQNameAmbig: (Map<string, number> | undefined)[] = []
const corpusQNameList: string[] = []
const fileSymbols: ({ name: string; kind: string; qualifiedName: string }[] | undefined)[] = []
const fileDeclared: ([string, string][] | undefined)[] = []
/**
 * Per-edge records for the `--raw` dump. The four extra keys are NOT decoration:
 * `raw-to-ladder-dumps.ts` maps them to `line`, `conf`, `meta` and `scope`, and two
 * of this lane's own published columns read them.
 *
 * They were absent from this type until pass 26, and the absence was invisible in
 * the output for the reason that matters. Measured both ways on the same 3,834-file
 * population (395,974 edges), same resolver, dumps differing only in these keys:
 *
 *                 Z65 ABSENT    per-type conf<0.7
 *   without them      395,974          0 for all 7 types
 *   with them             0            0 for all 7 types
 *
 * So the two columns behaved DIFFERENTLY and only one of them was an artifact:
 *
 *   - `targetScope ABSENT 395974` was pure artifact. The analyzer publishes
 *     `metadata.targetScope` on every edge (`annotateTargetScope`); this census never
 *     copied it out, so the resolver's `else` branch claimed every edge carried no
 *     scope. Fixed, it reads 234,024 file-local / 161,950 file-external / 0 absent.
 *   - `conf<0.7` reads 0 EITHER WAY, so calling it an artifact would be false. It is 0
 *     because the lowest confidence this analyzer assigns is 0.75: the full
 *     histogram over the draw is {0.75: 118802, 0.85: 113476, 0.9: 30794, 1: 132902}.
 *     The cut measures nothing here — see `zig-ruled-probe.ts`'s HEURISTIC-CLASS probe
 *     for the class the 0.7 cut misses, which is 118,802 edges.
 *
 * A column whose producer is absent reads as a measurement of the world. So does a
 * column whose threshold sits outside the value range. This is the lane's own §8 item
 * 35 reproduced inside its own instrument.
 */
const edgeRecs: { t: string; src: string; tgt: string; file: number; line: number | null; c: number | null; m: Record<string, unknown> | null; s: string | null }[] = []
let fileCount = 0
let symbolCount = 0
let relCount = 0
let parseFailures = 0
/** Files whose production result carries `fallback: true` — the REGEX `extractFallback`
 *  in shared machinery, reached when `parseFile` throws. Counted because it is
 *  the SELF-CERTIFYING signal that a run measured the regex extractor rather
 *  than the analyzer, and nothing else in the output says so: those symbols
 *  carry no `kind` and those edges sit at confidence 0.4/0.5 with a source that
 *  can be a caller name no zig file declares. Pass 2 published "0" here from one
 *  run; pass 3 measured 6 of 32 shard-runs degraded on the same draw at the same
 *  commit. See `pass3-adversarial.ts` and `fallback-degradation-rate.sh`. */
let fallbackFiles = 0
const perRepoFiles: Record<string, number> = {}
let allHeuristic = 0
let allEdges = 0

let idx = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { parseFailures++; continue }
    if ((r as any)?.fallback === true) fallbackFiles++
    fileCount++
    perRepoFiles[f.repo] = (perRepoFiles[f.repo] ?? 0) + 1
    const symbols: any[] = r.symbols ?? []
    const names = new Set<string>()
    const qnames = new Set<string>()
    const ambig = new Map<string, number>()
    const pubSyms: { name: string; kind: string; qualifiedName: string }[] = []
    for (const s of symbols) {
      symbolCount++
      const nm = typeof s.name === "string" ? s.name : ""
      const k = typeof s.kind === "string" ? s.kind : String(s.kind ?? "")
      kinds.set(k, (kinds.get(k) ?? 0) + 1)
      if (!SYMBOL_KINDS.has(k)) unknownKinds.set(k, (unknownKinds.get(k) ?? 0) + 1)
      if (nm.length === 0) emptyNameSymbols.push(`${key(f)}@${s.range?.startLine ?? 0}`)
      if (nm) names.add(nm)
      // The projection computes this field, so the census reads the PUBLISHED
      // spelling rather than re-deriving one (pass 21 §C's lesson: an instrument
      // that reads a shape nothing downstream sees measures a different thing).
      const qn = typeof s.qualifiedName === "string" && s.qualifiedName.length > 0 ? s.qualifiedName : nm
      if (qn) {
        qnames.add(qn)
        ambig.set(qn, (ambig.get(qn) ?? 0) + 1)
      }
      pubSyms.push({ name: nm, kind: k, qualifiedName: qn })
    }
    // The grammar's own binding sites. Read from a SECOND parse of the same
    // bytes, because `parseFile` publishes what the analyzer chose to publish
    // and a dropped declaration is invisible in it by construction — which is
    // the question this column exists to answer for the ladder.
    let bindings: [string, string][] = []
    try {
      const src = readFileSync(f.abs, "utf8")
      const tree = treeParser.parse(src)
      bindings = grammarBindings(src, tree.rootNode)
      tree?.delete?.()
    } catch { /* an unreadable file contributes no bindings and says so below */ }
    // The per-file name set is published for the caller, and the corpus-wide set
    // is folded in AFTER the workers join: `Set.add` from eight interleaved
    // workers is a data race, and a torn set would under-report resolution.
    fileNames[i] = names
    fileQNames[i] = qnames
    fileQNameAmbig[i] = ambig
    fileSymbols[i] = pubSyms
    fileDeclared[i] = bindings
    for (const nm of names) corpusNameList.push(nm)
    for (const qn of qnames) corpusQNameList.push(qn)
    const rels: any[] = r.relationships ?? []
    for (const e of rels) {
      relCount++
      allEdges++
      const t = String(e.type ?? e.relationshipType ?? "")
      const r2 = row(t)
      r2.count++
      r2.perRepo[f.repo] = (r2.perRepo[f.repo] ?? 0) + 1
      // Files-per-type is tracked as a SET, not derived from perRepo totals: a
      // repo contributes one entry no matter how many of its files carry the
      // type, so a sum of perRepo counts would be a repo count wearing a file
      // count's name.
      const fs = filesOfType(t)
      if (!fs.has(key(f))) {
        fs.add(key(f))
        if (r2.exampleFiles.length < 4) r2.exampleFiles.push(key(f))
      }
      const src = String(e.source ?? "")
      const tgt = String(e.target ?? "")
      // R7 counts a PLACEHOLDER: an endpoint the analyzer invented because a
      // fallback had nothing truthful to say. A source that really DECLARES a
      // member called `unknown` (`const Outcome = union(enum) { unknown, ... }`)
      // produces the same string and is a true name, so the two are counted
      // apart — collapsing them would either convict a truthful edge or excuse
      // a placeholder, and the register that enforces R7 is shrink-only either
      // way.
      if (src === "unknown" || tgt === "unknown") {
        // The test is on the `unknown` END(S) ONLY. An earlier revision read
        // `names.has(src) || names.has(tgt)`, which passes when EITHER end is a real name —
        // so `contains Kind -> unknown` was called "declared in source" on the strength of
        // `Kind`, and a genuine placeholder riding on a real source name could not be
        // convicted. That is the one thing this branch exists to catch, so the ends that are
        // literally `unknown` must ALL be published names for the edge to be truthful.
        const unknownEnds = [src, tgt].filter((x) => x === "unknown")
        // Classification is DEFERRED to the post-join pass, because the honest answer has three
        // classes and only two of them are knowable inside a worker: "declared in this file" is
        // local, "declared somewhere in the draw" needs `corpusNames`, and "declared nowhere" is
        // the only thing that may be called a placeholder. Deciding it here — as an earlier
        // revision did, with `names.has(src) || names.has(tgt)` — could only ever see the first,
        // and it passed an edge on the strength of an endpoint that had nothing to do with it.
        unknownEndpointRecs.push({ t, src, tgt, file: i, unknownEnds })
      }
      // Read defensively and record the ABSENCE rather than a substitute: a null
      // confidence in the dump is visibly "no confidence recorded", where 0 would
      // be confidently wrong and would land in the sub-0.7 heuristic histogram.
      edgeRecs.push({
        t, src, tgt, file: i,
        line: typeof e.line_number === "number" ? e.line_number : null,
        c: typeof e.confidence === "number" ? e.confidence : null,
        m: e.metadata ?? null,
        s: typeof e.metadata?.targetScope === "string" ? e.metadata.targetScope : null,
      })
      const isMarker = SOURCE_MARKERS.has(src)
      if (isMarker) r2.sourceMarker++
      else if (names.has(src)) r2.sourceResolved++
      else r2.sourceDangling++
      const tOK = names.has(tgt)
      if (tOK) r2.targetResolved++
      else r2.targetDangling++
      if (tOK && (isMarker || names.has(src))) r2.bothResolved++
      const conf = typeof e.confidence === "number" ? e.confidence : 1
      const ck = String(conf)
      r2.confidence[ck] = (r2.confidence[ck] ?? 0) + 1
      if (conf < 0.7) { r2.heuristicUnder07++; allHeuristic++ }
      const md = e.metadata ?? {}
      const ec = String(md.evidenceClass ?? "(absent)")
      r2.evidenceClass[ec] = (r2.evidenceClass[ec] ?? 0) + 1
      const rc = String(md.relationshipType ?? "(absent)")
      r2.reasonCode[rc] = (r2.reasonCode[rc] ?? 0) + 1
    }
    // `files` per type is the set size; nothing to recompute here.
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

/** Corpus-tier resolution, computed AFTER the join from the recorded edges. */
const corpusNames = new Set(corpusNameList)
const corpusTier = new Map<string, { targetResolved: number; bothResolved: number }>()
for (const e of edgeRecs) {
  let c = corpusTier.get(e.t)
  if (!c) { c = { targetResolved: 0, bothResolved: 0 }; corpusTier.set(e.t, c) }
  const local = fileNames[e.file]
  const tOK = corpusNames.has(e.tgt)
  if (tOK) c.targetResolved++
  if (tOK && (SOURCE_MARKERS.has(e.src) || (local ? local.has(e.src) : false))) c.bothResolved++
}

/**
 * The three-way classification of every edge with a literal `unknown` endpoint, applied here
 * because the corpus tier does not exist until the join:
 *
 *   declared in this file  the source really publishes a symbol with that name — a true edge
 *   declared in the draw   some other file publishes it; the name is real, this file just does
 *                          not declare it. Still not a fabricated edge, and still unresolvable
 *                          for a walk confined to one file.
 *   declared NOWHERE       no published symbol carries the name anywhere in the draw. This is
 *                          the only class the word PLACEHOLDER is allowed to describe.
 *
 * A name can be declared in many files at once (`unknown` is an enum member in std), so the
 * middle class is not unique-target: it is counted, never treated as a resolution.
 */
const unknownKeys = draw.map(key)
for (const r of unknownEndpointRecs) {
  const local = fileNames[r.file]
  const allLocal = r.unknownEnds.every((x) => (local ? local.has(x) : false))
  const allCorpus = r.unknownEnds.every((x) => corpusNames.has(x))
  const cls = allLocal ? "declared in source" : allCorpus ? "declared elsewhere in draw" : "PLACEHOLDER"
  if (cls === "declared in source") unknownDeclaredInSource++
  else if (cls === "declared elsewhere in draw") unknownCorpusOnly++
  else unknownPlaceholders++
  unknownEndpoints.push(`${r.t} ${r.src} -> ${r.tgt} @ ${unknownKeys[r.file]} [${cls}]`)
}

const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 10000) / 100)

const report = {
  instrument: "validation/m14/fixtures/zig/ontology-census.ts",
  entryPoint: "parseFile (src/ast/pool-worker.ts)",
  corpusRoot: CR,
  seed: SEED,
  samplingMethod:
    "git ls-files -- '*.zig' per corpus repo (the coverage gate's own walk), " +
    "ordered by sha256(seed|<repo>/<rel>) and the first N taken. Reproducible, " +
    "NOT a statistical random sample; the file set is named by drawHash below.",
  corpusFileCounts: repoFileCounts,
  corpusCommits: repoCommits,
  corpusFilesAdmitted: all.length,
  sampledFiles: draw.length,
  drawHash: `sha256:${drawHash}`,
  filesParsed: fileCount,
  fallbackFiles,
  filesPerRepo: perRepoFiles,
  parseFailures,
  symbols: symbolCount,
  relationships: relCount,
  kinds: Object.fromEntries([...kinds].sort((a, b) => b[1] - a[1])),
  kindsOutsideSharedSymbolKind: Object.fromEntries(unknownKinds),
  symbolsWithEmptyName: emptyNameSymbols.length,
  symbolsWithEmptyNameExamples: emptyNameSymbols.slice(0, 10),
  edgesWithUnknownEndpoint: unknownEndpoints.length,
  edgesWithUnknownEndpointDeclaredInSource: unknownDeclaredInSource,
  edgesWithUnknownEndpointDeclaredElsewhereInDraw: unknownCorpusOnly,
  edgesWithUnknownEndpointPlaceholder: unknownPlaceholders,
  edgesWithUnknownEndpointExamples: unknownEndpoints.slice(0, 10),
  heuristicEdgesUnder07: allHeuristic,
  heuristicRatioPct: pct(allHeuristic, allEdges),
  // The DISTRIBUTION those two above cannot express. `heuristicEdgesUnder07` is 0 for
  // this analyzer and would stay 0 if every edge it emits were a name-match guess,
  // because nothing it publishes scores below 0.75. Publishing the histogram beside the
  // threshold count is what makes "no edge is a sub-0.7 heuristic" a checkable claim
  // rather than a threshold that never fires.
  confidenceHistogram: Object.fromEntries(
    [...edgeRecs.reduce((m, e) => m.set(e.c === null ? "ABSENT" : String(e.c), (m.get(e.c === null ? "ABSENT" : String(e.c)) ?? 0) + 1), new Map<string, number>())]
      .sort((a, b) => Number(a[0]) - Number(b[0])),
  ),
  confidenceByReason: Object.fromEntries(
    [...edgeRecs.reduce((m, e) => {
      const rt = typeof e.m?.relationshipType === "string" ? e.m.relationshipType : "(none)"
      const k = `${e.c === null ? "ABSENT" : e.c} ${rt}`
      return m.set(k, (m.get(k) ?? 0) + 1)
    }, new Map<string, number>())].sort((a, b) => Number(a[0].split(" ")[0]) - Number(b[0].split(" ")[0]) || a[0].localeCompare(b[0])),
  ),
  // The per-edge keys the `--raw` dump copies out, counted HERE so their coverage is
  // a published number on the report a reader actually looks at. Until pass 26 they
  // were not copied at all, and `incoming-resolve.ts` published a column derived from
  // one of them: `targetScope ABSENT 395974`, every edge in the corpus, which read as
  // a finding about the analyzer and was a fact about this file. (Its `conf<0.7`
  // column reads 0 either way — see the header — so it is NOT counted here as an
  // artifact.) A per-edge key with no producer is indistinguishable from a key whose
  // value is uniform, so coverage is reported beside the count it would otherwise be
  // silently folded into.
  perEdgeKeyCoverage: {
    line: `${edgeRecs.filter((e) => e.line !== null).length}/${edgeRecs.length}`,
    confidence: `${edgeRecs.filter((e) => e.c !== null).length}/${edgeRecs.length}`,
    metadata: `${edgeRecs.filter((e) => e.m !== null).length}/${edgeRecs.length}`,
    targetScope: `${edgeRecs.filter((e) => e.s !== null).length}/${edgeRecs.length}`,
  },
  byType: Object.fromEntries(
    [...byType].sort((a, b) => a[0].localeCompare(b[0])).map(([t, r2]) => [
      t,
      {
        count: r2.count,
        files: filesOfType(t).size,
        perRepo: r2.perRepo,
        exampleFiles: r2.exampleFiles,
        source: {
          marker: r2.sourceMarker,
          resolved: r2.sourceResolved,
          dangling: r2.sourceDangling,
          markerPct: pct(r2.sourceMarker, r2.count),
          resolvedPct: pct(r2.sourceResolved, r2.count),
          danglingPct: pct(r2.sourceDangling, r2.count),
        },
        target: {
          resolvedFileLocal: r2.targetResolved,
          danglingFileLocal: r2.targetDangling,
          resolvedFileLocalPct: pct(r2.targetResolved, r2.count),
          resolvedCorpusTier: corpusTier.get(t)?.targetResolved ?? 0,
          resolvedCorpusTierPct: pct(corpusTier.get(t)?.targetResolved ?? 0, r2.count),
        },
        bothResolvedFileLocal: r2.bothResolved,
        bothResolvedFileLocalPct: pct(r2.bothResolved, r2.count),
        bothResolvedCorpusTier: corpusTier.get(t)?.bothResolved ?? 0,
        bothResolvedCorpusTierPct: pct(corpusTier.get(t)?.bothResolved ?? 0, r2.count),
        confidence: r2.confidence,
        heuristicUnder07: r2.heuristicUnder07,
        heuristicPct: pct(r2.heuristicUnder07, r2.count),
        evidenceClass: r2.evidenceClass,
        reasonCode: r2.reasonCode,
      },
    ]),
  ),
}

if (RAW) {
  // The per-edge + per-file-name records a merge needs to recompute the
  // CORPUS-TIER resolution columns against the UNION of every shard's names. The
  // per-shard report computes them against its own names only, which under-
  // reports them by construction; that is a property of sharding, not a defect,
  // so the raw dump carries what the merge cannot reconstruct otherwise.
  writeFileSync(
    path.resolve(ROOT, RAW),
    JSON.stringify({
      drawHash,
      drawFiles: draw.map(key),
      // WHAT `declaredNames` MEANS in this dump, stamped rather than remembered.
      //
      // The column's definition changed once (header above: it used to emit one
      // `(name, highest-ranked slot)` entry per name, now it emits every
      // `(name, slot)` the grammar binds and the consumer reduces), and no
      // consumer noticed: `analyzer-owned-miss-cause.ts`'s C2 compares recomputed
      // rungs against a table measured under the OLD definition and has been
      // printing FAIL on the same five cells ever since, which is indistinguishable
      // from a real regression. A number without the definition it was measured
      // under is the defect; this string is what makes the definition travel with
      // the number. Bump it if the reduction below ever changes.
      declaredNamesDefinition: "every-(name,slot)-the-grammar-binds;consumer-reduces",
      corpusFilesAdmitted: all.length,
      filesParsed: fileCount,
      fallbackFiles,
      filesPerRepo: perRepoFiles,
      parseFailures,
      symbols: symbolCount,
      relationships: relCount,
      kinds: Object.fromEntries(kinds),
      kindsOutsideSharedSymbolKind: Object.fromEntries(unknownKinds),
      symbolsWithEmptyName: emptyNameSymbols,
      edgesWithUnknownEndpoint: unknownEndpoints,
      edgesWithUnknownEndpointDeclaredInSource: unknownDeclaredInSource,
      edgesWithUnknownEndpointDeclaredElsewhereInDraw: unknownCorpusOnly,
      edgesWithUnknownEndpointPlaceholder: unknownPlaceholders,
      heuristicEdgesUnder07: allHeuristic,
      // Z65's annotation, counted AT THE PRODUCER. It used to be counted only by a
      // downstream instrument, which reported `ABSENT 395974` — a finding about the
      // analyzer that was really a fact about this file. Counting it here makes the
      // producer's own coverage a published number, so a future producer that drops
      // the annotation shows up in the census that produces it.
      targetScope: (() => {
        const c: Record<string, number> = { "file-local": 0, "file-external": 0, "scope-marker": 0, ABSENT: 0 }
        for (const e of edgeRecs) c[e.s ?? "ABSENT"] = (c[e.s ?? "ABSENT"] ?? 0) + 1
        return c
      })(),
      // The confidence HISTOGRAM, not just the under-0.7 count. `heuristicEdgesUnder07`
      // above is 0 and always will be for this analyzer — nothing it emits scores below
      // 0.75 — so on its own it cannot distinguish "no heuristics" from "the cut is
      // outside the value range". The distribution can, and it is what names the class
      // the cut misses.
      confidenceHistogram: (() => {
        const c: Record<string, number> = {}
        for (const e of edgeRecs) { const k = e.c === null ? "ABSENT" : String(e.c); c[k] = (c[k] ?? 0) + 1 }
        return Object.fromEntries(Object.entries(c).sort((a, b) => Number(a[0]) - Number(b[0])))
      })(),
      // (confidence, metadata.relationshipType) — which parse construct produced which
      // score. This is the pairing that makes a confidence claim checkable: it says the
      // 0.75 class is `zig_field_access` + `zig_field_reflection` and nothing else, so
      // "the 0.75 edges are the name-binding inferences" is a counted statement.
      confidenceByReason: (() => {
        const c: Record<string, number> = {}
        for (const e of edgeRecs) {
          const rt = typeof e.m?.relationshipType === "string" ? e.m.relationshipType : "(none)"
          const k = `${e.c === null ? "ABSENT" : e.c} ${rt}`
          c[k] = (c[k] ?? 0) + 1
        }
        return Object.fromEntries(Object.entries(c).sort((a, b) => Number(a[0].split(" ")[0]) - Number(b[0].split(" ")[0]) || a[0].localeCompare(b[0])))
      })(),
      edgesCarryingConfidence: edgeRecs.filter((e) => e.c !== null).length,
      edgesCarryingMetadata: edgeRecs.filter((e) => e.m !== null).length,
      edgesCarryingLine: edgeRecs.filter((e) => e.line !== null).length,
      // The per-file records the miss-cause ladder reads: the published SYMBOLS
      // (with the kind, so its C5 is a per-site check rather than a per-name one)
      // and the GRAMMAR's binding slots (so it can tell a dropped declaration
      // from a name the file never binds).
      files: fileSymbols
        .map((syms, i) => {
          if (!syms || !draw[i]) return null
          return {
            key: key(draw[i]),
            symbols: syms,
            declaredNames: fileDeclared[i] ?? [],
          }
        })
        .filter((e): e is NonNullable<typeof e> => e !== null),
      fileNames: Object.fromEntries(fileNames.map((s, i) => [i, s ? [...s] : null]).filter((e) => e[1] !== null)),
      fileQNames: Object.fromEntries(fileQNames.map((s, i) => [i, s ? [...s] : null]).filter((e) => e[1] !== null)),
      fileQNameAmbig: Object.fromEntries(
        fileQNameAmbig
          .map((m, i) => {
            if (!m) return null
            const dupe = [...m].filter(([, c]) => c > 1)
            return dupe.length ? [i, dupe] : null
          })
          .filter((e): e is [number, [string, number][]] => e !== null),
      ),
      edges: edgeRecs,
    }) + "\n",
  )
  console.log(`wrote raw ${RAW}`)
}

const text = JSON.stringify(report, null, 2)
if (OUT) {
  writeFileSync(path.resolve(ROOT, OUT), text + "\n")
  console.log(`wrote ${OUT}`)
}
console.log(`zig ontology census — ${report.sampledFiles} files sampled (${report.corpusFilesAdmitted} admitted), draw ${report.drawHash}`)
console.log(`parsed ${report.filesParsed}  symbols ${report.symbols}  relationships ${report.relationships}`)
console.log(`parseFile FALLBACK files ${fallbackFiles}${fallbackFiles > 0 ? "  <-- this run is a MIXTURE of the analyzer and extractFallback" : ""}`)
console.log(`empty-name symbols ${report.symbolsWithEmptyName}   unknown endpoints ${report.edgesWithUnknownEndpoint}   kinds outside SymbolKind ${Object.keys(report.kindsOutsideSharedSymbolKind).length}`)
console.log(`heuristic (<0.7) ${report.heuristicEdgesUnder07} = ${report.heuristicRatioPct}% of ${allEdges}`)
console.log(`  the distribution that number hides: ${JSON.stringify(report.confidenceHistogram)}`)
console.log(`  confidence x reason: ${JSON.stringify(report.confidenceByReason)}`)
console.log(`per-edge keys in the --raw dump: line ${report.perEdgeKeyCoverage.line}  confidence ${report.perEdgeKeyCoverage.confidence}  metadata ${report.perEdgeKeyCoverage.metadata}  targetScope ${report.perEdgeKeyCoverage.targetScope}`)
console.log("")
console.log("local = the name is a symbol in THIS file. corpus = the name is a symbol anywhere in the draw")
console.log(`type${" ".repeat(12)}count${" ".repeat(6)}files  srcMark%  srcDangle%  tgtLocal%  tgtCorpus%  bothCorpus%  heur%  conf`)
for (const [t, r2] of Object.entries(report.byType) as [string, any][]) {
  console.log(
    `${t}${" ".repeat(Math.max(1, 14 - t.length))}${String(r2.count).padStart(6)}${String(r2.files).padStart(7)}  ` +
    `${String(r2.source.markerPct).padStart(7)}  ${String(r2.source.danglingPct).padStart(10)}  ` +
    `${String(r2.target.resolvedFileLocalPct).padStart(9)}  ${String(r2.target.resolvedCorpusTierPct).padStart(9)}  ` +
    `${String(r2.bothResolvedCorpusTierPct).padStart(11)}  ${String(r2.heuristicPct).padStart(5)}  ` +
    Object.entries(r2.confidence).map(([k, v]) => `${k}:${v}`).join(" "),
  )
}
console.log("")
console.log(`kinds: ${Object.entries(report.kinds).map(([k, v]) => `${k}=${v}`).join(" ")}`)
if (report.edgesWithUnknownEndpoint > 0) {
  console.log("")
  console.log(`edges with a literal 'unknown' endpoint: ${report.edgesWithUnknownEndpoint}`)
  console.log(
    `  of which declared in source: ${report.edgesWithUnknownEndpointDeclaredInSource}` +
      `   declared elsewhere in draw: ${report.edgesWithUnknownEndpointDeclaredElsewhereInDraw}` +
      `   PLACEHOLDER: ${report.edgesWithUnknownEndpointPlaceholder}`,
  )
  // A placeholder is the R7 failure this whole branch exists to catch, so it is printed in FULL
  // and never truncated behind a shared 10-example cap — the cap is for the declared names,
  // which are numerous and uninteresting, and is the wrong place to hide the one that convicts.
  for (const x of unknownEndpoints) if (x.includes("[PLACEHOLDER]")) console.log(`  PLACEHOLDER  ${x}`)
  for (const x of report.edgesWithUnknownEndpointExamples) if (!x.includes("[PLACEHOLDER]")) console.log(`  ${x}`)
}
if (report.symbolsWithEmptyName > 0) {
  console.log("")
  for (const x of report.symbolsWithEmptyNameExamples) console.log(`  empty-name symbol: ${x}`)
}
