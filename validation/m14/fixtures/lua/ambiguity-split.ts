/**
 * LUA AMBIGUITY SPLIT — `incoming-check`'s two definitions of "ambiguous", printed
 * side by side on one walk, plus the ROUND BRIEF's class-B and class-C populations.
 *
 * ## WHY THIS FILE EXISTS
 *
 * The whole-corpus sweep (`validation/m14/measurements/incoming-whole.tsv`) quotes
 * one number per lane for "an edge target resolves to more than one published
 * symbol". For lua that row is `600 files, 9 fired, amb 7,409, unres 6,663`.
 *
 * That number is NOT what it reads like, and the brief that carries this round says
 * so directly: the fleet's `amb` column is a **KIND** count and is not comparable
 * across lanes. `script/m14/incoming-check.ts:137-141` builds
 * `published: Map<name, kind[]>`, appending a kind only `if (!arr.includes(kind))`,
 * and calls a target ambiguous when `hits.length > 1`. So ITS ambiguous means
 *
 *     this target string is published under two or more distinct `SymbolKind`s
 *
 * and NOT
 *
 *     this target string names two or more declarations.
 *
 * Three `.btn` rules in three files are all kind `class`, so `hits.length === 1`
 * and the instrument reports them RESOLVED. A consumer walking the reverse graph
 * collides on all three. For a language like lua, where bare names collide
 * constantly (`local M = {}` in every file, every method named `init`), the two
 * definitions can differ by an order of magnitude, and acting on the smaller one
 * would be acting on the wrong population.
 *
 * `script/m14/incoming-check.ts` is shared machinery (§8 of the lane brief) and is
 * NOT edited here. `kindsOf()` below reproduces its map **verbatim** — bare name
 * and `qualifiedName` indexed beside it, kinds deduped — so `--compare` is
 * like-for-like. If the two disagree, this file says so rather than printing a
 * prettier number than the fleet's.
 *
 * ## THE TWO DEFINITIONS, AND THE LUA-SPECIFIC THIRD AXIS
 *
 * For an edge `(type, file, line, source, target)` with target `T`:
 *
 *   multiSymbol   `S(T)` = declarations whose bare name is `T`, PLUS declarations
 *                 whose `qualifiedName` is exactly `T`, deduped on
 *                 (file, qualifiedName, kind, line). `|S(T)| > 1`.
 *                 This is what a reverse walk collides on.
 *   multiKind     `|{kind : d ∈ S(T)}| > 1`. This is `incoming-check`'s rule.
 *
 * Neither of them is a defect claim. Both are counts over the same edges, printed
 * together so the reader can tell which population a number describes.
 *
 * Lua adds a THIRD question the other lanes do not have to ask, because Lua's name
 * resolution is LEXICAL and every published symbol carries `startLine`/`endLine` and
 * `scope`. A target that names two declarations in one file is still **determined**
 * if lexical scoping names one of them. So the multiSymbol population is split four
 * ways, and the split is decided by the OWN FILE first:
 *
 *   B1_lineSettled   the edge's own file declares the target, and a visibility rule
 *                    names exactly one declaration. THE EDGE IS TRUE. What is weak is
 *                    the walker's rule of resolving by bare name.
 *   B2b_fileAbsent   the edge's own file declares the target ZERO times. The whole
 *                    collision lives in OTHER files, so the declaration this edge
 *                    names is reachable only through a module path — which the
 *                    published bare name does not carry. This is the shape that a
 *                    file-qualified identity fixes and nothing else does.
 *   B2c_noneVisible  the edge's own file declares it more than once and no candidate
 *                    is visible at the edge's line — the edge precedes every local
 *                    declaration of that name.
 *   B3_indistinct    several candidates are visible at the line and the tie-break
 *                    cannot separate them — same name, same startLine, one file. This
 *                    is the only class the published NAME cannot express, so it is the
 *                    number this instrument exists to bound.
 *
 * ### THE VISIBILITY RULE IS MEASURED, NOT ASSUMED
 *
 * Lua visibility is NOT span-based. A `local f` at line 10 is visible at line 20 —
 * the binding does not stop where the declaration's own span stops. So the rule is
 * ORDER: candidates declared at or before the edge's line, and among those the LAST
 * wins, because a later `local` of the same name shadows an earlier one from its own
 * declaration onward.
 *
 * The SPAN rule (`startLine <= l <= endLine`, innermost wins) is ALSO computed on the
 * same walk, and `visibilityRuleSensitive` counts the edges where the two verdicts
 * disagree. An earlier version of this file used SPAN alone and reported 88.74% of
 * the multiSymbol population as unresolved by scope; most of that was forward
 * references, which are the ordinary case in Lua. Both numbers are printed so the
 * instrument's own rule choice is visible rather than buried.
 *
 * The buckets partition the multiSymbol population: B2b is decided by the own-file
 * candidate count, and B1/B2c/B3 by the ORDER verdict among candidates that exist.
 * A partition without a stated order is not a measurement.
 *
 * ## THE ROUND BRIEF'S CLASS B AND CLASS C, MEASURED
 *
 * The brief splits the fleet's 339,750 into three causes and asks for each to be
 * treated as different work:
 *
 *   A  the published name is not an identifier (bare simple names collide);
 *   B  emitter and publisher disagree on the SPELLING — the target's final segment
 *      is a published name, so the edge would resolve if both sides used one
 *      canonical helper;
 *   C  EXTERNAL references emitted as if local — legitimately outside the corpus,
 *      to be MARKED external so they stop polluting `unresolved`.
 *
 * B and C are both measurable here and both are counted per type:
 *
 *   classB_finalSegmentResolves
 *        the target is NOT in the published map, it contains a `.`, and its FINAL
 *        segment IS in the published map. This is the exact shape the brief
 *        describes. It is REPORTED, not acted on: `imports` targets are module-path
 *        strings whose final segment names a different symbol than the module, so
 *        retargeting them would be a fabricated edge — §4's most expensive mistake.
 *        The per-type split is what tells the two apart, so both are printed.
 *   classC_externalCandidates
 *        the target is not declared anywhere in the draw and it is not a dotted
 *        path. Split by whether it is in the Lua 5.4 base-library list
 *        (TRANSCRIBED from the reference manual, NOT derived from the corpus — the
 *        claim it supports is "named in the documented stdlib surface" and nothing
 *        wider) and by its shape as an identifier.
 *
 * ## NO REGEX
 *
 * Every classification below is a name comparison against a set, a node-type-free
 * string split on `.`, or a numeric line comparison. There is no pattern matching
 * over source text in this file. Nothing is read off the file characters, so a name
 * in a comment or a string literal cannot enter the index — every fact comes from
 * the published `ParseResult` of `parseFile`, the production entry point.
 *
 * ## USAGE
 *
 *   npx tsx validation/m14/fixtures/lua/ambiguity-split.ts --out validation/m60/lua/ambiguity-split.json
 *   npx tsx validation/m14/fixtures/lua/ambiguity-split.ts --out <f> --compare ../../measurements/incoming-whole.tsv
 *
 * Exit 0 always: this reports, it does not gate.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const arg = (k: string, d = ""): string => {
  const hit = argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
  if (!hit) return d
  const eq = hit.indexOf("=")
  return eq === -1 ? (argv[argv.indexOf(hit) + 1] ?? d) : hit.slice(eq + 1)
}
const OUT = arg("out", "validation/m60/lua/ambiguity-split.json")
const COMPARE = arg("compare", "")
const FILES_CAP = Number(arg("files", "100000"))

/**
 * Store label -> ontology name. BOTH spellings of `RelationshipType.Imports` are
 * accepted: `src/ast/types.ts:69` spells the member `brain_import` and
 * `src/ast/engine.ts:454` spells the SAME member `imports`, and analyzers import the
 * enum from engine. Matching only one of them reports the type as 0 in every
 * language WHILE EMITTING IT.
 */
const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls",
  uses: "uses",
  contains: "contains", composition: "contains", part_of: "contains",
  imports: "imports", brain_import: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides",
  instantiates: "instantiates",
}
const TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
]

/** Scope labels the analyzer itself publishes; they are not declarations. */
const SCOPE_LABELS = new Set(["global", "owner", "__global__", "file"])

/**
 * Lua 5.4 base library + the fields of the standard table libraries this corpus
 * names. TRANSCRIBED FROM THE REFERENCE MANUAL, NOT DERIVED FROM THE CORPUS. A
 * number produced against a hand-typed list is only as good as the list.
 */
const LUA54_BASE = new Set([
  "_G", "_VERSION", "arg", "assert", "bit32", "collectgarbage", "coroutine", "debug",
  "dofile", "error", "getmetatable", "io", "ipairs", "jit", "load", "loadfile",
  "math", "module", "next", "os", "package", "pairs", "pcall", "print", "rawequal",
  "rawget", "rawlen", "rawset", "require", "select", "setmetatable", "string",
  "table", "tonumber", "tostring", "type", "unpack", "utf8", "xpcall",
  "byte", "char", "concat", "dump", "find", "format", "gmatch", "gsub", "len",
  "lower", "match", "move", "pack", "remove", "rep", "reverse", "sort", "sub",
  "upper", "abs", "acos", "asin", "atan", "ceil", "cos", "deg", "exp", "floor",
  "fmod", "huge", "log", "max", "maxinteger", "min", "mininteger", "mod", "modf",
  "pi", "rad", "random", "randomseed", "sin", "sqrt", "tan", "tointeger", "ult",
  "create", "resume", "running", "status", "wrap", "yield", "isyieldable",
  "close", "flush", "lines", "read", "seek", "setvbuf", "write", "lines",
  "clock", "date", "difftime", "execute", "exit", "getenv", "remove", "rename",
  "setlocale", "time", "tmpname", "loadlib", "searchpath", "get", "cpath",
  "config", "loaded", "loaders", "path", "preload", "coroutine",
])

/**
 * Symbols the pool-worker denylist carries that are LEGAL LUA IDENTIFIERS. Kept
 * here only to label a bucket; the deletion itself is measured by
 * `script/m60/lua-incoming-audit.ts` against `keepSymbol` itself.
 */
const DENYLIST_SHAPED = new Set(["unknown", "self", "root", "this", "program", "source_file", "me"])

interface Sym {
  name: string
  kind: string
  qual: string
  scope: string
  startLine: number
  endLine: number
}
interface Site extends Sym { file: string }
interface Edge {
  t: string
  s: string
  g: string
  l: number
  f: string
}

/**
 * What a visibility rule can say about a set of same-named declarations in ONE
 * file, at the edge's line.
 *
 *   unique    exactly one candidate satisfies the rule — no tie to break
 *   picksOne  several satisfy and the rule's tie-break names exactly one
 *   tie       several satisfy and the rule cannot separate them
 *   noneVisible  candidates exist in the file but none satisfies the rule
 */
type Verdict = "unique" | "picksOne" | "tie" | "noneVisible"

/** ORDER: declared at or before the line; the LAST such declaration wins. */
function verdictOrder(c: Site[], l: number): Verdict {
  const at = c.filter((s) => s.startLine > 0 && l > 0 && s.startLine <= l)
  if (at.length === 0) return "noneVisible"
  if (at.length === 1) return "unique"
  let best = at[0].startLine
  for (const s of at) if (s.startLine > best) best = s.startLine
  const last = at.filter((s) => s.startLine === best)
  return last.length === 1 ? "picksOne" : "tie"
}

/** SPAN: the declaration's own line range covers the line; innermost wins. */
function verdictSpan(c: Site[], l: number): Verdict {
  const cov = c.filter((s) => s.startLine > 0 && s.endLine > 0 && l > 0 && s.startLine <= l && l <= s.endLine)
  if (cov.length === 0) return "noneVisible"
  if (cov.length === 1) return "unique"
  let best = cov[0].endLine - cov[0].startLine
  for (const s of cov) if ((s.endLine - s.startLine) < best) best = s.endLine - s.startLine
  const inner = cov.filter((s) => (s.endLine - s.startLine) === best)
  return inner.length === 1 ? "picksOne" : "tie"
}

/** `pool-worker.ts:866-869` emits FLAT startLine/endLine and no range object. */
const symbolLine = (s: any): number => {
  const flat = Number(s?.startLine ?? 0)
  if (flat > 0) return flat
  const nested = Number(s?.range?.startLine ?? s?.range?.start?.line ?? 0)
  return nested > 0 ? nested : 0
}
const symbolEndLine = (s: any): number => {
  const flat = Number(s?.endLine ?? 0)
  if (flat > 0) return flat
  const nested = Number(s?.range?.endLine ?? s?.range?.end?.line ?? 0)
  return nested > 0 ? nested : 0
}
/** The store reads the edge line from `line_number`; `range.start.line` is absent. */
const edgeLine = (r: any): number => {
  const raw = r?.line_number
  if (typeof raw === "number" && raw > 0) return raw
  const n = Number(r?.range?.start?.line ?? 0)
  return n > 0 ? n : 0
}

// ─────────────────────────────────────────────────────────── corpus draw
// Identical predicate to `script/m60/lua-ontology-census.ts` and
// `script/m60/lua-incoming-audit.ts`: `git ls-files '*.lua'` per repo, sorted,
// capped per repo. NOT a random sample and not claimed to be one — it is a
// deterministic ordering, so the file set is identical on every machine.
function draw(): { files: string[]; repos: Record<string, number>; digest: string } {
  const repos: Record<string, string[]> = {}
  const rd = (d: string): string[] => { try { return readdirSync(d) } catch { return [] } }
  for (const repo of rd(CR).sort()) {
    const dir = path.join(CR, repo)
    try {
      if (!statSync(dir).isDirectory()) continue
      if (!existsSync(path.join(dir, ".git"))) continue
    } catch { continue }
    let out = ""
    try {
      out = execFileSync("git", ["ls-files", "*.lua"], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28 })
    } catch { continue }
    const tracked = out.split("\n").map((s) => s.trim()).filter(Boolean).sort()
    if (tracked.length === 0) continue
    repos[repo] = tracked.slice(0, FILES_CAP).map((p) => path.join(repo, p))
  }
  const files = Object.values(repos).flat().sort()
  const h = createHash("sha256")
  for (const f of files) {
    let size = -1
    try { size = statSync(path.join(CR, f)).size } catch { /* absent */ }
    h.update(`${f}\t${size}\n`)
  }
  return { files, repos: Object.fromEntries(Object.entries(repos).map(([k, v]) => [k, v.length])), digest: h.digest("hex") }
}

// ─────────────────────────────────────────────────────────── walk
async function main(): Promise<void> {
  const { files, repos, digest } = draw()
  console.log(`draw: ${files.length} lua files from ${Object.keys(repos).length} repos  digest=${digest.slice(0, 12)}`)

  const byFileName = new Map<string, Site[]>()
  const declaredIn = new Map<string, Set<string>>()
  const edges: Edge[] = []
  const failures: string[] = []
  let symbols = 0, emptyNames = 0, fallbackFiles = 0, symbolLineZero = 0, edgeLineZero = 0
  let offOntology: Record<string, number> = {}
  let edgeLineZeroByType: Record<string, number> = {}

  for (let i = 0; i < files.length; i++) {
    const rel = files[i]
    let r: any
    try {
      r = await parseFile(path.join(CR, rel), CR)
    } catch (e) {
      failures.push(`${rel}: ${(e as Error)?.message ?? e}`)
      continue
    }
    if (!r) { failures.push(`${rel}: no result`); continue }
    if (r.fallback === true) fallbackFiles++
    const syms: Site[] = []
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      symbols++
      const name = String(s?.name ?? "")
      if (name.length === 0) { emptyNames++; continue }
      const a = symbolLine(s), b = symbolEndLine(s)
      if (a === 0) symbolLineZero++
      syms.push({
        file: rel, name,
        kind: String(s?.kind ?? ""),
        qual: String(s?.qualifiedName ?? ""),
        scope: String(s?.scope ?? ""),
        startLine: a, endLine: b,
      })
      let set = declaredIn.get(name)
      if (!set) { set = new Set(); declaredIn.set(name, set) }
      set.add(rel)
    }
    byFileName.set(rel, syms)
    for (const e of Array.isArray(r.relationships) ? r.relationships : []) {
      const raw = String(e?.type ?? e?.relationshipType ?? "")
      const onto = LABEL_ALIASES[raw]
      if (!onto) { offOntology[raw] = (offOntology[raw] ?? 0) + 1; continue }
      const l = edgeLine(e)
      if (l === 0) { edgeLineZero++; edgeLineZeroByType[onto] = (edgeLineZeroByType[onto] ?? 0) + 1 }
      edges.push({
        t: onto,
        s: String(e?.source ?? e?.from ?? e?.fromSymbol ?? ""),
        g: String(e?.target ?? e?.to ?? e?.toSymbol ?? ""),
        l, f: rel,
      })
    }
    if ((i + 1) % 500 === 0) console.log(`  ...${i + 1}/${files.length} files, ${edges.length} edges`)
  }
  console.log(`walk complete: ${byFileName.size} files, ${symbols} symbols, ${edges.length} edges, ${declaredIn.size} distinct declared names`)

  // ── `incoming-check.ts`'s map, reproduced VERBATIM
  //
  // bare name -> DISTINCT kinds, with qualifiedName indexed beside it when it
  // differs. Reproduced rather than approximated so `--compare` is like-for-like.
  const kindsOf = new Map<string, Set<string>>()
  const sitesByName = new Map<string, Site[]>()
  const sitesByQual = new Map<string, Site[]>()
  const addKind = (k: string, kind: string): void => {
    let set = kindsOf.get(k)
    if (!set) { set = new Set(); kindsOf.set(k, set) }
    set.add(kind)
  }
  const addSites = (m: Map<string, Site[]>, k: string, v: Site): void => {
    const a = m.get(k)
    if (a) a.push(v)
    else m.set(k, [v])
  }
  for (const [, syms] of byFileName) {
    for (const s of syms) {
      addKind(s.name, s.kind)
      addSites(sitesByName, s.name, s)
      if (s.qual.length > 0 && s.qual !== s.name) {
        addKind(s.qual, s.kind)
        addSites(sitesByQual, s.qual, s)
      }
    }
  }
  /** S(T): both spellings, deduped on (file, qualifiedName, kind, line). */
  const sitesFor = (t: string): Site[] => {
    const seen = new Set<string>()
    const out: Site[] = []
    for (const s of [...(sitesByName.get(t) ?? []), ...(sitesByQual.get(t) ?? [])]) {
      const id = `${s.file}|${s.qual || s.name}|${s.kind}|${s.startLine}`
      if (seen.has(id)) continue
      seen.add(id)
      out.push(s)
    }
    return out
  }
  const byFile = new Map<string, Map<string, Site[]>>()
  for (const [f, syms] of byFileName) {
    const m = new Map<string, Site[]>()
    for (const s of syms) {
      const arr = m.get(s.name) ?? []
      arr.push(s)
      m.set(s.name, arr)
    }
    byFile.set(f, m)
  }

  // ── per-type rows
  type Row = {
    edges: number
    multiSymbol: number
    multiKind: number
    B1_lineSettled: number
    B2b_fileAbsent: number
    B2c_noneVisible: number
    B3_indistinct: number
    visibilityRuleSensitive: number
    unresolved: number
    selfLoop: number
    emptyTarget: number
    lexicallyUnique: number
    lexicallyInnerWins: number
    classB_finalSegmentResolves: number
    classB_finalSegmentNotPublished: number
    classC_stdlibExternal: number
    classC_otherUndeclared: number
    scopeLabel: number
    b1Names: Record<string, number>
    b2bNames: Record<string, number>
    b2cNames: Record<string, number>
    b3Names: Record<string, number>
    classBExamples: Record<string, number>
    classCExamples: Record<string, number>
  }
  const blank = (): Row => ({
    edges: 0, multiSymbol: 0, multiKind: 0, B1_lineSettled: 0, B2b_fileAbsent: 0, B2c_noneVisible: 0,
    B3_indistinct: 0, visibilityRuleSensitive: 0,
    unresolved: 0, selfLoop: 0, emptyTarget: 0, lexicallyUnique: 0, lexicallyInnerWins: 0,
    classB_finalSegmentResolves: 0, classB_finalSegmentNotPublished: 0,
    classC_stdlibExternal: 0, classC_otherUndeclared: 0, scopeLabel: 0,
    b1Names: {}, b2bNames: {}, b2cNames: {}, b3Names: {}, classBExamples: {}, classCExamples: {},
  })
  const perType: Record<string, Row> = {}
  for (const t of TYPES) perType[t] = blank()

  const ambNames = new Set<string>()
  const multiSymbolNames = new Set<string>()
  let totalMultiSymbol = 0, totalMultiKind = 0, totalB1 = 0, totalB2b = 0, totalB2c = 0, totalB3 = 0, totalUnres = 0
  let overlapCrossFile = 0, overlapMultiKindInMultiSymbol = 0
  let settleK = { byFile: 0, byKind: 0, byBoth: 0, byNeither: 0 }
  let ruleSensitive = 0

  const bump = (rec: Record<string, number>, k: string): void => { rec[k] = (rec[k] ?? 0) + 1 }

  for (const e of edges) {
    const row = perType[e.t]
    row.edges++
    const T = e.g
    if (T.length === 0) { row.emptyTarget++; continue }
    if (T === e.s) { row.selfLoop++; continue }
    if (SCOPE_LABELS.has(T)) { row.scopeLabel++; continue }

    // incoming-check's own verdict, reproduced
    const hits = kindsOf.get(T)
    if (!hits || hits.size === 0) {
      row.unresolved++
      totalUnres++
      // ── ROUND BRIEF class C: external emitted as if local
      if (LUA54_BASE.has(T)) {
        row.classC_stdlibExternal++
        bump(row.classCExamples, T)
      } else {
        row.classC_otherUndeclared++
        bump(row.classCExamples, T)
      }
      // ── ROUND BRIEF class B: emitter/publisher disagree on the SPELLING
      const dot = T.lastIndexOf(".")
      if (dot > 0 && dot < T.length - 1) {
        const tail = T.slice(dot + 1)
        if (kindsOf.has(tail)) {
          row.classB_finalSegmentResolves++
          bump(row.classBExamples, `${e.t} ${T}`)
        } else {
          row.classB_finalSegmentNotPublished++
        }
      }
      continue
    }
    if (hits.size > 1) { row.multiKind++; totalMultiKind++; ambNames.add(T) }

    const sites = sitesFor(T)
    if (sites.length <= 1) continue

    row.multiSymbol++
    totalMultiSymbol++
    multiSymbolNames.add(T)
    if (new Set(sites.map((s) => s.file)).size > 1) overlapCrossFile++
    if (hits.size > 1) overlapMultiKindInMultiSymbol++

    // settleBy: what a consumer could have used, on this walk
    const oneFile = new Set(sites.map((s) => s.file)).size === 1
    const oneKind = hits.size === 1
    if (oneFile && oneKind) settleK.byBoth++
    else if (oneFile) settleK.byFile++
    else if (oneKind) settleK.byKind++
    else settleK.byNeither++

    // ── Lua's name visibility, applied to the edge's OWN file
    //
    // LUA VISIBILITY IS NOT SPAN-BASED. A `local f` at line 10 is visible from
    // line 10 to the end of its enclosing block, so a call at line 20 IS that
    // binding even though the declaration's own span (10..10) does not cover
    // line 20. A span test therefore reports a correct forward reference as
    // "nothing visible here". An earlier version of this file used the span test
    // alone and reported 88.74% of the multiSymbol population as unresolved by
    // scope; most of that was forward references, not ambiguity.
    //
    // Two rules are therefore computed on the same walk and the answer is
    // reported under BOTH, so this instrument's own rule choice is a measured
    // number instead of an assumption:
    //
    //   ORDER  candidate declared at or before the edge's line; among those the
    //          LAST wins, because a later `local` of the same name shadows an
    //          earlier one from its own declaration onward.
    //   SPAN   candidate's span covers the line: startLine <= l <= endLine;
    //          among those the innermost (shortest span) wins.
    const local = byFile.get(e.f)?.get(T) ?? []
    if (local.length === 0) { row.B2b_fileAbsent++; totalB2b++; bump(row.b2bNames, T); continue }
    const vOrder = verdictOrder(local, e.l)
    const vSpan = verdictSpan(local, e.l)
    if (vOrder !== vSpan) { row.visibilityRuleSensitive++; ruleSensitive++ }
    if (vOrder === "unique") {
      row.B1_lineSettled++
      totalB1++
      row.lexicallyUnique++
      bump(row.b1Names, T)
      continue
    }
    if (vOrder === "picksOne") {
      row.B1_lineSettled++
      totalB1++
      row.lexicallyInnerWins++
      bump(row.b1Names, T)
      continue
    }
    if (vOrder === "tie") { row.B3_indistinct++; totalB3++; bump(row.b3Names, T); continue }
    row.B2c_noneVisible++
    totalB2c++
    bump(row.b2cNames, T)
  }

  // ── orphan declarations: a published declaration nothing names
  const named = new Set<string>()
  for (const e of edges) if (e.g.length > 0 && kindsOf.has(e.g)) named.add(e.g)
  let declaredNames = 0, orphans = 0
  for (const [n, set] of declaredIn) {
    declaredNames += set.size
    if (!named.has(n)) orphans += set.size
  }

  const report = {
    tool: "lua-ambiguity-split",
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    corpus: {
      root: CR,
      method: `git ls-files '*.lua' per repo, sorted, no cap (deterministic, not random)`,
      filesDrawn: files.length,
      repos,
      drawDigest: digest,
    },
    production: {
      filesParsed: byFileName.size,
      parseFailures: failures,
      symbols,
      emptyNames,
      relationships: edges.length,
      fallbackFiles,
      offOntologyRelationshipLabels: offOntology,
      distinctDeclaredNames: declaredIn.size,
      edgeLineZero,
      edgeLineZeroByType,
      symbolLineZero,
    },
    definitions: {
      multiSymbol: "|S(T)| > 1 where S(T) = declarations whose name is T, plus declarations whose qualifiedName is exactly T, deduped on (file, qualifiedName, kind, startLine)",
      multiKind: "|{kind : d in S(T)}| > 1 — this is script/m14/incoming-check.ts's rule, reproduced verbatim",
      B1_lineSettled: "the edge's OWN file declares T, and a visibility rule names exactly one declaration (unique, or picksOne). THE EDGE IS TRUE; resolving by bare name is what is weak.",
      B2b_fileAbsent: "the edge's own file declares T ZERO times. The collision is entirely in other files, so the declaration this edge names is reachable only through a module path, which the published bare name does not carry.",
      B2c_noneVisible: "the edge's own file declares T more than once and no candidate satisfies the ORDER rule at the edge's line — the edge precedes every local declaration of that name.",
      B3_indistinct: "several candidates satisfy the ORDER rule at the edge's line and the last-declared tie-break cannot separate them — same startLine, same name, one file. The published NAME cannot express this.",
      precedence: "over the multiSymbol population: B3 and B2c and B1 and B2b partition it, because B2b is decided first (own-file candidate count) and the rest by the ORDER verdict",
      visibilityOrderRule: "candidate declared at or before the edge's line (startLine <= l); among those the LAST wins, because a later local of the same name shadows an earlier one from its own declaration onward. THIS IS THE CORRECT RULE FOR LUA: a local at line 10 is visible at line 20.",
      visibilitySpanRule: "candidate's own span covers the line (startLine <= l <= endLine); innermost (shortest span) wins. RETAINED ONLY to measure the instrument's own sensitivity — a forward reference is invisible to it.",
      visibilityRuleSensitive: "edges where the ORDER verdict and the SPAN verdict disagree. This is how much the rule choice moves the buckets.",
      stdlibListIs: "TRANSCRIBED from the Lua 5.4 reference manual, NOT derived from the corpus — the claim is 'named in the documented stdlib surface'",
    },
    totals: {
      edges: edges.length,
      multiSymbol: totalMultiSymbol,
      multiKind: totalMultiKind,
      B1_lineSettled: totalB1,
      B2b_fileAbsent: totalB2b,
      B2c_noneVisible: totalB2c,
      B3_indistinct: totalB3,
      visibilityRuleSensitive: ruleSensitive,
      unresolved: totalUnres,
      distinctMultiSymbolNames: multiSymbolNames.size,
      distinctMultiKindNames: ambNames.size,
      declaredNameOccurrences: declaredNames,
      orphanDeclarationOccurrences: orphans,
      settleBy: settleK,
      overlap: { crossFileInMultiSymbol: overlapCrossFile, multiKindInsideMultiSymbol: overlapMultiKindInMultiSymbol },
    },
    perType,
  }
  const outAbs = path.resolve(ROOT, OUT)
  mkdirSync(path.dirname(outAbs), { recursive: true })
  writeFileSync(outAbs, JSON.stringify(report, null, 2) + "\n")

  const pad = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
  console.log("")
  console.log(`LUA AMBIGUITY SPLIT — ${report.production.filesParsed} files, ${symbols} symbols, ${edges.length} edges, drawDigest ${digest.slice(0, 12)}`)
  console.log("")
  console.log(pad("type", 13) + pad("edges", 9) + pad("multiSym", 10) + pad("multiKind", 10) + pad("B1", 9) + pad("B2b", 9) + pad("B2c", 9) + pad("B3", 9) + pad("unres", 9) + pad("clsB", 8) + pad("clsC", 8))
  console.log("-".repeat(120))
  let te = 0, tmS = 0, tmK = 0, tb1 = 0, tb2b = 0, tb2c = 0, tb3 = 0, tu = 0, tcb = 0, tcc = 0
  for (const t of TYPES) {
    const r = perType[t]
    te += r.edges; tmS += r.multiSymbol; tmK += r.multiKind
    tb1 += r.B1_lineSettled; tb2b += r.B2b_fileAbsent; tb2c += r.B2c_noneVisible; tb3 += r.B3_indistinct; tu += r.unresolved
    tcb += r.classB_finalSegmentResolves; tcc += r.classC_stdlibExternal + r.classC_otherUndeclared
    console.log(
      pad(t, 13) + pad(r.edges, 9) + pad(r.multiSymbol, 10) + pad(r.multiKind, 10) +
      pad(r.B1_lineSettled, 9) + pad(r.B2b_fileAbsent, 9) + pad(r.B2c_noneVisible, 9) + pad(r.B3_indistinct, 9) +
      pad(r.unresolved, 9) + pad(r.classB_finalSegmentResolves, 8) + pad(r.classC_stdlibExternal + r.classC_otherUndeclared, 8),
    )
  }
  console.log("-".repeat(120))
  console.log(pad("TOTAL", 13) + pad(te, 9) + pad(tmS, 10) + pad(tmK, 10) + pad(tb1, 9) + pad(tb2b, 9) + pad(tb2c, 9) + pad(tb3, 9) + pad(tu, 9) + pad(tcb, 8) + pad(tcc, 8))
  console.log("")
  console.log(`multiSymbol / multiKind ratio on the same walk : ${tmS} / ${tmK} = ${tmK === 0 ? "n/a" : (tmS / tmK).toFixed(2)}`)
  console.log(`distinct names carrying a multiSymbol edge    : ${multiSymbolNames.size}`)
  console.log(`distinct names carrying a multiKind edge       : ${ambNames.size}`)
  console.log(`B1  own file declares it, visibility names one : ${tb1}  (${pct(tb1, tmS)} of multiSymbol)`)
  console.log(`B2b own file declares it ZERO times           : ${tb2b}  (${pct(tb2b, tmS)} of multiSymbol)`)
  console.log(`B2c own file has it, none visible at the line  : ${tb2c}  (${pct(tb2c, tmS)} of multiSymbol)`)
  console.log(`B3  ORDER rule cannot separate them           : ${tb3}  (${pct(tb3, tmS)} of multiSymbol)`)
  console.log(`check B1+B2b+B2c+B3 = ${tb1 + tb2b + tb2c + tb3} vs multiSymbol ${tmS} ${tb1 + tb2b + tb2c + tb3 === tmS ? "PARTITION OK" : "DOES NOT PARTITION"}`)
  console.log(`visibility-rule sensitive (ORDER vs SPAN)     : ${ruleSensitive}  (${pct(ruleSensitive, tmS)} of multiSymbol)`)
  console.log(`overlaps: crossFile-in-multiSymbol ${overlapCrossFile}, multiKind-inside-multiSymbol ${overlapMultiKindInMultiSymbol}`)
  console.log(`orphan declaration occurrences                : ${orphans} of ${declaredNames} (${pct(orphans, declaredNames)})`)
  console.log("")
  console.log(`class B — dotted target whose FINAL SEGMENT is published: ${tcb}   (imports ${perType.imports.classB_finalSegmentResolves})`)
  console.log(`class C — undeclared and undotted: stdlib ${TYPES.reduce((a, t) => a + perType[t].classC_stdlibExternal, 0)}, other ${TYPES.reduce((a, t) => a + perType[t].classC_otherUndeclared, 0)}`)
  const top = (rec: Record<string, number>, n: number) =>
    Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} (${v})`).join(", ")
  for (const t of TYPES) {
    const r = perType[t]
    if (r.b3Names && Object.keys(r.b3Names).length) console.log(`  B3 ${t}: ${top(r.b3Names, 8)}`)
  }
  console.log(`  class C top (all types merged): ${top(merged(perType, "classCExamples"), 14)}`)
  console.log(`  class B top (all types merged): ${top(merged(perType, "classBExamples"), 8)}`)
  console.log("")
  console.log(`edge line 0 (disables the lexical test on that edge): ${edgeLineZero}   symbol line 0: ${symbolLineZero}`)
  console.log(`artifact: ${OUT}`)

  if (COMPARE) {
    // The fleet row lives on the supervisor's aggregate, not on a lane branch.
    // A lane must not vendor it (it is supervisor-owned), so this accepts an
    // absolute path or a path relative to either ROOT or the CWD, and a MISSING
    // file is a declared absence — not an unhandled throw. The previous version
    // read the file unguarded and aborted AFTER writing the artifact, which
    // turned a bad --compare argument into a lost measurement.
    const cands = [
      path.resolve(ROOT, COMPARE),
      path.resolve(process.cwd(), COMPARE),
      path.resolve(COMPARE),
    ]
    const cmpAbs = cands.find((c) => existsSync(c))
    console.log("")
    if (!cmpAbs) {
      console.log(`--compare: ${COMPARE} not found. Looked at:`)
      for (const c of cands) console.log(`    ${c}`)
      console.log(`  Declared absence: no fleet row compared. The table above stands on its own walk.`)
    } else {
      const tsv = readFileSync(cmpAbs, "utf8")
      const head = tsv.split("\n")[0].split("\t")
      const row = tsv.split("\n").find((l) => l.split("\t")[0] === "lua")
      console.log(`--compare ${cmpAbs}`)
      if (!row) console.log(`  no lua row in that file (columns: ${head.join(",")})`)
      else {
        const [, f, fired, amb, unres] = row.split("\t")
        const myFired = TYPES.filter((t) => perType[t].edges > 0).length
        console.log(`  files    fleet ${pad(f, 8)} this run ${pad(report.production.filesParsed, 8)} ${report.production.filesParsed === Number(f) ? "AGREE" : "DIFFER — different populations, not comparable"}`)
        console.log(`  fired    fleet ${pad(fired, 8)} this run ${pad(myFired, 8)} ${myFired === Number(fired) ? "AGREE" : "DIFFER"}`)
        console.log(`  amb      fleet ${pad(amb, 8)} this run ${pad(tmK, 8)} ${tmK === Number(amb) ? "AGREE" : "DIFFER — populations differ; the fleet draw is not published"}`)
        console.log(`  unres    fleet ${pad(unres, 8)} this run ${pad(tu, 8)} ${tu === Number(unres) ? "AGREE" : "DIFFER — populations differ; the fleet draw is not published"}`)
        console.log(`  and the OTHER definition of ambiguous on THIS run: multiSymbol ${tmS} (${(tmS / (tmK === 0 ? 1 : tmK)).toFixed(2)}x the kind count)`)
      }
    }
  }
  console.log("")
  console.log("Exit 0 always: this reports, it does not gate.")
}

function merged(perType: Record<string, Row>, key: "classCExamples" | "classBExamples"): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of Object.keys(perType)) for (const [k, v] of Object.entries(perType[t][key])) out[k] = (out[k] ?? 0) + v
  return out
}
function pct(a: number, b: number): string {
  return b === 0 ? "n/a" : `${((a / b) * 100).toFixed(2)}%`
}

await main()