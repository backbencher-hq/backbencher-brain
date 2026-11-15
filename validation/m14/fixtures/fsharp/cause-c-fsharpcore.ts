/**
 * FSHARP LANE — cause C, measured: how much of the unresolved population is
 * Microsoft.FSharp.Core, and therefore external by construction rather than a
 * name this lane published wrongly.
 *
 * ## Why this file exists
 *
 * The 600-file draw (`incoming-abc.mts`, draw `60da58a2088c4e6a`) partitions
 * this lane's 29,580 unresolved edges and finds U4 — "target names nothing in
 * the sample" — holding 26,093 of them, 88.2%. For `calls` alone U4 is 17,623
 * of 17,635 unresolved. The fleet brief calls the corresponding class cause C,
 * "EXTERNAL REFERENCES EMITTED AS IF LOCAL ... FSharp.Core symbols. Legitimately
 * outside the corpus."
 *
 * That sentence is a claim about which names are external. **This file measures
 * it**, against the one enumeration that can settle it.
 *
 * ## The two instruments, and why two
 *
 * FSharp.Core is not in any checkout as a compiled reference, but its SOURCE is in
 * this corpus (`repositories/fsharp/src/FSharp.Core`). So:
 *
 *   1. **SOURCE** — production `parseFile` over every `.fs` AND `.fsi` under that
 *      directory, recursively. This is the surface as the language declares it,
 *      read through the same front end that produced the edges under test.
 *   2. **BSL** — the `FSharp.Core.SurfaceArea.*.bsl` files, the compiler team's own
 *      machine-generated declaration of the public surface, in the corpus at
 *      `repositories/fsharp/tests/FSharp.Core.UnitTests/`. This is an INDEPENDENT
 *      witness: it was not produced by this analyzer and it enumerates the
 *      compiled surface rather than the source.
 *
 * They are not the same set and the difference is itself reported. All four BSL
 * files are read (netstandard2.0 and 2.1, debug and release) and the union is the
 * witness, so the netstandard2.1-only members are not silently absent.
 *
 * ## The first run of this instrument reported a finding that was its own bug
 *
 * v1 walked `readdirSync(FSharp.Core)` non-recursively and filtered on `.fs`. That is
 * 34 of the 67 `.fs`/`.fsi` files present, and it excluded every `.fsi` — which is
 * where the pervasive operators are declared. The consequence was concrete and large:
 * `failwith`, `ignore`, `not` and `fst` each resolve to a symbol published ONLY in
 * `prim-types.fsi`, so v1 filed 22,277 U4 edges (85.38% of U4) under "neither witness
 * names it" when the primary witness had simply never read the file. Every one of
 * those four names is a core F# operator that any F# corpus calls constantly.
 *
 * A number that moves because the instrument looked at more files is not a finding
 * about the language, and reporting v1's number would have been that. The recursion
 * and the `.fsi` inclusion are therefore part of the instrument, not a correction
 * appended to its output, and `assertWitnessCoverage` below fails the run if the
 * primary witness stops naming a name that F# programs obviously cannot avoid.
 *
 * What the SOURCE enumeration cannot settle remains stated: a name it publishes is
 * external only in the sense that the declaration lives in a library no corpus
 * checkout compiles. Whether the analyzer had any business emitting the edge at all
 * is a separate question, and marking a name external moves it between two columns
 * of the unresolved table — it does not delete an edge.
 *
 * ## What is NOT claimed
 *
 * This file does not assert that the analyzer is correct on the edges it marks
 * external. It asserts only that those edge targets name symbols that live in a
 * library no corpus checkout provides, so they cannot be resolved by any change to
 * what this lane emits. Whether the analyzer had any business emitting the edge at
 * all is a separate question, and the count of edges under review is unchanged
 * either way — marking a name external moves it between two columns of the
 * unresolved table, it does not delete an edge.
 *
 * ## No regex
 *
 * The BSL is a flat `<Owner>: <ReturnType> <Name>[<T>](<params>)` list, read by
 * `indexOf`/`split`/`lastIndexOf` only. The corpus walk is `readdirSync` plus the
 * production `parseFile`. No pattern literal appears in this file and none is
 * needed — including the coverage assertion, which is a `Set.has` membership test.
 *
 * ## Corpus dependency, stated
 *
 * Both instruments read files inside `repositories/fsharp`. If that checkout is
 * absent this file EXITS NON-ZERO with the reason. It does not fall back to a
 * hand-written name list: a list of names I chose is exactly the guess this
 * measurement exists to replace, and a silent fallback would print a confident
 * number derived from nothing.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/fsharp/cause-c-fsharpcore.ts \
 *     --draw validation/m14/measurements/fsharp-incoming-abc-600.json
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

import { parseFile } from "../../../../src/ast/pool-worker"

/** This directory, so the default draw path does not depend on the caller's cwd. */
const HERE = path.dirname(fileURLToPath(import.meta.url))

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const CORE_SRC = path.join(CR, "fsharp", "src", "FSharp.Core")
const CORE_BSL_DIR = path.join(CR, "fsharp", "tests", "FSharp.Core.UnitTests")
/**
 * INSTRUMENT 3 — the FSharp.Compiler project, which is the SAME checkout as FSharp.Core.
 *
 * The v2 partition left a 20,068-edge `neither` bucket and named it as the next
 * measurement rather than guessing at it. Its widest names are `InlineIfLambda` (763
 * edges), `Extension` (473), `RequireQualifiedAccess` (112), `AutoOpen` (110) — which are
 * FSharp.Compiler.Syntax / FSharp.Compiler.Symbols declarations, not FSharp.Core ones, and
 * the same `repositories/fsharp` checkout that supplies witness 1 declares them under
 * `src/Compiler`. So the second external population is witnessed from source rather than
 * inferred from how its names look.
 *
 * `src/Compiler` and NOT `src`: the sibling projects under `src` (FSharp.Build,
 * FSharp.Compiler.LanguageServer, LegacyMSBuildResolver) are a third population with their
 * own names, and admitting them here would make this witness a claim about "the compiler
 * repo" rather than about FSharp.Compiler. A narrower witness that says what it is beats a
 * wider one whose boundary is arguable.
 */
const COMPILER_SRC = path.join(CR, "fsharp", "src", "Compiler")
/** All four surface-area files, so netstandard2.1-only members are not silently absent. */
const CORE_BSL = [
  "FSharp.Core.SurfaceArea.netstandard20.release.bsl",
  "FSharp.Core.SurfaceArea.netstandard20.debug.bsl",
  "FSharp.Core.SurfaceArea.netstandard21.release.bsl",
  "FSharp.Core.SurfaceArea.netstandard21.debug.bsl",
].map((f) => path.join(CORE_BSL_DIR, f))
const DRAW_DEFAULT = path.join(
  HERE, "..", "..", "..", "..",
  "validation", "m14", "measurements", "fsharp-incoming-abc-600.json",
)
/**
 * The UNSLICED unresolved-target table, written as NDJSON by `incoming-abc.mts`.
 *
 * `report.unresolvedDetail` inside the draw JSON is truncated to 120 rows for
 * reading. Summing it yields a page's worth of edges presented as the whole set —
 * the first run of this instrument did exactly that and reported U4 = 0 against a
 * draw that totals 26,093. Every number below therefore comes from the sidecar,
 * and this file REFUSES to run if the sidecar's edge total disagrees with the
 * draw's own `unresU1..U4` total. A silent page-vs-population mismatch is the one
 * failure this instrument must not have.
 */
const UNRES_SIDECAR_DEFAULT = DRAW_DEFAULT.replace(/\.json$/, ".unresolved.ndjson")

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const DRAW_PATH = argValue("--draw") ?? DRAW_DEFAULT
const UNRES_PATH = argValue("--unresolved") ?? UNRES_SIDECAR_DEFAULT

// ───────────────────────────────────────────── instrument 1: FSharp.Core SOURCE
/**
 * Every name the FSharp.Core source publishes, via the production front end.
 *
 * RECURSIVE, and `.fsi` IS INCLUDED. Both are load-bearing, and v1 of this file got
 * both wrong; see the header. `prim-types.fsi` alone is where `failwith`, `ignore`,
 * `not` and `fst` are declared, and the `math/` subdirectory holds members no
 * top-level walk would have seen. A non-recursive `.fs`-only walk reads 34 of the
 * 67 files present and files the pervasive operators as "named by neither witness".
 */
const coreSourceNames = new Map<string, Set<string>>()
const coreSourceDecls = new Map<string, string[]>()
/**
 * THE COVERAGE ASSERTION, hoisted so the JSON output carries it.
 *
 * F# programs cannot avoid these; if the primary witness does not publish one of
 * them then the instrument has stopped reading the file that declares it, and every
 * share it prints is a share of an under-read population. This is the check whose
 * absence made v1's 85.38% look like a finding about F# rather than about the
 * fixture. Exits non-zero rather than printing a confident wrong partition.
 *
 * Every entry is a DECLARATION, not a keyword. `inline` was in the first draft of
 * this list and the assertion caught that too: it is a reserved word, so no parse of
 * FSharp.Core can ever publish it under that name, and a list containing an
 * unpublishable name is a check that cannot pass rather than one that detects
 * under-reading. The list is now asserted to pass against this corpus.
 */
const MUST_BE_WITNESSED = [
  "failwith", "ignore", "not", "fst", "snd", "printfn", "sprintf", "failwithf",
  "raise", "nameof", "invalidArg", "invalidOp", "id", "box", "string",
]
let coreFiles = 0
let coreSignatures = 0
let coreSymbols = 0
let coreDegraded = 0
{
  if (!existsSync(CORE_SRC)) {
    console.error(
      `FAIL: FSharp.Core source not found at ${CORE_SRC}\n` +
      `This instrument has no fallback by design. A hand-written name list would\n` +
      `print a confident number derived from a guess. Clone the compiler repo:\n` +
      `  git clone --depth 1 --filter=blob:none https://github.com/dotnet/fsharp ${CORE_SRC}`,
    )
    process.exit(2)
  }
  /** Depth-first, sorted, so the file list and therefore every count is deterministic. */
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir).sort()) {
      const p = path.join(dir, e)
      let dirent: ReturnType<typeof statSync>
      try { dirent = statSync(p) } catch { continue }
      if (dirent.isDirectory()) walk(p, out)
      else if (e.endsWith(".fs") || e.endsWith(".fsi")) out.push(p)
    }
    return out
  }
  const files = walk(CORE_SRC)
  const allNames = new Set<string>()
  for (const abs of files) {
    let r: any
    try {
      r = await parseFile(abs, CORE_SRC)
    } catch {
      continue
    }
    if (!r) continue
    coreFiles++
    if (abs.endsWith(".fsi")) coreSignatures++
    if (r.fallback === true) coreDegraded++
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      coreSymbols++
      const rel = path.relative(CORE_SRC, abs)
      allNames.add(name)
      let set = coreSourceNames.get(name)
      if (!set) {
        set = new Set()
        coreSourceNames.set(name, set)
      }
      set.add(String(s?.kind ?? ""))
      const decls = coreSourceDecls.get(name) ?? []
      if (decls.length < 3) { decls.push(rel); coreSourceDecls.set(name, decls) }
      // The qualified form's leaf is the same declaration reached by its dotted
      // spelling, so a target like `List.map` is recognised from its leaf.
      const q = String(s?.qualifiedName ?? "")
      if (q.length > 0) {
        const leaf = q.slice(q.lastIndexOf(".") + 1)
        if (leaf.length > 0 && leaf !== name) {
          allNames.add(leaf)
          let l = coreSourceNames.get(leaf)
          if (!l) {
            l = new Set()
            coreSourceNames.set(leaf, l)
          }
          l.add(String(s?.kind ?? ""))
          const ld = coreSourceDecls.get(leaf) ?? []
          if (ld.length < 3) { ld.push(rel); coreSourceDecls.set(leaf, ld) }
        }
      }
    }
  }
  /**
   * The assertion named above. `failwith`, `ignore`, `not` and `fst` are the four that
   * v1 missed: all four are declared ONLY in `prim-types.fsi`, which v1's `.fs`-only
   * filter never opened.
   */
  const missing = MUST_BE_WITNESSED.filter((n) => !allNames.has(n))
  if (missing.length > 0) {
    console.error(
      `FAIL: the FSharp.Core SOURCE witness does not publish ${missing.length} of ` +
      `${MUST_BE_WITNESSED.length} names every F# program uses:\n  ${missing.join(" ")}\n` +
      `The witness is under-reading the library. Refusing to print a partition of U4\n` +
      `against an instrument that cannot see the operators.`,
    )
    process.exit(4)
  }
}

// ───────────────────────────────────────────── instrument 2: the BSL surface
/** The compiler team's own public-surface declaration. An independent witness. */
const bslMembers = new Set<string>()
const bslTypes = new Set<string>()
/** file -> member names it declared, so a reader can see which file carried a name. */
const bslByFile = new Map<string, Set<string>>()
let bslLines = 0
{
  const present = CORE_BSL.filter((f) => existsSync(f))
  if (present.length === 0) {
    console.error(
      `FAIL: no FSharp.Core surface-area BSL found under ${CORE_BSL_DIR}\n` +
      `This is the independent witness. Without it the SOURCE enumeration is the\n` +
      `only instrument and a reader cannot tell an analyzer name from a core name.`,
    )
    process.exit(2)
  }
  for (const file of present) {
    const rows = new Set<string>()
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      const line = raw.trimEnd()
      if (line.length === 0 || line.startsWith("!")) continue
      const ci = line.indexOf(": ")
      if (ci <= 0) continue
      bslLines++
      bslTypes.add(line.slice(0, ci).slice(line.slice(0, ci).lastIndexOf(".") + 1))
      // Cut the parameter list, then the type-parameter list, then take the LAST
      // whitespace token — the first is the return type.
      let rest = line.slice(ci + 2)
      const p = rest.indexOf("(")
      if (p >= 0) rest = rest.slice(0, p)
      const br = rest.indexOf("[")
      if (br >= 0) rest = rest.slice(0, br)
      const toks = rest.split(" ").filter((t) => t.length > 0)
      const name = toks[toks.length - 1] ?? ""
      if (name.length > 0) { bslMembers.add(name); rows.add(name) }
    }
    bslByFile.set(path.basename(file), rows)
  }
  if (present.length < CORE_BSL.length) {
    console.error(
      `FAIL: only ${present.length} of ${CORE_BSL.length} surface-area BSL files are ` +
      `present under ${CORE_BSL_DIR}. A partial witness is a subset used as if it were\n` +
      `the surface, and netstandard2.1-only members would read as absent.`,
    )
    process.exit(2)
  }
}

// ───────────────────────────────────── instrument 3: FSharp.Compiler SOURCE
/**
 * Every name the FSharp.Compiler project publishes, by the same route as witness 1.
 *
 * Same discipline, for the same reason: RECURSIVE, `.fsi` INCLUDED, and a coverage
 * assertion that fails the run rather than letting a share be printed against an
 * under-read population. `MUST_BE_WITNESSED_COMPILER` is three names that are BOTH
 * confirmed declarations under `src/Compiler` AND present in the U4 population this
 * instrument is about — `InlineIfLambda` in `TypedTree/TypedTreeOps.Transforms.fsi`,
 * `RequireQualifiedAccess` under `Driver/GraphChecking`, `AutoOpen` under `Facilities`.
 *
 * Asserting on names that are in the population is what makes this a coverage check
 * rather than a tautology: a name nothing references would pass even if the witness were
 * reading nothing at all, while these three can only be found by actually opening the
 * files that declare them.
 */
const compilerSourceNames = new Map<string, Set<string>>()
const compilerSourceDecls = new Map<string, string[]>()
const MUST_BE_WITNESSED_COMPILER = ["InlineIfLambda", "RequireQualifiedAccess", "AutoOpen"]
let compilerFiles = 0
let compilerSignatures = 0
let compilerSymbols = 0
let compilerDegraded = 0
{
  if (!existsSync(COMPILER_SRC)) {
    console.error(
      `FAIL: FSharp.Compiler source not found at ${COMPILER_SRC}\n` +
      `Without this witness the U4 \`neither\` bucket cannot be reduced, and printing it\n` +
      `as 'not external' would be a guess about a population of ${""}names. Clone:\n` +
      `  git clone --depth 1 --filter=blob:none https://github.com/dotnet/fsharp ${COMPILER_SRC}`,
    )
    process.exit(2)
  }
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir).sort()) {
      const p = path.join(dir, e)
      let dirent: ReturnType<typeof statSync>
      try { dirent = statSync(p) } catch { continue }
      if (dirent.isDirectory()) walk(p, out)
      else if (e.endsWith(".fs") || e.endsWith(".fsi")) out.push(p)
    }
    return out
  }
  const files = walk(COMPILER_SRC)
  const allNames = new Set<string>()
  const add = (name: string, kind: string, rel: string): void => {
    allNames.add(name)
    let set = compilerSourceNames.get(name)
    if (!set) { set = new Set(); compilerSourceNames.set(name, set) }
    set.add(kind)
    const decls = compilerSourceDecls.get(name) ?? []
    if (decls.length < 3) { decls.push(rel); compilerSourceDecls.set(name, decls) }
  }
  for (const abs of files) {
    let r: any
    try {
      r = await parseFile(abs, COMPILER_SRC)
    } catch {
      continue
    }
    if (!r) continue
    compilerFiles++
    if (abs.endsWith(".fsi")) compilerSignatures++
    if (r.fallback === true) compilerDegraded++
    const rel = path.relative(COMPILER_SRC, abs)
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      compilerSymbols++
      add(name, String(s?.kind ?? ""), rel)
      const q = String(s?.qualifiedName ?? "")
      if (q.length > 0) {
        const leaf = q.slice(q.lastIndexOf(".") + 1)
        if (leaf.length > 0 && leaf !== name) add(leaf, String(s?.kind ?? ""), rel)
      }
    }
  }
  const missing = MUST_BE_WITNESSED_COMPILER.filter((n) => !allNames.has(n))
  if (missing.length > 0) {
    console.error(
      `FAIL: the FSharp.Compiler SOURCE witness does not publish ${missing.length} of ` +
      `${MUST_BE_WITNESSED_COMPILER.length} names this population references:\n  ` +
      `${missing.join(" ")}\n` +
      `The witness is under-reading the project. Refusing to print a partition of U4\n` +
      `against an instrument that cannot see them.`,
    )
    process.exit(4)
  }
}

type DrawRow = {
  type: string
  class: string
  target: string
  edges: number
  fileCount: number
}
type Draw = {
  draw: string
  population: { filesSampled: number; relationships: number; symbols: number; filesParsed: number }
  totals: Record<string, number>
  unresolvedDetail: DrawRow[]
}
const draw: Draw = JSON.parse(readFileSync(DRAW_PATH, "utf8"))

/** Read the UNSLICED table and refuse to proceed if it does not account for the draw's own total. */
function readUnresolved(pathname: string): DrawRow[] {
  if (!existsSync(pathname)) {
    console.error(
      `FAIL: unsliced unresolved table not found at ${pathname}\n` +
      `Produced by incoming-abc.mts, which writes it beside its --out file. The draw's\n` +
      `own unresolvedDetail is capped at 120 rows for reading and cannot be summed.`,
    )
    process.exit(2)
  }
  const rows: DrawRow[] = []
  for (const line of readFileSync(pathname, "utf8").split("\n")) {
    if (line.trim().length === 0) continue
    rows.push(JSON.parse(line) as DrawRow)
  }
  return rows
}
const unresolvedRows = readUnresolved(UNRES_PATH)

const leafOf = (t: string): string => {
  const i = t.lastIndexOf(".")
  return i <= 0 ? t : t.slice(i + 1)
}
const headOf = (t: string): string => {
  const i = t.indexOf(".")
  return i <= 0 ? t : t.slice(0, i)
}

/**
 * The witness ladder, in the order a row is tested. A target lands in the FIRST bucket
 * that names it, so the four FSharp.Core buckets keep exactly the meaning they had in v2 —
 * which is what keeps the 6,025-edge figure in the v2 commit comparable — and
 * `compiler_source` is what is left after both FSharp.Core witnesses decline.
 *
 * `compiler_source` is deliberately LAST rather than first. A name both projects declare
 * (`Extension` is one) is attributed to FSharp.Core, because that is the library an F#
 * program implicitly has open and it is the population the v2 number already counted.
 */
type Witness = "source_and_bsl" | "source_only" | "bsl_only" | "compiler_source" | "neither"
function witness(target: string): { w: Witness; via: "leaf" | "head" | "none" } {
  const leaf = leafOf(target)
  const head = headOf(target)
  const sLeaf = coreSourceNames.has(leaf)
  const sHead = coreSourceNames.has(head)
  const bLeaf = bslMembers.has(leaf) || bslTypes.has(leaf)
  const bHead = bslMembers.has(head) || bslTypes.has(head)
  const s = sLeaf || sHead
  const b = bLeaf || bHead
  const via = sLeaf || bLeaf ? "leaf" : sHead || bHead ? "head" : "none"
  if (s && b) return { w: "source_and_bsl", via }
  if (s) return { w: "source_only", via }
  if (b) return { w: "bsl_only", via }
  const cLeaf = compilerSourceNames.has(leaf)
  const cHead = compilerSourceNames.has(head)
  if (cLeaf || cHead) return { w: "compiler_source", via: cLeaf ? "leaf" : "head" }
  return { w: "neither", via: "none" }
}

// ───────────────────────────────────────────── the partition
type Bucket = { names: number; edges: number }
const buckets = (): Record<Witness, Bucket> => ({
  source_and_bsl: { names: 0, edges: 0 },
  source_only: { names: 0, edges: 0 },
  bsl_only: { names: 0, edges: 0 },
  compiler_source: { names: 0, edges: 0 },
  neither: { names: 0, edges: 0 },
})
/** One type's row: the same buckets, so a type never has to be looked up twice. */
type TypeRow = Record<Witness, Bucket>
const WITNESSES: Witness[] = ["source_and_bsl", "bsl_only", "source_only", "compiler_source", "neither"]
const bucketSum = (r: TypeRow, w?: Witness) =>
  w ? r[w] : WITNESSES.reduce((a, k) => a + r[k].edges, 0)

const u4ByType = new Map<string, TypeRow>()
const u4All = buckets()
const otherNames = new Map<string, number>()
const coreNames = new Map<string, { edges: number; w: Witness; via: string }>()
let u4Edges = 0

/**
 * ONE per-type table over all four witness buckets.
 *
 * The first version of this loop kept the witnessed edges and the unwitnessed edges
 * in two separate maps and printed two tables. That is worse than it looks: the
 * witnessed map's `neither` column was structurally always 0, because the loop
 * routed unwitnessed rows to the other map, so the page showed two large buckets as
 * if they were small — 5,605 calls and 274 references, 5,879 edges, against a U4
 * population of 26,093, with 20,214 edges unmentioned in either table. One map, one
 * row per type, and a TOTAL row that has to reconcile or the run is wrong.
 */
for (const row of unresolvedRows) {
  if (row.class !== "U4_namesNothing") continue
  u4Edges += row.edges
  const { w, via } = witness(row.target)
  u4All[w].edges += row.edges
  // Every bucket counts its names. v2 incremented this only for the WITNESSED
  // buckets, so `neither` printed 0 names beside 20,068 edges — a column that says
  // "no distinct target" over the widest bucket in the table.
  u4All[w].names++
  let t = u4ByType.get(row.type)
  if (!t) { t = buckets(); u4ByType.set(row.type, t) }
  t[w].edges += row.edges
  t[w].names++
  if (w !== "neither") {
    const c = coreNames.get(row.target)
    if (c) { c.edges += row.edges } else coreNames.set(row.target, { edges: row.edges, w, via })
  } else {
    otherNames.set(row.target, (otherNames.get(row.target) ?? 0) + row.edges)
  }
}

/**
 * Where a witnessed name was declared, across ALL witnesses.
 *
 * v2 answered this from `coreSourceDecls` alone, which was complete while FSharp.Core was
 * the only source witness. With a second project in the ladder a name attributed to
 * FSharp.Core but declared in both projects would be reported with one project's files and
 * no indication the other also declares it, so the lookup tries the project the bucket
 * names and falls back to the other rather than printing an empty list.
 */
function declaredIn(name: string, w: Witness): string[] {
  const compilerFirst = w === "compiler_source"
  const first = compilerFirst ? compilerSourceDecls : coreSourceDecls
  const second = compilerFirst ? coreSourceDecls : compilerSourceDecls
  const hit = first.get(name)
  if (hit && hit.length > 0) {
    const other = second.get(name)
    return other && other.length > 0
      ? [...hit.map((f) => `${f}`), ...other.map((f) => `${f} (also)`)]
      : hit
  }
  return second.get(name) ?? []
}

const unresolvedTotal = ["unresU1", "unresU2", "unresU3", "unresU4"]
  .reduce((a, k) => a + (draw.totals[k] ?? 0), 0)

/** Named witness either instrument carries. These edges cannot be resolved in-corpus. */
const externalEdges = u4Edges - u4All.neither.edges

/**
 * RECONCILIATION, before any number is printed.
 *
 * The sidecar must account for exactly the draw's unresolved total. If it does not,
 * the two artifacts are from different runs or one of them is truncated, and every
 * share below would be a share of the wrong population.
 */
const sidecarEdges = unresolvedRows.reduce((a, r) => a + r.edges, 0)
{
  if (sidecarEdges !== unresolvedTotal) {
    console.error(
      `FAIL: sidecar accounts for ${sidecarEdges} unresolved edges, draw totals ` +
      `${unresolvedTotal}. Refusing to print shares of a population that does not reconcile.`,
    )
    process.exit(3)
  }
}

const pad = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
const pct = (a: number, b: number) => (b === 0 ? "—" : `${((100 * a) / b).toFixed(2)}%`)

/**
 * The result as DATA, beside the console page.
 *
 * A number that lives only in a scrollback buffer is not reproducible from a clean
 * corpus: the next run has to be diffed against prose to see whether it moved. This
 * object carries the instrument's own version, the draw it measured, both witnesses'
 * populations, and the reconciliation, so a reader can check the shares without
 * trusting the arithmetic above. The `widest` lists are the same 25/40 the page
 * prints, so the file is a page plus provenance, not a silently larger claim.
 */
const OUT = argValue("--out") ?? DRAW_PATH.replace(/\.json$/, ".cause-c.json")
const outJson = {
  instrument: "fsharp-cause-c-fsharpcore",
  version: 3,
  /** v1 walked non-recursively and skipped `.fsi`; its "neither" bucket was that bug. */
  versionNote:
    "v1 read 34 of the 67 .fs/.fsi files present and filed 22,277 edges as named by " +
    "neither witness. failwith/ignore/not/fst are declared only in prim-types.fsi. " +
    "v2 recurses and includes .fsi; the coverage assertion MUST_BE_WITNESSED fails " +
    "the run if the primary witness ever stops seeing them again. v3 adds " +
    "instrument 3, the FSharp.Compiler project, because v2's 20,068-edge `neither` " +
    "bucket was named as the next measurement instead of being guessed at: its widest " +
    "names (InlineIfLambda 763, Extension 473, RequireQualifiedAccess 112, AutoOpen " +
    "110) are FSharp.Compiler.Syntax / .Symbols declarations in the same checkout. The " +
    "ladder tests the FSharp.Core witnesses FIRST and unchanged, so v2's 6,025-edge " +
    "figure still means the same thing and the two partitions are comparable.",
  draw: draw.draw,
  population: {
    filesParsed: draw.population.filesParsed,
    relationships: draw.population.relationships,
    symbols: draw.population.symbols,
    unresolvedTotal,
    u4Edges,
  },
  witnesses: {
    source: {
      corpusPath: CORE_SRC,
      filesParsed: coreFiles,
      signatureFiles: coreSignatures,
      symbols: coreSymbols,
      degraded: coreDegraded,
      distinctNames: coreSourceNames.size,
      mustBeWitnessed: MUST_BE_WITNESSED,
      mustBeWitnessedAllFound: true,
    },
    bsl: {
      corpusPath: CORE_BSL_DIR,
      files: [...bslByFile.keys()],
      rows: bslLines,
      memberNames: bslMembers.size,
      typeNames: bslTypes.size,
    },
    compiler: {
      corpusPath: COMPILER_SRC,
      filesParsed: compilerFiles,
      signatureFiles: compilerSignatures,
      symbols: compilerSymbols,
      degraded: compilerDegraded,
      distinctNames: compilerSourceNames.size,
      mustBeWitnessed: MUST_BE_WITNESSED_COMPILER,
      mustBeWitnessedAllFound: true,
    },
  },
  partition: {
    source_and_bsl: u4All.source_and_bsl,
    bsl_only: u4All.bsl_only,
    source_only: u4All.source_only,
    compiler_source: u4All.compiler_source,
    neither: u4All.neither,
    externalEitherWitness: externalEdges,
    confirmedByBoth: u4All.source_and_bsl.edges,
  },
  perType: Object.fromEntries(
    [...u4ByType].map(([t, b]) => [t, { ...b, u4Edges: bucketSum(b) }]),
  ),
  /** The per-type table summed, so a reader can check it against `partition` without adding columns. */
  perTypeTotals: Object.fromEntries(
    WITNESSES.map((w) => [w, {
      names: [...u4ByType.values()].reduce((a, b) => a + b[w].names, 0),
      edges: [...u4ByType.values()].reduce((a, b) => a + b[w].edges, 0),
    }]),
  ),
  widestConfirmedExternal: [...coreNames]
    .sort((a, z) => z[1].edges - a[1].edges).slice(0, 25)
    .map(([name, c]) => ({ name, edges: c.edges, witness: c.w, via: c.via, declaredIn: declaredIn(name, c.w) })),
  widestNeitherWitness: [...otherNames].sort((a, z) => z[1] - a[1]).slice(0, 40)
    .map(([name, edges]) => ({ name, edges })),
  reconciliation: { sidecarRows: unresolvedRows.length, sidecarEdges: sidecarEdges, drawUnresolvedTotal: unresolvedTotal },
  reproduce: `npx tsx validation/m14/fixtures/fsharp/cause-c-fsharpcore.ts --draw ${DRAW_PATH}`,
}

console.log(`fsharp cause C — draw ${draw.draw}, ${draw.population.filesParsed} files parsed, ` +
  `${draw.population.relationships} relationships, ${draw.population.symbols} symbols`)
console.log("")
console.log("INSTRUMENT 1 — FSharp.Core SOURCE, production parseFile, RECURSIVE over .fs AND .fsi")
console.log(`  files parsed ${coreFiles} (of which ${coreSignatures} .fsi signatures)   symbols ${coreSymbols}   degraded ${coreDegraded}   distinct names ${coreSourceNames.size}`)
console.log(`  corpus path ${CORE_SRC}`)
console.log("INSTRUMENT 2 — FSharp.Core SURFACE (compiler team's own BSL, independent witness, union of 4 files)")
console.log(`  rows ${bslLines}   member names ${bslMembers.size}   type names ${bslTypes.size}`)
for (const [f, rows] of bslByFile) console.log(`    ${pad(f, 48)} ${rows.size} distinct member names`)
console.log(`  corpus path ${CORE_BSL_DIR}`)
console.log("INSTRUMENT 3 — FSharp.Compiler SOURCE, production parseFile, RECURSIVE over .fs AND .fsi")
console.log(`  files parsed ${compilerFiles} (of which ${compilerSignatures} .fsi signatures)   symbols ${compilerSymbols}   degraded ${compilerDegraded}   distinct names ${compilerSourceNames.size}`)
console.log(`  coverage assertion ${MUST_BE_WITNESSED_COMPILER.join(", ")} — all found`)
console.log(`  corpus path ${COMPILER_SRC}`)
console.log("")
console.log(`U4 ("names nothing in the sample") = ${u4Edges} of ${unresolvedTotal} unresolved ` +
  `(${pct(u4Edges, unresolvedTotal)}) — and ${pct(unresolvedTotal, draw.population.relationships)} of all edges`)
console.log("")
console.log("U4 PARTITIONED BY WITNESS  (edges-weighted; `names` = distinct targets)")
console.log(pad("witness", 18) + pad("names", 8) + pad("edges", 9) + "share of U4   share of unresolved")
console.log("-".repeat(78))
for (const w of WITNESSES) {
  console.log(pad(w, 18) + pad(u4All[w].names, 8) + pad(u4All[w].edges, 9) +
    pad(pct(u4All[w].edges, u4Edges), 16) + pct(u4All[w].edges, unresolvedTotal))
}
console.log("-".repeat(78))
console.log(`EXTERNAL (either witness)  ${pad(externalEdges, 8)} edges  ${pct(externalEdges, u4Edges)} of U4  ` +
  `${pct(externalEdges, unresolvedTotal)} of unresolved`)
console.log(`CONFIRMED BY BOTH WITNESSES ${pad(u4All.source_and_bsl.edges, 6)} edges  ${pct(u4All.source_and_bsl.edges, u4Edges)} of U4`)
console.log("")
console.log("PER TYPE — U4 edges by witness. ONE row per type; the TOTAL row must reconcile to U4.")
console.log(pad("type", 16) + pad("both", 9) + pad("bslOnly", 9) + pad("sourceOnly", 11) + pad("compiler", 10) + pad("neither", 10) + "u4 edges   share")
console.log("-".repeat(88))
const rowsByType = [...u4ByType].sort((a, z) => bucketSum(z[1]) - bucketSum(a[1]))
const totals: Record<Witness, Bucket> = Object.fromEntries(
  WITNESSES.map((w) => [w, { names: 0, edges: 0 }])) as Record<Witness, Bucket>
let typeSum = 0
for (const [t, b] of rowsByType) {
  const tot = bucketSum(b)
  typeSum += tot
  for (const w of WITNESSES) { totals[w].edges += b[w].edges; totals[w].names += b[w].names }
  console.log(pad(t, 16) + pad(b.source_and_bsl.edges, 9) + pad(b.bsl_only.edges, 9) +
    pad(b.source_only.edges, 11) + pad(b.compiler_source.edges, 10) + pad(b.neither.edges, 10) + pad(tot, 10) + pct(tot, u4Edges))
}
console.log("-".repeat(88))
console.log(pad("TOTAL", 16) + pad(totals.source_and_bsl.edges, 9) + pad(totals.bsl_only.edges, 9) +
  pad(totals.source_only.edges, 11) + pad(totals.compiler_source.edges, 10) + pad(totals.neither.edges, 10) + pad(typeSum, 10))
const reconciles = WITNESSES.every((w) => totals[w].edges === u4All[w].edges) && typeSum === u4Edges
console.log(`  per-type TOTAL vs bucket TOTAL: ${reconciles ? "RECONCILES" : "DOES NOT RECONCILE"}`)
if (!reconciles) { console.error("FAIL: per-type table does not account for U4."); process.exit(5) }
console.log("")
console.log("WIDEST U4 TARGETS CONFIRMED EXTERNAL  (declared in, so a reader can check)")
for (const [n, c] of [...coreNames].sort((a, z) => z[1].edges - a[1].edges).slice(0, 25)) {
  console.log(`  ${pad(n, 46)} ${pad(c.edges, 6)} edges  ${c.w} (via ${c.via})  ${declaredIn(n, c.w).join(",")}`)
}
console.log("")
console.log("RESIDUAL — NO WITNESS NAMES IT. Not classified as external and not classified as local.")
console.log("  Two populations are known to be here and CANNOT be witnessed with what is on this")
console.log("  machine, so the residual is reported as a size and not apportioned:")
console.log("    * the BCL — `EventArgs`, `Func`, `Trim`, `ReadAllText`, `IsNullOrWhiteSpace`.")
console.log("      A declaration of that surface would be the .NET reference assemblies, and")
console.log("      ~/.dotnet holds no ref packs (no System.Runtime.dll anywhere on disk).")
console.log("    * NUnit — `Benchmark`, `shouldEqual`, `testCase`, `Fact`, `Exactly`. The corpus")
console.log("      carries .fsproj files REFERENCING the NUnit package, which declares a")
console.log("      dependency and not a member name, so it witnesses neither.")
for (const [n, e] of [...otherNames].sort((a, z) => z[1] - a[1]).slice(0, 40)) {
  console.log(`  ${pad(n, 46)} ${pad(e, 6)} edges`)
}
console.log("")
console.log(`draw ${DRAW_PATH}`)
console.log(`unsliced unresolved table ${UNRES_PATH} — ${unresolvedRows.length} rows, reconciled to ${unresolvedTotal} edges`)
console.log(`reproduce: npx tsx validation/m14/fixtures/fsharp/cause-c-fsharpcore.ts --draw ${DRAW_PATH}`)
