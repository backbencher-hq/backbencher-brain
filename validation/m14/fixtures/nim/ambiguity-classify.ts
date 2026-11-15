/**
 * NIM AMBIGUITY CLASSIFY — the three-way split of an ambiguous edge target.
 *
 * ## Why this file exists
 *
 * `script/m14/incoming-check.ts` reports one number per type,
 * `ambiguousTargets`, and the whole-corpus sweep quoted it for 23 lanes at once
 * (`validation/m14/measurements/incoming-whole.tsv`, nim = 12,491). That number
 * is an UPPER BOUND that mixes three different findings, and the three have
 * different owners:
 *
 *   B1 SCOPE-COLLAPSED   two declarations of the name sit IN THE EDGE'S OWN
 *                        FILE at different scopes. The edge's own file does not
 *                        settle it, because the analyzer published the bare name
 *                        for both. A real scoping failure, and the analyzer
 *                        controls it.
 *   B2 MODULE-NOT-MODELLED
 *                        the referring file declares the name at most once and
 *                        the multiplicity is ACROSS files. Which module is in
 *                        scope depends on the `import` graph and on files this
 *                        per-file analyzer has never read, so the edge cannot
 *                        name the right one without fabricating it.
 *   B3 LEGIT-SHARED-NAME
 *                        the declarations sit at the SAME scope and differ by
 *                        kind or by overload signature. Nim genuinely admits
 *                        `proc f(int)` and `proc f(string)`, and `type T` beside
 *                        `proc T`. The PUBLISHED NAME is not an identifier; no
 *                        per-edge fix exists short of signature-qualified names,
 *                        which is a published-name contract change, not a fix to
 *                        one analyzer.
 *
 * Mutually exclusive by precedence B1 > B3 > B2, with the raw overlaps recorded
 * so a reader can recombine them. The precedence is stated because a partition
 * without an order is not a measurement.
 *
 * ## Two independent definitions of "ambiguous", both reported
 *
 * The shared harness keys `published` on NAME with the value being the SET OF
 * KINDS (`incoming-check.ts:107,134-146`), so ITS `ambiguousTargets` means "this
 * name is published under more than one kind". This file's `ambiguous` means
 * "this name is published more than once". They are different numbers on the
 * same walk and both are printed, so the fleet-wide figure and this one can be
 * compared instead of being confused for each other.
 *
 * ## The population is pinned, not discovered
 *
 * The file list is read from `validation/m14/measurements/nim/session13-file-list.txt`
 * and its sha256 is printed and carried into the JSON. Discovery order changes
 * which 600 files a walk sees, and the incoming question is exactly the question
 * that a different file window answers differently, so the window is an artifact
 * here rather than an argument to be re-litigated every run.
 *
 * ## What it does NOT do
 *
 * No text matching and no regex anywhere: every fact below comes from the
 * published `ParseResult` of `parseFile`, the production entry point. Nothing is
 * read off the source characters, so a name in a comment or a string literal
 * cannot enter the index.
 *
 * An unresolved target is NOT called a defect here. Against a 600-file index of
 * a 6,063-file corpus, an absent target is outside the window far more often
 * than it is unpublished; `resolution-audit.ts` with the index universe equal to
 * the corpus is the instrument that can tell those apart, and its number is
 * quoted rather than recomputed.
 */
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = (import.meta as any).dirname ?? "."
const REPO = path.resolve(HERE, "../../../..")
const ANALYZER = path.join(REPO, "src/ast/real-nim-analyzer.ts")
const LIST_REL = "validation/m14/measurements/nim/session13-file-list.txt"
const LIST = path.join(REPO, LIST_REL)

const analyzerSha = (): string => createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
const listSha = (): string => createHash("sha256").update(readFileSync(LIST)).digest("hex")
const ANALYZER_SHA = analyzerSha()
const LIST_SHA = listSha()

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type T = (typeof ALL_TYPES)[number]

type Decl = { file: string; kind: string; scope: string; owner: string; line: number; params: number; isDecl: boolean; id: string }

const files = readFileSync(LIST, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter((s) => s.length > 0)

/**
 * The edge's own line, read the way the STORE reads it.
 *
 * `parallel-indexer.ts:3418` computes `relLine` as
 * `typeof rel.line_number === "number" && rel.line_number > 0 ? rel.line_number : null`
 * and `pool-worker.ts` forwards `line_number` untouched. An earlier cut of this
 * instrument read `rel.range.start.line`, which no nim relationship carries, so
 * EVERY edge reported line 0 — visible in the first run as `@file:0` on all
 * 30-odd printed examples. Line 0 is not a neutral default here: it silently
 * disables the store's `contains` line hint, so the simulation below would have
 * reported the pre-#612 behaviour while claiming to report the current one.
 */
const edgeLine = (rel: any): number => {
  const raw = rel?.line_number
  if (typeof raw === "number" && raw > 0) return raw
  const r = Number(rel?.range?.start?.line ?? 0)
  return r > 0 ? r : 0
}

/**
 * A symbol's line, read the way the STORE reads it.
 *
 * `pool-worker.ts:866-869` emits the symbol with FLAT `startLine`/`endLine` and
 * no `range` object at all, so `s.range.start.line` is `undefined` on every row
 * the production path returns. An earlier cut of this instrument read exactly
 * that, which made every declaration line 0 — and line 0 is not a neutral
 * default in this instrument: it collapses every same-file same-name declaration
 * onto one candidate in the store replay, and it makes the store's own
 * `(s.line_start = relLine)` hint compare 0 against 38 and never fire. Both
 * arms then agreed on every edge and the replay reported the #612 line hint as
 * worth 0 edges, which was an artefact of the reader and not a property of the
 * store. The three-way split was unaffected, because it reads only file, kind
 * and scope.
 */
const symbolLine = (s: any): number => {
  const flat = Number(s?.startLine ?? 0)
  if (flat > 0) return flat
  const nested = Number(s?.range?.startLine ?? s?.range?.start?.line ?? 0)
  return nested > 0 ? nested : 0
}

/**
 * The owner a declaration belongs to, read from the field the `contains` edge is
 * actually built from.
 *
 * `collectContainment` (real-nim-analyzer.ts:2068) emits `source: s.ownerName`, so
 * `ownerName` is the owner an edge names. `scope` is a DIFFERENT field with a
 * different meaning: it is the enclosing CALLABLE (`scope: nestedIn || undefined`,
 * :589), which is empty for every method at file scope even though the method has
 * a receiver type in `ownerName` (:608).
 *
 * `scope || owner` — not `owner || scope` — because a nested routine is inside
 * both a callable and an owner, and the edge names the owner. So `owner` is
 * authoritative whenever it is set, and this function falls back to `scope` only
 * for a declaration that has no owner at all.
 */
const ownerOf = (d: Decl): string => (d.owner.length > 0 ? d.owner : d.scope)

if (files.length === 0) {
  console.error(`no files in ${LIST_REL}`)
  process.exit(2)
}

// ── index the population
const byName = new Map<string, Decl[]>()
type Edge = { type: string; target: string; file: string; source: string; line: number; bucket?: Bucket }
const rels: Edge[] = []
const offOntology = new Map<string, number>()
let symbols = 0
let symbolRows = 0
let emptyName = 0
let emptyKind = 0
let degraded = 0
let symbolLineZero = 0
let edgeLineZero = 0
const parseFailures: string[] = []

const publish = (name: string, kind: string, scope: string, owner: string, line: number, params: number, file: string, isDecl: boolean): void => {
  if (name.length === 0) return
  const arr = byName.get(name)
  const d: Decl = { file, kind, scope, owner, line, params, isDecl, id: `${name}:${line}` }
  if (arr) arr.push(d)
  else byName.set(name, [d])
}

for (const abs of files) {
  const label = path.relative(path.dirname(abs) + "/..", abs)
  let r: any
  try {
    r = await parseFile(abs, path.dirname(abs))
  } catch (e) {
    parseFailures.push(`${abs}: ${(e as Error)?.message ?? e}`)
    continue
  }
  if (!r) { parseFailures.push(`${abs}: no result`); continue }
  if (r.fallback === true) degraded++
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    symbols++
    const name = String(s?.name ?? "")
    const kind = String(s?.kind ?? "")
    if (name.length === 0) { emptyName++; continue }
    if (kind.length === 0) { emptyKind++; continue }
    const line = symbolLine(s)
    if (line === 0) symbolLineZero++
    // OWNER, not just scope. `collectContainment` emits a `contains` edge from
    // `s.ownerName`, so the owner a candidate belongs to IS what the edge is
    // scored against — and for a METHOD `ownerName` is the receiver type while
    // `scope` is the ENCLOSING CALLABLE and is EMPTY at file scope
    // (`real-nim-analyzer.ts:589`, `scope: nestedIn || undefined`, against
    // `:608`, `ownerName: receiverType`).
    //
    // Reading `scope` alone therefore scored every method as scope-less, and the
    // contains intent test — "is the winner a member of the owner the edge
    // names?" — failed on 16 edges whose winner was on the edge's own file AND
    // its own line. Those 16 were reported as `contradictsIntent`: a confident
    // claim that the store mis-resolved 16 edges, produced by an instrument
    // comparing two different fields. Both are carried, and the bucket logic
    // below keeps using `scope` (a member-vs-top-level distinction is about
    // lexical scope); only the owner comparison uses the owner's field.
    const scope = String(s?.scope ?? "")
    const owner = String(s?.ownerName ?? "")
    const params = Array.isArray(s?.parameters) ? s.parameters.length : 0
    const isDecl = s?.metadata?.isDeclaration === true
    publish(name, kind, scope, owner, line, params, label, isDecl)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) publish(q, kind, scope, owner, line, params, label, isDecl)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const t = String(rel?.type ?? rel?.relationshipType ?? "")
    if (!t) continue
    if (!(ALL_TYPES as readonly string[]).includes(t)) {
      offOntology.set(t, (offOntology.get(t) ?? 0) + 1)
      continue
    }
    rels.push({
      type: t,
      target: String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? ""),
      file: label,
      source: String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? ""),
      line: (() => { const l = edgeLine(rel); if (l === 0) edgeLineZero++; return l })(),
    })
  }
}

// ── classify
type Bucket = "unique" | "B1_scope" | "B3_legit" | "B2_module" | "unresolved"
const BUCKETS: Bucket[] = ["unique", "B1_scope", "B3_legit", "B2_module", "unresolved"]
const blank = (): Record<Bucket, number> => ({ unique: 0, B1_scope: 0, B3_legit: 0, B2_module: 0, unresolved: 0 })
const perType: Record<string, Record<Bucket, number>> = {}
for (const t of ALL_TYPES) perType[t] = blank()

/** name -> bucket -> edge count, for the named examples in the doc. */
const nameCounts = new Map<string, Map<Bucket, number>>()
/** the two definitions of ambiguous, per type. */
const defs: Record<string, { multiDecl: number; multiKind: number }> = {}
for (const t of ALL_TYPES) defs[t] = { multiDecl: 0, multiKind: 0 }

/** For each ambiguous NAME, what a reverse walk could have used to settle it. */
type Settle = "settledByFile" | "settledByKind" | "settledByFileAndKind" | "settledByNeither"
const settleByName = new Map<string, { settle: Settle; decls: number; kinds: number; files: number }>()
const settleEdges: Record<Settle, number> = {
  settledByFile: 0, settledByKind: 0, settledByFileAndKind: 0, settledByNeither: 0,
}

const overlap = { scopeAndCrossFile: 0, crossFile: 0, multiKindInB1: 0 }

for (const e of rels) {
  const row = perType[e.type]
  const decls = byName.get(e.target)
  if (!decls || decls.length === 0) {
    row.unresolved++
    bump(nameCounts, e.target, "unresolved")
    continue
  }
  if (decls.length === 1) {
    row.unique++
    bump(nameCounts, e.target, "unique")
    continue
  }

  defs[e.type].multiDecl++
  const kinds = new Set(decls.map((d) => d.kind))
  if (kinds.size > 1) defs[e.type].multiKind++

  const here = decls.filter((d) => d.file === e.file)
  const otherFiles = new Set(decls.filter((d) => d.file !== e.file).map((d) => d.file))
  let bucket: Bucket
  if (here.length > 1) {
    const scopes = new Set(here.map((d) => d.scope))
    if (scopes.size > 1) bucket = "B1_scope"
    else bucket = "B3_legit"
    if (otherFiles.size > 0) overlap.scopeAndCrossFile++
    if (kinds.size > 1) overlap.multiKindInB1++
  } else {
    bucket = "B2_module"
    overlap.crossFile++
  }
  e.bucket = bucket
  row[bucket]++
  bump(nameCounts, e.target, bucket)

  const oneFile = new Set(decls.map((d) => d.file)).size === 1
  const oneKind = kinds.size === 1
  const settle: Settle = oneFile && oneKind ? "settledByFileAndKind"
    : oneFile ? "settledByFile"
    : oneKind ? "settledByKind"
    : "settledByNeither"
  settleEdges[settle]++
  const prev = settleByName.get(e.target)
  if (prev) { prev.decls = decls.length; prev.kinds = kinds.size; prev.files = new Set(decls.map((d) => d.file)).size }
  else settleByName.set(e.target, { settle, decls: decls.length, kinds: kinds.size, files: new Set(decls.map((d) => d.file)).size })
}

function bump(m: Map<string, Map<Bucket, number>>, name: string, b: Bucket): void {
  let inner = m.get(name)
  if (!inner) { inner = new Map(); m.set(name, inner) }
  inner.set(b, (inner.get(b) ?? 0) + 1)
}

// ── sub-shapes of B1 and B3, so a fix targets a measured bucket
//
// B1 and B3 are both "the referring file declares this name more than once", and
// the two have nothing in common mechanically. These signatures say WHICH
// declaration pair collided, because the remedy is different for each:
//
//   ownerCollision   the same name is a MEMBER of two owners declared in this
//                    file (`proc a` and `proc b` each with a local `x`). The
//                    owner is known at the edge, so `owner.x` is a fact.
//   memberVsTopLevel one declaration is a MEMBER (it has a scope) and the other
//                    is module scope. `scope.name` is a fact.
//   fieldVsAccessor  one declaration is a `property` and the other a callable.
//                    Same scope. Nim resolves these by call syntax, not by name.
//   sameKindOverload every declaration has the same kind; only arity or
//                    generics differ. Nim overloading. The bare name is all the
//                    language gives.
//   ownerPresent     the edge's SOURCE is itself a published declaration in this
//                    file, so `source.target` is a fact.
//
// Every shape counted here is per EDGE, and the counts are additive within a
// bucket except `ownerPresent`, which is recorded as a capability and not
// subtracted from anything.
type Shape = "ownerCollision" | "memberVsTopLevel" | "fieldVsAccessor" | "sameKindOverload" | "distinctKinds"
const shapes: Record<string, Record<Shape, number>> = {
  unique: { ownerCollision: 0, memberVsTopLevel: 0, fieldVsAccessor: 0, sameKindOverload: 0, distinctKinds: 0 },
  B1_scope: { ownerCollision: 0, memberVsTopLevel: 0, fieldVsAccessor: 0, sameKindOverload: 0, distinctKinds: 0 },
  B3_legit: { ownerCollision: 0, memberVsTopLevel: 0, fieldVsAccessor: 0, sameKindOverload: 0, distinctKinds: 0 },
  B2_module: { ownerCollision: 0, memberVsTopLevel: 0, fieldVsAccessor: 0, sameKindOverload: 0, distinctKinds: 0 },
  unresolved: { ownerCollision: 0, memberVsTopLevel: 0, fieldVsAccessor: 0, sameKindOverload: 0, distinctKinds: 0 },
}
const examples: Record<string, string[]> = {}
const noteExample = (key: string, text: string): void => {
  const arr = examples[key] ?? (examples[key] = [])
  if (arr.length < 6) arr.push(text)
}
let ownerPresentEdges = 0
const ownerPresentByBucket: Record<Bucket, number> = { unique: 0, B1_scope: 0, B3_legit: 0, B2_module: 0, unresolved: 0 }

// ── the candidate fix, measured BEFORE it is written
//
// B1's largest sub-shape is a MEMBER name that two owners in the same file both
// declare (`contains Character->id` beside `contains Starship->id`), and for
// those the edge's SOURCE is the owner, so `owner.name` is a fact and not a
// guess. The question that decides whether the fix is worth anything is NOT
// "does it disambiguate the file" — it obviously does — but "does the qualified
// spelling resolve GLOBALLY", because an edge that merely moves from B1 to B2
// has not improved: a reverse walk still picks a winner by a rule nobody chose.
//
// So the counterfactual is computed here, on the current published symbols:
// qualify every ambiguous edge whose source is a declaration in the edge's own
// file, rebuild the resolution map on the qualified spelling, and recount. An
// owner whose own name is not unique in the index does NOT collapse, and is
// counted separately rather than quietly hoped for.
type Trial = {
  edges: number
  wouldBeUnique: number
  wouldBeAmbiguous: number
  wouldBeUnresolved: number
  ownerNameNotUniqueInIndex: number
  memberNotOfSource: number
}
const trial: Record<string, Trial> = {}
const trialOne = (): Trial => ({ edges: 0, wouldBeUnique: 0, wouldBeAmbiguous: 0, wouldBeUnresolved: 0, ownerNameNotUniqueInIndex: 0, memberNotOfSource: 0 })

/**
 * THE SECOND COUNTERFACTUAL — and the one the round brief does not name.
 *
 * The brief's remedy is owner-qualification, measured above and worth 1006 of
 * 8175. The store already resolves `contains` by LINE (same-file, then
 * `s.line_start = the line the edge carries`), which places 1079 of 1079 on the
 * member the edge names. So the question this answers is: for the NAME-RESOLVED
 * types, would the same LINE anchor reach the edges that TEXT id order currently
 * decides?
 *
 * The two remedies are not alternatives to each other so much as different
 * instruments, and only one of them is available per type:
 *
 *   - a `calls`/`uses`/`references` edge's `line_number` is the SITE — where the
 *     call happened — and the store says so in its own comment
 *     (parallel-indexer.ts:3492-3495: "Every other relationship type keeps
 *     line_number as a SITE (where the call/read happened) and must NOT be
 *     resolved by it"). So a line anchor here is not merely unavailable, it is
 *     FORBIDDEN by the rule the store already wrote down.
 *   - but that comment is about resolving by the line as an equality. The
 *     question here is whether the edge's OWN FILE plus a coarse position can
 *     narrow the candidate set at all, which is a different claim.
 *
 * So this is measured, not argued: for each ambiguous edge, how many candidates
 * survive "same file as the edge" alone, and how many of those the store can
 * still separate by anything. `narrowedByFile` is the honest ceiling of what
 * the file hint alone buys, and it is reported per type so the two remedies can
 * be compared on the same edges.
 */
type FileNarrow = {
  edges: number
  fileUnique: number
  fileMulti: number
  /** candidates in the edge's file carry distinct lines — so a line KEY could break the tie */
  lineWouldSeparate: number
  /** the EDGE'S OWN line lands on exactly one same-file candidate — so line EQUALITY binds it */
  edgeLineBinds: number
  /** the edge carries no line at all */
  edgeNoLine: number
}
const narrow: Record<string, FileNarrow> = {}
const narrowOne = (): FileNarrow => ({ edges: 0, fileUnique: 0, fileMulti: 0, lineWouldSeparate: 0, edgeLineBinds: 0, edgeNoLine: 0 })
for (const e of rels) {
  const b = e.bucket
  if (b === undefined || b === "unique" || b === "unresolved") continue
  const decls = byName.get(e.target)
  if (!decls || decls.length <= 1) continue
  const n = narrow[e.type] ?? (narrow[e.type] = narrowOne())
  n.edges++
  const sameFile = decls.filter((d) => d.file === e.file)
  if (sameFile.length <= 1) { n.fileUnique++; continue }
  n.fileMulti++
  if (e.line <= 0) { n.edgeNoLine++; continue }
  const byLine = new Map<number, number>()
  for (const d of sameFile) byLine.set(d.line, (byLine.get(d.line) ?? 0) + 1)
  const best = Math.max(...byLine.values())
  if (best === 1) n.lineWouldSeparate++
  // THE MEASURE THAT DECIDES IT. `lineWouldSeparate` above says a line KEY could
  // break the tie; it does NOT say the edge's own line points at one candidate,
  // and those are different questions by exactly the difference between a rule
  // and a fact. For `contains` the edge's line IS the member's naming line and
  // this is 100%; for a `calls` edge the line is the SITE, so it lands on the
  // statement that made the call and on no declaration at all.
  if ((byLine.get(e.line) ?? 0) === 1) n.edgeLineBinds++
}

for (const e of rels) {
  const b = e.bucket
  if (b === undefined || b === "unique" || b === "unresolved") continue
  const decls = byName.get(e.target)
  if (!decls || decls.length <= 1) continue
  const t = trial[e.type] ?? (trial[e.type] = trialOne())
  t.edges++
  const srcHere = (byName.get(e.source) ?? []).filter((d) => d.file === e.file)
  if (srcHere.length === 0) { t.wouldBeAmbiguous++; continue }
  const targetIsMemberOfSource = decls.some((d) => d.file === e.file && ownerOf(d) === e.source)
  if (!targetIsMemberOfSource) { t.memberNotOfSource++; t.wouldBeAmbiguous++; continue }
  const qualified = `${e.source}.${e.target}`
  const qhits = (byName.get(qualified) ?? []).length
  const owners = new Set((byName.get(e.source) ?? []).map((d) => d.file))
  if (owners.size > 1) t.ownerNameNotUniqueInIndex++
  if (qhits === 1) t.wouldBeUnique++
  else if (qhits === 0) t.wouldBeUnresolved++
  else t.wouldBeAmbiguous++
}

for (const e of rels) {
  const b = e.bucket
  if (b === undefined || b === "unique" || b === "unresolved") continue
  const decls = byName.get(e.target)
  if (!decls) continue
  const here = decls.filter((d) => d.file === e.file)
  if (here.length <= 1) continue
  const kinds = new Set(here.map((d) => d.kind))
  const scopes = new Set(here.map((d) => d.scope))
  if (kinds.size === 1) {
    shapes[b].sameKindOverload++
    noteExample(`${b}/sameKindOverload`, `${e.type} ${e.source}->${e.target} @${e.file}:${e.line} decls=${here.length} kind=${[...kinds][0]} params=[${here.map((d) => d.params).join(",")}]`)
  } else if (kinds.size > 1) {
    shapes[b].distinctKinds++
    noteExample(`${b}/distinctKinds`, `${e.type} ${e.source}->${e.target} @${e.file}:${e.line} decls=${here.length} kinds=${[...kinds].sort().join(",")}`)
  }
  if (kinds.has("property") && (kinds.has("function") || kinds.has("macro") || kinds.has("method"))) {
    shapes[b].fieldVsAccessor++
    noteExample(`${b}/fieldVsAccessor`, `${e.type} ${e.source}->${e.target} @${e.file}:${e.line} kinds=${[...kinds].sort().join(",")}`)
  }
  if (scopes.size > 1) {
    const memberVsTop = here.some((d) => d.scope.length === 0) && here.some((d) => d.scope.length > 0)
    if (memberVsTop) shapes[b].memberVsTopLevel++
    else shapes[b].ownerCollision++
    noteExample(`${b}/scoped`, `${e.type} ${e.source}->${e.target} @${e.file}:${e.line} scopes=${[...scopes].sort().join("|")}`)
  }
  const src = byName.get(e.source) ?? []
  if (src.some((d) => d.file === e.file)) {
    ownerPresentEdges++
    ownerPresentByBucket[b]++
  }
}

/** Every declaration of a name, for the top-N names of a bucket. */
const declsOf = (name: string): Decl[] => (byName.get(name) ?? []).slice().sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0)

// ═══════════════════════════════════════════════════════════════════════════
// WHAT THE STORE ACTUALLY DOES WITH THESE AMBIGUOUS EDGES
// ═══════════════════════════════════════════════════════════════════════════
//
// The three-way split above measures ambiguity as a NAME-KEYED lookup, because
// that is what `script/m14/incoming-check.ts` does (line 107/134-146). The store
// does not resolve targets that way. `parallel-indexer.ts` prepares TWO
// statements and picks between them on the relationship type (line 3499-3501):
//
//   resolveContainsTargetStmt   ONLY for `contains`, and only when the edge
//     carries a line. ORDER BY (s.file_id = ?) DESC, (s.line_start = ?) DESC,
//     COALESCE(s.is_declaration,0) ASC, (f.language = ?) DESC, s.id
//     — the child's OWN naming line is the discriminator (#612 follow-up).
//
//   resolveTargetStmt          every other type. ORDER BY
//     COALESCE(s.is_declaration,0) ASC, (s.file_id = ?) DESC,
//     (f.language = ?) DESC, s.id
//     — no line, so a same-file duplicate is settled by `s.id` alone, which is
//     `${projectId}:${name}:${line}` compared as TEXT: the lexicographically
//     SMALLEST line wins.
//
// So the fleet-wide `ambiguousTargets` column is an UPPER BOUND on two different
// populations, and only one of them is a defect the lane can be charged with.
// This section replays both statements over the same index so the difference is
// a number instead of an argument about SQL.
//
// FIDELITY, stated because a replay that differs from the statement it replays
// measures the replay:
//   - `s.id` is `${projectId}:${path}:${name}:${line}`. The projectId prefix is
//     constant across candidates, so TEXT ordering reduces to `${name}:${line}`,
//     and `name` is equal within a candidate set. That reduction is what
//     `Decl.id` stores.
//   - `(f.language = ?)` is compared against the current file's language, and
//     this walk indexes nim files only, so the tier is a no-op and is dropped.
//   - `(s.file_id = ?)` is the edge's OWN file, so the tier is "same file first".
//   - `s.line_start` is the symbol's `range.startLine`, the same field the
//     analyzer writes `line_number` from for a member (`collectContainment`:
//     `line_number: s.range.startLine`), so the hint compares like with like.
//
// NOT SIMULATED: the `id`-tie-break is counted as a TIE, not resolved to a
// winner and scored, because with no intent oracle for calls/uses a winner would
// be scored against nothing. For `contains` the intent IS known — the member of
// the edge's own source — so that one is scored both ways and the hint's value is
// the difference.

type StoreRow = {
  ambiguous: number
  /** exactly one candidate wins on every key before `s.id` */
  decisive: number
  /** >=2 candidates tie on every key before `s.id`; the winner is `s.id` order */
  idTieBroken: number
  /** the winner was found (a candidate existed at all) */
  placed: number
  /** the winner sits in a file other than the edge's own */
  winnerInOtherFile: number
  /** `contains` only: winner's scope is the edge's source — the intended member */
  matchesIntent: number
  /** `contains` only: winner's scope is not the source */
  contradictsIntent: number
  /** contains edges with NO line, which fall out of the hinted statement */
  noLine: number
  /** raw candidates this walk published, before the store's id-collapse */
  rawCandidates: number
  /** candidates left after collapsing on `${file}:${name}:${line}` */
  storeCandidates: number
}
const storeNew: Record<string, StoreRow> = {}
const storeOld: Record<string, StoreRow> = {}
const storeOne = (): StoreRow => ({
  ambiguous: 0, decisive: 0, idTieBroken: 0, placed: 0,
  winnerInOtherFile: 0, matchesIntent: 0, contradictsIntent: 0, noLine: 0,
  rawCandidates: 0, storeCandidates: 0,
})
for (const t of ALL_TYPES) { storeNew[t] = storeOne(); storeOld[t] = storeOne() }

/**
 * Replay one ORDER BY vector. `keys` are ascending 0/1 flags where 1 wins;
 * ties on every key are reported rather than broken, and `id` ascending breaks
 * the rest exactly as SQLite's TEXT comparison would.
 *
 * CANDIDATES ARE DEDUPED BY `id` FIRST, and that dedupe is the correction that
 * makes this a replay of the store rather than of the walk. `brain_symbol.id` is
 * `${fileId}:${name}:${lineStart}` (`parallel-indexer.ts:2844`) and the insert is
 * `INSERT OR REPLACE` (`:2154`), so two rows this walk counts as two
 * declarations — a field published once as `property` and once as `variable` at
 * the same line, which the shape table shows at `compiler/sigmatch.nim:48` — are
 * ONE stored row, and the second write replaces the first. Ranking both would
 * report a tie the store cannot see and would have inflated `idTieBroken` by the
 * whole duplicate-publication count. Which kind survives the REPLACE depends on
 * insert order and is not simulated; it cannot affect which row is chosen, since
 * resolution reads only id, file_id and language.
 */
const pick = (
  candsIn: Decl[],
  edgeFile: string,
  edgeLineNum: number,
  keys: ((d: Decl) => number)[],
): { winner: Decl | null; tied: number } => {
  const cands: Decl[] = []
  const seenIds = new Set<string>()
  for (const d of candsIn) {
    const k = `${d.file}|${d.id}`
    if (seenIds.has(k)) continue
    seenIds.add(k)
    cands.push(d)
  }
  if (cands.length === 1) return { winner: cands[0], tied: 1 }
  const ranked = cands
    .map((d) => ({ d, key: keys.map((k) => k(d)), id: `${d.file}|${d.id}` }))
    .sort((a, b) => {
      for (let i = 0; i < keys.length; i++) {
        if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i]
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
  const top = ranked[0]
  if (!top) return { winner: null, tied: 0 }
  const tied = ranked.filter((r) => r.key.every((v, i) => v === top.key[i])).length
  return { winner: top.d, tied }
}

/**
 * Every `contains` edge the store's CURRENT rule places on a member of a
 * different owner than the edge names. Declared before the loop that fills it,
 * because a `const` read inside the loop body is a TDZ error at run time and a
 * type error only under some transpilers — either way the population silently
 * disappears, which is the failure mode this file exists to prevent.
 */
const contradicted: {
  file: string
  line: number
  source: string
  target: string
  winner: string
  winnerFile: string
  winnerKind: string
  winnerLine: number
  winnerIsDecl: boolean
  tied: number
  candidates: { scope: string; kind: string; line: number; file: string; isDecl: boolean }[]
}[] = []

for (const e of rels) {
  const b = e.bucket
  if (b === undefined || b === "unique" || b === "unresolved") continue
  const decls = byName.get(e.target)
  if (!decls || decls.length <= 1) continue

  const sameFile = (d: Decl) => (d.file === e.file ? 1 : 0)
  const oldRow = storeOld[e.type]
  oldRow.ambiguous++
  {
    const r = pick(decls, e.file, e.line, [(d) => (d.isDecl ? 1 : 0), sameFile])
    if (!r.winner) continue
    oldRow.placed++
    oldRow.storeCandidates += r.tied === 1 ? 1 : 0
    if (r.tied > 1) oldRow.idTieBroken++
    else oldRow.decisive++
    if (r.winner.file !== e.file) oldRow.winnerInOtherFile++
    if (e.type === "contains") {
      if (ownerOf(r.winner) === e.source) oldRow.matchesIntent++
      else oldRow.contradictsIntent++
    }
  }

  const newRow = storeNew[e.type]
  newRow.ambiguous++
  if (e.type !== "contains" || e.line <= 0) {
    // Not hinted: the store runs the general statement for it, so the arms agree.
    newRow.noLine++
    const r = pick(decls, e.file, e.line, [(d) => (d.isDecl ? 1 : 0), sameFile])
    if (!r.winner) continue
    newRow.placed++
    if (r.tied > 1) newRow.idTieBroken++
    else newRow.decisive++
    if (r.winner.file !== e.file) newRow.winnerInOtherFile++
    continue
  }
  const r = pick(decls, e.file, e.line, [sameFile, (d) => (d.line === e.line ? 1 : 0), (d) => (d.isDecl ? 1 : 0)])
  if (!r.winner) continue
  newRow.placed++
  if (r.tied > 1) newRow.idTieBroken++
  else newRow.decisive++
  if (r.winner.file !== e.file) newRow.winnerInOtherFile++
  if (ownerOf(r.winner) === e.source) newRow.matchesIntent++
  else {
    newRow.contradictsIntent++
    // NAME the contradicted edges. The count alone cannot be acted on: a
    // `contains` edge placed on a member of a DIFFERENT owner is a wrong edge,
    // and the only way to find out whether it is the analyzer's line, the
    // store's ordering, or a genuine same-line collision is to print the edge,
    // its source, the winner it picked and the candidates it picked against.
    //
    // This was added because the counterfactual below — the brief's prescribed
    // remedy — turned out to be a REGRESSION for this type, so the actionable
    // population is the 16, not the 1,079.
    contradicted.push({
      file: e.file,
      line: e.line,
      source: e.source,
      target: e.target,
      winner: `${r.winner.scope || "-"}.${r.winner.name ?? r.winner.id.split(":").pop()}`.replace(/^\./, ""),
      winnerFile: r.winner.file,
      winnerKind: r.winner.kind,
      winnerLine: r.winner.line,
      winnerIsDecl: r.winner.isDecl,
      tied: r.tied,
      candidates: decls
        .map((d) => ({ scope: d.scope || "-", kind: d.kind, line: d.line, file: d.file, isDecl: d.isDecl }))
        .sort((a, b) => a.line - b.line || (a.file < b.file ? -1 : 1)),
    })
  }
}

// the store's id-collapse, as its own number: how many ambiguous edges had MORE
// THAN ONE raw candidate that is ONE stored row
const idCollapse = new Map<string, number>()
let idCollapseEdges = 0
{
  for (const e of rels) {
    const b = e.bucket
    if (b === undefined || b === "unique" || b === "unresolved") continue
    const decls = byName.get(e.target) ?? []
    const uniq = new Set(decls.map((d) => `${d.file}|${d.id}`)).size
    if (decls.length > uniq) {
      const k = `${e.type}/${b}`
      idCollapse.set(k, (idCollapse.get(k) ?? 0) + 1)
      idCollapseEdges++
    }
  }
}

// per-type x per-bucket x per-shape, the table that decides which bucket to fix
const shapeByType: Record<string, Record<Bucket, Record<Shape, number>>> = {}
for (const t of ALL_TYPES) {
  shapeByType[t] = {} as any
  for (const b of BUCKETS) shapeByType[t][b] = { ownerCollision: 0, memberVsTopLevel: 0, fieldVsAccessor: 0, sameKindOverload: 0, distinctKinds: 0 }
}
const shapeExamples: Record<string, string[]> = {}
for (const e of rels) {
  const b = e.bucket
  if (b === undefined || b === "unique" || b === "unresolved") continue
  const decls = byName.get(e.target)
  if (!decls) continue
  const here = decls.filter((d) => d.file === e.file)
  if (here.length <= 1) continue
  const kinds = new Set(here.map((d) => d.kind))
  const scopes = new Set(here.map((d) => d.scope))
  const cell = shapeByType[e.type][b]
  if (kinds.size === 1) {
    cell.sameKindOverload++
    const key = `${e.type}/${b}/sameKindOverload`
    const arr = shapeExamples[key] ?? (shapeExamples[key] = [])
    if (arr.length < 4) arr.push(`${e.source}->${e.target} @${e.file}:${e.line} kind=${[...kinds][0]} params=[${here.map((d) => d.params).join(",")}]`)
  } else {
    cell.distinctKinds++
    const key = `${e.type}/${b}/distinctKinds`
    const arr = shapeExamples[key] ?? (shapeExamples[key] = [])
    if (arr.length < 4) arr.push(`${e.source}->${e.target} @${e.file}:${e.line} kinds=${[...kinds].sort().join(",")}`)
  }
  if (kinds.has("property") && (kinds.has("function") || kinds.has("macro") || kinds.has("method"))) cell.fieldVsAccessor++
  if (scopes.size > 1) {
    const memberVsTop = here.some((d) => d.scope.length === 0) && here.some((d) => d.scope.length > 0)
    if (memberVsTop) cell.memberVsTopLevel++
    else cell.ownerCollision++
  }
}

function topNames(bucket: Bucket, n: number): { name: string; edges: number; detail: string }[] {
  const rowsOut: { name: string; edges: number; detail: string }[] = []
  for (const [name, inner] of nameCounts) {
    const n2 = inner.get(bucket) ?? 0
    if (n2 === 0) continue
    const ds = declsOf(name)
    const byF = new Map<string, number>()
    for (const d of ds) byF.set(d.file, (byF.get(d.file) ?? 0) + 1)
    const scopes = [...new Set(ds.map((d) => (d.scope.length ? d.scope : "-")))].sort()
    const detail = `decls=${ds.length} kinds=[${[...new Set(ds.map((d) => d.kind))].sort().join(",")}] files=${byF.size} scopes=[${scopes.join(",")}]`
    rowsOut.push({ name, edges: n2, detail })
  }
  rowsOut.sort((a, b) => (b.edges - a.edges) || (a.name < b.name ? -1 : 1))
  return rowsOut.slice(0, n)
}

// ── totals
const total: Record<Bucket, number> = blank()
for (const t of ALL_TYPES) for (const b of BUCKETS) total[b] += perType[t][b]
const ambiguousEdges = total.B1_scope + total.B3_legit + total.B2_module
const edgesWithTarget = total.unique + ambiguousEdges + total.unresolved

const unresolvedNames = new Map<string, number>()
for (const [name, inner] of nameCounts) {
  const n = inner.get("unresolved") ?? 0
  if (n > 0) unresolvedNames.set(name, n)
}
const topUnresolved = [...unresolvedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)

const OUT_JSON = process.argv[2]
const OUT_TXT = process.argv[3]

const lines: string[] = []
const pad = (s: string | number, n: number): string => (String(s) + " ".repeat(n)).slice(0, n)
lines.push(`nim ambiguity classify — ${files.length} file(s), analyzer ${ANALYZER_SHA.slice(0, 12)}`)
lines.push(`file list ${LIST_REL} sha256 ${LIST_SHA.slice(0, 16)}`)
lines.push(`symbols ${symbols} (empty name ${emptyName}, empty kind ${emptyKind})  degraded ${degraded}  parse failures ${parseFailures.length}`)
lines.push(`READER GUARD — symbols with line 0: ${symbolLineZero}; edges with line 0: ${edgeLineZero}`)
lines.push(`  a nonzero count here means the reader missed the production shape, not that the analyzer`)
lines.push(`  omitted a line. The store replay below is INVALID while symbol line 0 is nonzero, because`)
lines.push(`  the id-collapse and the (s.line_start = relLine) hint both key on it.`)
if (parseFailures.length) for (const f of parseFailures.slice(0, 5)) lines.push(`  ${f}`)
if (offOntology.size) lines.push(`off-ontology edge labels: ${[...offOntology.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`)
lines.push("")
lines.push(pad("type", 14) + pad("edges", 9) + pad("unique", 9) + pad("B1_scope", 9) + pad("B3_legit", 10) + pad("B2_module", 11) + pad("unres", 8) + pad("multiDecl", 10) + "multiKind")
lines.push("-".repeat(96))
for (const t of ALL_TYPES) {
  const r = perType[t]
  const e = r.unique + r.B1_scope + r.B3_legit + r.B2_module + r.unresolved
  lines.push(
    pad(t, 14) + pad(e, 9) + pad(r.unique, 9) + pad(r.B1_scope, 9) + pad(r.B3_legit, 10) +
    pad(r.B2_module, 11) + pad(r.unresolved, 8) + pad(defs[t].multiDecl, 10) + String(defs[t].multiKind),
  )
}
lines.push("-".repeat(96))
lines.push(
  pad("TOTAL", 14) + pad(edgesWithTarget, 9) + pad(total.unique, 9) + pad(total.B1_scope, 9) +
  pad(total.B3_legit, 10) + pad(total.B2_module, 11) + pad(total.unresolved, 8),
)
lines.push("")
lines.push(`THE THREE-WAY SPLIT of ${ambiguousEdges} ambiguous edges (precedence B1 > B3 > B2):`)
lines.push(`  B1 SCOPE-COLLAPSED    ${pad(total.B1_scope, 8)} ${pct(total.B1_scope, ambiguousEdges)}  the edge's own file does not settle it`)
lines.push(`  B3 LEGIT-SHARED-NAME  ${pad(total.B3_legit, 8)} ${pct(total.B3_legit, ambiguousEdges)}  same scope, distinct declarations`)
lines.push(`  B2 MODULE-NOT-MODELLED ${pad(total.B2_module, 8)} ${pct(total.B2_module, ambiguousEdges)}  multiplicity is across files`)
lines.push("")
lines.push(`raw overlaps, for recombining: cross-file edges inside B1/B3 ${overlap.scopeAndCrossFile}, edges whose ambiguity spans >1 kind inside B1 ${overlap.multiKindInB1}, all ${overlap.crossFile} cross-file edges`)
lines.push("")
lines.push("what a reverse walk could have used to settle each ambiguous edge:")
for (const s of ["settledByFile", "settledByFileAndKind", "settledByKind", "settledByNeither"] as Settle[]) {
  lines.push(`  ${pad(s, 22)} ${pad(settleEdges[s], 8)} ${pct(settleEdges[s], ambiguousEdges)}`)
}
lines.push("")
lines.push("sub-shapes of B1 and B3 (per EDGE; sameKindOverload and distinctKinds are exclusive, fieldVsAccessor")
lines.push("and the two scoped shapes overlap them):")
for (const b of ["B1_scope", "B3_legit"] as Bucket[]) {
  lines.push(`  ${b}  total ${total[b]}`)
  for (const s of ["ownerCollision", "memberVsTopLevel", "fieldVsAccessor", "sameKindOverload", "distinctKinds"] as Shape[]) {
    lines.push(`    ${pad(s, 20)} ${pad(shapes[b][s], 8)} ${pct(shapes[b][s], total[b])}`)
  }
  lines.push(`    edge SOURCE is a declaration in the same file: ${ownerPresentByBucket[b]}`)
}
lines.push("")
lines.push(`ambiguous edges whose SOURCE is itself a published declaration in the same file: ${ownerPresentEdges}`)
lines.push("")
lines.push("PER TYPE x PER BUCKET x PER SHAPE — the cell that decides which bucket a fix can reach.")
lines.push("ownerCollision and memberVsTopLevel require scopes.size>1; sameKindOverload and distinctKinds are")
lines.push("exclusive; fieldVsAccessor overlays them. Shapes are computed on the SAME-FILE declarations only.")
for (const b of ["B1_scope", "B3_legit"] as Bucket[]) {
  for (const t of ALL_TYPES) {
    const n = perType[t][b]
    if (n === 0) continue
    const c = shapeByType[t][b]
    lines.push(`  ${pad(t, 14)} ${pad(b, 10)} ${pad(n, 6)}` +
      ` ownerCol=${pad(c.ownerCollision, 6)} memberVsTop=${pad(c.memberVsTopLevel, 6)}` +
      ` fieldVsAcc=${pad(c.fieldVsAccessor, 5)} sameKind=${pad(c.sameKindOverload, 6)} diffKind=${c.distinctKinds}`)
  }
}
lines.push("")
for (const k of Object.keys(shapeExamples).sort()) {
  lines.push(`  ${k}:`)
  for (const t of shapeExamples[k]) lines.push(`    ${t}`)
}
lines.push("")
lines.push("WHAT THE STORE DOES WITH THESE EDGES — both statements replayed over the same candidate sets.")
lines.push("NEW arm = current parallel-indexer.ts:3499-3501 (contains uses the child's own naming line;")
lines.push("every other type uses the name-only statement). OLD arm = the name-only statement for every")
lines.push("type, i.e. the pre-#612-follow-up behaviour. decisive = exactly one candidate wins every key")
lines.push("before s.id; idTieBroken = >=2 tie on those keys so the winner is TEXT id order.")
lines.push("matchesIntent/contradictsIntent are scored for `contains` ONLY — a contains edge names a")
lines.push("member of its own source, so the intended target is the candidate whose OWNER (`ownerName`,")
lines.push("the field `collectContainment` builds the edge's `source` from, :2068) is that source. NOT")
lines.push("`scope`: `scope` is the enclosing CALLABLE and is empty at file scope, so a first version")
lines.push("scored 16 method edges as contradicted whose winner was on the edge's own file AND line —")
lines.push("a confident claim that the store mis-resolved 16 edges, produced by comparing two fields.")
lines.push("For calls/uses/references the intent is not knowable from the edge, so scoring them against")
lines.push("the source would measure nothing and the columns read n/a.")
lines.push("")
lines.push("Candidates are collapsed on `${file}:${name}:${line}` before ranking, because")
lines.push("brain_symbol.id is exactly that triple (parallel-indexer.ts:2844) and the insert is")
lines.push(`INSERT OR REPLACE (:2154). Ambiguous edges whose raw candidates collapse: ${idCollapseEdges}`)
for (const [k, v] of [...idCollapse.entries()].sort()) lines.push(`  ${pad(k, 28)} ${v}`)
lines.push("")
lines.push(pad("type", 14) + pad("amb", 7) + pad("decisive", 10) + pad("idTie", 8) + pad("placed", 8) + pad("otherFile", 11) + pad("intentOK", 10) + pad("intentNO", 10) + "noLine")
lines.push("-".repeat(88))
{
  const sum = (m: Record<string, StoreRow>): StoreRow => {
    const o = storeOne()
    for (const t of ALL_TYPES) for (const k of Object.keys(o) as (keyof StoreRow)[]) o[k] += m[t][k]
    return o
  }
  const sn = sum(storeNew)
  const so = sum(storeOld)
  const cell = (r: StoreRow): string =>
    pad(r.ambiguous, 7) + pad(r.decisive, 10) + pad(r.idTieBroken, 8) + pad(r.placed, 8) +
    pad(r.winnerInOtherFile, 11) +
    (r.matchesIntent + r.contradictsIntent > 0 ? pad(r.matchesIntent, 10) + pad(r.contradictsIntent, 10) : pad("n/a", 10) + pad("n/a", 10)) +
    String(r.noLine)
  for (const t of ALL_TYPES) {
    const r = storeNew[t]
    if (r.ambiguous === 0) continue
    lines.push(pad(t, 14) + cell(r))
  }
  lines.push("-".repeat(88))
  lines.push(pad("NEW TOTAL", 14) + cell(sn))
  lines.push(pad("OLD TOTAL", 14) + cell(so))
  lines.push("")
  const cn = storeNew["contains"]
  const co = storeOld["contains"]
  lines.push(`contains, the only hinted type — the line the edge carries vs the member it names:`)
  lines.push(`  OLD (name-only)  intentOK ${pad(co.matchesIntent, 6)} intentNO ${pad(co.contradictsIntent, 6)} idTie ${pad(co.idTieBroken, 6)} decisive ${co.decisive}`)
  lines.push(`  NEW (line hint)  intentOK ${pad(cn.matchesIntent, 6)} intentNO ${pad(cn.contradictsIntent, 6)} idTie ${pad(cn.idTieBroken, 6)} decisive ${cn.decisive}`)
  lines.push(`  the shared #612 line hint moves ${cn.matchesIntent - co.matchesIntent} of ${cn.ambiguous} contains edges onto the member the edge names (${pct(cn.matchesIntent - co.matchesIntent, cn.ambiguous)})`)
  lines.push(`  ${cn.contradictsIntent} contains edges remain placed on a member of a DIFFERENT owner under the current rule`)
  lines.push("")
  // The 16, named. A count of wrong edges is a measurement; the edges are the
  // finding, and without them the only available move is to change the rule for
  // all 1,079 and hope.
  lines.push(`EVERY CONTRADICTED CONTAINS EDGE (${contradicted.length}) — the store's current rule, the winner it`)
  lines.push("picked, and every candidate it ranked. `sameLine` is whether a candidate sat on the edge's")
  lines.push("own line, which is the FIRST key after same-file; `src` is the owner the edge names.")
  lines.push("")
  for (const c of contradicted) {
    lines.push(`  ${c.file}:${c.line}  contains ${c.source} -> ${c.target}`)
    lines.push(
      `      picked ${c.winner} (${c.winnerKind}${c.winnerIsDecl ? ", DECLARATION" : ""}) ` +
        `@${c.winnerFile}:${c.winnerLine}   tie=${c.tied}`,
    )
    for (const k of c.candidates) {
      const sameLine = k.line === c.line ? " <- EDGE LINE" : ""
      lines.push(`      cand ${k.scope}.${c.target} (${k.kind}${k.isDecl ? ", DECL" : ""}) @${k.file}:${k.line}${sameLine}`)
    }
    lines.push("")
  }
  lines.push("")
  lines.push(`all types: idTieBroken — the winner is TEXT id order, a rule nobody chose — ${sn.idTieBroken} of ${sn.ambiguous} (${pct(sn.idTieBroken, sn.ambiguous)})`)
  lines.push(`all types: decided by a key the store chose deliberately — ${sn.decisive}`)
  lines.push(`all types: placed on a candidate in ANOTHER file than the edge's own — ${sn.winnerInOtherFile} of ${sn.ambiguous}`)
  lines.push(`all types: ambiguous edges the store cannot place at all — ${sn.ambiguous - sn.placed}`)
}
lines.push("")
lines.push("SECOND COUNTERFACTUAL — the FILE hint, which is the anchor already available and is what")
lines.push("settles `contains`. fileUnique = the edge's own file leaves exactly ONE candidate, so the")
lines.push("store's `(s.file_id = ?)` key is decisive on its own. fileMulti = it leaves >1.")
lines.push("lineWouldSep = of those, candidates carry distinct lines, so a line KEY could break the tie.")
lines.push("edgeLineBinds = the EDGE'S OWN line lands on exactly one same-file candidate, so a line")
lines.push("EQUALITY would actually bind it. edgeNoLine = the edge carries no line.")
lines.push("")
lines.push("The last two columns differ by exactly the difference between a RULE and a FACT, and the")
lines.push("first cut of this table reported only the first: 100.0% everywhere, which says a key is")
lines.push("possible and says nothing about whether any edge points at a declaration.")
lines.push("")
lines.push(pad("type", 14) + pad("amb", 8) + pad("fileUnique", 13) + pad("fileMulti", 12) + pad("lineWouldSep", 14) + pad("edgeLineBinds", 15) + pad("edgeNoLine", 12))
lines.push("-".repeat(96))
{
  let aE = 0, aU = 0, aM = 0, aL = 0, aB = 0, aN = 0
  for (const t of ALL_TYPES) {
    const n = narrow[t]
    if (!n || n.edges === 0) continue
    lines.push(
      pad(t, 14) + pad(n.edges, 8) + pad(n.fileUnique, 13) + pad(n.fileMulti, 12) +
        pad(n.lineWouldSeparate, 14) + pad(n.edgeLineBinds, 15) + pad(n.edgeNoLine, 12),
    )
    aE += n.edges; aU += n.fileUnique; aM += n.fileMulti
    aL += n.lineWouldSeparate; aB += n.edgeLineBinds; aN += n.edgeNoLine
  }
  lines.push("-".repeat(96))
  lines.push(pad("TOTAL", 14) + pad(aE, 8) + pad(aU, 13) + pad(aM, 12) + pad(aL, 14) + pad(aB, 15) + pad(aN, 12))
  lines.push("")
  lines.push(`  the file hint alone settles ${aU} of ${aE} ambiguous edges (${pct(aU, aE)}) — the FIRST key the store`)
  lines.push(`  already applies, so this is what the existing mechanism achieves rather than a new one.`)
  lines.push(`  of the ${aM} the file hint cannot, the edge's OWN line binds exactly one candidate for`)
  lines.push(`  ${aB} (${pct(aB, aM)}). The other ${aM - aB} carry no line or a line that lands on no declaration,`)
  lines.push(`  which is what parallel-indexer.ts:3492-3495 already states for these types: "Every other`)
  lines.push(`  relationship type keeps line_number as a SITE (where the call/read happened) and must NOT`)
  lines.push(`  be resolved by it". So the line anchor is available to exactly one type and it is used there.`)
}
lines.push("")
lines.push("COUNTERFACTUAL — qualify each ambiguous edge whose source is a declaration in the edge's own")
lines.push("file and count what the qualified spelling would resolve to GLOBALLY. This is the number that")
lines.push("decides whether owner-qualification is a fix or a migration from B1 to B2:")
lines.push(pad("type", 14) + pad("ambEdges", 10) + pad("->unique", 9) + pad("->amb", 7) + pad("->unres", 8) + pad("owner!uniq", 12) + "target!member")
lines.push("-".repeat(72))
{
  let te = 0, tu = 0, ta = 0, tx = 0, to = 0, tm = 0
  for (const t of ALL_TYPES) {
    const r = trial[t]
    if (!r) continue
    lines.push(pad(t, 14) + pad(r.edges, 10) + pad(r.wouldBeUnique, 9) + pad(r.wouldBeAmbiguous, 7) + pad(r.wouldBeUnresolved, 8) + pad(r.ownerNameNotUniqueInIndex, 12) + String(r.memberNotOfSource))
    te += r.edges; tu += r.wouldBeUnique; ta += r.wouldBeAmbiguous; tx += r.wouldBeUnresolved; to += r.ownerNameNotUniqueInIndex; tm += r.memberNotOfSource
  }
  lines.push("-".repeat(72))
  lines.push(pad("TOTAL", 14) + pad(te, 10) + pad(tu, 9) + pad(ta, 7) + pad(tx, 8) + pad(to, 12) + String(tm))
  lines.push(`  ->unique ${tu} of ${te} ambiguous edges (${pct(tu, te)}); ${te - tu} still ambiguous`)
}
lines.push("")
for (const k of Object.keys(examples)) {
  lines.push(`  examples ${k}:`)
  for (const t of examples[k]) lines.push(`    ${t}`)
}
lines.push("")
for (const b of ["B1_scope", "B3_legit", "B2_module"] as Bucket[]) {
  const top = topNames(b, 12)
  const nameTotal = [...nameCounts.entries()].filter(([, i]) => (i.get(b) ?? 0) > 0).length
  lines.push(`top ${b} names — ${nameTotal} distinct names carry this bucket's ${perTypeKeysSum(b)} edges`)
  for (const t of top) lines.push(`  ${pad(t.name, 26)} ${pad(t.edges, 6)} ${t.detail}`)
  lines.push("")
}
lines.push(`top unresolved targets — ${unresolvedNames.size} distinct names carry ${total.unresolved} edges`)
for (const [n, c] of topUnresolved) lines.push(`  ${pad(n, 30)} ${c}`)

function pct(a: number, b: number): string {
  return b === 0 ? "  n/a" : `${((a / b) * 100).toFixed(1)}%`
}
function perTypeKeysSum(b: Bucket): number {
  return total[b]
}

const text = lines.join("\n") + "\n"
process.stdout.write(text)
if (OUT_JSON) {
  writeFileSync(OUT_JSON, JSON.stringify({
    analyzerSha256: ANALYZER_SHA,
    fileList: LIST_REL,
    fileListSha256: LIST_SHA,
    files: files.length,
    symbols,
    emptyName,
    emptyKind,
    degraded,
    parseFailures,
    offOntology: Object.fromEntries(offOntology),
    perType,
    twoDefinitions: defs,
    totals: { edgesWithTarget, ambiguousEdges, ...total },
    overlap,
    shapes,
    shapeByType,
    shapeExamples,
    storeReplay: { new: storeNew, old: storeOld, contradictedContains: contradicted },
    idCollapse: Object.fromEntries(idCollapse),
    idCollapseEdges,
    ownerPresentEdges,
    ownerPresentByBucket,
    trial,
    fileNarrow: narrow,
    examples,
    settleEdges,
    settleByName: Object.fromEntries(settleByName),
    topNames: {
      B1_scope: topNames("B1_scope", 60),
      B3_legit: topNames("B3_legit", 60),
      B2_module: topNames("B2_module", 60),
    },
    topUnresolved: topUnresolved.map(([name, count]) => ({ name, count })),
  }, null, 2) + "\n")
}
if (OUT_TXT) writeFileSync(OUT_TXT, text)