/**
 * ZIG FILE-LOCAL MISS CLASSIFIER — why each edge whose target is NOT a published
 * symbol in its OWN file is not.
 *
 * `incoming-resolve.ts` resolves targets against the CORPUS tier: "is this name
 * a published symbol SOMEWHERE in the draw". `ontology-census.ts` also reports a
 * FILE-LOCAL tier: "is this name a published symbol in this edge's own file".
 * Those are different questions and they answer differently, and pass 11 §F left
 * the second one — the stricter, and the one a reverse walk most wants — as a
 * single unexplained percentage per type. This file decomposes it.
 *
 * For every edge whose target is absent from its own file's published-name set,
 * the cause is decided by EVIDENCE, in a fixed ladder whose order matters
 * because the first rung that matches wins:
 *
 *   resolved-file-local    the target IS a published symbol name in this file.
 *                          This is the SAFE shape and nothing else is safe.
 *   scope-marker           the target is a scope marker, not a declaration.
 *   empty                  no target at all. A zero-length edge endpoint.
 *   non-identifier         not a Zig identifier spelling.
 *   path                   an import PATH: it ends `.zig` or holds `/`. In Zig a
 *                          path names a MODULE, and a module is not a
 *                          declaration. Counting these as dropped declarations
 *                          would be the error this ladder exists to prevent.
 *   builtin-fn             an `@`-prefixed Zig builtin. Declared by the language.
 *   builtin-type           a name in the analyzer's own
 *                          ZIG_DECLARED_TYPE_BUILTINS with no published symbol.
 *                          The language declares it; the corpus does not.
 *   dropped-decl-IN-FILE   ** THIS FILE'S OWN TREE declares the name as a
 *                          top-level declaration and the analyzer published no
 *                          symbol for it. This is a defect the analyzer owns and
 *                          this lane fixes. Counted alone, never with the rest. **
 *   dropped-field-IN-FILE  same, declared as a container field.
 *   param-IN-FILE          the file's own tree declares it as a PARAMETER. This
 *                          project's model carries a signature on the function
 *                          symbol and publishes no symbol per parameter, so an
 *                          edge to one is not a dropped declaration.
 *   local-IN-FILE          the file's own tree declares it as a local const.
 *                          Locals are not published, by the same model rule.
 *   declared-elsewhere     the corpus tree declares the name (as decl or field)
 *                          but not in this file: a cross-file reference, which
 *                          the file-local rule cannot satisfy by construction.
 *   declared-elsewhere-p   as above, declared only as a parameter or a local
 *                          somewhere. Not a declaration under this model.
 *   external               NO tree in the whole draw declares the name. Honest
 *                          name: it is UNEXPLAINED — an external package, a
 *                          builtin the analyzer does not enumerate, a name from a
 *                          generated or `@cImport` header. This file does not
 *                          claim to know which, and does not guess.
 *
 * The last three rungs are what makes this a measurement rather than a
 * restatement: `dropped-*-IN-FILE` is a finding about the analyzer, `external`
 * is a finding about the corpus, and they are indistinguishable in a count.
 *
 * CONTROLS, run on every invocation, non-zero exit on failure:
 *   C1 a name published in a synthetic file resolves file-local for an edge in
 *      that file, and the same name does NOT resolve for an edge in another.
 *   C2 a name the file's own tree declares as `decl`, published nowhere, reads
 *      `dropped-decl-IN-FILE` — the rung the whole file exists to count.
 *   C3 a path, an `@`-prefixed builtin and a synthetic absent name read `path`,
 *      `builtin-fn` and `external` respectively: the three rungs a count would
 *      otherwise fold into "unresolved".
 *
 * Usage: npx tsx validation/m14/fixtures/zig/filelocal-miss-class.ts <dump-dir>
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { ZIG_DECLARED_TYPE_BUILTINS } from "../../../../src/ast/real-zig-analyzer"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = process.argv[2] ?? "/tmp/opencode/zig-inc"

/**
 * The artifact name carries the day it was measured, so the default is derived from
 * the clock rather than hardcoded. Four of this lane's instruments hardcoded a date
 * literal, and the consequence was measured on pass 19: re-running `incoming-resolve.ts`
 * on a LATER day overwrote `incoming-resolution-full-2026-10-03.json` in place, leaving a
 * file whose name claims 2026-10-03 and whose content is from a later date — and a
 * `git status` that reads as an edit to an existing measurement rather than as a
 * clobber. Three of the four named 2026-10-04 and one named 2026-10-03, so no two agreed.
 *
 * This is the same shape as §8 items 15 and 18 (an instrument that writes a register it
 * does not own, or under a name that misstates what is in it), with the target being this
 * lane's own artifacts rather than a shared one. `--out` still overrides, so a
 * reproducible re-run can still be written to an explicit name.
 */
const MEASURED_ON = new Date().toISOString().slice(0, 10)
const OUT = arg0("out", path.join(HERE, "measurements", `filelocal-miss-class-${MEASURED_ON}.json`))
function arg0(n: string, d: string): string {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}

const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(2)}%`)

const isIdChar = (c: string): boolean => {
  const k = c.charCodeAt(0)
  return (k >= 97 && k <= 122) || (k >= 65 && k <= 90) || (k >= 48 && k <= 57) || k === 95
}
const isPlainIdent = (s: string): boolean => {
  if (!s.length) return false
  const c0 = s.charCodeAt(0)
  if (!((c0 >= 97 && c0 <= 122) || (c0 >= 65 && c0 <= 90) || c0 === 95)) return false
  for (let i = 1; i < s.length; i++) if (!isIdChar(s[i])) return false
  return true
}
const isBuiltinFnSpelling = (s: string): boolean => s.charCodeAt(0) === 64
const looksLikePath = (s: string): boolean => {
  if (s.endsWith(".zig")) return true
  for (let i = 0; i < s.length; i++) if (s[i] === "/") return true
  return false
}
const SCOPE_MARKERS = new Set(["(global)", "(file)", "(declared-type)", "(import)", "(local)"])
const isScopeMarker = (s: string): boolean => SCOPE_MARKERS.has(s)
/** tree-declared-name kinds, weakest to strongest. A name declared twice in one
 *  file as both a `local` and a `decl` is a `decl`: the stronger reading is the
 *  one that can be a dropped symbol. Same ordering as incoming-resolve.ts. */
const ORD = ["local", "parameter", "field", "decl"]

type Dump = {
  popHash: string
  files: { key: string; symbols: { name: string; kind: string; qualifiedName: string }[]; declaredNames: [string, string][] }[]
  edges: { file: string; source: string; target: string; type: string; line: number; conf: number; meta: string | null; scope: string | null }[]
  fallbackFiles: string[]
}
const shards = readdirSync(DIR).filter((f) => f.startsWith("dump-") && f.endsWith(".json")).sort()
if (!shards.length) { console.error(`no dump-*.json in ${DIR}`); process.exit(2) }
const dumps: Dump[] = shards.map((f) => JSON.parse(readFileSync(path.join(DIR, f), "utf8")) as Dump)
const pops = new Set(dumps.map((d) => d.popHash))
if (pops.size !== 1) { console.error(`REFUSING: shards disagree on the population: ${[...pops]}`); process.exit(2) }
if (dumps.some((d) => d.fallbackFiles.length)) {
  console.error(`REFUSING: a shard reported parseFile fallback — it measured extractFallback, not the analyzer`)
  process.exit(2)
}

// ── the three indexes the ladder reads
/** file -> the published symbol NAMES in that file. The census's file-local
 *  rule, restated from `ontology-census.ts` so the two agree by construction:
 *  an edge resolves file-local iff its target string is in this set. */
const fileNames = new Map<string, Set<string>>()
/** file -> name -> the strongest kind that file's own TREE declares it as. */
const fileDeclared = new Map<string, Map<string, string>>()
/** name -> the strongest kind ANY file's tree declares it as, corpus tier. */
const corpusDeclared = new Map<string, string>()
/** name -> published symbol count, corpus tier. */
const publishedCount = new Map<string, number>()

for (const d of dumps) {
  for (const f of d.files) {
    const names = new Set<string>()
    for (const s of f.symbols) {
      if (!s.name) continue
      names.add(s.name)
      publishedCount.set(s.name, (publishedCount.get(s.name) ?? 0) + 1)
    }
    fileNames.set(f.key, names)
    const dm = new Map<string, string>()
    for (const [n, kd] of f.declaredNames) {
      const prev = dm.get(n)
      if (prev === undefined || ORD.indexOf(kd) > ORD.indexOf(prev)) dm.set(n, kd)
      const cprev = corpusDeclared.get(n)
      if (cprev === undefined || ORD.indexOf(kd) > ORD.indexOf(cprev)) corpusDeclared.set(n, kd)
    }
    fileDeclared.set(f.key, dm)
  }
}

type Class =
  | "resolved-file-local" | "scope-marker" | "empty" | "non-identifier" | "path"
  | "builtin-fn" | "builtin-type" | "dropped-decl-IN-FILE" | "dropped-field-IN-FILE"
  | "param-IN-FILE" | "local-IN-FILE" | "declared-elsewhere" | "declared-elsewhere-p"
  | "external"

/** The ladder. `file` is the edge's own file; its absence means the edge names a
 *  file no shard dumped, which is itself a finding and reads `external` here
 *  while the run reports the count of such edges separately.
 *
 *  ORDER IS THE POINT, and it is the census's order, not this file's. The hit
 *  test runs FIRST and is exactly `ontology-census.ts`'s: the target string is
 *  in the set of names this file published. Every other rung classifies a MISS,
 *  so putting a shape test ahead of the hit test would move edges out of
 *  `resolved-file-local` that the census counts as resolved — and it does:
 *  `contains` carries 1,178 targets that are not plain identifier spellings and
 *  ARE published in their own file, so testing `isPlainIdent` first read
 *  `contains` at 98.43% where the census reads 99.99%. A decomposition whose
 *  complement does not match the number it decomposes is a second measurement
 *  wearing the first one's name. */
function classify(target: string, file: string): Class {
  if (!target) return "empty"
  const own = fileNames.get(file)
  if (own?.has(target)) return "resolved-file-local"
  if (isScopeMarker(target)) return "scope-marker"
  if (isBuiltinFnSpelling(target)) return "builtin-fn"
  if (looksLikePath(target)) return "path"
  if (!isPlainIdent(target)) return "non-identifier"
  if (ZIG_DECLARED_TYPE_BUILTINS.has(target) && !publishedCount.has(target)) return "builtin-type"
  const dm = fileDeclared.get(file)
  const here = dm?.get(target)
  if (here === "decl") return "dropped-decl-IN-FILE"
  if (here === "field") return "dropped-field-IN-FILE"
  if (here === "parameter") return "param-IN-FILE"
  if (here === "local") return "local-IN-FILE"
  const ck = corpusDeclared.get(target)
  if (ck === "decl" || ck === "field") return "declared-elsewhere"
  if (ck === "parameter" || ck === "local") return "declared-elsewhere-p"
  return "external"
}

// ── CONTROLS
{
  const sf = "__ctl_file__"
  const of = "__ctl_other__"
  fileNames.set(sf, new Set(["__ctl_pub__"]))
  fileNames.set(of, new Set())
  fileDeclared.set(sf, new Map([["__ctl_decl__", "decl"], ["__ctl_param__", "parameter"],
    ["__ctl_local__", "local"], ["__ctl_field__", "field"]]))
  fileDeclared.set(of, new Map())
  const c1 = classify("__ctl_pub__", sf) === "resolved-file-local"
    && classify("__ctl_pub__", of) === "external"
  const c2 = classify("__ctl_decl__", sf) === "dropped-decl-IN-FILE"
  const c3 = classify("std/os.zig", sf) === "path"
    && classify("@import", sf) === "builtin-fn"
    && classify("__ctl_absent__", sf) === "external"
    && classify("__ctl_param__", sf) === "param-IN-FILE"
    && classify("__ctl_local__", sf) === "local-IN-FILE"
    && classify("__ctl_field__", sf) === "dropped-field-IN-FILE"
  if (!c1 || !c2 || !c3) {
    console.error(`CONTROL FAILING: C1=${c1} C2=${c2} C3=${c3}`)
    console.error(`  ${JSON.stringify(["__ctl_pub__", "__ctl_decl__", "__ctl_param__", "__ctl_local__", "__ctl_field__"].map((n) => [n, classify(n, sf)]))}`)
    process.exit(2)
  }
  // The synthetic entries are REMOVED, not left behind. Leaving them inflates the
  // file count the census prints by exactly the number of controls, which is how
  // a run reported 3,836 files on a 3,834-file draw.
  fileNames.delete(sf)
  fileNames.delete(of)
  fileDeclared.delete(sf)
  fileDeclared.delete(of)
  if (fileNames.get(sf) || fileDeclared.get(sf)) {
    console.error("CONTROL FAILING: synthetic state survived the control block")
    process.exit(2)
  }
  console.log("controls: 3 ok, 0 FAILING (C1 file-local isolation, C2 dropped-decl rung, C3 path/builtin/absent rungs)")
}

// ── the census
const CLASSES: Class[] = [
  "resolved-file-local", "scope-marker", "empty", "non-identifier", "path", "builtin-fn",
  "builtin-type", "dropped-decl-IN-FILE", "dropped-field-IN-FILE", "param-IN-FILE",
  "local-IN-FILE", "declared-elsewhere", "declared-elsewhere-p", "external",
]
type Row = { edges: number; files: Set<string>; classes: Record<string, number>; confUnder07: number; byReason: Record<string, Record<string, number>> }
const rows = new Map<string, Row>()
const row = (t: string): Row => {
  let r = rows.get(t)
  if (!r) {
    r = { edges: 0, files: new Set(), classes: Object.fromEntries(CLASSES.map((c) => [c, 0])), confUnder07: 0, byReason: {} }
    rows.set(t, r)
  }
  return r
}
let totalEdges = 0
let edgesWithUnseenFile = 0
const droppedDeclNames = new Map<string, number>()
/** name -> the files that dropped it. Per NAME, because a run-wide file count
 *  printed next to every name reads as a per-name count and is not one. */
const droppedDeclFilesOf = new Map<string, Set<string>>()
const droppedDeclFileCount = new Map<string, number>()
const externalNames = new Map<string, number>()
for (const d of dumps) {
  for (const e of d.edges) {
    totalEdges++
    const t = e.type
    const r = row(t)
    r.edges++
    r.files.add(e.file)
    if (!fileNames.has(e.file)) edgesWithUnseenFile++
    const c = classify(e.target, e.file)
    r.classes[c]++
    if (e.conf < 0.7) r.confUnder07++
    const reason = e.meta ?? "(none)"
    const rb = (r.byReason[reason] ??= {})
    rb[c] = (rb[c] ?? 0) + 1
    if (c === "dropped-decl-IN-FILE") {
      droppedDeclNames.set(e.target, (droppedDeclNames.get(e.target) ?? 0) + 1)
      const fs = droppedDeclFilesOf.get(e.target) ?? new Set<string>()
      fs.add(e.file)
      droppedDeclFilesOf.set(e.target, fs)
      droppedDeclFileCount.set(e.file, (droppedDeclFileCount.get(e.file) ?? 0) + 1)
    }
    if (c === "external") externalNames.set(e.target, (externalNames.get(e.target) ?? 0) + 1)
  }
}
const TYPES = [...rows.keys()].sort()
console.log(`\npopulation ${[...pops][0]} · ${dumps.length} shards · ${totalEdges} edges · ${fileNames.size} files`)
if (edgesWithUnseenFile) console.log(`  NOTE: ${edgesWithUnseenFile} edges name a file no shard dumped; classified as if external`)

console.log(`\nFILE-LOCAL RESOLUTION, decomposed. "local hit" is the census's own strict rule.`)
console.log(`type${" ".repeat(11)}edges${" ".repeat(5)}local hit   MISS CLASSES, largest first`)
for (const t of TYPES) {
  const r = rows.get(t)!
  const miss = r.edges - r.classes["resolved-file-local"]
  const parts = Object.entries(r.classes)
    .filter(([c]) => c !== "resolved-file-local")
    .sort((a, b) => b[1] - a[1])
    .map(([c, v]) => `${c} ${v} (${pct(v, miss)})`)
  console.log(`${t.padEnd(15)}${String(r.edges).padEnd(9)}${pct(r.classes["resolved-file-local"], r.edges).padEnd(12)}${parts.join(", ")}`)
}

/** C4 — CROSS-INSTRUMENT. The local-hit rate this file reports must equal the
 *  rate `ontology-census.ts` reports for the same type on the same population,
 *  or this decomposition is decomposing a number nobody published. The
 *  expectation is passed in, never hardcoded from this file's own output, so a
 *  drift in either instrument is a non-zero exit rather than a second number.
 *
 *  `--expect-local type=pct,type=pct`. Skipped when absent, and saying so, so an
 *  unverified run is not read as a verified one. */
const expectArg = arg0("expect-local", "")
if (expectArg) {
  const want = new Map(expectArg.split(",").map((kv) => {
    const [k, v] = kv.split("=")
    return [k, Number(v)] as [string, number]
  }))
  const bad: string[] = []
  for (const [t, v] of want) {
    const r = rows.get(t)
    if (!r) { bad.push(`${t}: no edges here`); continue }
    const got = Number(pct(r.classes["resolved-file-local"], r.edges).replace("%", ""))
    if (Math.abs(got - v) > 0.01) bad.push(`${t}: census ${v}% vs this file ${got}%`)
  }
  if (bad.length) {
    console.error(`CONTROL C4 FAILING — local-hit rate disagrees with ontology-census.ts: ${bad.join("; ")}`)
    process.exit(2)
  }
  console.log(`controls: C4 ok — local-hit rate matches ontology-census.ts on ${want.size} type(s)`)
} else {
  console.log("controls: C4 NOT RUN — pass --expect-local type=pct,... to check this file against the census")
}

console.log(`\nTHE TWO OPPOSITE FINDINGS, per type — the analyzer's own defect vs the corpus's`)
console.log(`  'dropped-*-IN-FILE' is a DECLARATION IN THIS VERY FILE WITH NO PUBLISHED SYMBOL: the analyzer owns it.`)
console.log(`  'external' is a NAME NO TREE IN THE DRAW DECLARES: the corpus owns it, or nothing does.`)
for (const t of TYPES) {
  const r = rows.get(t)!
  const own = r.classes["dropped-decl-IN-FILE"] + r.classes["dropped-field-IN-FILE"]
  if (!r.classes["external"] && !own) continue
  console.log(`  ${t.padEnd(15)} analyzer-owned ${String(own).padEnd(8)} corpus-external ${String(r.classes["external"]).padEnd(8)}`)
}

const ownTotal = [...rows.values()].reduce((a, r) => a + r.classes["dropped-decl-IN-FILE"] + r.classes["dropped-field-IN-FILE"], 0)
const extTotal = [...rows.values()].reduce((a, r) => a + r.classes["external"], 0)
console.log(`\nDELIVERABLE C, in one line: ${ownTotal} edges name a declaration their OWN file's tree carries and`)
console.log(`the analyzer published nothing for; ${extTotal} name something no tree in the draw declares.`)
console.log(`In a single unresolved count those two are indistinguishable and they are opposite findings.`)

console.log(`\nDropped declarations, by name (the analyzer-owned class, in full)`)
const topN = (m: Map<string, number>, n: number): [string, number][] =>
  [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n)
if (!droppedDeclNames.size) console.log("  none: no edge in this population names a declaration its own file's tree declares")
for (const [n, v] of topN(droppedDeclNames, 25)) {
  console.log(`    ${n} x${v}  in ${droppedDeclFilesOf.get(n)!.size} file(s)`)
}
console.log(`  ${droppedDeclFileCount.size} files carry at least one dropped declaration`)
console.log(`\nTop external names (unexplained by anything in the draw)`)
for (const [n, v] of topN(externalNames, 20)) console.log(`    ${n} x${v}`)

const out = {
  populationHash: [...pops][0],
  shards: dumps.length,
  totalEdges,
  files: fileNames.size,
  edgesWithUnseenFile,
  ladder: CLASSES,
  analyzerOwnedTotal: ownTotal,
  corpusExternalTotal: extTotal,
  rows: Object.fromEntries([...rows].map(([t, r]) => [t, {
    edges: r.edges,
    files: r.files.size,
    classes: r.classes,
    confUnder07: r.confUnder07,
    byReason: r.byReason,
  }])),
  droppedDeclNames: topN(droppedDeclNames, 300),
  externalNames: topN(externalNames, 300),
}
writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`\nwrote ${OUT}`)
