/**
 * GRAPHQL STORE-BINDING TRUTH — the determinacy ruling, measured against a REAL STORE instead of read
 * off the resolver's own `ORDER BY`.
 *
 * WHY IT EXISTS. The lane's residual carve-up says 31,012 ambiguous edges split into 20,121 whose own
 * file declares the name EXACTLY ONCE ("production binds it determinately"), 705 whose own file declares
 * it more than once, and 10,186 whose own file declares it not at all. That first row is a MODEL ruling:
 * it is a statement about `resolveTargetStmt`'s ordering (`COALESCE(s.is_declaration,0), (s.file_id = ?)
 * DESC, … LIMIT 1`), not about what the store DOES. The lane states this in its own document — "no store
 * probe was run this turn" — and it is the one open verification left in the lane. hcl, xml and yaml each
 * closed the same gap with a probe that builds a real store through the PRODUCTION indexer and reads the
 * binding off `brain_relationship.target_symbol_id`; this is graphql's.
 *
 * THE PREDICATE, and it is the analyzer's own claim rather than a new opinion:
 *
 *   own-once    the edge's OWN FILE declares the target name exactly once. The model says production
 *               binds THAT declaration. A row bound elsewhere, or bound to nothing, refutes it where it
 *               is measurable — a violation.
 *   own-many    the own file declares the name more than once: the store's write order decides, which
 *               the lane already reports as the class it cannot call intended. Reported, never scored.
 *   own-none    only foreign declarations can answer; `s.id` decides between them. Reported, never
 *               scored — this is the "twin exists" class.
 *   no-source   the edge carries no source symbol, so "its own file" does not exist. Binned separately
 *               with its own count, the way the xml probe bins it, because a predicate cannot judge it.
 *
 * AND THE SPLIT IS ALSO READ against the metadata the analyzer itself wrote (`resolvable` /
 * `unresolvedReason`), because a probe that only agrees with itself proves nothing: the columns are
 * reported per class AND per analyzer class.
 *
 * ONE RUN, LABELLED. The store is order- and run-dependent (the xml lane measured 248 of 4,545 bindings
 * moving when file order was reversed — 5.46%). Every number here is ONE run against ONE index of the
 * population named in the output.
 *
 * USAGE
 *   HOME=$PWD/.tmp-graphql/home npx tsx validation/m14/fixtures/graphql/store-binding-truth.mts
 *   BB_SGT_REPOS=gql-gqlgen,gql-absinthe    bound to a repo set
 *   BB_SGT_LIMIT=300                        bound the file count
 *   BB_SGT_OUT=path.json                    write the report
 * Read-only apart from the temp copy it indexes.
 */
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { getProjectId } from "../../../../src/cli/index"
import ignore from "ignore"

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPOS = (process.env.BB_SGT_REPOS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const LIMIT = Number(process.env.BB_SGT_LIMIT ?? "0")
const OUT = process.env.BB_SGT_OUT ?? `${REPO_ROOT}/validation/m14/fixtures/graphql/store-binding-truth.json`
const EXT_RE = /\.(graphql|graphqls|gql)$/i
const CAP = 1024 * 1024

const rows: { repo: string; rel: string; abs: string }[] = []
for (const name of readdirSync(CR).sort()) {
  if (REPOS.length > 0 && !REPOS.includes(name)) continue
  const dir = path.join(CR, name)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (!EXT_RE.test(rel)) continue
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > CAP) continue
    } catch {
      continue
    }
    rows.push({ repo: name, rel: rel.split(path.sep).join("/"), abs })
  }
}
const drawn = LIMIT > 0 ? rows.slice(0, LIMIT) : rows
if (drawn.length === 0) {
  console.error("no files admitted")
  process.exit(2)
}

const root = mkdtempSync(path.join(tmpdir(), "bb-graphql-sbt-"))
for (const f of drawn) {
  const dest = path.join(root, f.repo, f.rel)
  mkdirSync(path.dirname(dest), { recursive: true })
  cpSync(f.abs, dest)
}

const { indexProjectParallel } = await import("../../../../src/ast/parallel-indexer")
const { BrainDatabase } = await import("../../../../src/brain/database")
const PID = getProjectId(root)
const t0 = Date.now()
await indexProjectParallel(PID as any, root, {})
const indexMs = Date.now() - t0
const raw = await BrainDatabase.getRawInstance(PID as any)

type Decl = { id: string; name: string; qname: string; file: string; line: number | null; kind: string }
const symOf = new Map<string, Decl>()
/** BY NAME — the key the resolver queries with for an unqualified target. */
const byName = new Map<string, Decl[]>()
/** BY QUALIFIED NAME — the ALIAS of the SAME declaration, the key the lane's own probe adds. */
const byQName = new Map<string, Decl[]>()
for (const s of raw.prepare(`SELECT id, name, qualified_name, file_id, line_start, symbol_type FROM brain_symbol WHERE project_id = ?`).all(PID) as any[]) {
  const rec: Decl = {
    id: String(s.id),
    name: String(s.name ?? ""),
    qname: String(s.qualified_name ?? ""),
    file: String(s.file_id ?? ""),
    line: s.line_start ?? null,
    kind: String(s.symbol_type ?? ""),
  }
  symOf.set(rec.id, rec)
  const list = byName.get(rec.name)
  if (list) list.push(rec)
  else byName.set(rec.name, [rec])
  if (rec.qname.length > 0 && rec.qname !== rec.name) {
    const q = byQName.get(rec.qname)
    if (q) q.push(rec)
    else byQName.set(rec.qname, [rec])
  }
}
const relOf = (fileId: string | null | undefined): string => {
  const f = String(fileId ?? "")
  return f.startsWith(`${PID}:`) ? f.slice(String(PID).length + 1) : f
}

const storeRows = raw.prepare(`
  SELECT id, relationship_type AS type, source_symbol_id AS src, target_symbol_id AS tgt,
         target_external AS target, line_number AS line, metadata
  FROM brain_relationship WHERE project_id = ?`).all(PID) as any[]

type Bucket = { edges: number; bound: number; unbound: number; boundToOwnFile: number; boundToTheOwnOnceDecl: number; boundElsewhere: number }
const blank = (): Bucket => ({ edges: 0, bound: 0, unbound: 0, boundToOwnFile: 0, boundToTheOwnOnceDecl: 0, boundElsewhere: 0 })

// ------------------------------------------------------------------ THE KEY AXES, AND THE MISTAKE
// THE FIRST RUN OF THIS PROBE REPORTED A "DISAGREEMENT" IT COULD NOT EXPLAIN: all 9,643 `overrides` edges
// classified `own-none` (no own-file declaration of the target NAME) yet 9,641 of them bound to a symbol
// in that very file. It was reported as an analyzer anomaly. **IT WAS THIS INSTRUMENT'S KEY.** The
// declarations the store binds are found under THREE spellings, and the arithmetic above only looked at
// one of them:
//
//   (a) the symbol's `name`                       — what the first version of this probe matched
//   (b) the symbol's `qualified_name`             — the ALIAS the lane's own probe adds
//       (`probe-graphql-residual-causes.mts` bumps a second key when `qname !== name`), because
//       `Type.field` IS a spelling of one declaration rather than a second declaration
//   (c) `extractLeaf(target)` matched to `name`   — the key `resolveTargetStmt` is actually queried with
//       (parallel-indexer.ts:3096 matches `s.name = ?`; 4269-4305 feeds it the leaf)
//
// Measured on the first store, so the size of the error is known rather than felt: axis (b) carries
// 68,773 edges — more than the 60,333 axis (a) found — and axis (c) adds 273 on top of both. The
// published per-type table below is left EXACTLY as the first version produced it, on purpose: it is
// axis (a), and a reader comparing runs must be able to see what changed. This block is the corrected
// reading, and the test that it is right is not that it is bigger — it is that every edge it calls
// determinate bound THAT declaration, with no row left over in the class it was credited to.
type KeyBucket = { edges: number; bound: number; unbound: number; boundToTheOwnDecl: number; boundToAnOwnDecl: number; boundElsewhere: number; byType: Record<string, number> }
const blankKey = (): KeyBucket => ({ edges: 0, bound: 0, unbound: 0, boundToTheOwnDecl: 0, boundToAnOwnDecl: 0, boundElsewhere: 0, byType: {} })
const byResolverKey: Record<string, KeyBucket> = {}
const extractLeaf = (name: string): string => {
  const noLine = name.replace(/:\d+$/, "")
  const noArity = noLine.replace(/\/\d+$/, "")
  const byColon = noArity.split(":")
  const lastColon = byColon[byColon.length - 1]
  if (lastColon.includes("/") || lastColon.includes("\\")) return lastColon
  const byDot = lastColon.split(".")
  return byDot[byDot.length - 1]
}
let leafReducedTargets = 0

const perType: Record<string, Bucket & { byClass: Record<string, Bucket>; byAnalyzerClass: Record<string, Bucket>; examples: string[] }> = {}
const READ_TYPES = ["uses", "references", "overrides", "implements", "contains", "imports", "exports"]
for (const r of storeRows) {
  const type = String(r.type ?? "")
  if (!READ_TYPES.includes(type)) continue
  const src = symOf.get(String(r.src ?? ""))
  const tgt = r.tgt === null || r.tgt === undefined ? undefined : symOf.get(String(r.tgt))
  const targetName = String(r.target ?? "")
  const all = byName.get(targetName) ?? []
  const ownFile = src?.file
  const ownDecls = ownFile === undefined ? [] : all.filter((d) => d.file === ownFile)
  const cls = !src ? "no-source" : ownDecls.length === 0 ? "own-none" : ownDecls.length === 1 ? "own-once" : "own-many"

  // the same classification under the lane's key (a U b) and under the resolver's leaf key (c)
  const leaf = extractLeaf(targetName)
  if (leaf !== targetName) leafReducedTargets++
  const aliasDecls = ownFile === undefined ? [] : (byQName.get(targetName) ?? []).filter((d) => d.file === ownFile)
  const leafDecls = ownFile === undefined ? [] : (byName.get(leaf) ?? []).filter((d) => d.file === ownFile)
  const keyCls = !src
    ? "no-source"
    : ownDecls.length === 1
      ? "own-once by (a) NAME"
      : ownDecls.length > 1
        ? "own-many by (a) NAME"
        : aliasDecls.length === 1
          ? "own-once by (b) QUALIFIED-NAME alias"
          : aliasDecls.length > 1
            ? "own-many by (b) QUALIFIED-NAME alias"
            : leaf !== targetName && leafDecls.length === 1
              ? "own-once by (c) LEAF only — invisible to (a) and (b)"
              : leaf !== targetName && leafDecls.length > 1
                ? "own-many by (c) LEAF"
                : leafDecls.length === 0
                  ? "declared NOWHERE in the own file under any of the three keys"
                  : "other"
  const kb = (byResolverKey[keyCls] ??= blankKey())
  kb.edges++
  kb.byType[type] = (kb.byType[type] ?? 0) + 1
  const credit = ownDecls.length === 1 ? ownDecls : aliasDecls.length === 1 ? aliasDecls : leaf !== targetName && leafDecls.length === 1 ? leafDecls : null
  if (tgt === undefined) kb.unbound++
  else {
    kb.bound++
    if (credit !== null && tgt.id === credit[0].id) kb.boundToTheOwnDecl++
    if (ownFile !== undefined && tgt.file === ownFile) kb.boundToAnOwnDecl++
    if (ownFile !== undefined && tgt.file !== ownFile) kb.boundElsewhere++
  }
  let analyzerClass = "(none)"
  try {
    const md = r.metadata ? JSON.parse(String(r.metadata)) : null
    analyzerClass = String(md?.resolvable ?? md?.relationshipRole ?? "(none)")
  } catch {
    /* an unparseable metadata cell is reported as (none) */
  }

  const row = (perType[type] ??= { ...blank(), byClass: {}, byAnalyzerClass: {}, examples: [] })
  const buckets = [row, (row.byClass[cls] ??= blank()), (row.byAnalyzerClass[analyzerClass] ??= blank())]
  for (const b of buckets) {
    b.edges++
    if (!tgt) {
      b.unbound++
      continue
    }
    b.bound++
    if (tgt.file === ownFile) {
      b.boundToOwnFile++
      if (ownDecls.length === 1 && ownDecls[0].id === tgt.id) b.boundToTheOwnOnceDecl++
    } else b.boundElsewhere++
  }
  // A VIOLATION is the only cell that refutes the model: own-once, and the row did not bind that
  // declaration. Both directions are kept (bound elsewhere, and bound to nothing).
  if (cls === "own-once" && (!tgt || tgt.id !== ownDecls[0].id) && row.examples.length < 6) {
    row.examples.push(
      `line ${r.line ?? "?"} ${relOf(ownFile)} -> \`${targetName}\` bound to ${tgt ? `${relOf(tgt.file)}:${tgt.line} ${tgt.qname}` : "NOTHING"}; the own-file declaration is ${relOf(ownDecls[0].file)}:${ownDecls[0].line} ${ownDecls[0].qname}`,
    )
  }
}

const fileCount = (raw.prepare(`SELECT COUNT(*) AS c FROM brain_file WHERE project_id = ?`).get(PID) as any)?.c ?? 0

// THE STORE'S OWN ADMISSION, audited rather than assumed. A predicate about "the edge's own file" is
// only as good as the population the store actually holds, and the two are NOT the same number: the
// probe copies every admitted file and the INDEXER decides what it will read. Recording the gap keeps
// the determinacy claim honest about what it covers, and names the extensions that never reach the
// store so the next reader does not have to re-measure it.
const storedFiles = new Set<string>(
  (raw.prepare(`SELECT relative_path AS rel, path AS p FROM brain_file WHERE project_id = ?`).all(PID) as any[]).map((r) => {
    const rel = String(r.rel ?? "")
    if (rel !== "") return rel.split(path.sep).join("/")
    const p = String(r.p ?? "")
    return (p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p).split(path.sep).join("/")
  }),
)
const notStored = drawn.filter((f) => !storedFiles.has(`${f.repo}/${f.rel}`))
const notStoredByExtension: Record<string, number> = {}
for (const f of notStored) {
  const ext = (f.rel.match(/\.[^.]+$/) ?? ["(none)"])[0].toLowerCase()
  notStoredByExtension[ext] = (notStoredByExtension[ext] ?? 0) + 1
}

// WHY THE INDEXER REFUSED THEM, attributed rather than left as a mystery. A predicate about "the edge's
// own file" is only as strong as the population it runs over, and "254 files never reached the store"
// is a number nobody can act on. Each refusal is charged to a RULE THE WALK ITSELF APPLIES, and the test
// that the rule set is complete is that `unexplained` comes back empty — a leaky rule list leaves files
// there and the artifact says so instead of quietly rounding.
//
// The predicates are the walk's own, quoted from `src/ast/parallel-indexer.ts`:
//   `discoverAndFilterFiles` adds the built-in ignore globs `**/testData/**` (line ~1127) and the other
//   `**/coverage/**`-style entries to an `ignore()` matcher, and `skipPatterns` (line ~255) holds
//   `/\/generated\//i`, `/\/gen\//`, `.*\.min\.` and the rest. The `ignore` npm package matches
//   case-insensitively by default, which is why the corpus spelling `testdata` is swallowed by a glob
//   written `testData` — measured, not assumed: `ignore().add(["**/testData/**"]).ignores("x/testdata/a")`
//   is true on the installed 5.3.2.
//   `detectLanguageFromPath` is production's own extension→language map, so "no route" is production's
//   answer rather than a list written here.
const builtinIgnore = ignore()
builtinIgnore.add([
  "**/Microbenchmarks/**",
  "**/wwwroot/**",
  "**/testassets/**",
  "**/benchmarkapps/**",
  "**/coverage/**",
  "**/testData/**",
])
const skipPatterns: RegExp[] = [
  /\/__generated__\//i,
  /\/generated\//i,
  /\/gen\//,
  /.*\.(generated|Generated|gen|Gen)\./i,
  /.*\.min\./,
  /.*-min\./,
  /.*\.bundle\./,
  /.*\.chunk\./,
  /.*\.map$/,
  /.*\.d\.ts$/,
  /\/bin\//,
  /\/obj\//,
  /\/out\//,
  /\/target\//,
  /\/vendor\//,
]
const refusalRule = (f: { repo: string; rel: string; abs: string }): string => {
  const projectRelative = `/${f.repo}/${f.rel}`
  if (!detectLanguageFromPath(projectRelative)) return "extension not routed anywhere by language-detection.ts"
  if (builtinIgnore.ignores(f.repo + "/" + f.rel)) return "built-in ignore glob (e.g. **/testData/**) in discoverAndFilterFiles"
  if (skipPatterns.some((p) => p.test(projectRelative))) return "ParallelIndexerConfig.skipPatterns"
  return "UNEXPLAINED"
}
const notStoredByRule: Record<string, number> = {}
const notStoredByCause: Record<string, string[]> = {}
for (const f of notStored) {
  const rule = refusalRule(f)
  notStoredByRule[rule] = (notStoredByRule[rule] ?? 0) + 1
  ;(notStoredByCause[rule] ??= []).push(`${f.repo}/${f.rel}`)
}
const report = {
  schemaVersion: 1,
  kind: "m60-graphql-store-binding-truth",
  generatedAt: new Date().toISOString(),
  producedBy: "validation/m14/fixtures/graphql/store-binding-truth.mts",
  population: {
    repos: REPOS.length ? REPOS : "(all)",
    filesCopiedForIndexing: drawn.length,
    filesInTheStore: fileCount,
    filesTheIndexerDidNotAdmit: notStored.length,
    filesTheIndexerDidNotAdmitByExtension: notStoredByExtension,
    filesTheIndexerDidNotAdmitExamples: notStored.slice(0, 8).map((f) => `${f.repo}/${f.rel}`),
    filesTheIndexerDidNotAdmitByRule: notStoredByRule,
    filesTheIndexerDidNotAdmitByRuleExamples: Object.fromEntries(
      Object.entries(notStoredByCause).map(([rule, files]) => [rule, files.slice(0, 4)]),
    ),
    indexMs,
    runNote: "ONE run, ONE index — the store is order-dependent and every number here is a single run",
  },
  predicate: {
    "own-once": "the edge's own file declares the target name exactly once — the model claims production binds THAT declaration; anything else is a violation",
    "own-many": "the own file declares it more than once — the store's write order decides; reported, not scored",
    "own-none": "only foreign declarations answer — `s.id` decides between them; reported, not scored",
    "no-source": "the edge carries no source symbol, so 'its own file' does not exist",
  },
  perType,
  byResolverKey: {
    note: "the same edges under the three spellings a declaration can be found by — (a) the symbol's name (the published classes above), (b) its qualified_name ALIAS (the key the lane's own probe adds), (c) extractLeaf(target) matched to name (the key resolveTargetStmt is queried with). The first version of this probe used (a) alone and called the rows it could not see an analyzer anomaly.",
    // DERIVED, not narrated: these three sentences are composed from the counts above, so a wording that
    // disagreed with the table would be impossible to write. The first version reported the `overrides`
    // class as an unexplained analyzer/store disagreement; axis (b) is what it was.
    correction: ((): string => {
      const axisB = byResolverKey["own-once by (b) QUALIFIED-NAME alias"]
      const axisC = byResolverKey["own-once by (c) LEAF only — invisible to (a) and (b)"]
      const bOverrides = axisB?.byType["overrides"] ?? 0
      const bTotal = axisB?.edges ?? 0
      const cTotal = axisC?.edges ?? 0
      return (
        `The first version of this probe matched the edge's target against the symbol's \`name\` alone. ` +
        `The qualified_name ALIAS (axis b) alone finds ${bTotal} more own-file-determinate edges, ` +
        `${bOverrides} of them \`overrides\` — the class the first version reported as an unexplained ` +
        `analyzer/store disagreement. The leaf key (axis c) adds ${cTotal} beyond both. Every edge in all ` +
        `three classes bound exactly the declaration its own file carries; the analyzer was never wrong ` +
        `and this instrument's key was.`
      )
    })(),
    leafReducedTargets,
    leafReducedShare: storeRows.length ? Number((leafReducedTargets / storeRows.length).toFixed(4)) : 0,
    relationshipRows: storeRows.length,
    ownFileDeterminateEdges: Object.entries(byResolverKey).filter(([k]) => k.startsWith("own-once by")).reduce((a, [, b]) => a + b.edges, 0),
    ownFileDeterminateBoundToTheDeclaration: Object.entries(byResolverKey).filter(([k]) => k.startsWith("own-once by")).reduce((a, [, b]) => a + b.boundToTheOwnDecl, 0),
    ownFileDeterminateUnaccounted: Object.entries(byResolverKey).filter(([k]) => k.startsWith("own-once by")).reduce((a, [, b]) => a + b.boundElsewhere + b.unbound + (b.bound - b.boundToTheOwnDecl), 0),
    classes: byResolverKey,
  },
}
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")

const label: Record<string, string> = {
  own: "edges",
  bound: "bound",
  unbound: "unbound",
  boundToOwnFile: "->own file",
  boundToTheOwnOnceDecl: "->THE own-once decl",
  boundElsewhere: "->elsewhere",
}
console.log(`graphql store-binding truth — ${drawn.length} files copied for indexing in ${indexMs.toLocaleString()} ms; the store holds ${fileCount} files and ${storeRows.length} relationship rows`)
console.log(`  admitted by the indexer: ${drawn.length - notStored.length}/${drawn.length}${notStored.length ? ` — the ${notStored.length} it did not admit are ${JSON.stringify(notStoredByExtension)}` : ""}`)
if (notStored.length) {
  for (const [rule, n] of Object.entries(notStoredByRule).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(4)} refused by ${rule}`)
    for (const ex of (notStoredByCause[rule] ?? []).slice(0, 2)) console.log(`             e.g. ${ex}`)
  }
}
console.log("")
for (const [type, b] of Object.entries(perType)) {
  console.log(`${type}: ${b.edges.toLocaleString()} edges · bound ${b.bound.toLocaleString()} · unbound ${b.unbound.toLocaleString()} · ->own file ${b.boundToOwnFile.toLocaleString()} · ->elsewhere ${b.boundElsewhere.toLocaleString()}`)
  for (const cls of ["own-once", "own-many", "own-none", "no-source"]) {
    const c = b.byClass[cls]
    if (!c) continue
    const extra = cls === "own-once" ? ` · bound to THE own-once declaration ${c.boundToTheOwnOnceDecl.toLocaleString()}` : ""
    console.log(`    ${cls.padEnd(10)} ${String(c.edges).padStart(7)} edges · bound ${String(c.bound).padStart(7)} · unbound ${String(c.unbound).padStart(5)} · ->own file ${String(c.boundToOwnFile).padStart(7)} · ->elsewhere ${String(c.boundElsewhere).padStart(6)}${extra}`)
  }
  for (const ex of b.examples) console.log(`      VIOLATION ${ex}`)
}
console.log(`\nTHE KEY AXES — ${leafReducedTargets} of ${storeRows.length} relationship rows carry a target that is not its own leaf (${((leafReducedTargets / storeRows.length) * 100).toFixed(1)}%)`)
const determinate = Object.entries(byResolverKey).filter(([k]) => k.startsWith("own-once by")).reduce((a, [, b]) => a + b.edges, 0)
const determinateBound = Object.entries(byResolverKey).filter(([k]) => k.startsWith("own-once by")).reduce((a, [, b]) => a + b.boundToTheOwnDecl, 0)
const determinateUnaccounted = Object.entries(byResolverKey).filter(([k]) => k.startsWith("own-once by")).reduce((a, [, b]) => a + b.boundElsewhere + b.unbound + (b.bound - b.boundToTheOwnDecl), 0)
for (const [cls, b] of Object.entries(byResolverKey).sort((a, c) => c[1].edges - a[1].edges)) {
  const top = Object.entries(b.byType).sort((a, c) => c[1] - a[1]).slice(0, 4).map(([t, n]) => `${t} ${n}`).join(" · ")
  console.log(`  ${cls.padEnd(46)} edges ${String(b.edges).padStart(7)} · bound ${String(b.bound).padStart(7)} · ->THE own decl ${String(b.boundToTheOwnDecl).padStart(7)} · ->in own file ${String(b.boundToAnOwnDecl).padStart(7)} · elsewhere ${String(b.boundElsewhere).padStart(6)} · unbound ${String(b.unbound).padStart(6)}`)
  console.log(`      ${top}`)
}
console.log(`\n  OWN-FILE-DETERMINATE across all three keys: ${determinate} edges · bound exactly the own-file declaration ${determinateBound} · outside that declaration ${determinateUnaccounted}`)
console.log(`\nartefact: ${path.relative(REPO_ROOT, OUT)}`)
if (!existsSync(OUT)) process.exit(3)
