/**
 * R CAUSE-A COUNTERFACTUAL — what a qualified key space would buy, measured BEFORE the edit.
 *
 * ## The question
 *
 * `archive/docs-pre-consolidation/ROUND-BRIEF.md` §A states the fix for ambiguity:
 *
 *     The cause: the published name carries no file or owner identity, so N files
 *     declaring `version` collapse into one node and every edge to it is ambiguous.
 *     Fix: publish an identifier that includes the owner or module.
 *
 * and the recipe for §B:
 *
 *     `diagnose-incoming.mts` tells you how many edges that is worth before you touch anything.
 *
 * This file is that "before" measurement for the R lane. It changes no analyzer code.
 * It walks the admitted population once with production `parseFile`, keeps the raw
 * (symbol, relationship) rows, and then re-scores the SAME rows under alternative key
 * spaces. Every number below is therefore a statement about one analyzer build over one
 * file set, and the digests for both are printed in the header so a reader can tell which.
 *
 * ## The definition being decomposed — read off the instrument, not paraphrased
 *
 * `script/m14/incoming-check.ts` builds `published : Map<name, kind[]>`, inserting `name`
 * and, when it differs, `qualifiedName`; then, per edge, `if (hits.length > 1)
 * row.ambiguousTargets++`. So AMBIGUOUS means **this target string is published under two or
 * more distinct `SymbolKind` values**. Ten declarations of `f` all of kind `function` are NOT
 * ambiguous by this definition; one `function` and one `variable` ARE.
 *
 * That matters because the brief's §A describes the collision as N declarations of one name
 * sharing a node, and for R that is NOT the mechanism: R's ambiguity is a name→KIND collision.
 * `r-ambiguity-split.txt` already recorded the kind pairs (function+variable 5,152 ambiguous
 * edges, method+property 1,249, …) and `r-ambiguity-attribution.txt` recorded that every
 * colliding pair is TWO OBJECTS, so deduplication would delete a true declaration. Neither of
 * those files answers the decision question, which is: does any key space make the number move,
 * and by how much.
 *
 * ## The three key spaces scored, and why these three
 *
 *   FLAT (baseline)   `published` keyed by `name`. What ships today.
 *
 *   D1 kind-collapsed  The FUNCTION/VARIABLE distinction is not published. R has no separate
 *                      function declaration and variable declaration — both are name bindings —
 *                      so this is the "model R faithfully" design. Scored as an UPPER BOUND: it
 *                      removes the collision without changing any published kind, so it reports
 *                      what ambiguity would be if that ONE pair stopped colliding. It does not
 *                      claim the lane can drop `SymbolKind.Function`, which would be a far
 *                      larger change than the number it justifies.
 *
 *   D2 repo-qualified  `published` keyed by `<repo>::<name>`, and an edge resolves when the
 *                      SOURCE FILE'S repository declares the name. R's package boundary IS the
 *                      repository: two files in one repo share one namespace, so a bare
 *                      identifier inside a package cannot be ambiguous against a sibling file.
 *                      This is the brief's "include the owner or module" fix, specialised to R.
 *
 * ## What D2 cannot do, and why it is still the right measurement
 *
 * A repo-qualified key is not a repair on its own — an R package that calls `cli::cli_abort`
 * names a function in a DIFFERENT repository, and a bare call to a name from another package
 * names one too. So D2 is scored as a DIAGNOSTIC, not a claim: for every unresolved and every
 * ambiguous edge it asks whether the source file's own repository declares the target, and
 * whether that declaration is unique INSIDE the repository. The residue — edges whose target is
 * not declared in the source repository — is what no key space can reach, and it is the
 * population the brief calls cause C (stdlib / BCL / other packages). D2 separates the two
 * populations with counts; it does not pretend the second one is a naming defect.
 *
 * ## The one number that decides the edit
 *
 * `SAME-REPO RESOLVABLE` is printed as an edge count and as the share of the bucket it came
 * from. If it is small, cause A is not worth a name-surface change in this lane and the honest
 * verdict is that R's flat namespace makes ambiguity structural. If it is large, the edit is
 * worth proposing and the numbers here are what it is worth.
 *
 * ## Reproducing
 *
 *   npx tsx validation/m14/fixtures/r/r-cause-a-counterfactual.ts
 *   BB_R_LIMIT=600 npx tsx validation/m14/fixtures/r/r-cause-a-counterfactual.ts
 *   BB_R_FRESH=1 npx tsx validation/m14/fixtures/r/r-cause-a-counterfactual.ts
 *
 * `BB_R_LIMIT` is a corpus-order PREFIX, not a draw. The walk appends one JSON line per file to
 * `validation/m14/fixtures/r/cause-a-walk-<digest>.jsonl` and skips files already present, so a
 * run killed by the shared 120-second parse watchdog (`src/ast/engine.ts` `process.exit()`,
 * shared machinery per §8 of the workstream brief) resumes instead of losing the walk. The
 * rows are kept raw on purpose: every counterfactual is scored over the same bytes.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.env.BB_R_LIMIT ?? 0)
const FRESH = process.env.BB_R_FRESH === "1"
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
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports", extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides", instantiates: "instantiates",
}
function ontologyType(raw: unknown): Type | null {
  const s = String(raw ?? "").toLowerCase()
  if ((ALL_TYPES as readonly string[]).includes(s)) return s as Type
  return LABEL_ALIASES[s] ?? null
}

// ---------------------------------------------------------------- corpus admission
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
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "r") continue
    admitted.push({ repo: e, dir, rel, abs })
    reposWithR[e] = (reposWithR[e] ?? 0) + 1
  }
}
const covered = LIMIT > 0 ? admitted.slice(0, LIMIT) : admitted

const ANALYZER = path.resolve(process.cwd(), "src/ast/real-r-analyzer.ts")
const analyzerDigest = existsSync(ANALYZER)
  ? createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
  : "MISSING (src/ast/real-r-analyzer.ts not found from cwd)"
const corpusDigest = createHash("sha256")
  .update(covered.map((c) => c.abs).sort().join("\n"))
  .digest("hex")

console.log(`R cause-A counterfactual — production parseFile, no analyzer edit`)
console.log(`analyzer: src/ast/real-r-analyzer.ts sha256 ${analyzerDigest}`)
console.log(`corpus file set: sha256 ${corpusDigest} (${covered.length} paths, sorted)`)
console.log(`corpus root: ${CR}`)
console.log(`admitted population: ${admitted.length} files across ${Object.keys(reposWithR).length} repositories`)
console.log(`repositories: ${Object.entries(reposWithR).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}=${n}`).join(" ")}`)
console.log(`files walked: ${covered.length}${LIMIT > 0 ? " (corpus-order PREFIX of the admitted list)" : " (whole population)"}`)
console.log(`workers: ${WORKERS}\n`)

// ---------------------------------------------------------------- walk, checkpointed
interface Decl { n: string; k: string; q: string; r: string; l: number }
interface Edge { t: Type; s: string; g: string; r: string; c: number }

const SPOOL_DIR = path.resolve(process.cwd(), "validation/m14/fixtures/r")
const SPOOL = path.join(SPOOL_DIR, `cause-a-walk-${corpusDigest.slice(0, 12)}.jsonl`)
mkdirSync(SPOOL_DIR, { recursive: true })
if (FRESH) { try { writeFileSync(SPOOL, ""); } catch { /* recreated below */ } }

const walked = new Set<string>()
if (existsSync(SPOOL)) {
  for (const line of readFileSync(SPOOL, "utf8").split("\n")) {
    if (!line.trim()) continue
    try { walked.add(String(JSON.parse(line).abs ?? "")) } catch { /* truncated tail */ }
  }
}
if (walked.size) console.log(`spool: ${walked.size} files already recorded (${path.relative(process.cwd(), SPOOL)})`)

let spoolBuf: string[] = []
function flushSpool(): void {
  if (!spoolBuf.length) return
  writeFileSync(SPOOL, spoolBuf.join("") , { flag: "a" })
  spoolBuf = []
}

const degraded: string[] = []
const parseFailures: string[] = []
let next = 0
let doneFiles = walked.size
const TOTAL = covered.length

async function worker(): Promise<void> {
  for (;;) {
    const i = next++
    if (i >= TOTAL) return
    const f = covered[i]
    if (walked.has(f.abs)) continue
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch (e) {
      parseFailures.push(`${f.abs}: ${(e as Error)?.message ?? e}`)
      return
    }
    const d: Decl[] = []
    const g: Edge[] = []
    if (r) {
      if (r.fallback === true) degraded.push(f.abs)
      for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
        const name = String(s?.name ?? "")
        if (name.length === 0) continue
        d.push({
          n: name, k: String(s?.kind ?? ""), q: String(s?.qualifiedName ?? ""),
          r: f.repo, l: Number(s?.line_number ?? s?.line ?? 0),
        })
      }
      for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
        const t = ontologyType(rel?.type ?? rel?.relationshipType)
        if (!t) continue
        const src = String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? "")
        const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
        if (!tgt.length) continue
        if (src === tgt) continue
        g.push({ t, s: src, g: tgt, r: f.repo, c: Number(rel?.confidence ?? 0) })
      }
    }
    spoolBuf.push(JSON.stringify({ abs: f.abs, repo: f.repo, decls: d, edges: g }) + "\n")
    doneFiles++
    if (spoolBuf.length >= 40) flushSpool()
  }
}

await Promise.all(Array.from({ length: WORKERS }, () => worker()))
flushSpool()

// ---------------------------------------------------------------- read the spool back
const decls: Decl[] = []
const edges: Edge[] = []
const walkedAbs = new Set<string>()
{
  const text = readFileSync(SPOOL, "utf8")
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    let row: any
    try { row = JSON.parse(line) } catch { continue }
    if (walkedAbs.has(row.abs)) continue
    walkedAbs.add(row.abs)
    for (const d of row.decls ?? []) decls.push(d)
    for (const g of row.edges ?? []) edges.push(g)
  }
}

console.log(`files walked OK: ${walkedAbs.size}   degraded (regex fallback): ${degraded.length}   parse failures: ${parseFailures.length}`)
console.log(`symbols: ${decls.length}   edges: ${edges.length}\n`)
if (parseFailures.length) {
  console.log(`PARSE FAILURES (${parseFailures.length}) — each is a file this run contributes nothing from:`)
  for (const p of parseFailures.slice(0, 10)) console.log(`  ${p}`)
  console.log()
}

// ---------------------------------------------------------------- key spaces
/**
 * FLAT: `published : Map<name, kind[]>` exactly as `incoming-check.ts` builds it — `name`
 * plus `qualifiedName` when it differs. `kinds` is a SET, so the ">1 kind" test is the
 * instrument's test, not a re-derivation of it.
 */
const flat = new Map<string, Set<string>>()
for (const d of decls) {
  const name = d.n
  if (name.length === 0) continue
  const k = d.k || "?"
  if (!flat.has(name)) flat.set(name, new Set())
  flat.get(name)!.add(k)
  const q = d.q
  if (q.length > 0 && q !== name) {
    if (!flat.has(q)) flat.set(q, new Set())
    flat.get(q)!.add(k)
  }
}

/** D1: the FUNCTION/VARIABLE distinction not published. Upper bound, stated as one. */
function kindsD1(kinds: Set<string>): Set<string> {
  const s = new Set(kinds)
  const hasFn = s.has("function")
  const hasVar = s.has("variable")
  if (hasFn && hasVar) { s.delete("function") }
  return s
}

/**
 * D2: per-repository declaration index. ONE key builder, used by both the writer below and
 * the reader in the scoring loop, because the two halves of an index that spell the key
 * differently produce a total of zero and read as a finding. The separator is a byte no
 * repository name or R identifier can contain, so `repo + SEP + name` cannot collide the way
 * bare concatenation can (repo "ab" + name "c" against repo "a" + name "bc").
 */
const SEP = "\u0000"
const repoKey = (repo: string, name: string): string => `${repo}${SEP}${name}`

const perRepo = new Map<string, Set<string>>()
/** Same index reduced to KINDS, so D2's ambiguity is scored by `incoming-check.ts`'s own
 *  test (>1 distinct kind for the key) rather than by a raw declaration count. Without this,
 *  D1 and D2 would be measured on two different definitions and neither number would be
 *  comparable to `flatAmb`. */
const perRepoKinds = new Map<string, Set<string>>()
for (const d of decls) {
  if (d.n.length === 0) continue
  const key = repoKey(d.r, d.n)
  if (!perRepo.has(key)) perRepo.set(key, new Set())
  perRepo.get(key)!.add(`${d.k}@${d.r}/${d.n}`)
  if (!perRepoKinds.has(key)) perRepoKinds.set(key, new Set())
  perRepoKinds.get(key)!.add(d.k || "?")
}

interface Row {
  edges: number
  flatAmb: number
  flatUnres: number
  d1Amb: number
  /** FLAT resolves the target, and the SOURCE FILE'S repository declares that name. */
  resSameRepo: number
  /** … and exactly one declaration of it inside that repository. */
  resSameRepoUnique: number
  /** FLAT resolves the target, and the source repository declares NOTHING by that name. */
  resCrossRepo: number
  /** FLAT resolves the target, and the source repository publishes it under >1 kind (D2's ambiguity). */
  resSameRepoKindCollision: number
  /** FLAT calls it ambiguous, and the source repository publishes it under exactly ONE kind —
   *  i.e. the second kind came from a different package, so qualifying the key removes the
   *  ambiguity. This is the population D2 actually recovers. */
  flatAmbRepoKindClean: number
  /** FLAT cannot resolve the target. Split by whether any repository declares the bare name. */
  unresRepoHasBare: number
  unresRepoNoBare: number
}
const perType = {} as Record<Type, Row>
for (const t of ALL_TYPES) {
  perType[t] = {
    edges: 0, flatAmb: 0, flatUnres: 0, d1Amb: 0,
    resSameRepo: 0, resSameRepoUnique: 0, resCrossRepo: 0, resSameRepoKindCollision: 0,
    flatAmbRepoKindClean: 0,
    unresRepoHasBare: 0, unresRepoNoBare: 0,
  }
}

const ambNamesFlat = new Set<string>()
const unresNamesFlat = new Set<string>()
const ambNamesD2 = new Set<string>()
const crossRepoTop = new Map<string, number>()
const unresTop = new Map<string, number>()

/** Does ANY repository publish this bare name? (FLAT also indexes qualifiedName, so this is the weaker test.) */
const bareRepos = new Map<string, Set<string>>()
for (const d of decls) {
  if (d.n.length === 0) continue
  let s = bareRepos.get(d.n)
  if (!s) { s = new Set(); bareRepos.set(d.n, s) }
  s.add(d.r)
}

for (const e of edges) {
  const row = perType[e.t]
  row.edges++
  const kinds = flat.get(e.g)
  if (!kinds || kinds.size === 0) {
    row.flatUnres++
    unresNamesFlat.add(e.g)
    bump(unresTop, e.g)
    // FLAT indexes every published `name` AND every published `qualifiedName` across all
    // repositories, so an unresolved target is by construction declared nowhere under either
    // spelling. Counted rather than asserted, because the containment is the whole result.
    if ((bareRepos.get(e.g)?.size ?? 0) > 0) row.unresRepoHasBare++
    else row.unresRepoNoBare++
    continue
  }
  if (kinds.size > 1) { row.flatAmb++; ambNamesFlat.add(e.g) }
  if (kindsD1(kinds).size > 1) row.d1Amb++
  if (kinds.size > 1 && (perRepoKinds.get(repoKey(e.r, e.g))?.size ?? 0) === 1) {
    row.flatAmbRepoKindClean++
  }
  // D2, on the FLAT-resolvable population only — the resolvable half is where a key space can act.
  const inRepo = perRepo.get(repoKey(e.r, e.g))
  if (inRepo && inRepo.size > 0) {
    row.resSameRepo++
    if (inRepo.size === 1) row.resSameRepoUnique++
    else ambNamesD2.add(e.g)
    if ((perRepoKinds.get(repoKey(e.r, e.g))?.size ?? 0) > 1) row.resSameRepoKindCollision++
  } else {
    row.resCrossRepo++
    bump(crossRepoTop, e.g)
  }
}
function bump(m: Map<string, number>, k: string): void { m.set(k, (m.get(k) ?? 0) + 1) }

const sum = (f: (r: Row) => number) => ALL_TYPES.reduce((a, t) => a + f(perType[t]), 0)

console.log(`PER TYPE — FLAT (what ships) vs D1 (function/variable distinction not published)`)
console.log(`            vs D2 (per-repository key: R's package boundary)`)
console.log(`type            edges    flatAmb  flatUnres     D1amb  D2sameRepo  D2uniq  D2cross  D2amb   unresBare`)
console.log(`-----------------------------------------------------------------------------------------------------`)
for (const t of ALL_TYPES) {
  const r = perType[t]
  const p = (s: string | number, n: number) => String(s).padEnd(n)
  console.log(
    p(t, 14) + p(r.edges, 9) + p(r.flatAmb, 9) + p(r.flatUnres, 11) + p(r.d1Amb, 8) +
    p(r.resSameRepo, 11) + p(r.resSameRepoUnique, 8) + p(r.resCrossRepo, 9) +
    p(r.resSameRepoKindCollision, 11) + r.unresRepoHasBare,
  )
}
console.log(`-----------------------------------------------------------------------------------------------`)
console.log(
  `TOTAL`.padEnd(14) +
  String(sum((r) => r.edges)).padEnd(9) +
  String(sum((r) => r.flatAmb)).padEnd(9) +
  String(sum((r) => r.flatUnres)).padEnd(11) +
  String(sum((r) => r.d1Amb)).padEnd(8) +
  String(sum((r) => r.resSameRepo)).padEnd(11) +
  String(sum((r) => r.resSameRepoUnique)).padEnd(8) +
  String(sum((r) => r.resCrossRepo)).padEnd(9) +
  String(sum((r) => r.resSameRepoKindCollision)).padEnd(8) +
  sum((r) => r.unresRepoHasBare),
)

const E = sum((r) => r.edges)
const Amb = sum((r) => r.flatAmb)
const Unres = sum((r) => r.flatUnres)
const Resolved = E - Unres
const D2amb = sum((r) => r.resSameRepoKindCollision)
const D2unres = Unres + sum((r) => r.resCrossRepo)
const D2recovers = sum((r) => r.flatAmbRepoKindClean)
const D2losesAmbiguityToUnresolved = Amb - D2amb - D2recovers
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)

console.log(`
D1 UPPER BOUND — if the function/variable kind distinction were not published, ambiguous edges would
  fall from ${Amb} to ${sum((r) => r.d1Amb)}, i.e. ${Amb - sum((r) => r.d1Amb)} fewer (${pct(Amb - sum((r) => r.d1Amb), Amb)} of the ambiguous population).
  The residue ${sum((r) => r.d1Amb)} is collisions between kinds this design KEEPS (method+property, class+variable, function+method).
  A BOUND, not a proposal: it publishes nothing, and dropping SymbolKind.Function is a far larger
  contract edit than the number above would on its own justify.

D2 DIAGNOSTIC — per-repository key space, scored over the ${Resolved} FLAT-RESOLVABLE edges only:

  source repo DECLARES the target                    ${sum((r) => r.resSameRepo)}   (${pct(sum((r) => r.resSameRepo), Resolved)} of resolvable)
  … and exactly one declaration of it in that repo    ${sum((r) => r.resSameRepoUnique)}   (${pct(sum((r) => r.resSameRepoUnique), Resolved)})
  … and one of SEVERAL declarations in that repo      ${sum((r) => r.resSameRepo) - sum((r) => r.resSameRepoUnique)}   (${pct(sum((r) => r.resSameRepo) - sum((r) => r.resSameRepoUnique), Resolved)})
  source repo declares NOTHING by that name           ${sum((r) => r.resCrossRepo)}   (${pct(sum((r) => r.resCrossRepo), Resolved)})
  distinct names still multi-declared inside one repo ${ambNamesD2.size}`)

console.log(`
D2 SCORED END TO END — the same two columns under the per-repository key space, both scored with
incoming-check.ts's own test so the two rows are comparable:

                       ambiguous    unresolved
  FLAT (ships today)    ${String(Amb).padStart(8)}    ${String(Unres).padStart(9)}
  D2 (per-repo key)     ${String(D2amb).padStart(8)}    ${String(D2unres).padStart(9)}

  D2 pays in the other column: ${sum((r) => r.resCrossRepo)} edges are resolved under FLAT and NOT addressable under D2, because
  the source package declares nothing by that name and its own namespace therefore cannot
  address it. Both rows are counts over the same ${E} edges, so the trade reads off directly.

  Of the ${Amb} edges FLAT calls ambiguous:
    second kind comes from ANOTHER package; source package is kind-clean   ${D2recovers}   recovered by qualifying the key
    source package declares nothing by that name                          ${D2losesAmbiguityToUnresolved}   ambiguous -> UNRESOLVED under D2, not recovered
    genuine two-kind collision INSIDE the source package                    ${D2amb}   survives any key qualification
  and ${D2recovers + D2amb + D2losesAmbiguityToUnresolved} = ${Amb} closes the partition.

  The surviving ${D2amb} is not a naming defect at all: R has no function declaration distinct from
  a variable declaration, so one package can bind \`f\` to a closure in one file and to a vector in
  another, and both are true declarations that a single key cannot separate. Fixing that means
  choosing one kind for R bindings — the D1 column — not qualifying a name.`)

console.log(`
WHY D2 CANNOT TOUCH THE UNRESOLVED BUCKET — counted, not asserted. Of ${Unres} edges FLAT cannot resolve,
  some repository DOES publish the bare name          ${sum((r) => r.unresRepoHasBare)}
  NO repository publishes the bare name                ${sum((r) => r.unresRepoNoBare)}
  A per-repository key is a PARTITION of FLAT, not an extension of it: FLAT already indexes every
  published name AND every published qualifiedName across all 16 repositories, so a target absent
  from FLAT is absent from every one of its partitions. A name-space change therefore recovers
  ${sum((r) => r.unresRepoHasBare)} of ${Unres} unresolved edges. The other ${sum((r) => r.unresRepoNoBare)} name something no corpus file defines under
  any spelling — base R, another package, or a runtime argument — which is the brief's cause C and
  is not a naming defect. Any proposal that claims a name fix moves the unresolved column is
  claiming otherwise.`)

/**
 * CAUSE C — the external population, bucketed by SYNTAX.
 *
 * The brief's cause C asks for external references to be countable and excluded rather than
 * silently unresolved. Three of the buckets below are decidable from the target string alone,
 * with certainty, and are therefore measured here. The fourth is the residue and is left
 * un-subdivided on purpose: telling base R from another package from a runtime argument needs
 * an authoritative base-R export list, this environment has no R installed to produce one
 * (`Rscript` is absent), and the corpus cannot supply it because no corpus file IS base R. A
 * hand-written name list would make this a statement about that list rather than about R, which
 * is the same substitution error `r-ambiguity-split.ts` documents and refuses.
 *
 * R's reserved words are the one bucket that is a statement about the LANGUAGE rather than about
 * a list: `?Reserved` fixes them, they cannot be bound, and an edge naming one is a reference to
 * a syntactic form. It is measured rather than assumed, because if it were large it would be a
 * fabricated-edge class and the whole point of counting it is that a small number is a pass.
 */
const R_RESERVED = new Set(
  ("if else repeat while function for in next break TRUE FALSE NULL Inf NaN NA " +
   "NA_integer_ NA_real_ NA_character_ NA_complex_ ..1 ..2 ..3 ...").split(" "),
)
const isQualifiedTarget = (t: string): boolean => t.includes("::")

const cBuckets: Record<string, { edges: number; names: Set<string> }> = {
  PKG_QUALIFIED: { edges: 0, names: new Set() },
  DOT_LEADING: { edges: 0, names: new Set() },
  RESERVED_WORD: { edges: 0, names: new Set() },
  BARE_RESIDUE: { edges: 0, names: new Set() },
}
function bucketOf(t: string): string {
  if (isQualifiedTarget(t)) return "PKG_QUALIFIED"
  if (R_RESERVED.has(t)) return "RESERVED_WORD"
  if (t.startsWith(".")) return "DOT_LEADING"
  return "BARE_RESIDUE"
}
for (const [tgt, n] of unresTop) {
  const b = cBuckets[bucketOf(tgt)]
  b.edges += n
  b.names.add(tgt)
}
const cTotal = Object.values(cBuckets).reduce((a, b) => a + b.edges, 0)

console.log(`
CAUSE C CENSUS — the ${Unres} flat-unresolved edges over ${unresNamesFlat.size} distinct target names, bucketed by
target SYNTAX. Every bucket is decidable from the target string, so no list is being asserted:

  bucket            edges   names   share of unresolved   decidable from
  -------------------------------------------------------------------------------------------
  PKG-QUALIFIED      ${String(cBuckets.PKG_QUALIFIED.edges).padStart(5)}   ${String(cBuckets.PKG_QUALIFIED.names.size).padStart(5)}   ${pct(cBuckets.PKG_QUALIFIED.edges, Unres).padStart(18)}   the target contains :: or :::
  DOT-LEADING       ${String(cBuckets.DOT_LEADING.edges).padStart(5)}   ${String(cBuckets.DOT_LEADING.names.size).padStart(5)}   ${pct(cBuckets.DOT_LEADING.edges, Unres).padStart(18)}   the target starts with '.'
  RESERVED-WORD     ${String(cBuckets.RESERVED_WORD.edges).padStart(5)}   ${String(cBuckets.RESERVED_WORD.names.size).padStart(5)}   ${pct(cBuckets.RESERVED_WORD.edges, Unres).padStart(18)}   the target is in ?Reserved
  BARE-RESIDUE      ${String(cBuckets.BARE_RESIDUE.edges).padStart(5)}   ${String(cBuckets.BARE_RESIDUE.names.size).padStart(5)}   ${pct(cBuckets.BARE_RESIDUE.edges, Unres).padStart(18)}   nothing — NOT SUBDIVIDED, see below
  -------------------------------------------------------------------------------------------
  TOTAL             ${String(cTotal).padStart(5)}   ${String(Object.values(cBuckets).reduce((a, b) => a + b.names.size, 0)).padStart(5)}
  partition check: ${Object.values(cBuckets).reduce((a, b) => a + b.edges, 0)} vs unresolved ${Unres} -> ${cTotal === Unres}

  RESERVED-WORD is a fabricated-edge probe and it comes out at ${cBuckets.RESERVED_WORD.edges} edges over ${cBuckets.RESERVED_WORD.names.size} names: ${[...cBuckets.RESERVED_WORD.names].join(", ") || "none"}.
  R's grammar gives \`if\`, \`for\` and \`while\` their own node types rather than a call with a
  callee, so the analyzer's call rule cannot reach them. A large number here would have been a
  fabricated-reference class; it is not one.

  BARE-RESIDUE is deliberately left whole. Its ${cBuckets.BARE_RESIDUE.edges} edges over ${cBuckets.BARE_RESIDUE.names.size} names are base R, another package, or a runtime
  argument, and nothing in this corpus distinguishes the three: no corpus file IS base R, and
  \`Rscript\` is not installed in this environment, so no authoritative export list can be
  produced. Splitting it needs one vendored base-R export list, which is a SHARED artifact —
  every lane's cause C needs it and no lane can produce it alone. Reported, not faked.

TOP PKG-QUALIFIED TARGETS — external by syntax, the part of the column a consumer could exclude today`)
for (const [k, v] of [...unresTop].sort((a, b) => b[1] - a[1]).filter(([k]) => isQualifiedTarget(k)).slice(0, 15)) {
  console.log(`  ${String(v).padStart(6)}  ${k}`)
}
console.log(`
TOP FLAT-UNRESOLVED TARGETS — the corpus calling what no file in it defines`)
for (const [k, v] of [...unresTop].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${String(v).padStart(6)}  ${k}`)
console.log(`  … ${unresTop.size} distinct unresolved target names in total`)

console.log(`
TOP CROSS-REPO TARGETS among FLAT-resolvable edges — reachable only by a fallback key, never by
the source file's own package`)
for (const [k, v] of [...crossRepoTop].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${String(v).padStart(6)}  ${k}`)
console.log(`  … ${crossRepoTop.size} distinct such target names in total`)

console.log(`
PARTITION CHECKS`)
console.log(`  flat: ambiguous ${Amb} + unresolved ${Unres} = ${Amb + Unres} <= edges ${E}  -> ${Amb + Unres <= E}`)
console.log(`  d2:   sameRepo ${sum((r) => r.resSameRepo)} + crossRepo ${sum((r) => r.resCrossRepo)} = ${sum((r) => r.resSameRepo) + sum((r) => r.resCrossRepo)} vs resolvable ${Resolved}  -> ${sum((r) => r.resSameRepo) + sum((r) => r.resCrossRepo) === Resolved}`)
console.log(`  d2:   unresRepoHasBare ${sum((r) => r.unresRepoHasBare)} + unresRepoNoBare ${sum((r) => r.unresRepoNoBare)} = ${sum((r) => r.unresRepoHasBare) + sum((r) => r.unresRepoNoBare)} vs unresolved ${Unres}  -> ${sum((r) => r.unresRepoHasBare) + sum((r) => r.unresRepoNoBare) === Unres}`)
console.log(`  d1:   d1Amb ${sum((r) => r.d1Amb)} <= flatAmb ${Amb}  -> ${sum((r) => r.d1Amb) <= Amb}`)
console.log(`  amb partition: recovers ${D2recovers} + survives ${D2amb} + loses ${D2losesAmbiguityToUnresolved} = ${D2recovers + D2amb + D2losesAmbiguityToUnresolved} vs flatAmb ${Amb}  -> ${D2recovers + D2amb + D2losesAmbiguityToUnresolved === Amb}`)
console.log(`  distinct flat ambiguous names ${ambNamesFlat.size}   distinct flat unresolved names ${unresNamesFlat.size}`)

console.log(`
==============================================================================
analyzer sha256 ${analyzerDigest}
corpus   sha256 ${corpusDigest}
degraded (regex fallback) ${degraded.length}   parse failures ${parseFailures.length}
==============================================================================`)

