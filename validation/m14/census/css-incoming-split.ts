/**
 * CSS INCOMING SPLIT — where do the reverse-walk's targets land, and WHICH of the
 * buckets is the analyzer's to repair?
 *
 * ## Why this file exists
 *
 * `script/m14/incoming-check.ts` (the supervisor's instrument, shared machinery) answers
 * one question per target: does the string resolve, and does it resolve to MORE THAN ONE
 * KIND? That is the right question for a gate and the wrong question for a repair, because
 * a repair needs to know WHY a target failed. `archive/docs-pre-consolidation/ROUND-BRIEF.md` asks for the split, and
 * this file is the split:
 *
 *   U0  resolves to exactly ONE declaration in the window          — sound
 *   U1  resolves to N>1 declarations, ALL OF ONE KIND               — same name, N scopes
 *   U2  resolves to N>1 declarations, 2+ KINDS                      — name collision
 *   U3  resolves to nothing in the window, but a declaration EXISTS elsewhere in the
 *       admitted corpus                                            — window population
 *   U4  resolves to nothing in the window AND nowhere in the corpus — genuinely absent
 *
 * The instrument's `ambiguousTargets` is U2 alone (`published` is a name -> KINDS map, so
 * `hits.length > 1` means two KINDS, not two declarations). U1 is invisible to it and can
 * be the larger population. This file counts both, and additionally counts each bucket by
 * NAME and by EDGE, because a bucket measured only by edge is not a statement about symbol
 * identity and a bucket measured only by name is not a statement about the graph.
 *
 * ## Why U3 and U4 must be separated
 *
 * The brief's rule is that an unresolved target naming a declaration outside the sampled
 * window is not a defect. In CSS that population is structurally large: a class selector
 * used by a component's stylesheet is usually DEFINED by markup or by a JavaScript
 * template, so it has no CSS declaration anywhere. If U3 and U4 are reported as one number,
 * a correct analyzer and a broken one print the same figure. They are separated here, and
 * U4 is reported per SHAPE (`classifyTargetShape`) because "never declared" and "declared
 * as the wrong kind" are different findings with different fixes.
 *
 * ## U1 is not one population, and the difference decides whether it is a defect
 *
 * U1 counts a name declared N>1 times. On its own that number overstates the harm,
 * because the store does NOT bind a relationship target by an arbitrary winner:
 * `src/ast/parallel-indexer.ts:2239` (`resolveTargetStmt`) is
 *
 *   WHERE s.project_id = ? AND s.name = ?
 *   ORDER BY COALESCE(s.is_declaration,0) ASC, (s.file_id = ?) DESC, ... LIMIT 1
 *
 * so a SAME-FILE declaration of the name wins over every other file's, and
 * `resolveContainsTargetStmt` (:2354) adds the edge's own line as the second key. A
 * cross-file name collision is therefore harmless whenever the referencing file declares
 * the name itself, which is the normal case for a `references` edge to a custom property.
 * This file reports that split explicitly — `bindsSameFile` per edge — so U1 is not quoted
 * as a defect count when the population behind it is already resolved.
 *
 * The consequence for the lane's own scope: what remains after `bindsSameFile` is removed
 * is NOT fixable by emitting more edges or by publishing a different name. In CSS a custom
 * property is a GLOBAL name by specification; eight theme files each declaring
 * `--pico-font-family` are eight legitimate declarations of one global name. Choosing one
 * would be the fabrication the workstream forbids.
 *
 * ## ZERO REGEX
 *
 * `classifyTargetShape` reads `charCodeAt` and `startsWith`. A regex over a target string
 * would be a text matcher deciding what a NAME means — the defect class the regex census
 * exists to prevent. `script/m12/verify-regex-census.ts` is the arbiter and it must keep
 * printing 0 for this lane.
 *
 * ## Sampling
 *
 * Same admission rule as `css-parsefile-census.ts` (git-tracked, real dir, <= 512 KB,
 * `detectLanguageFromPath(abs, text) === "css"`), same deterministic STRIDE over the
 * concatenated per-repo `git ls-files` order, so the window spreads over every repo rather
 * than exhausting the alphabetically-first ones. The WHOLE admitted corpus is also parsed,
 * because U3 is by definition a question about files outside the window and cannot be
 * answered from inside it.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/census/css-incoming-split.ts --window 600 --json out.json
 *   npx tsx validation/m14/census/css-incoming-split.ts --window 600 --probe 25
 *
 * ## READ-ONLY with respect to the corpus. Writes nothing unless --json is given.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const num = (flag: string, dflt: number): number => {
  const i = argv.indexOf(flag)
  return i >= 0 ? Number(argv[i + 1]) || dflt : dflt
}
const WINDOW = num("--window", 600)
const PROBE = num("--probe", 0)
const jsonAt = argv.indexOf("--json")
const JSON_OUT = jsonAt >= 0 ? String(argv[jsonAt + 1]) : ""
/** Bound the whole-corpus parse when the census is only a probe, so --probe stays cheap. */
const PROBE_ONLY = argv.includes("--probe-only")

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

/** Store label -> ontology name. Same alias table shape as the shared instrument. */
const LABEL: Record<string, Type> = {
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

// ---------------------------------------------------------------- target shape

type Shape =
  | "class-selector" | "id-selector" | "custom-property" | "type-selector"
  | "keyframe-name" | "media-feature" | "pseudo-class" | "pseudo-element"
  | "module-path" | "url-path" | "at-keyword" | "bare-identifier" | "other"

/**
 * What KIND of CSS thing a target string names, read from its first characters.
 *
 * CharCode/startsWith only — see the ZERO REGEX note in the header. The classification is
 * about the SHAPE of a published name, not about whether a construct exists in the file, so
 * it cannot be fooled by a comment or a string literal: the string arrived here as a
 * relationship endpoint the analyzer already derived from the tree.
 */
function classifyTargetShape(t: string): Shape {
  if (t.length === 0) return "other"
  if (t.charCodeAt(0) === 46 /* . */) return "class-selector"
  if (t.charCodeAt(0) === 35 /* # */) return "id-selector"
  if (t.charCodeAt(0) === 45 /* - */ && t.charCodeAt(1) === 45 /* - */) return "custom-property"
  if (t.charCodeAt(0) === 58 /* : */) {
    return t.indexOf("::") === 0 ? "pseudo-element" : "pseudo-class"
  }
  if (t.charCodeAt(0) === 64 /* @ */) return "at-keyword"
  if (t.indexOf("/") >= 0 || t.indexOf(".css") > 0) return "module-path"
  if (t.endsWith("url()") || t.endsWith(".svg") || t.endsWith(".png")) return "url-path"
  const head = t.slice(0, 8)
  if (head.indexOf("keyframes") === 0) return "keyframe-name"
  if (head.indexOf("media") === 0) return "media-feature"
  // A lowercase bare word with no punctuation is a type selector (an element name).
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    const lower = c >= 97 && c <= 122
    const digit = c >= 48 && c <= 57
    const dash = c === 45
    if (!lower && !digit && !dash) return "bare-identifier"
  }
  return "type-selector"
}

// ---------------------------------------------------------------- corpus walk

type File = { repo: string; rel: string; abs: string }

const every: File[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "css") continue
    every.push({ repo: e, rel, abs })
  }
}

const windowFiles = (() => {
  if (every.length <= WINDOW) return every
  const stride = Math.max(1, Math.floor(every.length / WINDOW))
  const out: File[] = []
  for (let i = 0; i < every.length && out.length < WINDOW; i += stride) out.push(every[i])
  return out
})()
const inWindow = new Set(windowFiles.map((f) => f.abs))

// ---------------------------------------------------------------- parse

/** One published declaration, identified by file + name + kind. */
type Decl = { file: string; repo: string; name: string; qualifiedName: string; kind: string }

const corpusUniverse = new Map<string, Decl[]>()
const windowUniverse = new Map<string, Decl[]>()
/** target string -> per-type edge count, with one exemplar (source, sourceFile). */
const targets = new Map<string, Map<Type, { edges: number; src: string; file: string }>>()
/** Every window edge, retained so the store's same-file preference can be applied per edge. */
type Edge = { t: Type; tgt: string; src: string; file: string }
const edges: Edge[] = []
let symbols = 0
let degraded = 0
const parseFailures: string[] = []
let filesParsed = 0
const kindsSeen: Record<string, number> = {}

const toFiles = PROBE_ONLY ? windowFiles : every
for (const f of toFiles) {
  let r: any
  try {
    r = await parseFile(f.abs, path.dirname(f.abs))
  } catch (e) {
    parseFailures.push(`${f.abs}: ${(e as Error)?.message ?? e}`)
    continue
  }
  if (!r) {
    parseFailures.push(`${f.abs}: no result`)
    continue
  }
  if (r.fallback === true) degraded++
  filesParsed++

  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    symbols++
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    const kind = String(s?.kind ?? "")
    kindsSeen[kind] = (kindsSeen[kind] ?? 0) + 1
    const q = String(s?.qualifiedName ?? "")
    const decl: Decl = { file: f.abs, repo: f.repo, name, qualifiedName: q, kind }
    for (const key of q.length > 0 && q !== name ? [name, q] : [name]) {
      const arr = corpusUniverse.get(key)
      if (arr) arr.push(decl)
      else corpusUniverse.set(key, [decl])
      if (inWindow.has(f.abs)) {
        const w = windowUniverse.get(key)
        if (w) w.push(decl)
        else windowUniverse.set(key, [decl])
      }
    }
  }

  // Edges are collected from the WINDOW only: an edge from a file outside the window is not
  // part of the population the shared instrument measures, and mixing them in would make
  // the before/after incomparable. Each edge keeps its source FILE, because the store's
  // same-file preference (see the header) is what separates a resolved collision from a
  // harmful one.
  if (!inWindow.has(f.abs)) continue
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const t = LABEL[String(rel?.type ?? "")]
    if (!t) continue
    const tgt = String(rel?.target ?? "")
    if (tgt.length === 0) continue
    const src = String(rel?.source ?? "")
    edges.push({ t, tgt, src, file: f.abs })
    let byType = targets.get(tgt)
    if (!byType) {
      byType = new Map()
      targets.set(tgt, byType)
    }
    const row = byType.get(t)
    if (row) row.edges++
    else byType.set(t, { edges: 1, src, file: f.abs })
  }
}

// ---------------------------------------------------------------- classify

type Bucket = "U0-unique" | "U1-multi-one-kind" | "U2-multi-multi-kind" | "U3-outside-window" | "U4-absent-corpus"

const bucketOf = (t: string): { bucket: Bucket; nWin: number; kindsWin: number; nCorpus: number; outside: string[] } => {
  const w = windowUniverse.get(t) ?? []
  const kinds = new Set(w.map((d) => d.kind))
  const c = corpusUniverse.get(t) ?? []
  const outside = c.filter((d) => !inWindow.has(d.file)).map((d) => d.file)
  if (w.length === 1) return { bucket: "U0-unique", nWin: 1, kindsWin: 1, nCorpus: c.length, outside }
  if (w.length > 1) {
    return {
      bucket: kinds.size > 1 ? "U2-multi-multi-kind" : "U1-multi-one-kind",
      nWin: w.length, kindsWin: kinds.size, nCorpus: c.length, outside,
    }
  }
  if (c.length > 0) return { bucket: "U3-outside-window", nWin: 0, kindsWin: 0, nCorpus: c.length, outside }
  return { bucket: "U4-absent-corpus", nWin: 0, kindsWin: 0, nCorpus: 0, outside: [] }
}

type TypeRow = {
  fired: boolean
  edges: number
  names: number
  byName: Record<string, number>
  byEdge: Record<string, number>
  shapes: Record<string, Record<string, number>>
  /**
   * The store's own outcome for the TARGET, per edge, applying `resolveTargetStmt`'s key
   * order: a SAME-FILE declaration of the target name wins over every other file's.
   */
  store: {
    /** target name exists nowhere in the window -> stored as target_external */
    external: number
    /** target name exists, and the SOURCE'S OWN file declares it -> unambiguous */
    sameFile: number
    /** target name exists elsewhere but not in the source's file, and only one file has it */
    crossFileUnique: number
    /** target name exists in N>1 other files and not in the source's file: a real collision */
    crossFileCollision: number
  }
  /**
   * The same, for the SOURCE. Reported separately because the two halves fail
   * independently and for different reasons: a source that names no symbol in its own file
   * is recorded `source_external`, which is what every `imports` edge did before the
   * stylesheet-module symbol existed. The target half is measured by `store`, and for
   * `imports` the target is CORRECTLY external — an `@import` specifier names a resource
   * the graph may not hold — so quoting `store.external` as a defect count would be wrong.
   */
  sourceBind: {
    external: number
    sameFile: number
    crossFileUnique: number
    crossFileCollision: number
  }
  /** U1/U2 detail: the multi-declaration targets, ranked by declaration count. */
  collisions: { target: string; shape: Shape; decls: number; kinds: string[]; files: string[] }[]
  /** U4 detail: never declared anywhere, ranked by edge count. */
  absentTop: { target: string; shape: Shape; edges: number; src: string; srcFile: string }[]
}

const blankRow = (): TypeRow => ({
  fired: false, edges: 0, names: 0,
  byName: {}, byEdge: {}, shapes: {},
  store: { external: 0, sameFile: 0, crossFileUnique: 0, crossFileCollision: 0 },
  sourceBind: { external: 0, sameFile: 0, crossFileUnique: 0, crossFileCollision: 0 },
  collisions: [], absentTop: [],
})

const rows: Record<Type, TypeRow> = Object.fromEntries(
  ALL_TYPES.map((t) => [t, blankRow()]),
) as Record<Type, TypeRow>

for (const [tgt, byType] of targets) {
  const shape = classifyTargetShape(tgt)
  const b = bucketOf(tgt)
  for (const [t, info] of byType) {
    const row = rows[t]
    row.fired = true
    row.edges += info.edges
    row.names++
    row.byName[b.bucket] = (row.byName[b.bucket] ?? 0) + 1
    row.byEdge[b.bucket] = (row.byEdge[b.bucket] ?? 0) + info.edges
    const sh = row.shapes[shape] ?? (row.shapes[shape] = {})
    sh[b.bucket] = (sh[b.bucket] ?? 0) + info.edges
    if (b.bucket === "U1-multi-one-kind" || b.bucket === "U2-multi-multi-kind") {
      const w = windowUniverse.get(tgt) ?? []
      row.collisions.push({
        target: tgt, shape, decls: b.nWin, kinds: [...new Set(w.map((d) => d.kind))],
        files: [...new Set(w.map((d) => d.file))].slice(0, 4),
      })
    }
    if (b.bucket === "U4-absent-corpus") {
      row.absentTop.push({ target: tgt, shape, edges: info.edges, src: info.src, srcFile: info.file })
    }
  }
}

for (const t of ALL_TYPES) {
  rows[t].collisions.sort((a, b) => b.decls - a.decls)
  rows[t].absentTop.sort((a, b) => b.edges - a.edges)
}

// The store's per-edge outcome. Kept separate from the bucket counters above on purpose:
// a bucket is a property of the NAME, this is a property of the EDGE plus the store's key
// order, and the two disagree by design — a name declared 8 times in 8 files is one bucket
// and eight resolvable edges.
const bindInto = (row: TypeRow, slot: "store" | "sourceBind", name: string, file: string): void => {
  const w = windowUniverse.get(name) ?? []
  if (w.length === 0) { row[slot].external++; return }
  if (w.some((d) => d.file === file)) { row[slot].sameFile++; return }
  const otherFiles = new Set(w.filter((d) => d.file !== file).map((d) => d.file))
  if (otherFiles.size <= 1) row[slot].crossFileUnique++
  else row[slot].crossFileCollision++
}

for (const e of edges) {
  const row = rows[e.t]
  bindInto(row, "store", e.tgt, e.file)
  bindInto(row, "sourceBind", e.src, e.file)
}

// ---------------------------------------------------------------- report

const totals = {
  edges: 0, names: 0,
  byEdge: {} as Record<string, number>,
  byName: {} as Record<string, number>,
  store: { external: 0, sameFile: 0, crossFileUnique: 0, crossFileCollision: 0 },
  sourceBind: { external: 0, sameFile: 0, crossFileUnique: 0, crossFileCollision: 0 },
}
for (const t of ALL_TYPES) {
  const r = rows[t]
  totals.edges += r.edges
  totals.names += r.names
  totals.store.external += r.store.external
  totals.store.sameFile += r.store.sameFile
  totals.store.crossFileUnique += r.store.crossFileUnique
  totals.store.crossFileCollision += r.store.crossFileCollision
  totals.sourceBind.external += r.sourceBind.external
  totals.sourceBind.sameFile += r.sourceBind.sameFile
  totals.sourceBind.crossFileUnique += r.sourceBind.crossFileUnique
  totals.sourceBind.crossFileCollision += r.sourceBind.crossFileCollision
  for (const k of Object.keys(r.byEdge)) {
    totals.byEdge[k] = (totals.byEdge[k] ?? 0) + r.byEdge[k]
    totals.byName[k] = (totals.byName[k] ?? 0) + r.byName[k]
  }
}

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)

console.log(`corpus admitted ${every.length} | window ${windowFiles.length} | parsed ${filesParsed} | degraded ${degraded} | failures ${parseFailures.length}`)
console.log(`symbols ${symbols} | distinct published names corpus ${corpusUniverse.size} window ${windowUniverse.size}`)
if (PROBE_ONLY) {
  console.log("NOTE --probe-only: only the window was parsed, so the whole-corpus universe IS the window and U3 reads 0 BY CONSTRUCTION. Not a measurement.")
}
console.log("")
console.log("type          fired   edges    names  U0      U1      U2      U3      U4      (by NAME)")
for (const t of ALL_TYPES) {
  const r = rows[t]
  const g = (k: Bucket) => String(r.byName[k] ?? 0).padStart(6)
  console.log(
    `${t.padEnd(13)} ${String(r.edges > 0).padEnd(6)} ${String(r.edges).padStart(7)} ${String(r.names).padStart(7)}  ` +
    `${g("U0-unique")} ${g("U1-multi-one-kind")} ${g("U2-multi-multi-kind")} ${g("U3-outside-window")} ${g("U4-absent-corpus")}`,
  )
}
console.log("")
console.log("TOTAL (by EDGE): " + JSON.stringify(totals.byEdge))
console.log("TOTAL (by NAME): " + JSON.stringify(totals.byName))
console.log("")
console.log("TARGET bind, per edge      edges   sameFile  crossUniq  crossColl  external")
for (const t of ALL_TYPES) {
  const s = rows[t].store
  console.log(
    `  ${t.padEnd(22)} ${String(rows[t].edges).padStart(7)} ${String(s.sameFile).padStart(9)} ` +
    `${String(s.crossFileUnique).padStart(10)} ${String(s.crossFileCollision).padStart(10)} ${String(s.external).padStart(9)}`,
  )
}
console.log("SOURCE bind, per edge      edges   sameFile  crossUniq  crossColl  external")
for (const t of ALL_TYPES) {
  const s = rows[t].sourceBind
  console.log(
    `  ${t.padEnd(22)} ${String(rows[t].edges).padStart(7)} ${String(s.sameFile).padStart(9)} ` +
    `${String(s.crossFileUnique).padStart(10)} ${String(s.crossFileCollision).padStart(10)} ${String(s.external).padStart(9)}`,
  )
}
console.log("")
console.log("kinds: " + JSON.stringify(kindsSeen))
if (parseFailures.length > 0) console.log("parseFailures: " + parseFailures.slice(0, 5).join(" | "))

for (const t of ALL_TYPES) {
  const r = rows[t]
  if (r.absentTop.length > 0 && PROBE > 0) {
    console.log("")
    console.log(`--- ${t}: U4 never-declared targets, top ${Math.min(PROBE, r.absentTop.length)} of ${r.absentTop.length} by edges`)
    for (const a of r.absentTop.slice(0, PROBE)) {
      console.log(`   ${String(a.edges).padStart(5)} edges  shape=${a.shape.padEnd(15)} target=${JSON.stringify(a.target)}  from ${a.srcFile.split("/repositories/")[1] ?? a.srcFile} (src=${JSON.stringify(a.src)})`)
    }
  }
  if (r.collisions.length > 0 && PROBE > 0) {
    console.log("")
    console.log(`--- ${t}: multi-declaration targets (U1+U2), top ${Math.min(PROBE, r.collisions.length)} of ${r.collisions.length} by declaration count`)
    for (const c of r.collisions.slice(0, PROBE)) {
      console.log(`   ${String(c.decls).padStart(4)} decls  kinds=${c.kinds.join(",")}  shape=${c.shape}  target=${JSON.stringify(c.target)}`)
      for (const file of c.files) console.log(`            in ${file.split("/repositories/")[1] ?? file}`)
    }
  }
}

if (JSON_OUT) {
  const out = {
    tool: "css-incoming-split",
    corpusRoot: CR,
    admission: "git-tracked, real dir, <=512KB, detectLanguageFromPath(abs,text)==='css'",
    corpusTotal: every.length,
    window: windowFiles.length,
    /** The window as absolute paths, so `script/m14/incoming-check.ts` can be run on
     *  EXACTLY this population and the two instruments' numbers are comparable. */
    windowFiles: windowFiles.map((f) => f.abs),
    sampling: `deterministic stride over concatenated per-repo git ls-files, target ${WINDOW}`,
    wholeCorpusParsed: PROBE_ONLY ? false : true,
    filesParsed,
    parseFailures: parseFailures.length,
    degraded,
    symbols,
    distinctNamesCorpus: corpusUniverse.size,
    distinctNamesWindow: windowUniverse.size,
    kindCensus: kindsSeen,
    totals,
    types: rows,
  }
  writeFileSync(JSON_OUT, JSON.stringify(out, null, 2))
  console.log("")
  console.log(`wrote ${JSON_OUT}`)
}