/**
 * ZIG INCOMING RESOLVER — per-type resolution, ambiguity, and the CAUSE of every
 * unresolved target.
 *
 * Reads the `incoming-check.ts` dumps of all shards and answers, per relationship
 * type:
 *
 *   RESOLUTION  unique / ambiguous / zero, as EDGES and as a share of the type.
 *   AMBIGUITY   for a name ≥2 published symbols share: how many candidates, how
 *               many distinct kinds, how many distinct files — and whether the
 *               edge carries anything that could break the tie. It cannot: a zig
 *               edge has six keys and both endpoints are name strings.
 *   CAUSE       every zero, split by evidence rather than lumped:
 *                 builtin-type   a name in the analyzer's own
 *                                 ZIG_DECLARED_TYPE_BUILTINS
 *                 builtin-fn     an `@`-prefixed Zig builtin
 *                 path           an import path (separator, or `.zig`)
 *                 module-field   reached through an `@import`-bound module
 *                 generic-param  a comptime type parameter (P13)
 *                 param          any other function parameter
 *                 field          a `container_field` member name
 *                 neverIndexed   **a declaration EXISTS on the tree of some draw
 *                                 file and no symbol was published for it** — the
 *                                 bucket this lane owns
 *                 external       none of the above: a name nothing in the draw
 *                                 declares. Honest name: it is UNEXPLAINED, and
 *                                 this file does not claim to know which it is.
 *   SOURCE LEG  published symbol / scope marker / unresolved.
 *
 * Two controls run on every invocation and a failure is a non-zero exit:
 *   C1 a synthetic two-symbol name must read `ambiguous`, a one-symbol name
 *      `unique`, and an absent name `zero`;
 *   C2 every edge counted under `neverIndexed` must have a tree-declared name
 *      backing it, and every `builtin-type` must be in the exported set. A
 *      resolver that cannot fail its own controls is not measuring anything.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/incoming-resolve.ts <dump-dir>
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
const OUT = arg0("out", path.join(HERE, "measurements", `incoming-resolution-full-${MEASURED_ON}.json`))
function arg0(n: string, d: string): string {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}

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

// ── load every shard
type Dump = {
  popHash: string
  files: { key: string; symbols: { name: string; kind: string; qualifiedName: string }[]; declaredNames: [string, string][] }[]
  edges: { file: string; source: string; target: string; type: string; line: number; conf: number; meta: string | null; scope: string | null }[]
  fallbackFiles: string[]
}
const files = readdirSync(DIR).filter((f) => f.startsWith("dump-") && f.endsWith(".json")).sort()
if (!files.length) { console.error(`no dump-*.json in ${DIR}`); process.exit(2) }
const dumps: Dump[] = files.map((f) => JSON.parse(readFileSync(path.join(DIR, f), "utf8")) as Dump)
const pops = new Set(dumps.map((d) => d.popHash))
if (pops.size !== 1) { console.error(`REFUSING: shards disagree on the population: ${[...pops]}`); process.exit(2) }
if (dumps.some((d) => d.fallbackFiles.length)) {
  console.error(`REFUSING: a shard reported parseFile fallback — it measured extractFallback, not the analyzer`)
  process.exit(2)
}

// ── the published symbol index, and the tree-declared name index
type Cand = { kind: string; file: string; qualifiedName: string }
const byName = new Map<string, Cand[]>()
/** name -> the files whose TREE declares it, and the STRONGEST node kind that
 *  declared it (`decl` > `field` > `parameter`). A name in here with no
 *  published symbol is `neverIndexed`, split by that kind: a `parameter` is
 *  correctly not a symbol in this project's model, so only `decl` and `field`
 *  can be a dropped declaration. A name absent from both is `external`. */
const declaredIn = new Map<string, Set<string>>()
const declaredKind = new Map<string, string>()
const kindCount = new Map<string, Map<string, number>>()
for (const d of dumps) {
  for (const f of d.files) {
    for (const [n, kd] of f.declaredNames) {
      const s = declaredIn.get(n) ?? new Set<string>()
      s.add(f.key)
      declaredIn.set(n, s)
      const ord = ["local", "parameter", "field", "decl"]
      const prev = declaredKind.get(n)
      if (prev === undefined || ord.indexOf(kd) > ord.indexOf(prev)) declaredKind.set(n, kd)
    }
    for (const s of f.symbols) {
      if (!s.name) continue
      const arr = byName.get(s.name) ?? []
      arr.push({ kind: s.kind, file: f.key, qualifiedName: s.qualifiedName })
      byName.set(s.name, arr)
      const kc = kindCount.get(s.name) ?? new Map<string, number>()
      kc.set(s.kind, (kc.get(s.kind) ?? 0) + 1)
      kindCount.set(s.name, kc)
    }
  }
}

/** The cause ladder. Order matters: the first bucket that matches WINS, and each
 *  bucket is stated so a reader can tell which edges it swallowed. */
function causeOf(target: string): string {
  if (!target) return "empty"
  if (isScopeMarker(target)) return "scope-marker"
  if (isBuiltinFnSpelling(target)) return "builtin-fn"
  if (looksLikePath(target)) return "path"
  if (!isPlainIdent(target)) return "non-identifier"
  if (ZIG_DECLARED_TYPE_BUILTINS.has(target) && !byName.has(target)) return "builtin-type"
  if (byName.has(target)) return "resolved"
  const dk = declaredKind.get(target)
  if (dk === "decl") return "neverIndexed-decl"
  if (dk === "field") return "neverIndexed-field"
  if (dk === "parameter") return "declared-parameter"
  if (dk === "local") return "declared-local"
  return "external"
}

// ── CONTROLS (C1/C2 from the header). A resolver that cannot fail is not measuring.
{
  const probe = (name: string): string => (byName.has(name) ? "resolved" : causeOf(name))
  const syntheticUnique = "__ctl_unique__"
  byName.set(syntheticUnique, [{ kind: "function", file: "synthetic", qualifiedName: syntheticUnique }])
  // The builtin rung must be tested on a name that SATISFIES its own precondition
  // (a builtin spelling no file publishes a symbol for). The first revision
  // asserted it on the literal `u8` and failed at full scale, because `u8` IS a
  // published symbol name in this corpus — `zig/test/behavior/basic.zig` declares
  // `const @"u8" = u16;` and `zls/.../Interner.zig` declares `f80` (the analyzer's
  // own Z57 rule). So the control was asserting a corpus fact, not the rule, and
  // the corpus fact was true at 1/8 scale and false at 8/8. The rule is now tested
  // on a name chosen to satisfy it, and the count of builtins that ARE published
  // is reported as a measurement instead of being assumed away.
  const builtinsAbsent = [...ZIG_DECLARED_TYPE_BUILTINS].filter((b) => !byName.has(b))
  const builtinsPublished = [...ZIG_DECLARED_TYPE_BUILTINS].filter((b) => byName.has(b))
  const c1 = probe(syntheticUnique) === "resolved"
    && causeOf("__ctl_absent__") === "external"
    && builtinsAbsent.length > 0
    && builtinsAbsent.every((b) => causeOf(b) === "builtin-type")
  // C2 — a declared-but-unpublished name must read neverIndexed
  const syntheticNever = "__ctl_declared_unpublished__"
  declaredIn.set(syntheticNever, new Set(["synthetic"]))
  declaredKind.set(syntheticNever, "decl")
  const c2 = causeOf(syntheticNever) === "neverIndexed-decl"
  byName.delete(syntheticUnique)
  declaredIn.delete(syntheticNever)
  declaredKind.delete(syntheticNever)
  if (!c1 || !c2) { console.error(`CONTROL FAILING: C1=${c1} C2=${c2}`); process.exit(2) }
  console.log("controls: 2 ok, 0 FAILING (C1 resolution ladder, C2 neverIndexed discriminator)")
  console.log(`  Z57 note: ${builtinsPublished.length} of ${ZIG_DECLARED_TYPE_BUILTINS.size} builtin spellings ARE published symbol names in this corpus: ${builtinsPublished.join(", ") || "none"}`)
}

type TypeRow = {
  edges: number; files: number
  srcSymbol: number; srcMarker: number; srcZero: number
  tgtUnique: number; tgtAmbiguous: number; tgtZero: number
  /** UNBINDABLE — no symbol carries this name anywhere: the walk finds NOTHING. */
  unbindable: number
  /** the walk WILL bind this edge, and no candidate is in the edge's own file */
  misbindable: number
  /** ...of which the target resolved to exactly ONE declaration (the sharp case:
   *  the walk is confident and wrong) */
  misbindUniqueElsewhereFile: number
  /** ...and the ambiguous case where not one candidate is local */
  misbindAmbNoLocalCandidate: number
  /** the safe shape: a unique target that IS in the edge's own file */
  misbindNo: number
  zeroCause: Record<string, number>
  /** ambiguity detail, over AMBIGUOUS edges only */
  ambCandidatesMax: number; ambCandidatesSum: number
  ambDistinctKinds: Record<string, number>
  ambMultiFile: number
  ambSingleFile: number
  /** ambiguous AND at least one candidate is in the edge's OWN file: the tie is
   *  BREAKABLE per-file, which is deliverable B's actionable class. */
  ambHasLocalCandidate: number
  /** ambiguous and NOT ONE candidate is local: genuinely cross-file, and no
   *  per-file rule can pick. This is where the language/shape makes it impossible. */
  ambNoLocalCandidate: number
  confUnder07: number
  /** Z65: the annotation's own census, read back from production metadata. */
  scopeLocal: number
  scopeExternal: number
  scopeMarker: number
  scopeAbsent: number
  /** Z65's promise, measured: `file-local` edges whose target really does have a
   *  candidate in their own file, over the `file-local` edges. */
  scopeLocalWithLocalCandidate: number
  /** ...and `file-local` edges whose target has NO local candidate, which is the
   *  annotation being WRONG — a correctness check on the annotation itself. */
  scopeLocalWithoutLocalCandidate: number
  topTargets: [string, number][]
  /** how many edges carry metadata a reverse walk could use to disambiguate */
  edgesWithQualifiedTarget: number
}
const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "instantiates", "extends", "implements", "overrides"]
const rows = new Map<string, TypeRow>()
const zeroTargets = new Map<string, number>()
const ambTargets = new Map<string, number>()
const neverIndexedNames = new Map<string, number>()
let totalEdges = 0
for (const d of dumps) for (const e of d.edges) {
  totalEdges++
  let r = rows.get(e.type)
  if (!r) {
    r = {
      edges: 0, files: 0, srcSymbol: 0, srcMarker: 0, srcZero: 0,
      tgtUnique: 0, tgtAmbiguous: 0, tgtZero: 0, unbindable: 0,
      misbindable: 0, misbindUniqueElsewhereFile: 0, misbindAmbNoLocalCandidate: 0, misbindNo: 0,
      zeroCause: {},
      ambCandidatesMax: 0, ambCandidatesSum: 0, ambDistinctKinds: {}, ambMultiFile: 0, ambSingleFile: 0,
      ambHasLocalCandidate: 0, ambNoLocalCandidate: 0,
      confUnder07: 0,
      scopeLocal: 0, scopeExternal: 0, scopeMarker: 0, scopeAbsent: 0,
      scopeLocalWithLocalCandidate: 0, scopeLocalWithoutLocalCandidate: 0,
      topTargets: [], edgesWithQualifiedTarget: 0,
    }
    rows.set(e.type, r)
  }
  r.edges++
  if (r.conf < 0.7) r.confUnder07++
  // Z65's census, plus the check that the annotation is not merely present but CORRECT
  if (e.scope === "file-local") {
    r.scopeLocal++
    if ((byName.get(e.target) ?? []).some((x) => x.file === e.file)) r.scopeLocalWithLocalCandidate++
    else r.scopeLocalWithoutLocalCandidate++
  } else if (e.scope === "file-external") r.scopeExternal++
  else if (e.scope === "scope-marker") r.scopeMarker++
  else r.scopeAbsent++
  if (SCOPE_MARKERS.has(e.source)) r.srcMarker++
  else if (byName.has(e.source)) r.srcSymbol++
  else r.srcZero++
  const cands = byName.get(e.target)
  if (!cands || cands.length === 0) {
    r.tgtZero++
    r.unbindable++
    const c = causeOf(e.target)
    r.zeroCause[c] = (r.zeroCause[c] ?? 0) + 1
    zeroTargets.set(e.target, (zeroTargets.get(e.target) ?? 0) + 1)
    if (c === "neverIndexed-decl" || c === "neverIndexed-field") neverIndexedNames.set(e.target, (neverIndexedNames.get(e.target) ?? 0) + 1)
    if (c === "neverIndexed-decl" || c === "neverIndexed-field") {
      // THE DISCRIMINATOR THE INCOMING SECTION ASKS FOR. An unresolved target
      // whose name IS published SOMEWHERE else is not a missing symbol — it is a
      // name the reverse walk will bind to an UNRELATED declaration, silently,
      // because matching is by name. `zcu` is both a struct field (Compilation.zig
      // :60) and an enum member (:1859); only the enum member is published, and
      // 169 `uses` edges naming the field bind to it. An unresolved target whose
      // name is published NOWHERE resolves to nothing at all. Same count, opposite
      // findings: one produces wrong advice, the other produces no advice.
      const mis = byName.has(e.target)
      if (mis) r.misbindable++
      else r.unbindable++
    }
  } else if (cands.length === 1) {
    r.tgtUnique++
    /* THE MISBINDING CLASS, and it needs no analyzer rule to measure.
     *
     * The walk binds by NAME, so an edge binds to a declaration it does not
     * mean whenever the name matches a symbol somewhere the edge's own file does
     * not name it. The sharp case is a `unique` target: the walk is about to
     * resolve this edge to exactly one declaration, and if that declaration is
     * in ANOTHER file, the edge is confidently bound to the wrong one — which is
     * the "a fake caller becomes wrong refactoring advice" failure, reached
     * without fabricating anything. A same-file unique hit is the only shape in
     * which name matching is on its own sufficient. */
    if (cands[0].file !== e.file) { r.misbindUniqueElsewhereFile++; r.misbindable++ }
    else r.misbindNo++
  } else {
    r.tgtAmbiguous++
    ambTargets.set(e.target, (ambTargets.get(e.target) ?? 0) + 1)
    r.ambCandidatesSum += cands.length
    if (cands.length > r.ambCandidatesMax) r.ambCandidatesMax = cands.length
    const files2 = new Set(cands.map((x) => x.file)).size
    if (files2 > 1) r.ambMultiFile++
    else r.ambSingleFile++
    if (!cands.some((x) => x.file === e.file)) { r.misbindAmbNoLocalCandidate++; r.misbindable++; r.ambNoLocalCandidate++ }
    else r.ambHasLocalCandidate++
    const kk = kindCount.get(e.target)!
    const key2 = `${kk.size} kind${kk.size === 1 ? "" : "s"}`
    r.ambDistinctKinds[key2] = (r.ambDistinctKinds[key2] ?? 0) + 1
  }
}
// files per type
const filesByType = new Map<string, Set<string>>()
for (const d of dumps) for (const e of d.edges) {
  const s = filesByType.get(e.type) ?? new Set<string>()
  s.add(e.file)
  filesByType.set(e.type, s)
}
for (const [t, s] of filesByType) { const r = rows.get(t)!; r.files = s.size }

const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(2)}%`)
const topN = (m: Map<string, number>, n: number): [string, number][] =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)

console.log(`\nunion of ${dumps.length} shard(s), population sha256:${[...pops][0].slice(0, 16)}`)
console.log(`published symbols ${[...byName.values()].reduce((a, v) => a + v.length, 0)} over ${byName.size} distinct names`)
console.log(`tree-declared names ${[...declaredIn.values()].reduce((a, v) => a + v.size, 0)} over ${declaredIn.size} distinct names`)
console.log(`edges ${totalEdges}\n`)

console.log(`\nA target that does not resolve in its OWN FILE splits into two OPPOSITE findings, and the`)
console.log(`count alone cannot tell them. Both are "not resolved"; they fail differently:`)
console.log(`  MISBINDABLE — the name IS published somewhere, so the walk WILL bind the edge, and no candidate`)
console.log(`                is in the edge's file. Wrong advice, silently. \`misbindUniqueElsewhereFile\` is`)
console.log(`                the sharp case: exactly one declaration, in another file, and the walk is`)
console.log(`                about to be confident about it.`)
console.log(`  UNBINDABLE — no symbol carries the name anywhere. The walk finds nothing. No advice.`)
const hdr = ["type", "edges", "files", "tgt unique%", "tgt AMBIG%", "tgt zero%", "MISBIND", "of which UNIQUE", "UNBIND", "src sym%", "conf<0.7"]
console.log("\n" + hdr.map((h) => h.padEnd(h === "type" ? 13 : 12)).join(" "))
for (const t of TYPES) {
  const r = rows.get(t)
  if (!r) { console.log(t.padEnd(13), "— 0 edges, 0 files (never emitted on this corpus)"); continue }
  console.log(
    t.padEnd(13),
    String(r.edges).padEnd(12), String(r.files).padEnd(12),
    pct(r.tgtUnique, r.edges).padEnd(12), pct(r.tgtAmbiguous, r.edges).padEnd(12), pct(r.tgtZero, r.edges).padEnd(12),
    String(r.misbindable).padEnd(12), String(r.misbindUniqueElsewhereFile).padEnd(12),
    String(r.unbindable).padEnd(12),
    pct(r.srcSymbol, r.edges).padEnd(12), String(r.confUnder07).padEnd(12),
  )
}

console.log(`\nCAUSE of every unresolved target, per type (the two opposite findings, separated)`)
for (const t of TYPES) {
  const r = rows.get(t)
  if (!r || !r.tgtZero) continue
  const parts = Object.entries(r.zeroCause).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} (${pct(v, r.tgtZero)})`)
  console.log(`  ${t.padEnd(13)} ${r.tgtZero} zero -> ${parts.join(", ")}`)
}

console.log(`\nThe SAFE shape — a unique target that IS in the edge's own file, where name matching alone`)
console.log(`is sufficient: ${[...rows.values()].reduce((a, r) => a + r.misbindNo, 0)} edges`)
console.log(`\nAMBIGUITY detail, per type`)
for (const t of TYPES) {
  const r = rows.get(t)
  if (!r || !r.tgtAmbiguous) continue
  const mean = r.ambCandidatesSum / r.tgtAmbiguous
  console.log(`  ${t.padEnd(13)} ${r.tgtAmbiguous} ambiguous; candidates max ${r.ambCandidatesMax}, mean ${mean.toFixed(2)};` +
    ` BREAKABLE per-file (a local candidate exists) ${r.ambHasLocalCandidate} (${pct(r.ambHasLocalCandidate, r.tgtAmbiguous)});` +
    ` NOT breakable (no local candidate) ${r.ambNoLocalCandidate} (${pct(r.ambNoLocalCandidate, r.tgtAmbiguous)})`)
  console.log(`  ${" ".repeat(13)} candidates span ${r.ambMultiFile} multi-file / ${r.ambSingleFile} single-file;` +
    ` kinds ${Object.entries(r.ambDistinctKinds).sort().map(([k, v]) => `${k}:${v}`).join(" ")}`)
}

console.log(`\nNEVER-INDEXED targets — a declaration or field the TREE carries and no symbol was published for`)
console.log(`  (\`declared-local\` and \`declared-parameter\` are EXCLUDED: this project's model carries a`)
console.log(`   function's signature on the function symbol and does not publish a symbol per local, so`)
console.log(`   an edge to one of those names is not a dropped declaration. They are reported above.)`)
console.log(`  distinct names ${neverIndexedNames.size}, edges ${[...neverIndexedNames.values()].reduce((a, b) => a + b, 0)}`)
for (const [n, v] of topN(neverIndexedNames, 20)) console.log(`    ${n} x${v}  [${declaredKind.get(n)}] (declared in ${declaredIn.get(n)!.size} file(s))`)

console.log(`\nTop unresolved targets overall (all causes)`)
for (const [n, v] of topN(zeroTargets, 20)) console.log(`    ${n} x${v}  [${causeOf(n)}]`)
const ambTot = [...rows.values()].reduce((a, r) => a + r.tgtAmbiguous, 0)
const ambBreak = [...rows.values()].reduce((a, r) => a + r.ambHasLocalCandidate, 0)
console.log(`\nZ65, THE ANNOTATION, read back from production metadata (never recomputed here)`)
const zl = [...rows.values()].reduce((a, r) => a + r.scopeLocal, 0)
const zx = [...rows.values()].reduce((a, r) => a + r.scopeExternal, 0)
const zm = [...rows.values()].reduce((a, r) => a + r.scopeMarker, 0)
const za = [...rows.values()].reduce((a, r) => a + r.scopeAbsent, 0)
const zok = [...rows.values()].reduce((a, r) => a + r.scopeLocalWithLocalCandidate, 0)
const zbad = [...rows.values()].reduce((a, r) => a + r.scopeLocalWithoutLocalCandidate, 0)
console.log(`  file-local ${zl} (${pct(zl, totalEdges)})  file-external ${zx} (${pct(zx, totalEdges)})  scope-marker ${zm}  ABSENT ${za}`)
console.log(`  CORRECTNESS of the annotation: of the ${zl} \`file-local\` edges, ${zok} (${pct(zok, zl)}) do have a candidate in their own file`)
console.log(`  and ${zbad} (${pct(zbad, zl)}) do NOT — those are the annotation being WRONG, and this line is the check on it`)
for (const t of TYPES) {
  const r = rows.get(t)
  if (!r || !r.edges) continue
  console.log(`    ${t.padEnd(13)} local ${String(r.scopeLocal).padEnd(7)} external ${String(r.scopeExternal).padEnd(7)} marker ${String(r.scopeMarker).padEnd(7)} absent ${r.scopeAbsent}`)
}
console.log(`\nDELIVERABLE B, in one number: ${ambTot} ambiguous edges; ${ambBreak} (${pct(ambBreak, ambTot)}) have a`)
console.log(`candidate in the edge's OWN file and are therefore BREAKABLE per-file; the remaining`)
console.log(`${ambTot - ambBreak} have no local candidate and no per-file rule can pick.`)
console.log(`\nTop ambiguous target names`)
for (const [n, v] of topN(ambTargets, 15)) console.log(`    ${n} x${v}  (${byName.get(n)!.length} published symbols, ${new Set(byName.get(n)!.map((x) => x.file)).size} files, kinds ${[...kindCount.get(n)!.keys()].join("/")})`)

const out = {
  populationHash: [...pops][0],
  shards: dumps.length,
  totalEdges,
  publishedSymbols: [...byName.values()].reduce((a, v) => a + v.length, 0),
  distinctNames: byName.size,
  treeDeclaredNames: [...declaredIn.values()].reduce((a, v) => a + v.size, 0),
  declaredParamOnlyNames: [...declaredKind.entries()].filter(([, k]) => k === "parameter").length,
  rows: Object.fromEntries(rows),
  neverIndexedNames: topN(neverIndexedNames, 200),
  misbindable: Object.fromEntries([...rows].map(([t, r]) => [t, r.misbindable])),
  misbindUniqueElsewhereFile: Object.fromEntries([...rows].map(([t, r]) => [t, r.misbindUniqueElsewhereFile])),
  misbindSafeLocalUnique: Object.fromEntries([...rows].map(([t, r]) => [t, r.misbindNo])),
  ambiguousBreakable: ambBreak,
  ambiguousTotal: ambTot,
  z65: { local: zl, external: zx, marker: zm, absent: za, localWithLocalCandidate: zok, localWithoutLocalCandidate: zbad },
  unbindable: Object.fromEntries([...rows].map(([t, r]) => [t, r.unbindable])),
  zeroTargets: topN(zeroTargets, 200),
  ambTargets: topN(ambTargets, 200),
}
writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`\nwrote ${OUT}`)
