/**
 * R AMBIGUITY ATTRIBUTION — which analyzer RULE emits the colliding second kind?
 *
 * ## The question this file answers
 *
 * `r-ambiguity-split.ts` partitions R's 11,777 ambiguous edges into B1 SAME-FILE (130),
 * B2 CROSS-FILE (7,572) and B3 BASE-R (4,075), and the brief's instruction is to "fix the
 * largest single bucket your lane controls". B2 and B3 are the brief's second and third
 * kinds — not statically decidable, and not published by this lane at all. B1 is the
 * smallest of the three at 130 edges.
 *
 * But that partition buckets by WHERE the declarations are, not by WHAT emitted them, and
 * the top kind pair is `function+variable` at 5,152 edges — an order of magnitude larger
 * than B1. The two cuts disagree, so one of them is not naming the fixable bucket. This
 * file resolves that by cutting a THIRD way: for every ambiguous edge, find the analyzer
 * metadata on the declaration that supplies the SECOND kind, and attribute the edge to
 * that rule.
 *
 * `symbols.push` in `src/ast/real-r-analyzer.ts` carries an `rSpecific` metadata field on
 * every declaration it makes, and those markers name the rule (`isS7ClassBinding`,
 * `isS4Binding`, `quotedAssignmentTarget`, `declarationOperator`, ...). So the attribution
 * is READ OFF the walk, not guessed from the source.
 *
 * ## Why the second kind is the whole question
 *
 * `incoming-check.ts` declares an edge ambiguous when the target string hits more than one
 * entry of its KIND ARRAY. A name declared ten times as `function` hits once and is NOT
 * ambiguous. So only the *minority* kind in each collision matters: removing the duplicate
 * `function` declarations moves nothing, and removing the `variable` one removes every
 * edge on that name. That makes the minority-kind attribution a decision list, in
 * descending order of edge count, rather than a list of statistics.
 *
 * ## What a repair must satisfy to be honest
 *
 * The two kinds under one name must not be the same declaration recorded twice. If they
 * are — one binding, two `symbols.push` calls — the fix is to publish it once. If they are
 * genuinely two R objects that share a name (an S7 class named `gg` bound to `class_gg`
 * is two, and `s7_class_binding` already links them), then publishing one would DELETE a
 * true declaration, which is the fabricated-edge failure wearing the opposite hat. So this
 * file records, per attributed rule, how many of its pairs are one-declaration-twice
 * against how many are two-real-objects, and the split is the deliverable — not the
 * ranking.
 *
 * ## Reproducing
 *
 *   npx tsx validation/m14/fixtures/r/r-ambiguity-attribution.ts
 *   BB_R_LIMIT=600 npx tsx validation/m14/fixtures/r/r-ambiguity-attribution.ts
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.env.BB_R_LIMIT ?? 0)
const WORKERS = 4

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

const LABEL_ALIASES: Record<string, Type> = {
  brain_import: "imports", brain_call: "calls", brain_use: "uses",
  brain_contains: "contains", brain_reference: "references", brain_export: "exports",
  brain_extends: "extends", brain_implements: "implements",
  brain_overrides: "overrides", brain_instantiates: "instantiates",
  call: "calls", use: "uses", composition: "contains", part_of: "contains",
  imports: "imports", brain_imports: "imports",
  use_: "uses", reference: "references", export: "exports",
}
function ontologyType(raw: unknown): Type | null {
  const s = String(raw ?? "")
  if ((ALL_TYPES as readonly string[]).includes(s)) return s as Type
  return LABEL_ALIASES[s] ?? LABEL_ALIASES[s.toLowerCase()] ?? null
}

// ---------------------------------------------------------------- corpus admission
// Byte-identical to r-ambiguity-split.ts and ontology-ten-types.ts.
interface Admitted { repo: string; dir: string; rel: string; abs: string }
const admitted: Admitted[] = []
const reposWithR: Record<string, number> = {}
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "r") continue
    admitted.push({ repo: e, dir, rel, abs })
    reposWithR[e] = (reposWithR[e] ?? 0) + 1
  }
}
const covered = LIMIT > 0 ? admitted.slice(0, LIMIT) : admitted

const ANALYZER = path.resolve(process.cwd(), "src/ast/real-r-analyzer.ts")
let analyzerDigest = "MISSING (src/ast/real-r-analyzer.ts not found from cwd)"
try {
  analyzerDigest = createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
} catch { /* declared above */ }
const corpusDigest = createHash("sha256").update(covered.map((c) => c.abs).sort().join("\n")).digest("hex")
const SKIP_DEGRADED = process.env.BB_R_SKIP_DEGRADED === "1"

// The two instruments build `published` differently — this file unions the whole
// population, `incoming-check.ts` unions only the files on its argv — so their
// numbers are comparable ONLY at the same file set. Dumping the set is what makes
// that comparison runnable instead of asserted.
if (process.env.BB_R_DUMP_PATHS === "1") {
  for (const c of covered) console.log(c.abs)
  process.exit(0)
}

console.log(`R ambiguity attribution — production parseFile`)
console.log(`analyzer: src/ast/real-r-analyzer.ts sha256 ${analyzerDigest}`)
console.log(`corpus file set: sha256 ${corpusDigest} (${covered.length} paths, sorted)`)
console.log(`corpus root: ${CR}`)
console.log(`admitted population: ${admitted.length} files across ${Object.keys(reposWithR).length} repositories`)
console.log(`files walked: ${covered.length}${LIMIT > 0 ? " (corpus-order PREFIX)" : " (whole population)"}`)
console.log(`workers: ${WORKERS}\n`)

// ---------------------------------------------------------------- walk
interface Decl {
  name: string; kind: string; qualified: string
  file: string; rel: string; repo: string; line: number
  /** The rSpecific marker the emitting rule stamped, so attribution reads off the walk. */
  rule: string
  ownerName?: string
}
interface Edge { t: Type; src: string; tgt: string; file: string; conf: number }

/**
 * Which analyzer rule emitted this symbol, read off the fields production `parseFile`
 * KEEPS.
 *
 * The obvious source — the `metadata: { rSpecific: true, isS7ClassBinding: true, … }`
 * marker every `symbols.push` stamps — does not survive the pipeline. Measured on
 * `Matrix/R/00_Class.R` through `parseFile`, a returned symbol has 34 keys and
 * `metadata` is NOT among them, so a metadata-driven attribution would print `unmarked`
 * for every symbol in the corpus and rank nothing. That is a measurement about the
 * pipeline, not a guess, and it is why this function reads `kind`, `ownerName`,
 * `ownerKind` and `snippet` instead: those four do survive, and between them they
 * separate the emitting rules, because each `symbols.push` site differs in exactly one of
 * them.
 *
 * So the label is `kind` + `owner:` + a snippet-derived constructor name. The snippet is
 * the declaration's own source text, which names the R construct it came from — `setClass`
 * vs `R6Class` vs `setGeneric` — so the label is derived from evidence, and a symbol whose
 * snippet carries no recognised constructor is labelled `bare:<kind>` and never folded
 * into a named rule.
 */
function ruleOf(s: any): string {
  const kind = String(s?.kind ?? "?")
  const snip = String(s?.snippet ?? "")
  // Constructor call at the head of the snippet. Ordered so the more specific
  // setGeneric/setMethod/setValidity pair wins over the bare `setClass`.
  const ctor =
    /\bsetGeneric\s*\(/.test(snip) ? "setGeneric" :
    /\bsetMethod\s*\(/.test(snip) ? "setMethod" :
    /\bsetClass\s*\(/.test(snip) ? "setClass" :
    /\bsetValidity\s*\(/.test(snip) ? "setValidity" :
    /\bR6Class\s*\(/.test(snip) ? "R6Class" :
    /\bsetRefClass\s*\(/.test(snip) ? "setRefClass" :
    /\bnew_class\s*\(/.test(snip) ? "new_class" :
    /\bnew_base_class\s*\(/.test(snip) ? "new_base_class" :
    /\bS7::method\s*\(/.test(snip) ? "S7::method" :
    /\bS7_method\s*\(/.test(snip) ? "S7_method" :
    /<-|\bfunction\s*\(/.test(snip) ? "assignment" :
    /^[^\n]*=/.test(snip) ? "assignment" : ""
  const shape = ctor ? `${ctor}/${kind}` : `bare/${kind}`
  return shape
}

const decls: Decl[] = []
const edges: Edge[] = []
const degraded: string[] = []
const parseFailures: string[] = []
let next = 0
let doneFiles = 0

async function worker(): Promise<void> {
  for (;;) {
    const i = next++
    if (i >= covered.length) return
    const f = covered[i]
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch (e) {
      parseFailures.push(`${f.abs}: ${(e as Error)?.message ?? e}`)
      continue
    }
    if (!r) { parseFailures.push(`${f.abs}: no result`); continue }
    if (r.fallback === true) {
      degraded.push(f.abs)
      // Excluded AFTER the walk, so the two-pass form costs one walk, not two.
      if (SKIP_DEGRADED) continue
    }
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      decls.push({
        name, kind: String(s?.kind ?? ""),
        qualified: String(s?.qualifiedName ?? ""),
        file: f.abs, rel: f.rel, repo: f.repo,
        line: Number(s?.startLine ?? s?.line_number ?? s?.line ?? 0),
        rule: ruleOf(s),
        ownerName: s?.ownerName ? String(s.ownerName) : undefined,
      })
    }
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const t = ontologyType(rel?.type ?? rel?.relationshipType)
      if (!t) continue
      edges.push({
        t,
        src: String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? ""),
        tgt: String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? ""),
        file: f.abs,
        conf: Number(rel?.confidence ?? 0),
      })
    }
    doneFiles++
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

console.log(`files walked OK: ${doneFiles}   degraded (regex fallback): ${degraded.length}   parse failures: ${parseFailures.length}`)
if (degraded.length) {
  console.log(`degraded files are named because they change the population:`)
  for (const d of degraded.slice(0, 10)) console.log(`  DEGRADED ${d}`)
}
console.log(`symbols: ${decls.length}   edges: ${edges.length}\n`)

// ---------------------------------------------------------------- published universe
// Byte-identical to incoming-check.ts, including the qualifiedName alias key.
interface KeyInfo { kinds: Map<string, Decl[]>; files: Set<string>; decls: Decl[]; bare: boolean }
const published = new Map<string, KeyInfo>()
function key(k: string, d: Decl, bare: boolean): KeyInfo {
  let info = published.get(k)
  if (!info) { info = { kinds: new Map(), files: new Set(), decls: [], bare }; published.set(k, info) }
  const arr = info.kinds.get(d.kind)
  if (arr) arr.push(d); else info.kinds.set(d.kind, [d])
  info.files.add(d.file)
  info.decls.push(d)
  return info
}
for (const d of decls) {
  key(d.name, d, true)
  if (d.qualified.length > 0 && d.qualified !== d.name) key(d.qualified, d, false)
}

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const isAmbiguous = (k: string) => (published.get(k)?.kinds.size ?? 0) > 1

// ---------------------------------------------------------------- attribution
/**
 * For an ambiguous name, the MAJORITY kind is the one with the most declarations and the
 * minority kind is every other one — because an edge only resolves ambiguously while the
 * minority declaration exists. Each ambiguous edge is charged to the rule that emitted the
 * MINORITY-KIND declaration of its target, which is the declaration whose removal would
 * resolve it.
 */
interface Charge {
  rule: string; kind: string; majorityKind: string
  edges: number; names: Set<string>
  /** Same (file,line,kind) for both kinds — one declaration recorded twice. */
  sameSiteEdges: number
  /** Distinct sites: two R objects that share a name. Deleting one deletes a true decl. */
  distinctSiteEdges: number
  /** Distinct sites AND different files. */
  crossFileEdges: number
  /** Distinct sites in ONE file — the only collision R's lexical scoping could break. */
  sameFileEdges: number
  /** How many of this charge's names are owned by a class (ownerName set on the minority). */
  ownerNames: Set<string>
}
const charges = new Map<string, Charge>()
const perTypeAmb: Record<Type, number> = {} as any
for (const t of ALL_TYPES) perTypeAmb[t] = 0

let totalAmb = 0
let chargedEdges = 0
let selfLoops = 0
const uncharged: Array<{ tgt: string; kinds: string[]; types: Type[] }> = []

for (const e of edges) {
  // Self-loops are counted in their own bucket by incoming-check.ts:210, which
  // `continue`s before the ambiguity test. Without this guard this file reports
  // 11,828 ambiguous where the shared instrument reports 11,777 — measured on the
  // same analyzer digest and the same corpus digest — so the 51-edge gap was
  // self-loops whose own target is ambiguous, not a disagreement about ambiguity.
  if (e.src === e.tgt) { selfLoops++; continue }
  if (!isAmbiguous(e.tgt)) continue
  totalAmb++
  perTypeAmb[e.t]++
  const info = published.get(e.tgt)!
  // majority kind = most declarations
  let majorityKind = ""
  let best = -1
  for (const [k, arr] of info.kinds) if (arr.length > best) { best = arr.length; majorityKind = k }
  // minority declarations = every kind except the majority
  const minority: Decl[] = []
  for (const [k, arr] of info.kinds) if (k !== majorityKind) minority.push(...arr)
  if (minority.length === 0) { uncharged.push({ tgt: e.tgt, kinds: [...info.kinds.keys()], types: [e.t] }); continue }
  chargedEdges++
  for (const m of minority) {
    const ckey = `${m.rule} | ${m.kind} vs ${majorityKind}`
    let c = charges.get(ckey)
    if (!c) {
      c = {
        rule: m.rule, kind: m.kind, majorityKind,
        edges: 0, names: new Set(),
        sameSiteEdges: 0, distinctSiteEdges: 0, crossFileEdges: 0, sameFileEdges: 0,
        ownerNames: new Set(),
      }
      charges.set(ckey, c)
    }
    if (c.names.has(e.tgt)) continue
    c.names.add(e.tgt)
    c.edges++
    // Is some majority-kind declaration at the SAME (file,line)? Then the two kinds
    // describe one binding and one of them is a second push for the same declaration.
    const maj = info.kinds.get(majorityKind)!
    const sameSite = maj.some((x) => x.file === m.file && x.line === m.line)
    if (sameSite) c.sameSiteEdges++
    else {
      c.distinctSiteEdges++
      if (!maj.some((x) => x.file === m.file)) c.crossFileEdges++
      else c.sameFileEdges++
    }
    if (m.ownerName) c.ownerNames.add(m.ownerName)
  }
}

console.log(`AMBIGUITY, PER TYPE (incoming-check definition: target hits >1 SymbolKind)`)
console.log(`type            ambiguousEdges  share`)
let tsum = 0
for (const t of ALL_TYPES) { tsum += perTypeAmb[t]; console.log(`${pad(t, 15)} ${pad(String(perTypeAmb[t]), 15)} ${pad(totalAmb ? ((perTypeAmb[t] / totalAmb) * 100).toFixed(1) + "%" : "-", 8)}`) }
console.log(`${"TOTAL".padEnd(15)} ${pad(String(tsum), 15)}`)
console.log()

console.log(`ATTRIBUTION — each ambiguous edge charged to the analyzer rule that emitted the`)
console.log(`MINORITY-KIND declaration of its target. edges = DISTINCT target names, so the`)
console.log(`column is a decision list and not an edge count (one name carries many edges).\n`)
console.log(`rule                                    minority   majority   names   sameSite  distinct  sameFile  crossFile  owned`)
console.log(`----------------------------------------------------------------------------------------------------------`)
const ordered = [...charges.values()].sort((a, b) => b.edges - a.edges)
for (const c of ordered) {
  console.log(
    `${pad(c.rule, 39)} ${pad(c.kind, 10)} ${pad(c.majorityKind, 10)} ${pad(String(c.names.size), 7)} ` +
    `${pad(String(c.sameSiteEdges), 9)} ${pad(String(c.distinctSiteEdges), 10)} ` +
    `${pad(String(c.sameFileEdges), 9)} ${pad(String(c.crossFileEdges), 10)} ${c.ownerNames.size}`,
  )
}
console.log()
const chargeSum = ordered.reduce((a, c) => a + c.names.size, 0)
console.log(`partition check: charged ${chargedEdges} of ${totalAmb} ambiguous edges`)
console.log(`self-loops excluded (incoming-check.ts:210 buckets these separately): ${selfLoops}`)
console.log(`distinct-name check: ${chargeSum} name-charges over ${ordered.length} rule/kind pairs`)
if (uncharged.length) {
  console.log(`UNCHARGEABLE: ${uncharged.length} edge(s) whose target is ambiguous but carries no minority declaration`)
  for (const u of uncharged.slice(0, 5)) console.log(`  ${u.tgt} kinds=${u.kinds.join("+")} types=${[...new Set(u.types)].join(",")}`)
}
console.log()

// ---------------------------------------------------------------- the decision question
console.log(`WHAT A REPAIR WOULD COST — for the top rule, is the colliding pair one declaration`)
console.log(`recorded twice, or two real R objects sharing a name?\n`)
for (const c of ordered.slice(0, 6)) {
  const verdict = c.sameSiteEdges > 0 && c.sameSiteEdges >= c.distinctSiteEdges
    ? "DEDUP — one binding, two pushes"
    : c.distinctSiteEdges > 0 ? "TWO OBJECTS — publishing one deletes a true declaration"
    : "no data"
  console.log(`  ${pad(c.rule, 39)} sameSite ${pad(String(c.sameSiteEdges), 4)} distinct ${pad(String(c.distinctSiteEdges), 5)} sameFile ${pad(String(c.sameFileEdges), 5)} => ${verdict}`)
  // name the three worst names with their declaration sites, so the claim is checkable
  const sample = [...c.names].slice(0, 3)
  for (const n of sample) {
    const info = published.get(n)!
    const sites = info.decls.map((d) => `${d.rule}/${d.kind}@${d.rel}:${d.line}`).slice(0, 4)
    console.log(`      ${pad(n, 24)} ${sites.join("  ")}`)
  }
}
console.log()

// ---------------------------------------------------------------- examples by rule
console.log(`MINORITY DECLARATION SITES, per rule — the raw evidence for each row above`)
for (const c of ordered.slice(0, 8)) {
  const rows: string[] = []
  for (const n of c.names) {
    const info = published.get(n)!
    const m = info.decls.filter((d) => d.kind === c.kind).slice(0, 2)
    const j = info.decls.filter((d) => d.kind === c.majorityKind).slice(0, 2)
    rows.push(`${n}: ${c.kind}[${m.map((d) => `${d.rel}:${d.line}`).join(",")}] vs ${c.majorityKind}[${j.map((d) => `${d.rel}:${d.line}`).join(",")}]`)
  }
  console.log(`\n  ${c.rule} (${c.kind} vs ${c.majorityKind}) — ${c.names.size} names, ${c.edges} distinct-target edges`)
  for (const r of rows.slice(0, 6)) console.log(`    ${r}`)
}
console.log()

console.log(`==============================================================================`)
console.log(`analyzer sha256 ${analyzerDigest}`)
console.log(`corpus   sha256 ${corpusDigest}`)
console.log(`degraded (regex fallback) ${degraded.length}   parse failures ${parseFailures.length}`)
console.log(`==============================================================================`)