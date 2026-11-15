/**
 * SQL PASS-3 INCOMING PROBE — can the graph walk TO a declaration, and can it pick the right one?
 *
 * WHY THIS EXISTS. Every outgoing number this lane has measured answers "what does this file
 * reference", not "what references this declaration". `src/lsp/impact.ts` obtains its reverse edges
 * by SCANNING OUTGOING EDGES AND MATCHING TARGETS, so the reverse walk is exactly as good as the
 * target-matching, and three failure modes follow — two of which this probe measures and one of
 * which it fixes:
 *
 *   1. AN AMBIGUOUS TARGET. A bare name that resolves to more than one published declaration. The
 *      reverse walk picks a winner by a rule nobody chose, and the graph attributes an incoming edge
 *      to a declaration that never mentioned it. Measured on 289 boundary migration files: `contains`
 *      has 82 ambiguous targets out of 595 distinct, and the dominant collision is a column and an
 *      INDEX sharing a name (`scope_id`, `auth_method_id`, …) because the analyzer maps both to bare
 *      names.
 *   2. A HOPELESS-STRING TARGET. An external package, a path, a builtin. Indistinguishable, in a
 *      count, from a declaration that was simply never indexed — and the two are OPPOSITE findings.
 *   3. A SOURCE THAT IS NOT A SYMBOL. `global` is the analyzer's synthetic owner for anonymous
 *      statements. It is not published, so 77 % of `uses` edges cannot be walked FROM at all.
 *
 * WHAT MAKES THIS PROBE ABLE TO FAIL. Every expectation is re-derived from the parse result's own
 * symbol array and from the pool-worker's own exported `keepSymbol`, never read out of a table this
 * lane produced. `keepSymbol` is exported precisely so a probe can ask the index's question instead
 * of keeping a copy of the rule that could drift.
 *
 * USAGE:
 *   npx tsx validation/m14/fixtures/sql/pass3-incoming.mts [--out FILE] <file> ...
 */
import { writeFileSync, readdirSync, statSync, readFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { parseFile } from "../../../../src/ast/pool-worker"
import { keepSymbol, nameTheSymbolRule } from "../../../../src/ast/pool-worker"
import { SQL_KEYWORDS, SQL_BUILTINS } from "../../../../src/ast/real-sql-analyzer"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const argv = process.argv.slice(2)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined
const CONCURRENCY = argv.includes("--concurrency") ? Number(argv[argv.indexOf("--concurrency") + 1]) : 8
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 512 * 1024

/**
 * With no files given, walk the corpus exactly as `ontology-census.mts` does — git-tracked files,
 * <= 512 KB, routed to `sql` by PRODUCTION's own `detectLanguageFromPath`. Same universe, so an
 * incoming number here and an outgoing number there describe the same files. The corpus walk matters
 * for the external/never-indexed split: a target that no file in the WHOLE corpus declares is a
 * different finding from one that a file outside the probe's input declares.
 */
function discover(): string[] {
  const out: string[] = []
  for (const entry of readdirSync(CR)) {
    const dir = path.join(CR, entry)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let text: string
      try {
        if (statSync(abs).size > SIZE_CAP) continue
        text = readFileSync(abs, "utf8")
      } catch { continue }
      if (detectLanguageFromPath(abs, text) !== "sql") continue
      out.push(abs)
    }
  }
  return out.sort()
}

const FILES: string[] = (() => {
  const given = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out" && argv[i - 1] !== "--concurrency")
  return given.length ? given.sort() : discover()
})()

const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const

/**
 * Classify an unresolved target. The four answers are different findings and must not be summed:
 *
 *   droppedByKeepSymbol  the analyzer EMITTED a symbol with this name and `keepSymbol` deletes it, so
 *                       the declaration exists and the index threw it away. That is a defect and it
 *                       is mine-or-shared, not a gap in the corpus.
 *   qualifiedBareLeaf    the corpus declares `s.t` and the edge names `t`. Not unresolvable — the
 *                       analyzer emitted the bare TAIL of a qualified reference on purpose.
 *   externalByBuiltin    the name is in a guard set the analyzer ITSELF exports (`SQL_BUILTINS`,
 *                       `SQL_KEYWORDS`), or has the shape of a platform object (`pg_*`,
 *                       `_pg_*`, `sql_*`, `information_schema.*`). A corpus file cannot declare
 *                       these by construction, so they are the "hopeless-string target" class and
 *                       they are NOT a recall gap.
 *   unaccounted          everything else. This is the only bucket that is a real gap, and it is
 *                       reported as its own number rather than folded into any other.
 */
function classifyUnresolved(
  name: string,
  published: Map<string, Set<string>>,
  emittedButDropped: Set<string>,
  guardSets: { builtins: Set<string>; keywords: Set<string> },
  meta: Record<string, unknown> | undefined,
  sourceFile: string,
): string {
  if (emittedButDropped.has(name)) return "droppedByKeepSymbol"
  // The two `imports` mechanisms are separated by the analyzer's OWN metadata, not by a name shape:
  // a psql `\i` target is a FILE and a `CREATE EXTENSION` target is a DISTRIBUTION. Neither can be a
  // corpus declaration, so both are hopeless-string targets and both are reported as their own class
  // rather than as recall gaps. The old run put all 22 in `unaccounted`, which is the failure mode the
  // workstream calls out: an external package and a path look identical to "never indexed" unless
  // something says which they are.
  if (meta?.psqlInclude === true) return "externalByFilePath"
  if (meta?.extensionInstall === true) return "externalByDistribution"
  // `schema.table` / `schema.function` in the published set means the edge names the bare leaf.
  let dotted = false
  for (const key of published.keys()) if (key.includes(".") && key.endsWith(`.${name}`)) { dotted = true; break }
  if (dotted) return "qualifiedBareLeaf"
  if (guardSets.builtins.has(name) || guardSets.keywords.has(name)) return "externalByBuiltin"
  for (const p of PLATFORM_PREFIXES) if (name.startsWith(p)) return "externalByBuiltin"
  return "unaccounted"
}

type TypeRow = {
  edges: number
  distinctTargets: number
  ambiguousTargets: number
  ambiguousTargetNames: { name: string; kinds: string[]; edges: number }[]
  unresolvedTargets: number
  unresolvedDistinct: number
  unresolvedClasses: Record<string, number>
  unresolvedClassExamples: Record<string, string[]>
  sourceGlobal: number
  selfLoops: number
}

function blankRow(): TypeRow {
  return {
    edges: 0, distinctTargets: 0, ambiguousTargets: 0, ambiguousTargetNames: [],
    unresolvedTargets: 0, unresolvedDistinct: 0, unresolvedClasses: {}, unresolvedClassExamples: {},
    sourceGlobal: 0, selfLoops: 0,
  }
}

const published = new Map<string, Set<string>>()          // name -> kinds
const emittedButDropped = new Map<string, string>()        // name -> keepSymbol's reason
const rels: any[] = []
const symbolsByFile: { file: string; symbols: any[] }[] = []
let symbolsTotal = 0
let droppedByKeepSymbol = 0
let parseFailures = 0
let degraded = 0

/**
 * The per-file results are buffered and folded in a fixed order so the report does not depend on
 * which worker finished first. With 8 workers the arrival order is not stable, and a report whose
 * `ambiguousTargetNames` list and `symbolsByFile` order varied run to run could not be diffed —
 * which is the whole reason the shard/merge split exists in the census.
 */
const perFileResults: { file: string; symbols: any[]; rels: any[]; degraded: boolean; failed: boolean }[] = []
let idx = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= FILES.length) return
    const f = FILES[i]
    let r: any
    try {
      r = await parseFile(f, path.dirname(f))
    } catch {
      perFileResults.push({ file: f, symbols: [], rels: [], degraded: false, failed: true })
      continue
    }
    perFileResults.push({
      file: f,
      symbols: Array.isArray(r?.symbols) ? r.symbols : [],
      rels: Array.isArray(r?.relationships) ? r.relationships : [],
      degraded: r?.fallback === true,
      failed: false,
    })
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
perFileResults.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))

for (const res of perFileResults) {
  if (res.failed) { parseFailures++; continue }
  if (res.degraded) degraded++
  symbolsByFile.push({ file: res.file, symbols: res.symbols })
  for (const s of res.symbols) {
    const name = String(s?.name ?? "")
    if (!name) continue
    symbolsTotal++
    const kind = String(s?.kind ?? "")
    // THE INDEX'S OWN DECISION, asked of the index's own exported rule rather than of a copy.
    if (!keepSymbol(s, "sql")) { droppedByKeepSymbol++; emittedButDropped.set(name, nameTheSymbolRule(s, "sql")); continue }
    const k = published.get(name) ?? new Set<string>()
    k.add(kind)
    published.set(name, k)
  }
  for (const rel of res.rels) rels.push({ ...rel, file: res.file })
}

/**
 * The platform names, read from the analyzer's own exported guard sets where they exist and from a
 * name-shape test otherwise. No regex (lane policy).
 *
 * PASS 6 CORRECTION — this set was BUILT WRONG, and the error made the classification vacuous.
 * It was constructed as:
 *
 *     for (const name of published.keys()) { if (platform-shaped) externalNames.add(name) }
 *
 * `published` holds the names the corpus DECLARES, and the set is only ever consulted for names
 * the corpus does NOT declare (`if (!published.has(target))` above). So the two sets were disjoint
 * by construction: `externalByName` could never fire, and every unresolved target fell into
 * `unaccounted`. The artifact read `unaccounted: 827` for `calls` and nothing else, which reads as
 * a finding about 827 edges and is in fact a statement about the classifier. The old code is kept
 * below as `publishedPlatformNames` and is REPORTED as a row of its own, because the count of
 * platform-named declarations is a real measurement — it just is not the unresolved classification.
 *
 * The fixed test applies the shape test to the unresolved NAME ITSELF, and asks the analyzer's own
 * exported guard sets whether the name is one it deliberately refuses to treat as a callee.
 */
const PLATFORM_PREFIXES = ["pg_", "information_schema", "sql_", "_pg_"]
const publishedPlatformNames = new Set<string>()
for (const name of published.keys()) {
  for (const p of PLATFORM_PREFIXES) if (name.startsWith(p)) { publishedPlatformNames.add(name); break }
}

const rows = new Map<string, TypeRow>()
const GUARD_SETS = { builtins: SQL_BUILTINS, keywords: SQL_KEYWORDS }

/** edge object -> the file that produced it, so a psql `\i` target can be resolved ON DISK. */
const sourceFileOf = new Map<unknown, string>()
for (const res of perFileResults) for (const rel of res.rels) sourceFileOf.set(rel, res.file)
for (const t of TYPES) rows.set(t, blankRow())
const targetNames = new Map<string, Set<string>>()
const orphanCandidates = new Map<string, number>()

for (const rel of rels) {
  const type = String(rel?.type ?? "").toLowerCase()
  if (!TYPES.includes(type as any)) continue
  const row = rows.get(type)!
  const source = String(rel?.source ?? "")
  const target = String(rel?.target ?? "")
  row.edges++
  if (source === "global") row.sourceGlobal++
  if (source === target) row.selfLoops++
  const s = targetNames.get(type) ?? new Set<string>()
  s.add(target)
  targetNames.set(type, s)
  orphanCandidates.set(target, (orphanCandidates.get(target) ?? 0) + 1)
  if (!published.has(target)) {
    row.unresolvedTargets++
    const meta = (rel?.metadata ?? undefined) as Record<string, unknown> | undefined
    const cls = classifyUnresolved(target, published, new Set(emittedButDropped.keys()), GUARD_SETS, meta, sourceFileOf.get(rel) ?? "")
    row.unresolvedClasses[cls] = (row.unresolvedClasses[cls] ?? 0) + 1
    const ex = row.unresolvedClassExamples[cls] ?? []
    if (ex.length < 6) ex.push(target)
    row.unresolvedClassExamples[cls] = ex
  }
}

for (const [type, names] of targetNames) {
  const row = rows.get(type)!
  row.distinctTargets = names.size
  const ambiguous = [...names].filter((n) => (published.get(n)?.size ?? 0) > 1).sort()
  row.ambiguousTargets = ambiguous.length
  row.ambiguousTargetNames = ambiguous.slice(0, 12).map((n) => ({ name: n, kinds: [...(published.get(n) ?? [])], edges: 0 }))
}
for (const rel of rels) {
  const type = String(rel?.type ?? "").toLowerCase()
  const row = rows.get(type)
  if (!row) continue
  for (const a of row.ambiguousTargetNames) if (a.name === String(rel?.target ?? "")) a.edges++
}
for (const t of TYPES) rows.get(t)!.unresolvedDistinct = [...new Set(
  rels.filter((r) => String(r?.type ?? "").toLowerCase() === t && !published.has(String(r?.target ?? ""))).map((r) => String(r?.target ?? "")),
)].length

/**
 * THE DISAMBIGUATION TEST — does `(target, ownerName)` identify a declaration uniquely?
 *
 * This is the claim the fix rests on, so it is measured rather than asserted. A `contains` edge's
 * SOURCE is the owning declaration and its target is the member, so if (name, owner) is unique then a
 * consumer needs no new schema and no stored inbound edge: it reads the member's `ownerName`, which is
 * already published.
 *
 * TWO DENOMINATORS, because they are different questions and answering either alone is misleading:
 *
 *   intraFile   how many symbols with that name AND that owner the edge's OWN file publishes. This is
 *               the resolution a per-file analyzer supports.
 *   corpusWide  how many symbols with that name AND that owner exist across ALL files parsed. This is
 *               the resolution `bb_graph` and `bb_impact` face, and it is the one with the bad number:
 *               a migrations corpus declares `users(id)` in many files, so `owner` alone does not
 *               disambiguate corpus-wide and only the FILE does. Both are reported because the first
 *               one alone would read as "already fine" and the second alone would read as "hopeless".
 */
const containsUniqueness = {
  edges: 0,
  intraFile: { unique: 0, ambiguous: 0, notFound: 0, kindPairs: {} as Record<string, number>, examples: [] as string[] },
  corpusWide: { unique: 0, ambiguous: 0, notFound: 0, medianMatches: 0 },
  bareNameCorpusWide: { unique: 0, ambiguous: 0 },
  // THE FIX, measured rather than asserted: `contains` edges now carry `memberKind`, so a consumer
  // can match (target, ownerName, memberKind) instead of (target). This denominator says how far
  // that gets INSIDE the edge's own file, which is the resolution a per-file analyzer supports.
  intraFileWithMemberKind: { unique: 0, ambiguous: 0, notFound: 0, edgeLacksMemberKind: 0 },
  note: "`contains` edges carry only the bare member name by default, so a consumer matches on name alone. This measures whether what the member symbol ALREADY carries (ownerName, then file, then kind) plus the edge's `metadata.memberKind` is enough to match exactly.",
}

{
  // name -> owner -> [symbols], over every file parsed.
  const index = new Map<string, Map<string, any[]>>()
  for (const { file, symbols } of symbolsByFile) {
    for (const s of symbols) {
      if (!keepSymbol(s, "sql")) continue
      const name = String(s?.name ?? "")
      const owner = String(s?.ownerName ?? "")
      if (!name) continue
      const byOwner = index.get(name) ?? new Map<string, any[]>()
      const arr = byOwner.get(owner) ?? []
      arr.push({ kind: String(s?.kind ?? ""), file })
      byOwner.set(owner, arr)
      index.set(name, byOwner)
    }
  }
  const matchCounts: number[] = []
  for (const rel of rels) {
    if (String(rel?.type ?? "").toLowerCase() !== "contains") continue
    const target = String(rel?.target ?? "")
    const owner = String(rel?.source ?? "")
    containsUniqueness.edges++
    const bareKinds = published.get(target)
    if (bareKinds) { if (bareKinds.size === 1) containsUniqueness.bareNameCorpusWide.unique++; else containsUniqueness.bareNameCorpusWide.ambiguous++ }
    const byOwner = index.get(target)?.get(owner)
    if (!byOwner || byOwner.length === 0) {
      containsUniqueness.corpusWide.notFound++
      continue
    }
    matchCounts.push(byOwner.length)
    if (byOwner.length === 1) containsUniqueness.corpusWide.unique++
    else containsUniqueness.corpusWide.ambiguous++
    const here = byOwner.filter((m) => m.file === rel.file)
    // THE SAME MATCH, plus the edge's own `metadata.memberKind`.
    const mk = (rel?.metadata ?? {})?.memberKind
    if (mk === undefined) containsUniqueness.intraFileWithMemberKind.edgeLacksMemberKind++
    const hereKinded = mk === undefined ? here : here.filter((m) => m.kind === mk)
    if (hereKinded.length === 1) containsUniqueness.intraFileWithMemberKind.unique++
    else if (hereKinded.length === 0) containsUniqueness.intraFileWithMemberKind.notFound++
    else containsUniqueness.intraFileWithMemberKind.ambiguous++
    if (here.length === 1) containsUniqueness.intraFile.unique++
    else if (here.length === 0) containsUniqueness.intraFile.notFound++
    else {
      containsUniqueness.intraFile.ambiguous++
      const pair = [...new Set(here.map((m) => m.kind))].sort().join("+")
      containsUniqueness.intraFile.kindPairs[pair] = (containsUniqueness.intraFile.kindPairs[pair] ?? 0) + 1
      if (containsUniqueness.intraFile.examples.length < 8) {
        containsUniqueness.intraFile.examples.push(`${owner} -> ${target} in ${path.basename(rel.file)} matched ${here.length} (${pair})`)
      }
    }
  }
  matchCounts.sort((a, b) => a - b)
  containsUniqueness.corpusWide.medianMatches = matchCounts.length ? matchCounts[Math.floor(matchCounts.length / 2)] : 0
}

/**
 * ORPHAN DECLARATIONS, split by whether anything could plausibly name them. A table declared in a
 * migration and read by a query in a DIFFERENT file is an orphan in this index and is CORRECT — the
 * index here is per-file. So the rate is reported with that stated, not scored.
 */
let namedAtAll = 0
for (const [, n] of orphanCandidates) if (n > 0) namedAtAll++
const totalDecls = published.size
const orphans = {
  publishedDeclarations: totalDecls,
  namedBySomeEdge: namedAtAll,
  namedByNothing: totalDecls - namedAtAll,
  note: "This probe indexes the files given and no others, so a declaration read by a file outside the set is an orphan HERE and not in the project. The rate is reported, not scored.",
}

/**
 * TRIGGER / FUNCTION NAME COLLISION — the shape behind 431 of 747 `calls` self-loops.
 *
 * PostgreSQL's convention is to name a trigger after the function it executes:
 *
 *   CREATE TRIGGER immutable_columns BEFORE UPDATE OR INSERT ON t
 *     EXECUTE FUNCTION immutable_columns();
 *
 * Both declarations publish as `kind: function` with the same name, so (a) a reverse walk on
 * `immutable_columns` has two candidate declarations to choose between and (b) the edge that joins
 * them is encoded `source == target`, which is the SAME encoding a recursive call uses. The edge is
 * factually correct and is not fabricated — the SQL says it — but a consumer reading `calls X -> X`
 * will conclude "X is recursive", and on this corpus that conclusion is wrong in every case.
 *
 * Counted here rather than asserted: how many `calls` edges are self-loops, how many of those carry
 * `metadata.triggerAction`, and how many distinct names carry both a trigger and a function symbol.
 */
const selfLoopRows = {
  callsSelfLoops: 0,
  withTriggerAction: 0,
  withoutTriggerAction: 0,
  withoutExamples: [] as string[],
  distinctSelfLoopTargetNames: 0,
  note: "A trigger and a function both publish as kind `function`, so a same-named pair is indistinguishable at the symbol level. Distinguishing them needs a SymbolKind the shared enum does not have (src/ast/types.ts is supervisor-owned). The edge itself is not fabricated — the SQL says EXECUTE FUNCTION <same name> — and it is already marked `metadata.triggerAction`.",
}
const namesWithCall = new Set<string>()
const selfLoopNames = new Set<string>()
for (const rel of rels) {
  if (String(rel?.type ?? "").toLowerCase() !== "calls") continue
  const s = String(rel?.source ?? "")
  const t = String(rel?.target ?? "")
  namesWithCall.add(s)
  namesWithCall.add(t)
  if (s !== t) continue
  selfLoopRows.callsSelfLoops++
  selfLoopNames.add(s)
  const ta = (rel?.metadata ?? {})?.triggerAction
  if (ta === true) selfLoopRows.withTriggerAction++
  else {
    selfLoopRows.withoutTriggerAction++
    if (selfLoopRows.withoutExamples.length < 8) selfLoopRows.withoutExamples.push(`${s} -> ${t} in ${rel.file}`)
  }
}
selfLoopRows.distinctSelfLoopTargetNames = selfLoopNames.size

/**
 * KEYWORD-NAMED SYMBOLS — a declaration whose name is a reserved word.
 *
 * `RESERVED_AS_COLUMN_NAME` in the analyzer holds exactly two words (`like`, `inherit`), which is a
 * record of two encounters with this class rather than a considered list. `ALTER TABLE t ADD FOREIGN
 * KEY (a) REFERENCES u(x)` yields an `add_column` whose `column_definition` names the column
 * `FOREIGN`, and `ADD UNIQUE (a, b)` names it `UNIQUE` — a `property` symbol whose name is a keyword,
 * plus a `contains` edge pointing at it.
 *
 * Measured against the analyzer's OWN exported `SQL_KEYWORDS` rather than a local copy, so the list
 * cannot drift from the guard that is supposed to prevent this. `SQL_BUILTINS` is deliberately NOT
 * used: a column legitimately named `left` or `user` is not a declaration error, and folding builtins
 * in would inflate this count with correct symbols.
 */
const keywordNamedSymbols = {
  n: 0,
  byName: new Map<string, number>(),
  examples: [] as { file: string; kind: string; name: string; owner: string; line: number }[],
}
for (const { file, symbols } of symbolsByFile) {
  for (const s of symbols) {
    const name = String(s?.name ?? "")
    if (!name) continue
    if (!SQL_KEYWORDS.has(name.toLowerCase())) continue
    keywordNamedSymbols.n++
    keywordNamedSymbols.byName.set(name, (keywordNamedSymbols.byName.get(name) ?? 0) + 1)
    if (keywordNamedSymbols.examples.length < 10) {
      keywordNamedSymbols.examples.push({ file: path.basename(file), kind: String(s?.kind ?? ""), name, owner: String(s?.ownerName ?? ""), line: Number(s?.startLine ?? 0) })
    }
  }
}

const report = {
  instrument: "validation/m14/fixtures/sql/pass3-incoming.mts",
  entryPoint: "parseFile (src/ast/pool-worker.ts)",
  filesGiven: FILES.length,
  parseFailures,
  degradedRegexFallback: degraded,
  symbolsSeenByParser: symbolsTotal,
  distinctPublishedNames: totalDecls,
  droppedByKeepSymbol: { n: droppedByKeepSymbol, byName: [...emittedButDropped.entries()].map(([name, reason]) => ({ name, reason })) },
  /**
   * THE CLASSIFIER'S OWN VACUITY CHECK, added at pass 6 after `externalByBuiltin` was found to be
   * unreachable. Two numbers that must both be non-zero for the split to mean anything:
   *
   *   guardSetSizes          how big the two exported guard sets are, so a reader can see the
   *                         classifier had names to work with rather than an empty list.
   *   publishedPlatformNames the count the OLD (vacuous) test produced, kept because it is a real
   *                         measurement of platform-named DECLARATIONS — and because reporting the
   *                         new figure beside the old one is what makes the old bug visible rather
   *                         than merely fixed.
   *
   * If `externalByBuiltin` is 0 across every type while `unaccounted` is not, this classifier has
   * failed the same way again and the artifact should not be read as a finding about the edges.
   *
   * The first version of THIS check read `Object.values(rows)` where `rows` is a `Map`, which yields
   * `[]`, so the three totals were 0 and `vacuous` was `false` on an empty array — a self-check that
   * could not fail is the same defect one level up, and it is why the iteration is `rows.values()`.
   */
  /**
   * `imports` is the one type whose unresolvable target is RESOLVABLE BY A DIFFERENT KEY, so it is
   * the one type where "unresolved against the symbol set" is not the end of the question. A psql
   * `\\i` target is a path relative to the including script, and the analyzer records
   * `metadata.relativeToScript` for `\\ir`. Both are resolved on disk here — not from the symbol set —
   * so the claim "22 of 22 include targets exist" is measured in the same artifact and by the same
   * run as the classification above.
   */
  importsPathResolution: (() => {
    let includes = 0, includesOnDisk = 0, installs = 0, installsOnDisk = 0
    const missing: string[] = []
    for (const res of perFileResults) {
      for (const rel of res.rels) {
        if (String(rel?.type ?? "").toLowerCase() !== "imports") continue
        const meta = (rel?.metadata ?? {}) as Record<string, unknown>
        const target = String(rel?.target ?? "")
        if (meta.extensionInstall === true) {
          installs++
          // An extension is a DISTRIBUTION: it is installed by the server, not read from this repo.
          // Whether one happens to sit in the corpus is not what the edge means, so it is counted and
          // deliberately NOT scored as resolved — the two are different claims.
          if (existsSync(path.join(CR, target))) installsOnDisk++
          continue
        }
        if (meta.psqlInclude === true) {
          includes++
          const abs = path.resolve(path.dirname(res.file), target)
          if (existsSync(abs)) includesOnDisk++
          else if (missing.length < 8) missing.push(`${res.file} -> ${target}`)
        }
      }
    }
    return {
      psqlIncludes: includes, psqlIncludesExistingOnDisk: includesOnDisk,
      extensionInstalls: installs, extensionInstallsPresentInCorpus: installsOnDisk,
      extensionInstallsScoredAsResolved: false,
      missingExamples: missing,
      note: "relativeToScript is recorded by the analyzer on `\\ir` but the ON-DISK test resolves both the same way, because `\\i` and `\\ir` are the same relative-path resolution and differ only in the path base they resolve against; a disagreement between the two forms would show up as a missing example.",
    }
  })(),
  classifierSelfCheck: {
    guardSetSizes: { builtins: SQL_BUILTINS.size, keywords: SQL_KEYWORDS.size },
    publishedPlatformNames: publishedPlatformNames.size,
    externalByBuiltinTotal: [...rows.values()].reduce((a, r) => a + (r.unresolvedClasses.externalByBuiltin ?? 0), 0),
    unaccountedTotal: [...rows.values()].reduce((a, r) => a + (r.unresolvedClasses.unaccounted ?? 0), 0),
    vacuous: [...rows.values()].every((r) => (r.unresolvedClasses.externalByBuiltin ?? 0) === 0) &&
      [...rows.values()].some((r) => (r.unresolvedClasses.unaccounted ?? 0) > 0),
  },
  edgesTotal: rels.length,
  perType: Object.fromEntries([...rows.entries()].map(([t, r]) => [t, r])),
  containsUniqueness,
  keywordNamedSymbols: { n: keywordNamedSymbols.n, byName: [...keywordNamedSymbols.byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20), examples: keywordNamedSymbols.examples },
  triggerFunctionNameCollision: selfLoopRows,
  orphans,
}

if (OUT) writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)

console.log(`SQL pass-3 incoming probe — ${FILES.length} files, ${symbolsTotal} symbols, ${rels.length} edges`)
console.log(`degraded ${degraded}  parse failures ${parseFailures}  dropped by keepSymbol ${droppedByKeepSymbol} (${[...emittedButDropped.keys()].join(", ")})`)
console.log("")
console.log(`${"type".padEnd(13)}${"edges".padStart(8)}${"distinct".padStart(9)}${"ambig".padStart(7)}${"unres".padStart(8)}${"srcGlobal".padStart(11)}${"selfLoop".padStart(10)}  unres classes`)
for (const t of TYPES) {
  const r = rows.get(t)!
  const cls = Object.entries(r.unresolvedClasses).map(([k, v]) => `${k}=${v}`).join(" ") || "-"
  console.log(`${t.padEnd(13)}${String(r.edges).padStart(8)}${String(r.distinctTargets).padStart(9)}${String(r.ambiguousTargets).padStart(7)}${String(r.unresolvedTargets).padStart(8)}${String(r.sourceGlobal).padStart(11)}${String(r.selfLoops).padStart(10)}  ${cls}`)
}
console.log("")
console.log("contains disambiguation, using only what the member symbol already carries:")
const u = containsUniqueness
console.log(`  edges ${u.edges}`)
console.log(`  bare name alone, corpus-wide: unique ${u.bareNameCorpusWide.unique}  ambiguous ${u.bareNameCorpusWide.ambiguous}`)
console.log(`  (name, ownerName) within the edge's own FILE: unique ${u.intraFile.unique}  ambiguous ${u.intraFile.ambiguous}  not found ${u.intraFile.notFound}`)
if (Object.keys(u.intraFile.kindPairs).length) console.log(`    intra-file ambiguous kind pairs: ${Object.entries(u.intraFile.kindPairs).map(([k, v]) => k + "=" + v).join(" ")}`)
for (const e of u.intraFile.examples) console.log(`      ${e}`)
console.log(`  (name, ownerName) corpus-wide: unique ${u.corpusWide.unique}  ambiguous ${u.corpusWide.ambiguous}  not found ${u.corpusWide.notFound}  median matches ${u.corpusWide.medianMatches}`)
console.log(`  + edge metadata.memberKind, within the edge's own FILE: unique ${u.intraFileWithMemberKind.unique}  ambiguous ${u.intraFileWithMemberKind.ambiguous}  not found ${u.intraFileWithMemberKind.notFound}  edges without the key ${u.intraFileWithMemberKind.edgeLacksMemberKind}`)
console.log("")
console.log(`orphans: ${orphans.namedByNothing} of ${orphans.publishedDeclarations} published names are named by no edge in this set`)
console.log("")
console.log(`keyword-named symbols (name is in the analyzer's own SQL_KEYWORDS): ${keywordNamedSymbols.n} — ${[...keywordNamedSymbols.byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + "=" + v).join("  ")}`)
console.log("")
console.log("trigger/function name collision (the shape behind `calls` self-loops):")
console.log(`  calls self-loops ${selfLoopRows.callsSelfLoops}   with metadata.triggerAction ${selfLoopRows.withTriggerAction}   without ${selfLoopRows.withoutTriggerAction}`)
console.log(`  names carrying both a trigger and a function symbol that a calls edge mentions: ${selfLoopRows.distinctSelfLoopTargetNames}`)
for (const e of selfLoopRows.withoutExamples) console.log(`    non-trigger self-loop: ${e}`)
if (OUT) console.log(`\nwrote ${OUT}`)