/**
 * B2 CENSUS — the full membership of the cross-module bucket, and the two tests that decide
 * whether any of it is this lane's to repair.
 *
 * ## Why this file exists
 *
 * `script/m14/tmp/graphql/probe/ambiguity-split.mts` split incoming ambiguity into B1 (one file),
 * B2 (the name carries >=2 kinds across files) and B3 (one kind, N declaring types), and wrote
 * B1's membership in FULL because it was the lane-repairable bucket. It wrote the heaviest 60
 * rows of the whole distribution into the artifact, so B2 — the largest of the three by name and
 * the one the brief calls "partly lane" — arrived as 20 rows with no census behind it. A bucket
 * described only by its count is a bucket nobody can act on, and the brief's instruction is to
 * fix "the largest single bucket your lane controls", which requires knowing WHICH B2 names
 * exist before deciding whether any of them are controllable.
 *
 * ## THE FIRST DRAFT OF THIS PROBE MEASURED NOTHING, AND IT IS RECORDED BECAUSE IT REPORTED 371
 *
 * The first version discriminated each colliding name with `metadata.graphqlType`, the grammar's
 * own node type, which `real-graphql-analyzer.ts` stamps on every symbol. It printed
 * `no graphqlType: 91464` against `symbols: 91464` — every symbol, all of them — and then
 * classified all 371 colliding names as "one grammar node type carrying two kinds". That is a
 * plausible-looking number and it is an artifact of reading a field that is not there: the
 * discriminator's input was the empty string for all 91,464 declarations, so `Set("(none)")`
 * collected a second member the moment a kind differed and fired on every name.
 *
 * The cause is a production seam, not a mistake in this probe. `parseFile` is the entry point the
 * workstream mandates, and `src/ast/pool-worker.ts:1020` rebuilds every symbol's `metadata` through
 * a per-language KEY ALLOWLIST — CSS, markdown and bash keys, and nothing else. `graphqlType` and
 * `graphqlRole` are not on it, so all 91,464 graphql symbols cross the worker boundary with no
 * `metadata` at all. Relationship metadata is NOT narrowed (it survives whole), which is why
 * `relationshipRole` reads 36,751 times in this lane's census and `graphqlRole` reads zero.
 *
 * So this probe reads only fields that survive: `kind`, `type`, `qualifiedName`, `scope`,
 * `ownerName`, `ownerKind`. Both tests below are built from those, and `assertDiscriminatorHasInput`
 * fails the run if any of them is empty for a large share of declarations — the defect that made
 * the first draft print a number is now a check that stops it.
 *
 * ## TEST 1 — is the collision INSIDE ONE REPOSITORY?
 *
 * A GraphQL schema has ONE type namespace: within a schema `type Foo` and `interface Foo` cannot
 * both exist. Across two schemas they are two different types and the collision is legal. So:
 *
 *   intra-repo collision   two kinds for one name inside ONE repository. This would be an
 *                          analyzer defect — it would be publishing one name two ways for one
 *                          schema. Lane-repairable.
 *   cross-repo only        the name carries one kind per repository and collides only ACROSS
 *                          repositories. Legal GraphQL; no analyzer change can separate it,
 *                          because a per-file analyzer is handed no repository identity either.
 *
 * ## TEST 2 — can the EDGE'S OWN SOURCE determine the owner?
 *
 * The repair the brief asks for would be to publish a qualified target where the edge already
 * knows the owner. For an edge `S -> N`, if `owner(S) + "." + N` names exactly ONE declaration in
 * the population, then the edge could have carried that qualified name and the collision would
 * not have been ambiguous for it. That is the only lane-owned form of this repair — it changes no
 * edge's meaning, it publishes the same fact under a name that is already unique. The census
 * counts those edges per colliding name, and counts the names where the owner does NOT determine
 * it, which is where no repair exists.
 *
 * ## POPULATION
 *
 * Discovery is byte-identical to `ambiguity-split.mts` (git ls-files per repo,
 * `detectLanguageFromPath`, 512 KB cap), so the admitted-file set, and therefore B2 membership,
 * is comparable with that artifact and with the supervisor's 600-file tsv.
 *
 * ## WHAT THIS DOES NOT CLAIM
 *
 * It reports how names collide, by kind, by repository and by what an edge's source determines.
 * It does not claim any relationship edge is correct, and a "cross-repo only" verdict is a
 * statement about NAMESPACES, not a defence of every edge that names one.
 *
 * ## Usage
 *
 *     npx tsx script/m14/tmp/graphql/probe/b2-census.mts
 *
 * Writes `script/m14/tmp/graphql/out/b2-census.json`. READ-ONLY with respect to the corpus.
 */
import { readFileSync, statSync, readdirSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { GQL, OUT as outDir } from "../paths.mts"
import { parseFile } from "../../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../../src/ast/language-detection"
import { resumableWalk } from "../../../resumable-walk"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "graphql"

const checkpoint = path.join(GQL, "walk-b2-census.txt")
const artifact = path.join(outDir, "b2-census.json")

/** -------------------------------------------------------------- discovery (ambiguity-split-identical) */
const files: { abs: string; text: string; repo: string; rel: string }[] = []
for (const e of readdirSync(CR)) {
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
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ abs, text, repo: e, rel })
  }
}
files.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
console.log(`b2 census — ${LANG}`)
console.log(`corpus: ${files.length} admitted files (discovery identical to ambiguity-split)`)

type Decl = {
  repo: string
  file: string
  kind: string
  qualifiedName: string
  scope: string
  ownerName: string
  ownerKind: string
  /** Top-level: a type, operation, fragment, directive definition or schema. Member: anything scoped. */
  level: "T" | "M"
  /**
   * The GraphQL NAME SPACE this declaration belongs to, derived only from fields that survive
   * `parseFile`. GraphQL keeps these separate, so one spelling legitimately denotes a different
   * thing in each: `type User` and a field `User` are not in conflict, and neither are they
   * distinguishable by a bare name.
   */
  namespace: string
}

/**
 * THE NAMESPACE KEY, and why `metadata.graphqlRole` cannot supply it.
 *
 * The analyzer already stamps `graphqlRole` on most branches and it is the natural discriminator,
 * but `parseFile` drops the whole symbol `metadata` object (see the file header), so it reads 0
 * times here. These fields do survive. `level` separates top-level declarations from members,
 * `ownerKind` separates a field of an object type from a root operation type of the schema, and
 * `kind` separates the rest — so the key is:
 *
 *   type          a type definition: object, input object, interface, union, scalar, enum
 *   operation     an operation or a fragment definition (both are `method` at top level)
 *   directive     a directive definition (published as `@name`, so it never collides bare)
 *   schema        the `schema` symbol itself
 *   field         a field definition or an input field definition
 *   enum_value    an enum value definition
 *   root_op_type  `query:` / `mutation:` / `subscription:` inside a schema definition
 *   variable      a `$variable` definition
 *
 * The two kinds this maps together ON PURPOSE are `class` (object AND input object) and `type`
 * (union AND scalar), because `TYPE_KIND` in the analyzer already merges those pairs
 * (real-graphql-analyzer.ts:536-541) and a kind that is one symbol cannot collide with itself.
 */
function namespaceOf(kind: string, level: "T" | "M", ownerKind: string, scope: string): string {
  if (level === "T") {
    if (kind === "method") return "operation"
    if (kind === "function") return "directive"
    if (kind === "namespace") return "schema"
    return "type"
  }
  if (kind === "enum_member") return "enum_value"
  if (kind === "variable") return "variable"
  if (kind === "property") return ownerKind === "namespace" ? "root_op_type" : "field"
  return `member:${kind}:${ownerKind || scope || "?"}`
}

const declsByName = new Map<string, Decl[]>()
/** qualifiedName -> distinct declarations, for TEST 2. */
const declsByQName = new Map<string, Set<string>>()
type RelRow = { type: string; source: string; target: string; ownerOfSource: string }
const relsByFile = new Map<string, RelRow[]>()
const walkedFiles: string[] = []
let symbolTotal = 0
let emptyNameSymbols = 0
let emptyKindSymbols = 0
let noQNameSymbols = 0
let metadataPresent = 0
let degraded = 0

const ONTOLOGY = new Set([
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
])
const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls", uses: "uses", dependency: "uses",
  contains: "contains", composition: "contains", part_of: "contains",
  imports: "imports", brain_import: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides",
  instantiates: "instantiates",
}

const stats = await resumableWalk(checkpoint, files.length, {
  id: (i) => path.relative(CR, files[i].abs),
  concurrency: 4,
  run: async (i) => {
    const f = files[i]
    const r: any = await parseFile(f.abs, f.abs)
    if (!r) throw new Error("no result")
    if (r.fallback === true) degraded++
    const relFile = path.relative(CR, f.abs)
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      symbolTotal++
      const name = String(s?.name ?? "")
      const kind = String(s?.kind ?? "")
      const qualifiedName = String(s?.qualifiedName ?? "")
      if (name.length === 0) emptyNameSymbols++
      if (kind.length === 0) emptyKindSymbols++
      if (qualifiedName.length === 0) noQNameSymbols++
      if (s?.metadata && Object.keys(s.metadata).length > 0) metadataPresent++
      if (name.length === 0 || kind.length === 0) continue
      const scope = String(s?.scope ?? "")
      const ownerName = String(s?.ownerName ?? "")
      const ownerKind = String(s?.ownerKind ?? "")
      const level: "T" | "M" = scope.length > 0 ? "M" : "T"
      const d: Decl = {
        repo: f.repo,
        file: relFile,
        kind,
        qualifiedName,
        scope,
        ownerName,
        ownerKind,
        level,
        namespace: namespaceOf(kind, level, ownerKind, scope),
      }
      const nb = declsByName.get(name)
      if (nb) nb.push(d)
      else declsByName.set(name, [d])
      if (qualifiedName.length > 0) {
        const bag = declsByQName.get(qualifiedName) ?? new Set<string>()
        bag.add(`${relFile}:${kind}`)
        declsByQName.set(qualifiedName, bag)
      }
    }
    const rows: RelRow[] = []
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const t = LABEL_ALIASES[String(rel?.type ?? "")]
      if (!t || !ONTOLOGY.has(t)) continue
      const src = String(rel?.source ?? "")
      rows.push({
        type: t,
        source: src,
        target: String(rel?.target ?? ""),
        ownerOfSource: src.includes(".") ? src.slice(0, src.lastIndexOf(".")) : "",
      })
    }
    relsByFile.set(relFile, rows)
    walkedFiles.push(relFile)
  },
})

const walked = walkedFiles.slice().sort()
console.log(
  `walk: ${stats.walked} newly walked, ${stats.alreadyDone} already done, ` +
  `${stats.skippedBad} skipped bad, of ${files.length} admitted`,
)
console.log(
  `symbols: ${symbolTotal}  emptyName: ${emptyNameSymbols}  emptyKind: ${emptyKindSymbols}  ` +
  `emptyQualifiedName: ${noQNameSymbols}  symbolsCARRYING metadata: ${metadataPresent}  degraded: ${degraded}`,
)

if (stats.walked === 0) {
  console.error("")
  console.error("REFUSING TO WRITE. The walk resumed from a complete checkpoint and every accumulator")
  console.error("above is populated inside run(), which resumableWalk does not call for a file a")
  console.error("previous run recorded. This file has measured nothing and would write a")
  console.error("fully-shaped artifact over an empty population — the resumed-walk zero this lane has")
  console.error("already lost 1905 files to twice. Delete the checkpoint to re-measure:")
  console.error(`    rm ${checkpoint}`)
  process.exit(2)
}

/** The defect the first draft of this probe had: a discriminator fed an absent field. */
function assertDiscriminatorHasInput(): void {
  const total = symbolTotal
  const qnameRate = total === 0 ? 0 : (total - noQNameSymbols) / total
  if (qnameRate < 0.99) {
    console.error("")
    console.error(`REFUSING TO WRITE. qualifiedName is empty on ${noQNameSymbols} of ${total} symbols`)
    console.error(`(${(qnameRate * 100).toFixed(2)}% populated), and TEST 2 reads it to decide whether an`)
    console.error("edge's own source determines the target's owner. A discriminator below its input")
    console.error("threshold produces a plausible number over nothing — which is what this file's first")
    console.error("draft did. Refusing is the fix; not reporting the ratio is what caused the bug.")
    process.exit(2)
  }
  console.log(`discriminator inputs OK: qualifiedName populated on ${(qnameRate * 100).toFixed(2)}% of symbols`)
}
assertDiscriminatorHasInput()

type Row = {
  name: string
  bucket: "B1_intraFile" | "B2_crossModuleKind"
  kinds: string[]
  declarations: number
  files: number
  repos: number
  edges: number
  /** Edges naming this bare name whose SOURCE's owner + name names exactly one declaration. */
  edgesOwnerDetermines: number
  /** Edges naming this bare name that no qualified target could disambiguate. */
  edgesOwnerDoesNotDetermine: number
  byKind: Record<string, number>
  /** GraphQL name spaces this spelling occupies — `type`, `field`, `enum_value`, `operation`, … */
  byNamespace: Record<string, number>
  /** Number of DISTINCT name spaces. 1 means the kinds collide WITHIN one space; >1 means GraphQL keeps them apart. */
  namespaceCount: number
  /** Namespaces a single repository holds this spelling in. */
  namespacesPerRepo: Record<string, string[]>
  /** Repos in which this name alone carries >=2 kinds — the kind-level collision count. */
  intraRepoCollision: boolean
  intraRepoDetail: string[]
  scopes: string[]
}

const rows: Row[] = []
for (const [name, decls] of declsByName) {
  const kinds = [...new Set(decls.map((d) => d.kind))].sort()
  if (kinds.length <= 1) continue
  const fileSet = new Set(decls.map((d) => d.file))
  const repoSet = new Set(decls.map((d) => d.repo))
  const byKind: Record<string, number> = {}
  const byNamespace: Record<string, number> = {}
  const kindsByRepo = new Map<string, Set<string>>()
  const namespacesByRepo = new Map<string, Set<string>>()
  const namespaces = new Set<string>()
  for (const d of decls) {
    byKind[d.kind] = (byKind[d.kind] ?? 0) + 1
    byNamespace[d.namespace] = (byNamespace[d.namespace] ?? 0) + 1
    namespaces.add(d.namespace)
    const bag = kindsByRepo.get(d.repo) ?? new Set<string>()
    bag.add(d.kind)
    kindsByRepo.set(d.repo, bag)
    const nb2 = namespacesByRepo.get(d.repo) ?? new Set<string>()
    nb2.add(d.namespace)
    namespacesByRepo.set(d.repo, nb2)
  }
  const intra = [...kindsByRepo.entries()].filter(([, ks]) => ks.size > 1).map(([r, ks]) => `${r}:[${[...ks].sort().join(",")}]`)
  rows.push({
    name,
    bucket: fileSet.size <= 1 ? "B1_intraFile" : "B2_crossModuleKind",
    kinds,
    declarations: decls.length,
    files: fileSet.size,
    repos: repoSet.size,
    edges: 0,
    edgesOwnerDetermines: 0,
    edgesOwnerDoesNotDetermine: 0,
    byKind,
    byNamespace,
    namespaceCount: namespaces.size,
    namespacesPerRepo: Object.fromEntries([...namespacesByRepo.entries()].map(([r, ns]) => [r, [...ns].sort()])),
    intraRepoCollision: intra.length > 0,
    intraRepoDetail: intra.slice(0, 6),
    scopes: [...new Set(decls.map((d) => (d.scope.length > 0 ? d.scope : "(none)")))].slice(0, 8),
  })
}

// TEST 2 — per colliding name, can the edge's own source owner determine the target?
const colliding = new Set(rows.map((r) => r.name))
const byName = new Map(rows.map((r) => [r.name, r]))
for (const f of walked) {
  for (const rel of relsByFile.get(f) ?? []) {
    if (!colliding.has(rel.target)) continue
    const r = byName.get(rel.target)!
    r.edges++
    if (rel.ownerOfSource.length > 0) {
      const cand = `${rel.ownerOfSource}.${rel.target}`
      const hit = declsByQName.get(cand)
      if (hit && hit.size === 1) r.edgesOwnerDetermines++
      else r.edgesOwnerDoesNotDetermine++
    } else {
      r.edgesOwnerDoesNotDetermine++
    }
  }
}

rows.sort((a, b) => b.edges - a.edges || b.declarations - a.declarations)
const b1 = rows.filter((r) => r.bucket === "B1_intraFile")
const b2 = rows.filter((r) => r.bucket === "B2_crossModuleKind")
const sum = (xs: Row[], f: (r: Row) => number) => xs.reduce((a, r) => a + f(r), 0)

console.log("")
console.log(`names carrying >=2 kinds: ${rows.length}   (B1 ${b1.length} / B2 ${b2.length})`)
console.log(`  B1 intra-file   ${String(b1.length).padStart(4)} names ${String(sum(b1, (r) => r.edges)).padStart(7)} edges`)
console.log(`  B2 cross-module ${String(b2.length).padStart(4)} names ${String(sum(b2, (r) => r.edges)).padStart(7)} edges`)

console.log("")
console.log("TEST 1 — is the collision INSIDE ONE REPOSITORY?")
const intra = rows.filter((r) => r.intraRepoCollision)
const crossOnly = rows.filter((r) => !r.intraRepoCollision)
console.log(`  names colliding intra-repo          ${String(intra.length).padStart(4)}  ${String(sum(intra, (r) => r.edges)).padStart(7)} edges   <- an analyzer defect if > 0`)
console.log(`  names colliding only ACROSS repos    ${String(crossOnly.length).padStart(4)}  ${String(sum(crossOnly, (r) => r.edges)).padStart(7)} edges   legal GraphQL`)
if (intra.length > 0) {
  console.log("")
  for (const r of intra.slice(0, 30)) {
    console.log(`    ${String(r.edges).padStart(6)}e  ${r.name.slice(0, 36).padEnd(36)} ${r.intraRepoDetail.join(" ")}`)
  }
}

console.log("")
console.log("TEST 2 — can the EDGE'S OWN SOURCE determine the owner?")
console.log(`  edges naming a colliding name                 ${String(sum(rows, (r) => r.edges)).padStart(7)}`)
console.log(`    owner(S) + "." + target names ONE decl      ${String(sum(rows, (r) => r.edgesOwnerDetermines)).padStart(7)}   <- publishable as a qualified target, meaning unchanged`)
console.log(`    no qualified target could disambiguate      ${String(sum(rows, (r) => r.edgesOwnerDoesNotDetermine)).padStart(7)}`)

console.log("")
console.log("TEST 3 — does GraphQL keep the colliding declarations in SEPARATE NAME SPACES?")
console.log("  GraphQL does not have one flat namespace. Type names, operation names, field names,")
console.log("  enum-value names and directive names are separate, and field/enum-value names are")
console.log("  scoped by their parent. A name in two spaces is legal GraphQL and a bare name cannot")
console.log("  tell them apart — so a namespace prefix on the published target WOULD separate them,")
// split each colliding name by how many name spaces it occupies
const multiNs = rows.filter((r) => r.namespaceCount >= 2)
const oneNs = rows.filter((r) => r.namespaceCount === 1)
console.log(`    name occupies >=2 name spaces             ${String(multiNs.length).padStart(4)}  ${String(sum(multiNs, (r) => r.edges)).padStart(7)} edges   <- separable by publishing the namespace`)
console.log(`    name occupies exactly 1 name space        ${String(oneNs.length).padStart(4)}  ${String(sum(oneNs, (r) => r.edges)).padStart(7)} edges   <- needs the OWNER, not the namespace`)

console.log("")
console.log("  TEST 3a — inside ONE REPOSITORY, do the colliding kinds sit in one space or several?")
const intraMulti = rows.filter((r) => r.intraRepoCollision && Object.values(r.namespacesPerRepo).some((ns) => ns.length >= 2))
const intraOne = rows.filter((r) => r.intraRepoCollision && r.namespaceCount === 1)
console.log(`    intra-repo, separate name spaces          ${String(intraMulti.length).padStart(4)}  ${String(sum(intraMulti, (r) => r.edges)).padStart(7)} edges   legal GraphQL, ambiguity is the analyzer's`)
console.log(`    intra-repo, ONE name space                ${String(intraOne.length).padStart(4)}  ${String(sum(intraOne, (r) => r.edges)).padStart(7)} edges   no namespace prefix can separate these`)

console.log("")
console.log("B2 BY KIND PAIR — the kinds each cross-module name carries, with the namespace behind each:")
const pairRows = new Map<string, { names: number; edges: number }>()
for (const r of b2) {
  for (let i = 0; i < r.kinds.length; i++) {
    for (let k = i + 1; k < r.kinds.length; k++) {
      const key = [r.kinds[i], r.kinds[k]].sort().join(" + ")
      const cur = pairRows.get(key) ?? { names: 0, edges: 0 }
      cur.names++
      cur.edges += r.edges
      pairRows.set(key, cur)
    }
  }
}
for (const [k, v] of [...pairRows.entries()].sort((a, b) => b[1].edges - a[1].edges)) {
  const intraN = b2.filter((r) => r.intraRepoCollision && r.kinds.some((x, i, a2) => i > 0 && [a2[i - 1], x].sort().join(" + ") === k)).length
  console.log(`  ${String(v.names).padStart(4)} names ${String(v.edges).padStart(7)} edges   ${k.padEnd(30)} intra-repo names: ${intraN}`)
}

console.log("")
console.log(`every B2 name (${b2.length}), heaviest first — edges / ownerDetermines / kinds / namespaces / intraRepo:`)
for (const r of b2) {
  console.log(
    `  ${String(r.edges).padStart(6)}e ${String(r.edgesOwnerDetermines).padStart(6)}o ${String(r.declarations).padStart(5)}d ` +
    `${String(r.repos).padStart(3)}r ${r.name.slice(0, 30).padEnd(30)} ${r.kinds.join("+").padEnd(26)} ` +
    `${Object.keys(r.byNamespace).join(",").slice(0, 34).padEnd(34)} ${r.intraRepoCollision ? "INTRA-REPO" : ""}`,
  )
}

mkdirSync(outDir, { recursive: true })
writeFileSync(artifact, JSON.stringify({
  generatedAt: new Date().toISOString(),
  population: {
    discovery: "identical to script/m14/tmp/graphql/probe/ambiguity-split.mts (git ls-files per repo, detectLanguageFromPath, 512 KB cap)",
    admittedFiles: files.length,
    filesWalked: walked.length,
    degraded,
  },
  walk: stats,
  symbols: {
    total: symbolTotal,
    emptyName: emptyNameSymbols,
    emptyKind: emptyKindSymbols,
    emptyQualifiedName: noQNameSymbols,
    carryingMetadata: metadataPresent,
    metadataNote: "parseFile rebuilds symbol.metadata through a per-language key allowlist (src/ast/pool-worker.ts:1020, CSS/markdown/bash keys). graphqlType and graphqlRole are not on it, so 0 graphql symbols cross the worker boundary with metadata. Relationship metadata is not narrowed.",
  },
  discriminator: {
    rule: "surviving fields only: kind, qualifiedName, scope, ownerName, ownerKind, and the repository each file came from.",
    qualifiedNamePopulated: symbolTotal === 0 ? 0 : (symbolTotal - noQNameSymbols) / symbolTotal,
  },
  test1_intraRepo: {
    rule: "one GraphQL schema has one type namespace, so a name carrying >=2 kinds INSIDE one repository is an analyzer defect; a name colliding only ACROSS repositories is two schemas sharing a spelling.",
    intraRepoNames: intra.length,
    intraRepoEdges: sum(intra, (r) => r.edges),
    crossRepoOnlyNames: crossOnly.length,
    crossRepoOnlyEdges: sum(crossOnly, (r) => r.edges),
  },
  test2_sourceDeterminesOwner: {
    rule: "for an edge S -> N where owner(S) + '.' + N names exactly one declaration in the population, the edge could have carried that qualified name without changing what it means.",
    edges: sum(rows, (r) => r.edges),
    ownerDetermines: sum(rows, (r) => r.edgesOwnerDetermines),
    ownerDoesNotDetermine: sum(rows, (r) => r.edgesOwnerDoesNotDetermine),
    B2_only: {
      edges: sum(b2, (r) => r.edges),
      ownerDetermines: sum(b2, (r) => r.edgesOwnerDetermines),
      ownerDoesNotDetermine: sum(b2, (r) => r.edgesOwnerDoesNotDetermine),
    },
  },
  test3_namespaceSeparation: {
    rule: "GraphQL keeps type names, operation names, field names, enum-value names and directive names in SEPARATE name spaces, and scopes field/enum-value names by parent. A spelling in two spaces is legal GraphQL that a bare name cannot distinguish, so publishing the namespace on the target would separate them. A spelling in ONE space with two kinds is not separable by namespace and needs the owner.",
    namespaceKey: "derived from surviving fields only (kind, level, scope, ownerKind); metadata.graphqlRole is unavailable through parseFile. `class` merges object+input and `type` merges union+scalar because TYPE_KIND in real-graphql-analyzer.ts already merges those pairs.",
    multiNamespaceNames: multiNs.length,
    multiNamespaceEdges: sum(multiNs, (r) => r.edges),
    singleNamespaceNames: oneNs.length,
    singleNamespaceEdges: sum(oneNs, (r) => r.edges),
    intraRepoMultiNamespace: intraMulti.length,
    intraRepoMultiNamespaceEdges: sum(intraMulti, (r) => r.edges),
    intraRepoSingleNamespace: intraOne.length,
    intraRepoSingleNamespaceEdges: sum(intraOne, (r) => r.edges),
  },
  counts: {
    namesTwoOrMoreKinds: rows.length,
    B1_intraFile: { names: b1.length, edges: sum(b1, (r) => r.edges) },
    B2_crossModuleKind: { names: b2.length, edges: sum(b2, (r) => r.edges) },
  },
  kindPairs: Object.fromEntries([...pairRows.entries()].sort((a, b) => b[1].edges - a[1].edges)
    .map(([k, v]) => [k, { names: v.names, edges: v.edges }])),
  rows,
}, null, 1))
console.log("")
console.log(`wrote ${artifact}`)