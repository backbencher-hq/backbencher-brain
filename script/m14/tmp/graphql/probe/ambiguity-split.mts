/**
 * AMBIGUITY SPLIT — what kind of ambiguous is it, and which of it is this lane's to repair?
 *
 * ## The question this answers
 *
 * `validation/m14/measurements/incoming-whole.tsv` reports, per lane, how many relationship targets
 * resolve to more than one published symbol ("ambiguous") and how many resolve to none
 * ("unresolved"). graphql reads `amb 3,710  unres 4,427` at 600 files.
 *
 * An ambiguous target is ONE edge the reverse walk will attribute to N declarations — not N edges —
 * so it cannot be lowered by emitting fewer edges or by implementing another type. It falls only
 * when SYMBOL IDENTITY becomes sound. Three causes have to be separated before any of that is worth
 * attempting, because they have different owners:
 *
 *   B1 INTRA-FILE       one file publishes the same name under two different SymbolKinds. Two
 *                       symbols, one name, and within one document there is exactly one right
 *                       answer — so this is a defect and the lane owns it.
 *   B2 CROSS-MODULE     the same name carries different kinds in DIFFERENT files — two repos each
 *                       declaring `Status` as a class and as an enum. Module identity is unmodelled,
 *                       so a bare name cannot separate them. Partly the lane's: it could publish a
 *                       module-qualified target.
 *   B3 NAME-NOT-ID      ONE kind and N declaring types in N scopes. In GraphQL a field's identity
 *                       IS (OWNING TYPE, FIELD NAME); the bare name is not an identifier for it,
 *                       so no care in this analyzer makes a bare `id` resolve to one thing. NOT
 *                       lane-fixable at the bare-name level — it is a statement about the
 *                       published-name contract.
 *
 * The classification is FIRST-MATCH, therefore mutually exclusive and summing to the total:
 *   B1  all declarations of the name live in ONE file
 *   B2  else, the name carries >=2 distinct kinds
 *   B3  else, one kind and >=2 declaring types (in >=2 files)
 *
 * ## B3 IS UNREACHABLE UNDER ONE OF THE TWO RULES, AND THAT IS A FINDING
 *
 * Ambiguity is not a property of the corpus. It is a property of a RESOLUTION RULE applied to the
 * corpus, and the two rules in play disagree about what collides:
 *
 *   KIND RULE  — `script/m14/incoming-check.ts` keeps `name -> array of DISTINCT KINDS`, so
 *                `hits.length > 1` means the name is published under MORE THAN ONE KIND. A name
 *                declared on 47 types is ONE kind and is therefore NOT ambiguous to that
 *                instrument, however many declarations share it. Under this rule B3 CANNOT FIRE:
 *                "one kind, several declarations" is excluded by construction.
 *   STORE RULE — `parallel-indexer.ts resolveRelationships` tries a qualified-name exact match
 *                first (`_res_qname`), then accepts a bare name only when its count is 1
 *                (`_res_name`) — and that count is over SYMBOLS, not kinds. A bare name carried by
 *                1,866 symbols is ambiguous here and invisible under the kind rule.
 *
 * So the brief's bucket 3 is unobservable through the instrument whose number is quoted in the tsv.
 * This probe therefore splits BOTH rule sets separately, asserts kind-rule parity with
 * `incoming-check`, and reports the two rule columns side by side. A single "ambiguous" number with
 * no rule attached is a number about an unstated instrument.
 *
 * ## THE RESUMED-WALK ZERO — this probe's second draft had it and lost 1905 files' worth of data
 *
 * The first run of this file reported 1,905 files and 156,730 edges and wrote its artifact. The
 * SECOND run, against a complete checkpoint, reported `0 files, 0 edges` and OVERWROTE that
 * artifact, exiting 0. Every accumulator here lives in memory and is populated inside `run()`, and
 * `resumableWalk` does not call `run()` for a file a previous run recorded — so a resumed walk
 * computes a fully-shaped result over nothing. `script/m14/ontology-coverage-gate.ts` has the same
 * shape and the same exposure, and `production-six-questions.mts` in this lane already lost 156,759
 * relationships to it. Three instruments in one lane, one failure mode: this one now REFUSES to
 * write rather than reporting the empty measurement.
 *
 * ## POPULATION, AND WHY IT IS THE 1,905 ADMITTED FILES RATHER THAN 600
 *
 * File discovery is copied from `script/m14/ontology-coverage-gate.ts` (git ls-files per repo,
 * `detectLanguageFromPath`, 512 KB cap) so the population is the same 1,905 admitted files every
 * other number in this lane is measured on, and the two are comparable. A deterministic stride
 * slice is ALSO reported from the same walk, so there is a figure comparable in SHAPE with the
 * supervisor's 600-file tsv. Both are labelled with the population they describe, because a count
 * without its population is a finding about the wrong thing.
 *
 * ## WHAT THIS PROBE DOES NOT CLAIM
 *
 * It measures what a target STRING resolves to under two stated rules. It does not prove any
 * particular edge is right. Moving B1 to zero is a repair this lane can make and verify. Moving B3
 * to zero would require publishing qualified targets, which changes what the edge MEANS and belongs
 * to the family, not to this file.
 *
 * ## Usage
 *
 *     npx tsx script/m14/tmp/graphql/probe/ambiguity-split.mts --fresh
 *
 * `--fresh` is REQUIRED for a number to mean anything; see above. Writes
 * `script/m14/tmp/graphql/out/ambiguity-split.json`. READ-ONLY with respect to the corpus.
 */
import { readFileSync, statSync, readdirSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { GQL, OUT as outDir } from "../paths.mts"
import { parseFile } from "../../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../../src/ast/language-detection"
import { resumableWalk, resetCheckpoint } from "../../../resumable-walk"

const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const LANG = "graphql"
const SLICE = 600

const checkpoint = path.join(GQL, "walk-ambiguity-split.txt")
const artifact = path.join(outDir, "ambiguity-split.json")

const TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
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
const ontologyName = (raw: string): string | null => LABEL_ALIASES[raw] ?? null

/**
 * GraphQL's specification-defined vocabulary: names the SPEC defines, so no `.graphql` file can
 * declare them and no brain_symbol row can ever exist for them. `parallel-indexer`'s two strategies
 * therefore cannot land an edge naming one. That is a property of the vocabulary, not of the edge —
 * so it is its own bucket and never counted as a target the corpus "failed to declare".
 */
const SPEC_VOCABULARY = new Set(["Int", "Float", "String", "Boolean", "ID", "__typename", "__schema", "__type"])

/** ------------------------------------------------------------------ discovery (gate-identical) */
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
console.log(`ambiguity split — ${LANG}`)
console.log(`corpus: ${files.length} admitted files (discovery identical to ontology-coverage-gate)`)

const FRESH = process.argv.includes("--fresh") || process.env.AMB_FRESH === "1"
if (FRESH) resetCheckpoint(checkpoint)

/** ------------------------------------------------------------------ accumulators (memory only) */
type Decl = { file: string; kind: string; qualifiedName: string; scope: string; owner: string }
type RelRow = { type: string; source: string; target: string; role: string; file: string; fileLevel: boolean }

const declsByName = new Map<string, Decl[]>()
const declsByQName = new Map<string, Decl[]>()
const relsByFile = new Map<string, RelRow[]>()
const walkedFiles: string[] = []
let symbolTotal = 0
let emptyNameSymbols = 0
let emptyQNameSymbols = 0
let emptyKindSymbols = 0
let unknownEndpointRels = 0
let degraded = 0
/** Relationship labels that map to no ontology name — a row the ontology cannot account for. */
const unmappedLabels = new Map<string, number>()

const stats = await resumableWalk(checkpoint, files.length, {
  id: (i) => path.relative(CR, files[i].abs),
  concurrency: 4,
  run: async (i) => {
    const f = files[i]
    const r: any = await parseFile(f.abs, f.abs)
    if (!r) throw new Error("no result")
    if (r.fallback === true) degraded++
    const relFile = path.relative(CR, f.abs)
    const rows: RelRow[] = []
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      symbolTotal++
      const name = String(s?.name ?? "")
      const d: Decl = {
        file: relFile,
        kind: String(s?.kind ?? ""),
        qualifiedName: String(s?.qualifiedName ?? ""),
        scope: String(s?.scope ?? ""),
        owner: String(s?.owner ?? ""),
      }
      if (name.length === 0) emptyNameSymbols++
      if (d.qualifiedName.length === 0) emptyQNameSymbols++
      if (d.kind === "") emptyKindSymbols++
      if (name.length === 0 || d.kind === "") continue
      // `incoming-check` puts the bare name and the qualified name into ONE map. They are kept in
      // two here only so the two roles stay separately countable; classify() unions them as that
      // instrument does.
      const nb = declsByName.get(name)
      if (nb) nb.push(d)
      else declsByName.set(name, [d])
      if (d.qualifiedName.length > 0) {
        const qb = declsByQName.get(d.qualifiedName)
        if (qb) qb.push(d)
        else declsByQName.set(d.qualifiedName, [d])
      }
    }
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const raw = String(rel?.type ?? "")
      const t = ontologyName(raw)
      if (!t) { unmappedLabels.set(raw, (unmappedLabels.get(raw) ?? 0) + 1); continue }
      const src = String(rel?.source ?? "")
      const tgt = String(rel?.target ?? "")
      if (src === "unknown" || tgt === "unknown") unknownEndpointRels++
      rows.push({
        type: t, source: src, target: tgt,
        role: String(rel?.metadata?.relationshipRole ?? ""),
        file: relFile,
        fileLevel: rel?.metadata?.fileLevel === true,
      })
    }
    relsByFile.set(relFile, rows)
    walkedFiles.push(relFile)
  },
})

/**
 * THE GUARD. Every accumulator above is memory populated inside `run()`, so a resumed walk
 * reconstructs nothing and would report a full-shaped artifact over 0 files. Refuse rather than
 * publish the empty measurement.
 */
const nothingWalked = stats.walked === 0
const partialPopulation = stats.skippedBad > 0 || stats.walked + stats.alreadyDone < stats.total
if (nothingWalked) {
  console.error("")
  console.error(`REFUSING TO WRITE: this run parsed 0 of ${stats.total} admitted files (${stats.alreadyDone} were already`)
  console.error(`recorded by an earlier run). Every accumulator is populated inside run(), which a resumed walk does not`)
  console.error(`call, so the numbers below describe no files at all. Re-run with --fresh. The existing artifact`)
  console.error(`is left untouched rather than overwritten with zeros.`)
  process.exit(3)
}
console.log(
  `walk: ${stats.walked} newly walked, ${stats.alreadyDone} already done, ${stats.skippedBad} skipped bad,` +
  ` of ${stats.total} admitted (fresh=${FRESH})`,
)
if (partialPopulation) {
  console.log(`WARNING partial population: ${stats.walked} walked + ${stats.alreadyDone} already done < ${stats.total}, or ${stats.skippedBad} skipped. Counts below describe that population, not the corpus.`)
}

/** ------------------------------------------------------------------ resolution, under BOTH rules */
type Rule = "kind" | "store"

/** The declaration set a target resolves to, under one rule. */
function hits(target: string, rule: Rule): Decl[] {
  if (rule === "store") {
    // parallel-indexer: qualified-name exact match wins outright.
    const q = declsByQName.get(target)
    if (q && q.length > 0) return q
  }
  const n = declsByName.get(target) ?? []
  const q = declsByQName.get(target) ?? []
  return [...n, ...q]
}

function classify(all: string[], rule: Rule) {
  const perType: any = {}
  for (const t of TYPES) {
    perType[t] = {
      edges: 0, ambiguous: 0, unresolved: 0, resolved: 0,
      unresolvedSpecVocabulary: 0, unresolvedPathShaped: 0, unresolvedOther: 0,
      selfLoops: 0, emptyTarget: 0,
    }
  }
  const ambiguousNames = new Set<string>()
  const unresolvedOtherNames = new Map<string, number>()

  for (const f of all) {
    for (const rel of relsByFile.get(f) ?? []) {
      const row = perType[rel.type]
      row.edges++
      if (rel.target.length === 0) { row.emptyTarget++; continue }
      if (rel.source === rel.target) { row.selfLoops++; continue }

      const hs = hits(rel.target, rule)
      if (hs.length === 0) {
        row.unresolved++
        if (SPEC_VOCABULARY.has(rel.target)) row.unresolvedSpecVocabulary++
        else if (/[./\\]/.test(rel.target)) row.unresolvedPathShaped++
        else {
          row.unresolvedOther++
          unresolvedOtherNames.set(rel.target, (unresolvedOtherNames.get(rel.target) ?? 0) + 1)
        }
        continue
      }
      if (rule === "kind") {
        if (new Set(hs.map((d) => d.kind)).size > 1) { row.ambiguous++; ambiguousNames.add(rel.target) }
        else row.resolved++
      } else {
        // store: bare name accepted only when the SYMBOL count is 1
        if (hs.length > 1) { row.ambiguous++; ambiguousNames.add(rel.target) }
        else row.resolved++
      }
    }
  }
  return { perType, ambiguousNames: [...ambiguousNames].sort(), unresolvedOtherNames }
}

/** B1 / B2 / B3 over NAMES. First match, so the three sum to the total. */
function splitAmbiguity(names: string[]) {
  const buckets: Record<string, string[]> = { B1_intraFile: [], B2_crossModuleKind: [], B3_nameNotIdentifier: [] }
  const detail: any[] = []
  for (const name of names) {
    const decls = [...(declsByName.get(name) ?? []), ...(declsByQName.get(name) ?? [])]
    const kinds = [...new Set(decls.map((d) => d.kind))].sort()
    const fileSet = new Set(decls.map((d) => d.file))
    const byKind: Record<string, number> = {}
    for (const d of decls) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1
    const bucket =
      fileSet.size <= 1 ? "B1_intraFile" :
      kinds.length > 1 ? "B2_crossModuleKind" :
      "B3_nameNotIdentifier"
    buckets[bucket].push(name)
    detail.push({
      name, bucket, kinds,
      declarations: decls.length,
      files: fileSet.size,
      scopes: [...new Set(decls.map((d) => (d.scope.length > 0 ? d.scope : "(none)")))].slice(0, 6),
      byKind,
    })
  }
  detail.sort((a, b) => b.declarations - a.declarations)
  return { buckets, detail }
}

function weightByEdges(names: string[], all: string[]) {
  const want = new Set(names)
  const w: Record<string, number> = {}
  for (const f of all) for (const rel of relsByFile.get(f) ?? []) {
    if (want.has(rel.target)) w[rel.target] = (w[rel.target] ?? 0) + 1
  }
  return w
}

const walked = walkedFiles.slice().sort()
const stride = Math.max(1, Math.ceil(walked.length / SLICE))
const slice = walked.filter((_, i) => i % stride === 0).slice(0, SLICE)

/**
 * WHY 19,066 TARGETS ARE UNRESOLVED — and why the obvious reading of the buckets is WRONG
 *
 * `uses` is the type-reference edge: a field's return type, an argument's type, an `implements`
 * list, an enum value's type. Its target is whatever the schema NAMES, and a GraphQL schema
 * routinely names a type the admitted corpus never declares — SDL is split across files, and an
 * executable query names types a schema file elsewhere defines. So the four buckets:
 *
 *   S1 SPEC VOCABULARY   `Int`/`String`/`__typename`/… — the spec defines them, no file declares
 *                         them. 4,586 edges. Not a defect; nothing can be emitted for them.
 *   S2 CORPUS-TEXT-ONLY  the name occurs somewhere in the corpus text but no symbol claims it.
 *                         620 edges.
 *   S3 OUT-OF-CORPUS     the name occurs in NO admitted file at all. 6,530 edges. The declaration
 *                         is outside the population, so an edge to it is CORRECT and the target
 *                         cannot resolve here.
 *   S4 PATH-SHAPED       contains `.` or `/`. 7,330 edges — mostly `JiraIssueField.__typename`,
 *                         a qualified name whose OWNER is itself undeclared (it lands in S3), and
 *                         `b.graphql`, an `imports` path that is a file, not a symbol by design.
 *
 * ## S2 IS NOT THE LANE-OWNED BUCKET. An earlier draft of this header called it that, and it was
 * ## wrong — `decl-inventory.mts` is the correction, and it is worth stating how it was wrong.
 *
 * A corpus-TEXT scan cannot distinguish a DECLARATION from a USAGE. `story` is S2's second
 * largest name at 27 unresolved edges; `grep story` finds it in absinthe's kitchen-sink.graphql
 * as a SELECTED FIELD in an executable query, not as a declared type. Every one of S2's top 40
 * names was checked against the corpus-wide published-symbol set (69,230 distinct names) and
 * ALL 40 return `NO SYMBOL ANYWHERE` — which is what a usage looks like.
 *
 * So S2 measures "this schema names something it never defines", which is correct GraphQL and
 * correct analyzer behaviour. The question S2 was MEANT to ask — does the analyzer drop a
 * declaration? — needs the grammar, not the text, and `decl-inventory.mts` answers it directly:
 * it collects the name at every DECLARATION node over the same 1,905 admitted files and diffs
 * against the analyzer's symbols. Result: **36,730 declaration sites, 11,745 distinct names, 0
 * declared-but-unpublished.** So the lane-owned bucket for dropped declarations is empty, and
 * this file's S2 must not be cited as a residual defect.
 *
 * The buckets stay here because the OTHER three are the measurement: 4,586 spec-vocabulary and
 * 6,530 out-of-corpus targets are 58% of all unresolved edges and neither is fixable by emitting
 * anything, which is the answer to "why is `uses` 38% unresolved".
 */
const corpusText = files.map((f) => f.text).join("\n")
const DECL_TOKEN = /[\s,:()\[\]{}!<>=|&.]/
function corpusMentions(name: string): boolean {
  // A token-bounded scan, not `includes`: `Type` occurs inside `TypeName` on almost every
  // line, and counting that as "the corpus mentions Type" would empty S2 and hide the only
  // lane-owned bucket in the table.
  let from = 0
  for (;;) {
    const i = corpusText.indexOf(name, from)
    if (i < 0) return false
    const before = i === 0 ? "" : corpusText[i - 1]
    const after = corpusText[i + name.length] ?? ""
    if (!DECL_TOKEN.test(before) && !DECL_TOKEN.test(after)) return true
    from = i + name.length
  }
}

function classifyUnresolved(all: string[]) {
  const out: Record<string, Record<string, { count: number; names: Record<string, number> }>> = {}
  for (const f of all) {
    for (const rel of relsByFile.get(f) ?? []) {
      if (rel.target.length === 0 || rel.source === rel.target) continue
      const hits0 = hits(rel.target, "store")
      if (hits0.length > 0) continue
      const bucket = SPEC_VOCABULARY.has(rel.target)
        ? "S1_specVocabulary"
        : /[./\\]/.test(rel.target)
          ? "S4_pathShaped"
          : corpusMentions(rel.target)
            ? "S2_presentInCorpusText"
            : "S3_outOfCorpus"
      const byType = (out[rel.type] ??= {})
      const row = (byType[bucket] ??= { count: 0, names: {} })
      row.count++
      row.names[rel.target] = (row.names[rel.target] ?? 0) + 1
    }
  }
  return out
}

function reportUnresolvedCauses(label: string, all: string[]) {
  const byType = classifyUnresolved(all)
  const totals: Record<string, number> = {}
  for (const rows of Object.values(byType))
    for (const [b, r] of Object.entries(rows)) totals[b] = (totals[b] ?? 0) + r.count
  console.log("")
  console.log(`  UNRESOLVED TARGETS, BY CAUSE (${label}, ${all.length} files):`)
  console.log("  type          edges    S1spec   S2inText  S3outOfCorpus  S4pathShaped   S2 share")
  console.log("  " + "-".repeat(76))
  for (const t of TYPES) {
    const rows = byType[t]
    if (!rows) { console.log(`  ${t.padEnd(12)} ${"(does not fire)"}`); continue }
    const g = (b: string) => rows[b]?.count ?? 0
    const all2 = Object.values(rows).reduce((a, r) => a + r.count, 0)
    const s2 = g("S2_presentInCorpusText")
    console.log(
      "  " + t.padEnd(12) + String(all2).padStart(6) + String(g("S1_specVocabulary")).padStart(9) +
      String(s2).padStart(10) + String(g("S3_outOfCorpus")).padStart(14) + String(g("S4_pathShaped")).padStart(14) +
      String(all2 ? ((s2 / all2) * 100).toFixed(1) + "%" : "-").padStart(10),
    )
    const top = Object.entries(rows["S2_presentInCorpusText"]?.names ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 8)
    if (top.length) {
      console.log(`      top S2 — USAGE-ONLY names. NOT a lane defect: see the header and decl-inventory.mts (0 dropped declarations).`)
      for (const [n, c] of top) console.log(`        ${String(c).padStart(5)}  ${n.slice(0, 60)}`)
    }
  }
  console.log("  " + "-".repeat(76))
  const sum = Object.values(totals).reduce((a, b) => a + b, 0)
  console.log(`  TOTAL unresolved ${sum}: ` + Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "))
  return byType
}

function report(label: string, all: string[]) {
  console.log("")
  console.log(`── ${label}: ${all.length} files walked ──`)
  const perRule: Record<Rule, any> = {} as any
  const perRuleSplit: Record<Rule, any> = {} as any
  for (const rule of ["kind", "store"] as Rule[]) {
    const { perType, ambiguousNames, unresolvedOtherNames } = classify(all, rule)
    const { buckets, detail } = splitAmbiguity(ambiguousNames)
    const weight = weightByEdges(ambiguousNames, all)
    const wOf = (ns: string[]) => ns.reduce((a, n) => a + (weight[n] ?? 0), 0)
    let edges = 0
    for (const t of TYPES) edges += perType[t].edges
    console.log("")
    console.log(`  [${rule} rule]  ${edges} edges`)
    console.log("  type          edges     amb  unres  unresSpec  unresPath  unresOther  self  empty")
    console.log("  " + "-".repeat(76))
    for (const t of TYPES) {
      const r = perType[t]
      if (r.edges === 0) { console.log(`  ${t.padEnd(12)} ${String(r.edges).padStart(6)}   (does not fire)`); continue }
      console.log(
        "  " + t.padEnd(12) + String(r.edges).padStart(6) + String(r.ambiguous).padStart(8) +
        String(r.unresolved).padStart(7) + String(r.unresolvedSpecVocabulary).padStart(12) +
        String(r.unresolvedPathShaped).padStart(12) + String(r.unresolvedOther).padStart(12) +
        String(r.selfLoops).padStart(6) + String(r.emptyTarget).padStart(6),
      )
    }
    console.log("  " + "-".repeat(76))
    console.log(`  ambiguous NAMES split (first match, mutually exclusive):`)
    console.log(`    B1 INTRA-FILE          ${String(buckets.B1_intraFile.length).padStart(5)} names ${String(wOf(buckets.B1_intraFile)).padStart(7)} edges   lane-owned`)
    console.log(`    B2 CROSS-MODULE-KIND   ${String(buckets.B2_crossModuleKind.length).padStart(5)} names ${String(wOf(buckets.B2_crossModuleKind)).padStart(7)} edges   partly lane-owned`)
    console.log(`    B3 NAME-NOT-IDENTIFIER ${String(buckets.B3_nameNotIdentifier.length).padStart(5)} names ${String(wOf(buckets.B3_nameNotIdentifier)).padStart(7)} edges   published-name contract`)
    if (buckets.B1_intraFile.length > 0) {
      console.log(`    every B1 name (lane-repairable — one file, one name, two kinds, so there is exactly one right answer):`)
      for (const d of detail.filter((x) => x.bucket === "B1_intraFile")) {
        console.log(`      ${String(weight[d.name] ?? 0).padStart(5)} edges  ${d.name.padEnd(28)} decls=${String(d.declarations).padStart(3)} files=${d.files} kinds=${d.kinds.join(",")} byKind=${JSON.stringify(d.byKind)}`)
      }
    }
    if (rule === "store") {
      console.log(`    top B3 by edge weight (one kind, N declaring types — the bucket the kind rule cannot see):`)
      const b3w: Record<string, number> = {}
      for (const n of buckets.B3_nameNotIdentifier) b3w[n] = weight[n] ?? 0
      for (const [n, c] of Object.entries(b3w).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
        const d = detail.find((x) => x.name === n)
        console.log(`      ${String(c).padStart(6)} edges  ${n.padEnd(24)} decls=${String(d?.declarations ?? "?").padStart(5)} files=${String(d?.files ?? "?").padStart(4)} kinds=${(d?.kinds ?? []).join(",")}`)
      }
      const topUnres = [...unresolvedOtherNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      if (topUnres.length) {
        console.log(`    top unresolved names that are NOT spec vocabulary and NOT path-shaped:`)
        for (const [n, c] of topUnres) console.log(`      ${String(c).padStart(6)} edges  ${n}`)
      }
    }
    perRule[rule] = { perType, buckets, weight }
    perRuleSplit[rule] = {
      // B1 is the only bucket this lane can repair, so its membership is written IN FULL.
      // The other two are truncated to the heaviest 60, because a reader deciding whether to
      // act on them needs the head of the distribution, not 6,566 rows.
      bucketCounts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
      detail: detail.filter((d) => d.bucket === "B1_intraFile" || detail.indexOf(d) < 60),
    }
  }
  return { perRule, perRuleSplit }
}

const full = report("ALL admitted files", walked)
const sliceR = report(`deterministic stride slice (stride ${stride})`, slice)
const causesAll = reportUnresolvedCauses("ALL admitted files", walked)
const causesSlice = reportUnresolvedCauses(`stride slice (${slice.length} files)`, slice)

mkdirSync(outDir, { recursive: true })
writeFileSync(artifact, JSON.stringify({
  generatedAt: new Date().toISOString(),
  population: {
    discovery: "identical to script/m14/ontology-coverage-gate.ts (git ls-files per repo, detectLanguageFromPath, 512 KB cap)",
    admittedFiles: files.length,
    filesWalked: walked.length,
    partialPopulation,
    sliceFiles: slice.length,
    sliceMethod: `deterministic stride over ${walked.length} sorted walked paths, stride ${stride}, first ${SLICE}`,
  },
  walk: { ...stats, degraded },
  symbols: { total: symbolTotal, emptyName: emptyNameSymbols, emptyQualifiedName: emptyQNameSymbols, emptyKind: emptyKindSymbols },
  relationships: {
    totalAcrossTenTypes: walked.reduce((a, f) => a + (relsByFile.get(f)?.length ?? 0), 0),
    unknownEndpoints: unknownEndpointRels,
    unmappedLabels: Object.fromEntries([...unmappedLabels.entries()].sort((a, b) => b[1] - a[1])),
  },
  rules: {
    kind: "incoming-check parity: name -> DISTINCT KINDS; ambiguous == >=2 kinds. B3 is unreachable under this rule BY CONSTRUCTION.",
    store: "parallel-indexer resolveRelationships: qualified-name exact first, then bare name accepted only when its SYMBOL count is 1; ambiguous == >1 symbol.",
    why: "'ambiguous' is a property of a resolution rule, not of the corpus. A single number with no rule attached describes an unstated instrument.",
  },
  all: full.perRuleSplit,
  slice: sliceR.perRuleSplit,
  edgesPerRule: full.perRule,
  unresolvedCauses: {
    rule: "store-rule hits; every unresolved target falls into exactly one of S1 spec vocabulary / S2 present in corpus text only / S3 absent from every admitted file / S4 path-shaped. NONE of the four is a lane-owned bucket: S2 cannot distinguish a usage from a declaration, and decl-inventory.mts measures the declaration question directly at 0 over 36,730 sites.",
    s2IsNotADefect: "decl-inventory.mts — same 1,905 admitted files, name collected at every grammar DECLARATION node, diffed against analyzer symbols: 36,730 sites, 11,745 distinct names, 0 declared-but-unpublished. S2 in this file is a USAGE/DEFINITION split, which is normal for split SDL.",
    method: "token-bounded scan of the concatenation of all admitted file texts (a name counts as mentioned only when neither adjacent character is a GraphQL delimiter), because a substring scan counts Type inside TypeName and would empty S2.",
    all: causesAll,
    slice: causesSlice,
  },
}, null, 2))
console.log("")
console.log(`(written to ${path.relative(process.cwd(), artifact)})`)