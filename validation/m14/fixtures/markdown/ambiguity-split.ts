/**
 * MARKDOWN AMBIGUITY SPLIT — how many ambiguous targets an edge cannot disambiguate,
 * separated from how many the shared harness calls ambiguous for a reason the edge
 * itself already settles.
 *
 * ## Why this file exists rather than a line in the doc
 *
 * `script/m14/incoming-check.ts` is shared machinery (workstream §8), so it is not
 * edited here. It measures `ambiguousTargets`, and it is right about what it says, but
 * it resolves against
 *
 *   const published = new Map<string, string[]>()   // name -> KINDS, file DISCARDED
 *
 * keyed on NAME, accumulating DISTINCT KINDS as the value and dropping the file
 * (incoming-check.ts:107, 176-188). Two consequences, and both inflate this lane:
 *
 *   1. The file is dropped, so a name two SEPARATE DOCUMENTS each declare counts as
 *      ambiguous. Every markdown relationship this analyzer emits is file-local by
 *      construction — `contains` between two headings in one document, `references`
 *      between a link and an anchor in one document, `uses` from a link in one document
 *      to a heading in the SAME document (see the `uses` 0-target-resolution note in
 *      `script/m14/markdown-ruled.ts`: its targets are link destinations, published by
 *      another file, and `imports` targets are file paths). The edge carries its own
 *      file, so for those edges the file already decides it and the collision is not a
 *      finding about this analyzer.
 *   2. Kinds are the value, so "ambiguous" actually means "this name is published with
 *      more than one DISTINCT KIND", which is a much narrower and stranger thing than
 *      "more than one symbol carries this name". A name published 40 times as `type` in
 *      40 documents reads UNAMBIGUOUS to that map.
 *
 * `validation/m14/measurements/incoming-whole.tsv` records this lane at
 * `markdown  600  4  68  15107` — 68 ambiguous, 15,107 unresolved. Both numbers are
 * reproduced here under the same definition so the two are comparable, and then split.
 *
 * ## The three buckets the round brief asks for
 *
 *   (a) N declarations share a name in the edge's OWN FILE          scopeCollisionSameFile
 *   (b) the name is published in OTHER files and the analyzer does not model which is
 *       in scope                                                  crossFileNoScopeModel
 *   (c) two DISTINCT symbols legitimately share a published name   sharedPublishedName
 *
 * Only (a) and (b) are repairable inside this analyzer. (c) is a fact about the
 * published-name contract, and this analyzer already carries the unique spelling:
 *
 *   src/ast/real-markdown-analyzer.ts:281-284
 *     name: target,            // the RESOLVED spelling — bare text, or `Text#n`
 *     qualifiedName: id,       // `Parent.Child`, `#n`-suffixed — unique per site
 *
 * so the identity exists and is published; it is not on the ENDPOINT of the edge. Which
 * is why this instrument also reports `disambiguatedBySource`: for an edge whose target
 * name is shared inside one file, how many of those are decided by the edge's own
 * SOURCE, i.e. `(source, target)` is unique even though `target` alone is not.
 *
 * ## The sample, stated
 *
 * The admitted population is rebuilt with the census's own rule
 * (`validation/m14/fixtures/markdown/whole-corpus-census.ts`): `git ls-files` per repo,
 * size <= 512 KB, `detectLanguageFromPath(abs, text) === "markdown"`, sorted by
 * (repo, rel) ascending, then the first `LIMIT`. That ordering is the census's, so this
 * sample is a PREFIX of the population the whole-corpus census walked rather than an
 * independent draw — stated here because a prefix is not a random sample and inherits
 * the census's repo-name ordering bias.
 *
 * ## The limit of this instrument, stated
 *
 * It resolves by NAME, like every instrument in this lane, so a name that a THIRD file
 * declares and that no indexed file declares is `unresolved` — which conflates "outside
 * this 600-file index" with "nowhere in the corpus". The brief is explicit that an
 * unresolved target naming a file outside the window is not a defect, so this file
 * BOUNDS the unresolved column and does not call it a defect.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/markdown/ambiguity-split.ts [out.json]
 *   BB_MARKDOWN_AMBIGUITY_FILES=600 npx tsx .../ambiguity-split.ts [out.json]
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { resumableWalk } from "../../../../script/m14/resumable-walk"

const ANALYZER = path.resolve(
  (import.meta as any).dirname ?? ".",
  "../../../../src/ast/real-markdown-analyzer.ts",
)
const analyzerHash = (): string => createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
const HASH_BEFORE = analyzerHash()

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const OUT = argv.find((a) => a.endsWith(".json")) ?? null
const LIMIT = Number(process.env.BB_MARKDOWN_AMBIGUITY_FILES ?? 600)
const CHECKPOINT =
  process.env.BB_MARKDOWN_AMBIGUITY_CHECKPOINT ??
  path.resolve((import.meta as any).dirname ?? ".", "../../../m14/measurements/walk-markdown-ambiguity-600.txt")

const ALL_TYPES = [
  "calls",
  "uses",
  "contains",
  "imports",
  "references",
  "exports",
  "extends",
  "implements",
  "overrides",
  "instantiates",
] as const
type T = (typeof ALL_TYPES)[number]

/** Store label -> ontology name. Both `imports` spellings, as `incoming-check.ts` does. */
const LABEL_ALIASES: Record<string, string> = {
  calls: "calls",
  call: "calls",
  uses: "uses",
  contains: "contains",
  composition: "contains",
  part_of: "contains",
  imports: "imports",
  brain_import: "imports",
  references: "references",
  depends_on: "references",
  related: "references",
  exports: "exports",
  provides: "exports",
  extends: "extends",
  inheritance: "extends",
  implements: "implements",
  implementation: "implements",
  overrides: "overrides",
  override: "overrides",
  instantiates: "instantiates",
}
const ontologyName = (raw: string): T | null =>
  (LABEL_ALIASES[raw] as T | undefined) ?? null

// ───────────────────────────────────────────── the file set
const files: { abs: string; dir: string; rel: string; repo: string }[] = []
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
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
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
    if (detectLanguageFromPath(abs, text) !== "markdown") continue
    files.push({ abs, dir, rel, repo: e })
  }
}
// The census's own ordering. Stated in the header: this makes the sample a PREFIX of
// the whole-corpus population, not an independent draw.
files.sort((a, b) => (a.repo === b.repo ? (a.rel < b.rel ? -1 : 1) : a.repo < b.repo ? -1 : 1))
const populationSha256 = createHash("sha256")
  .update(files.map((f) => `${f.repo}/${f.rel}`).join("\n"))
  .digest("hex")

/**
 * Two orderings, because "which 600" turned out to change the answer by an order of
 * magnitude and a split measured on one of them is a fact about that one.
 *
 *   prefix  the first LIMIT of the census order. This is a PREFIX of the whole-corpus
 *           population, so it inherits the census's repo-name ordering bias: sorted by
 *           repo name it front-loads Aporia..Exposed, which is Julia/F#/Documenter
 *           documentation — heading-heavy documents with a small, repeated heading
 *           vocabulary. It is the comparable sample, because the census walked this
 *           order.
 *   spread  every floor(i * N / LIMIT)-th file of the same sorted population, so the
 *           sample spans all 196 repos. Not a random sample, and not independent of
 *           the ordering either — it is the same order with the head removed.
 */
const ORDER = process.env.BB_MARKDOWN_AMBIGUITY_ORDER ?? "prefix"
const sample: typeof files =
  ORDER === "spread"
    ? Array.from({ length: Math.min(LIMIT, files.length) }, (_, k) =>
        files[Math.min(files.length - 1, Math.floor((k * files.length) / LIMIT))],
      ).filter((f, i, a) => i === 0 || f.abs !== a[i - 1].abs)
    : files.slice(0, LIMIT)

// ───────────────────────────────────────────── the index
/** name -> file -> DISTINCT kinds. The file dimension is the point of this file. */
const published = new Map<string, Map<string, Set<string>>>()
/** name -> DISTINCT kinds, file discarded: `incoming-check.ts`'s exact definition. */
const kindOnly = new Map<string, Set<string>>()
/** One row per symbol, so the split can be recomputed from evidence, not from a tally. */
interface Decl {
  name: string
  id: string
  kind: string
  file: string
  line: number
}
const decls: Decl[] = []

const publish = (name: string, kind: string, file: string): void => {
  if (name.length === 0) return
  let byFile = published.get(name)
  if (!byFile) {
    byFile = new Map()
    published.set(name, byFile)
  }
  let kinds = byFile.get(file)
  if (!kinds) {
    kinds = new Set()
    byFile.set(file, kinds)
  }
  kinds.add(kind)
  let ko = kindOnly.get(name)
  if (!ko) {
    ko = new Set()
    kindOnly.set(name, ko)
  }
  ko.add(kind)
}

interface Edge {
  type: T
  source: string
  target: string
  file: string
  line: number
}
const edges: Edge[] = []
let symbols = 0
let degraded = 0
let parseFailures = 0
const parseFailureExamples: string[] = []

/** (source, target) pairs per file — the qualification test. */
const pairSeen = new Set<string>()

const stats = await resumableWalk(CHECKPOINT, sample.length, {
  id: (i) => sample[i].abs,
  concurrency: 4,
  run: async (i) => {
    const f = sample[i]
    const label = `${f.repo}/${f.rel}`
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch (e) {
      parseFailures++
      if (parseFailureExamples.length < 12) parseFailureExamples.push(`${label}: ${(e as Error)?.message ?? e}`)
      throw e
    }
    if (!r) {
      parseFailures++
      if (parseFailureExamples.length < 12) parseFailureExamples.push(`${label}: no result`)
      throw new Error("no result")
    }
    if (r.fallback === true) degraded++
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      symbols++
      const name = String(s?.name ?? "")
      const kind = String(s?.kind ?? "")
      const q = String(s?.qualifiedName ?? "")
      publish(name, kind, label)
      if (q.length > 0 && q !== name) publish(q, kind, label)
      if (name.length > 0) {
        // The pipeline FLATTENS the analyzer's `range` into `startLine`/`endLine` and
        // DROPS `id` (measured on Aporia/readme.markdown through production parseFile:
        // 22 symbols, 0 with `range`, 0 with `id`, 22 with `startLine`, and
        // `qualifiedName` retained). So `range.startLine` reads 0 here and the
        // `line_number` closure rule below closed nothing until this was corrected —
        // the same class of error as the `line`/`line_number` key above: a probe that
        // cannot see a field reports the field as absent.
        decls.push({
          name,
          id: q.length > 0 ? q : name,
          kind,
          file: label,
          line: Number(s?.startLine ?? (s?.range as any)?.startLine ?? 0),
        })
      }
    }
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const t = ontologyName(String(rel?.type ?? rel?.relationshipType ?? ""))
      if (!t) continue
      const src = String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? "")
      const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
      // `line_number` is the field the analyzer publishes (real-markdown-analyzer.ts:164).
      // This line read `line` and `lineNumber`, which no relationship carries, so every
      // edge's line read 0 and the `line_number` closure rule below closed nothing on
      // the first run of this section. The number was a property of the PROBE.
      // Verified against production output: 38 of 38 relationships on
      // Aporia/readme.markdown carry `line_number`.
      const line = Number(rel?.line_number ?? rel?.line ?? rel?.lineNumber ?? 0)
      edges.push({ type: t, source: src, target: tgt, file: label, line })
      if (tgt.length > 0) pairSeen.add(`${label} ${src} ${tgt}`)
    }
  },
})

// ───────────────────────────────────────────── classify every target
type Bucket = "unique" | "sameFileMultiple" | "crossFileOnly" | "unresolved"
const row = (): Record<Bucket, number> => ({
  unique: 0,
  sameFileMultiple: 0,
  crossFileOnly: 0,
  unresolved: 0,
})
const perType: Record<string, Record<Bucket, number>> = {}
for (const t of ALL_TYPES) perType[t] = row()

/** The brief's taxonomy. Only the first two are repairable in this analyzer. */
type AmbiguityKind = "none" | "a_scopeCollisionSameFile" | "b_crossFileNoScopeModel" | "c_sharedPublishedName"
const ambRow = (): Record<AmbiguityKind, number> => ({
  none: 0,
  a_scopeCollisionSameFile: 0,
  b_crossFileNoScopeModel: 0,
  c_sharedPublishedName: 0,
})
const perTypeAmb: Record<string, Record<AmbiguityKind, number>> = {}
for (const t of ALL_TYPES) perTypeAmb[t] = ambRow()

/**
 * `incoming-check.ts`'s definition, recomputed here so the two numbers are comparable:
 * the target name is published with more than one DISTINCT KIND.
 */
let sharedInstrumentAmbiguous = 0
let sharedInstrumentDistinct = 0

/** Of the same-file collisions, how many are decided by the edge's own SOURCE. */
let disambiguatedBySource = 0
let sourcePairsUniqueAmongCollisions = 0

const unresolvedNames = new Map<string, number>()
const collisionNames = new Map<string, { edges: number; files: number; kinds: number }>()
/** Bucket (a) in full: the target name, and how this file spells each declaration. */
const sameFileNames = new Map<
  string,
  { edges: number; types: Set<string>; samples: string[] }
>()

for (const e of edges) {
  const t = e.type
  if (!perType[t]) {
    perType[t] = row()
    perTypeAmb[t] = ambRow()
  }
  if (e.target.length === 0) continue

  const ko = kindOnly.get(e.target)
  if (!ko || ko.size === 0) {
    perType[t].unresolved++
    unresolvedNames.set(e.target, (unresolvedNames.get(e.target) ?? 0) + 1)
    continue
  }
  sharedInstrumentDistinct++
  if (ko.size > 1) sharedInstrumentAmbiguous++

  const byFile = published.get(e.target)!
  const files = byFile.size
  const totalKinds = new Set<string>()
  for (const s of byFile.values()) for (const k of s) totalKinds.add(k)
  const here = byFile.get(e.file)
  const hereKinds = here ? here.size : 0

  // The pair test, run BEFORE the buckets decide it: if this file already published
  // exactly one `(source, target)` pair for this target name, the edge is decided.
  const pairKey = `${e.file} ${e.source} ${e.target}`

  if (hereKinds > 1) {
    perType[t].sameFileMultiple++
    perTypeAmb[t].a_scopeCollisionSameFile++
    // Is it decided by the source? An edge's SOURCE is the parent's PUBLISHED NAME
    // (real-markdown-analyzer.ts:319 passes `owner`, which is the resolved spelling,
    // not `ownerId`), and a child's identity is `${parentId}.${name}` with an
    // optional `#n` site suffix. So the test is: find the parent this source names in
    // this file, then ask how many of its children publish this target name.
    const parentIds = decls
      .filter((d) => d.file === e.file && (d.name === e.source || d.id === e.source))
      .map((d) => d.id)
    let candidates = 0
    for (const pid of parentIds) {
      candidates += decls.filter(
        (d) =>
          d.file === e.file &&
          d.name === e.target &&
          (d.id === `${pid}.${e.target}` || d.id.startsWith(`${pid}.${e.target}#`)),
      ).length
    }
    if (parentIds.length > 0 && candidates === 1) {
      disambiguatedBySource++
      sourcePairsUniqueAmongCollisions++
    }
    const key = `${e.target}`
    const sc = sameFileNames.get(key) ?? { edges: 0, types: new Set<string>(), samples: [] as string[] }
    sc.edges++
    sc.types.add(t)
    if (sc.samples.length < 3) {
      const here0 = published.get(e.target)?.get(e.file)
      const ids = decls
        .filter((d) => d.file === e.file && d.name === e.target)
        .slice(0, 4)
        .map((d) => d.id)
      sc.samples.push(`${e.file} :: ${e.source} -> ${e.target} :: declared here as [${ids.join(", ")}] kinds=[${[...(here0 ?? [])].join(",")}]`)
    }
    sameFileNames.set(key, sc)
    void pairKey
  } else if (files > 1) {
    perType[t].crossFileOnly++
    if (hereKinds === 1) {
      // The edge's own file declares it exactly once — the file decides which one.
      perTypeAmb[t].c_sharedPublishedName++
    } else {
      // Nothing in the edge's own file: the analyzer would need a scope model to know
      // which of the other files is in scope. That IS a modelling gap.
      perTypeAmb[t].b_crossFileNoScopeModel++
    }
  } else {
    perType[t].unique++
    perTypeAmb[t].none++
  }

  const c = collisionNames.get(e.target) ?? { edges: 0, files: 0, kinds: 0 }
  c.edges++
  c.files = files
  c.kinds = totalKinds.size
  collisionNames.set(e.target, c)
}

// ───────────────────────────────────────────── what the STORE actually looks up
//
// The three buckets above all resolve the way `incoming-check.ts` resolves: by the
// string the ANALYZER spelled. The production store does not. Before it matches a target
// it runs `extractLeaf` on it (`src/ast/parallel-indexer.ts:3377-3391`, called at
// :3393 and handed to `resolveContainsTargetStmt` / `resolveTargetStmt` at :3498-3501),
// which strips a `:line`, strips an elixir `/arity`, splits on `:` and takes the last
// segment, then splits THAT on `.` and takes the last segment.
//
// This analyzer publishes a DOTTED name for every fenced code block — `code_block.scala`,
// `code_block.jldoctest` (`real-markdown-analyzer.ts:445`) — so for those edges the
// string the store searches for is `scala` or `jldoctest`, a bare language token that no
// markdown file declares as a symbol. That is a claim about resolution, so it is
// measured here against the same 600-file index rather than asserted from the source.
//
// The leaf function below is a VERBATIM copy of the production one, regexes and all,
// because a re-implementation would not be the rule the store applies. The 0-regex
// property is pinned on the ANALYZER (`src/ast/real-markdown-analyzer.ts:104-106`),
// not on this harness.
const extractLeaf = (name: string): string => {
  const noLine = name.replace(/:\d+$/, "")
  const noArity = noLine.replace(/\/\d+$/, "")
  const byColon = noArity.split(":")
  const lastColon = byColon[byColon.length - 1]
  const byDot = lastColon.split(".")
  return byDot[byDot.length - 1]
}

type LeafRow = {
  edges: number
  targetNamesASymbolInThisFile: number
  leafEqualsTarget: number
  leafNamesASymbolInThisFile: number
  leafNamesASymbolAnyFile: number
  leafIsAWrongKindOfThing: number
}
const leafRow = (): LeafRow => ({
  edges: 0,
  targetNamesASymbolInThisFile: 0,
  leafEqualsTarget: 0,
  leafNamesASymbolInThisFile: 0,
  leafNamesASymbolAnyFile: 0,
  leafIsAWrongKindOfThing: 0,
})
const perTypeLeaf: Record<string, LeafRow> = {}
for (const t of ALL_TYPES) perTypeLeaf[t] = leafRow()
const leafTotals = leafRow()

/** `<target> -> <leaf>` for the targets the store rewrites, with the files involved. */
const leafPairs = new Map<string, { edges: number; leafHits: number; examples: string[] }>()

/**
 * The counterfactual for the ONE naming change this lane could make: publish the code
 * block as `code_block` and carry the language in `metadata.language`, where it already
 * is (`real-markdown-analyzer.ts:470`). For each dotted target of that shape, does the
 * edge's own file publish the de-infixed name? This is not a proposal's success figure —
 * it is the population the proposal would have to serve.
 */
let codeBlockEdges = 0
let codeBlockFileDeclaresBareCodeBlock = 0
let codeBlockFileDeclaresNothingCalledCodeBlock = 0
const codeBlockFileExamples: string[] = []

for (const e of edges) {
  if (e.target.length === 0) continue
  const byFile = published.get(e.target)
  if (!byFile || byFile.size === 0) continue // unresolved: no name to look up at all
  const leaf = extractLeaf(e.target)
  const r = perTypeLeaf[e.type] ?? (perTypeLeaf[e.type] = leafRow())
  r.edges++
  leafTotals.edges++
  if (byFile.has(e.file)) {
    r.targetNamesASymbolInThisFile++
    leafTotals.targetNamesASymbolInThisFile++
  }
  if (leaf === e.target) {
    r.leafEqualsTarget++
    leafTotals.leafEqualsTarget++
  }
  const leafHere = published.get(leaf)?.has(e.file) ?? false
  const leafAnywhere = published.has(leaf)
  if (leafHere) {
    r.leafNamesASymbolInThisFile++
    leafTotals.leafNamesASymbolInThisFile++
  }
  if (leafAnywhere) {
    r.leafNamesASymbolAnyFile++
    leafTotals.leafNamesASymbolAnyFile++
  }
  if (leaf !== e.target) {
    if (leafHere) {
      r.leafIsAWrongKindOfThing++
      leafTotals.leafIsAWrongKindOfThing++
    }
    const p = leafPairs.get(e.target) ?? { edges: 0, leafHits: 0, examples: [] }
    p.edges++
    if (leafHere) p.leafHits++
    if (p.examples.length < 2) p.examples.push(`${e.file} :: ${e.source} -> ${e.target}`)
    leafPairs.set(e.target, p)
  }
  if (e.target.startsWith("code_block.")) {
    codeBlockEdges++
    const bare = published.get("code_block")
    if (!bare) {
      codeBlockFileDeclaresNothingCalledCodeBlock++
      if (codeBlockFileExamples.length < 6)
        codeBlockFileExamples.push(`${e.file} :: ${e.target} :: this file publishes no 'code_block' at all`)
    } else if (bare.has(e.file)) {
      codeBlockFileDeclaresBareCodeBlock++
      if (codeBlockFileExamples.length < 6)
        codeBlockFileExamples.push(`${e.file} :: ${e.target} :: this file publishes 'code_block'`)
    } else if (codeBlockFileExamples.length < 6) {
      codeBlockFileExamples.push(
        `${e.file} :: ${e.target} :: 'code_block' exists in the index but NOT in this file`,
      )
    }
  }
}

// ───────────────────────────────────────────── what the STORE resolves, stage by stage
//
// The three buckets above all resolve the way `incoming-check.ts` resolves: by the string
// the ANALYZER spelled. The production store does not, and nothing in this lane's
// measurement set had asked what it does instead. It matters because `target_symbol_id`
// is the ONLY thing the reverse walk reads (`src/lsp/impact.ts:529-539`,
// `src/lsp/relations.ts:130-134`, `src/lsp/navigation.ts:440-453` all join on
// `r.target_symbol_id`, never on a name), so an edge the store cannot bind is an edge no
// consumer can walk back along.
//
// The store's resolution, in the order it runs, all of it name-driven:
//
//   INSERT TIME   src/ast/parallel-indexer.ts:3498-3502 — the target goes through
//                 `extractLeaf` (:3377-3391) FIRST, then
//                   `resolveContainsTargetStmt` (:2354-2360) when the type is `contains`
//                     and the edge carries a line:
//                       WHERE s.name = ? ORDER BY (s.file_id = ?) DESC, (s.line_start = ?) DESC,
//                                            COALESCE(s.is_declaration,0) ASC, (f.language=?) DESC, s.id
//                   `resolveTargetStmt` (:2239-2245) otherwise:
//                       WHERE s.name = ? ORDER BY COALESCE(s.is_declaration,0) ASC,
//                                            (s.file_id = ?) DESC, (f.language=?) DESC, s.id
//                 LIMIT 1. A `contains` edge is deliberately resolved with the LINE it
//                 carries, because a containment names a point inside its container and
//                 that is the only anchor that picks one of several same-named members
//                 (:3395-3417, the #612 rule).
//   POST-INDEX    only for rows still NULL, except I13 which overwrites non-`contains`:
//                 strategy 1  target_external == qualified_name           (:3976-4005)
//                 strategy 3  target_external == name AND name unique      (:4008-4020)
//                 strategy 4  dotted target -> leaf name, MIN(id)          (:3822-3833)
//                 I13          bare names only (no `.`, no `:`), non-contains (:4127-4146)
//
// This is a SIMULATION of those rules over this 600-file index, not the store. It cannot
// see `is_declaration` (nothing in the analyzer sets it), the project-wide tables the
// post-index passes read, or scheduling. What it can answer exactly is the question that
// decides this round: for how many of this lane's edges does the store search a string
// that any symbol in this index actually carries?
type StageRow = { resolved: number; unresolved: number }
const stageRow = (): StageRow => ({ resolved: 0, unresolved: 0 })
const stageInsert: Record<string, StageRow> = {}
const stageAfterPost: Record<string, StageRow> = {}
for (const t of ALL_TYPES) {
  stageInsert[t] = stageRow()
  stageAfterPost[t] = stageRow()
}
const stageTotals = { insertResolved: 0, insertUnresolved: 0, afterResolved: 0, afterUnresolved: 0 }

/** name -> declarations, so the simulated ORDER BY has something to rank. */
const byName = new Map<string, Decl[]>()
for (const d of decls) {
  const a = byName.get(d.name)
  if (a) a.push(d)
  else byName.set(d.name, [d])
}
/** qualifiedName -> declaration, for strategy 1. */
const byQName = new Map<string, Decl[]>()
for (const d of decls) {
  const a = byQName.get(d.id)
  if (a) a.push(d)
  else byQName.set(d.id, [d])
}

/** Which of the store's stages would bind this edge, and to what. */
const simulateStore = (e: Edge): { stage: string; to?: Decl } => {
  const leaf = extractLeaf(e.target)
  // INSERT TIME — name match on the leaf, then the type's ORDER BY.
  const cands = byName.get(leaf) ?? []
  if (cands.length > 0) {
    const ranked = [...cands].sort((a, b) => {
      if (e.type === "contains" && e.line > 0) {
        // (s.file_id = ?) DESC, then (s.line_start = ?) DESC
        const sa = a.file === e.file ? 0 : 1
        const sb = b.file === e.file ? 0 : 1
        if (sa !== sb) return sa - sb
        return Math.abs(a.line - e.line) - Math.abs(b.line - e.line)
      }
      // COALESCE(is_declaration,0) ASC — nothing sets it, so 0 everywhere — then
      // (s.file_id = ?) DESC, then id. `id` is not reproduced here, so the winner among
      // equally-ranked candidates is the first declared, which is STATED rather than
      // claimed to be what SQLite returns.
      const sa = a.file === e.file ? 0 : 1
      const sb = b.file === e.file ? 0 : 1
      return sa - sb
    })
    return { stage: "insert-time", to: ranked[0] }
  }
  // POST-INDEX, only for rows insert time left NULL.
  if (byQName.has(e.target)) return { stage: "post-strategy1-qualifiedName", to: byQName.get(e.target)![0] }
  const byNameHere = byName.get(e.target)
  if (byNameHere && byNameHere.length === 1)
    return { stage: "post-strategy3-uniqueName", to: byNameHere[0] }
  const dottedLeaf = byName.get(leaf)
  if (e.target.includes(".") && dottedLeaf && dottedLeaf.length > 0)
    return { stage: "post-strategy4-dottedLeaf", to: dottedLeaf[0] }
  return { stage: "none" }
}

const storeStageTally = new Map<string, number>()
const storeStageByType: Record<string, Record<string, number>> = {}
/** Edges the store would bind to a symbol that is NOT what the edge is about. */
const storeMisbindings: string[] = []

for (const e of edges) {
  if (e.target.length === 0) continue
  const verdict = simulateStore(e)
  const key = `${e.type}|${verdict.stage}`
  const t = storeStageByType[e.type] ?? (storeStageByType[e.type] = {})
  t[verdict.stage] = (t[verdict.stage] ?? 0) + 1
  storeStageTally.set(verdict.stage, (storeStageTally.get(verdict.stage) ?? 0) + 1)
  const si = stageInsert[e.type] ?? (stageInsert[e.type] = stageRow())
  const sa = stageAfterPost[e.type] ?? (stageAfterPost[e.type] = stageRow())
  if (verdict.stage === "insert-time") {
    si.resolved++
    sa.resolved++
    stageTotals.insertResolved++
    stageTotals.afterResolved++
    // The store binds by NAME, so a target it rewrote onto some other declaration is a
    // mis-binding, not a resolution. Counted, not narrated.
    if (extractLeaf(e.target) !== e.target && verdict.to && verdict.to.name !== e.target) {
      storeMisbindings.push(
        `${e.file} :: ${e.source} -[${e.type}]-> ${e.target} :: store searched ${extractLeaf(e.target)} and bound ${verdict.to.name} (${verdict.to.file})`,
      )
    }
  } else {
    si.unresolved++
    stageTotals.insertUnresolved++
    if (verdict.stage === "none") {
      sa.unresolved++
      stageTotals.afterUnresolved++
    } else {
      sa.resolved++
      stageTotals.afterResolved++
    }
  }
}

// ───────────────────────────────────────────── report
//
// `resumableWalk` records only WHICH paths it walked; the tallies below are accumulated
// in this process by `run`. So a resumed run — every path already in the checkpoint —
// walks 0 files and would print a table of ZEROS over 600 admitted files. That is the
// `docs/M14-HONESTY-CONTRACT.md` failure the whole programme is built against: "an empty
// result over a non-empty corpus is a failed check, not a pass", and it is invisible
// because every column is formatted identically whether it holds 4,531 or 0.
//
// Observed here, not theorised: a re-run with the checkpoint from the previous session
// printed `600 file(s), 0 symbols, 0 edges` and exited 0. The checkpoint is for killing
// a poison file, not for resuming a tally — resuming needs a fresh path.
//
// So this refuses rather than reporting. A re-run that would print zeros is an error,
// and the fix is a fresh BB_MARKDOWN_AMBIGUITY_CHECKPOINT, not a reading of the zeros.
if (sample.length > 0 && stats.walked === 0) {
  console.error(
    `refusing to report: 0 of ${stats.total} file(s) walked (every path is already in ${CHECKPOINT}).\n` +
      `  The tallies live in this process, so a fully-resumed walk has nothing to tally.\n` +
      `  Re-run with a fresh checkpoint, e.g.\n` +
      `    BB_MARKDOWN_AMBIGUITY_CHECKPOINT=<new path> ${process.argv.slice(1).join(" ")}`,
  )
  process.exit(2)
}

const pad = (s: string, n: number): string => String(s).padEnd(n)
const rpad = (s: string | number, n: number): string => String(s).padStart(n)
const pct = (a: number, b: number): string => (b === 0 ? "-" : `${((100 * a) / b).toFixed(1)}%`)

console.log(`markdown ambiguity split — order=${ORDER} ${sample.length} file(s), ${symbols} symbols, ${edges.length} edges`)
console.log(`analyzer : ${path.relative(process.cwd(), ANALYZER)} sha256:${HASH_BEFORE.slice(0, 16)}`)
console.log(`population: ${files.length} admitted files, populationSha256 ${populationSha256.slice(0, 16)}`)
console.log(`walk     : total=${stats.total} alreadyDone=${stats.alreadyDone} walked=${stats.walked} skippedBad=${stats.skippedBad} partial=${stats.partial}`)
console.log(`degraded parses: ${degraded}   parse failures: ${parseFailures}`)
console.log(`distinct published names: ${published.size}`)
console.log("")
console.log(
  `${pad("type", 14)}${rpad("edges", 9)}${rpad("unique", 9)}${rpad("sameFile", 10)}${rpad("crossFile", 11)}${rpad("unresolved", 12)}`,
)
console.log("-".repeat(65))
let tEdges = 0
let tUniq = 0
let tSame = 0
let tCross = 0
let tUnres = 0
for (const t of ALL_TYPES) {
  const r = perType[t]
  const n = r.unique + r.sameFileMultiple + r.crossFileOnly + r.unresolved
  tEdges += n
  tUniq += r.unique
  tSame += r.sameFileMultiple
  tCross += r.crossFileOnly
  tUnres += r.unresolved
  console.log(
    `${pad(t, 14)}${rpad(n, 9)}${rpad(r.unique, 9)}${rpad(r.sameFileMultiple, 10)}${rpad(r.crossFileOnly, 11)}${rpad(r.unresolved, 12)}`,
  )
}
console.log("-".repeat(65))
console.log(`${pad("TOTAL", 14)}${rpad(tEdges, 9)}${rpad(tUniq, 9)}${rpad(tSame, 10)}${rpad(tCross, 11)}${rpad(tUnres, 12)}`)
console.log("")
console.log(`shared-harness reproduction (name -> >1 DISTINCT KIND, file discarded):`)
console.log(`  ambiguous ${sharedInstrumentAmbiguous} of ${sharedInstrumentDistinct} resolvable targets`)
console.log(`  incoming-whole.tsv recorded 68 for this lane at 600 files; the two definitions differ, so`)
console.log(`  the comparison is stated rather than asserted to match.`)
console.log("")
console.log(`THE BRIEF'S THREE BUCKETS, over every target that resolves at least once:`)
const ambTotal = tEdges - tUnres
console.log(`${pad("bucket", 30)}${rpad("edges", 9)}   ${pad("repairable here", 16)}meaning`)
console.log("-".repeat(96))
const aTot = Object.values(perTypeAmb).reduce((n, r) => n + r.a_scopeCollisionSameFile, 0)
const bTot = Object.values(perTypeAmb).reduce((n, r) => n + r.b_crossFileNoScopeModel, 0)
const cTot = Object.values(perTypeAmb).reduce((n, r) => n + r.c_sharedPublishedName, 0)
console.log(`${pad("(a) same-file collision", 30)}${rpad(aTot, 9)}   ${pad("yes", 16)}N declarations share the name in the edge's OWN file`)
console.log(`${pad("(b) cross-file, no scope", 30)}${rpad(bTot, 9)}   ${pad("yes", 16)}name lives in other files; which is in scope is unmodelled`)
console.log(`${pad("(c) shared published name", 30)}${rpad(cTot, 9)}   ${pad("no", 16)}edge's own file declares it once; the file decides`)
console.log("-".repeat(96))
console.log(`${pad("TOTAL resolving", 30)}${rpad(ambTotal, 9)}   of ${tEdges} edges`)
console.log("")
console.log(`(a) decided by the edge's own SOURCE: ${disambiguatedBySource} of ${aTot}.`)
console.log(`    "decided" = the edge's source names a parent in this file, and exactly one of that`)
console.log(`    parent's children publishes the target name, so (source,target) is unique although`)
console.log(`    target alone is not.`)
console.log("")
const topSame = [...sameFileNames.entries()].sort((a, b) => b[1].edges - a[1].edges)
console.log(`BUCKET (a) IN FULL — ${topSame.length} distinct target names over ${aTot} edges:`)
for (const [n, v] of topSame.slice(0, 14)) {
  console.log(`  ${pad(n, 34)} edges=${String(v.edges).padStart(5)}  types=${[...v.types].join(",")}`)
}
for (const [n, v] of topSame.slice(0, 6)) {
  for (const s of v.samples) console.log(`      ${s}`)
}
console.log("")
const topColl = [...collisionNames.entries()]
  .filter(([, v]) => v.files > 1)
  .sort((a, b) => b[1].edges - a[1].edges)
  .slice(0, 12)
if (topColl.length) {
  console.log(`most frequent target names published in >1 file (the cross-file collision set):`)
  for (const [n, v] of topColl) console.log(`  ${pad(n, 40)} edges=${v.edges} files=${v.files} kinds=${v.kinds}`)
}
console.log("")
console.log(`WHAT THE STORE ACTUALLY LOOKS UP — extractLeaf (parallel-indexer.ts:3377-3391) on every`)
console.log(`target that resolves at least once. A target the store REWRITES is one it cannot find by`)
console.log(`the string the analyzer published.`)
console.log(
  `${pad("type", 14)}${rpad("edges", 9)}${rpad("targetHere", 12)}${rpad("leaf==tgt", 11)}${rpad("leafHere", 11)}${rpad("leafAny", 10)}${rpad("WRONG", 8)}`,
)
console.log("-".repeat(76))
for (const t of ALL_TYPES) {
  const r = perTypeLeaf[t]
  if (r.edges === 0) continue
  console.log(
    `${pad(t, 14)}${rpad(r.edges, 9)}${rpad(r.targetNamesASymbolInThisFile, 12)}${rpad(r.leafEqualsTarget, 11)}${rpad(r.leafNamesASymbolInThisFile, 11)}${rpad(r.leafNamesASymbolAnyFile, 10)}${rpad(r.leafIsAWrongKindOfThing, 8)}`,
  )
}
console.log("-".repeat(76))
console.log(
  `${pad("TOTAL", 14)}${rpad(leafTotals.edges, 9)}${rpad(leafTotals.targetNamesASymbolInThisFile, 12)}${rpad(leafTotals.leafEqualsTarget, 11)}${rpad(leafTotals.leafNamesASymbolInThisFile, 11)}${rpad(leafTotals.leafNamesASymbolAnyFile, 10)}${rpad(leafTotals.leafIsAWrongKindOfThing, 8)}`,
)
console.log(`  targetHere  = the analyzer's own spelling names a symbol in the edge's OWN file`)
console.log(`  leaf==tgt   = extractLeaf is the identity on this target, so the store searches what was published`)
console.log(`  leafHere    = the REWRITTEN string names a symbol in the edge's own file`)
console.log(`  WRONG       = ... and that symbol is NOT the one the edge is about (target was rewritten)`)
console.log("")
const topLeaf = [...leafPairs.entries()].sort((a, b) => b[1].edges - a[1].edges).slice(0, 14)
if (topLeaf.length) {
  console.log(`targets the store REWRITES, most frequent first (leaf -> leafHitsInThisFile/edges):`)
  for (const [tgt, v] of topLeaf)
    console.log(`  ${pad(tgt, 40)} edges=${String(v.edges).padStart(5)}  leafHitsHere=${v.leafHits}`)
  console.log("")
  console.log(`COUNTERFACTUAL for publishing \`code_block\` and keeping the language in metadata:`)
  console.log(`  edges whose target is \`code_block.<lang>\`: ${codeBlockEdges}`)
  console.log(`  ... whose own file already publishes a bare \`code_block\`: ${codeBlockFileDeclaresBareCodeBlock}`)
  console.log(`  ... whose own file publishes no \`code_block\` at all:  ${codeBlockFileDeclaresNothingCalledCodeBlock}`)
  for (const s of codeBlockFileExamples) console.log(`      ${s}`)
}
console.log("")
console.log(`WHAT THE STORE BINDS — the production resolution order simulated over this index.`)
console.log(`Every reverse-walking surface joins on r.target_symbol_id (lsp/impact.ts:529-539,`)
console.log(`lsp/relations.ts:130-134, lsp/navigation.ts:440-453), so this is the column that decides`)
console.log(`whether an edge can be walked back along at all.`)
console.log(
  `${pad("type", 14)}${rpad("edges", 9)}${rpad("insert OK", 11)}${rpad("insert NULL", 12)}${rpad("after post", 12)}`,
)
console.log("-".repeat(58))
for (const t of ALL_TYPES) {
  const i = stageInsert[t]
  const a = stageAfterPost[t]
  const n = i.resolved + i.unresolved
  if (n === 0) continue
  console.log(
    `${pad(t, 14)}${rpad(n, 9)}${rpad(i.resolved, 11)}${rpad(i.unresolved, 12)}${rpad(a.resolved, 12)}`,
  )
}
console.log("-".repeat(58))
console.log(
  `${pad("TOTAL", 14)}${rpad(stageTotals.insertResolved + stageTotals.insertUnresolved, 9)}${rpad(stageTotals.insertResolved, 11)}${rpad(stageTotals.insertUnresolved, 12)}${rpad(stageTotals.afterResolved, 12)}`,
)
console.log(`  by stage:`)
for (const [k, v] of [...storeStageTally.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`    ${pad(k, 32)} ${v}`)
console.log(`  by type and stage:`)
for (const t of ALL_TYPES) {
  const row = storeStageByType[t]
  if (!row) continue
  console.log(`    ${pad(t, 12)} ${Object.entries(row).map(([k, v]) => `${k}=${v}`).join("  ")}`)
}
console.log(`  MIS-BINDINGS (store bound an edge to a declaration that is not the one it names): ${storeMisbindings.length}`)
for (const s of storeMisbindings.slice(0, 10)) console.log(`      ${s}`)
console.log("")
console.log(`UNRESOLVED ${tUnres} edges / ${unresolvedNames.size} distinct target names.`)
console.log(`  This index is ${sample.length} files and the corpus is ${files.length}. A target naming a file`)
console.log(`  outside this window is NOT a defect, so this column BOUNDS rather than establishes one.`)
const topUnres = [...unresolvedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
if (topUnres.length) {
  console.log(`  most frequent: ${topUnres.map(([k, v]) => `${k}(${v})`).join(" ")}`)
}

// ───────────────────────────────────────────── the round brief's B / A / C
//
// The brief asks for three before/after numbers and names a cause for each. This
// section MEASURES each cause against the fields the analyzer actually publishes,
// so a fix can be scored on the same population the split was read from and a
// cause with nothing behind it is reported as zero rather than assumed away.
//
//   B  emitter/publisher format mismatch — the target's FINAL SEGMENT is a
//      published name. Applied to the UNRESOLVED population only, because an
//      edge that already resolves cannot be a format mismatch.
//   A  name is not an identifier — the target is published in more than one
//      file. Closure is attempted from PUBLISHED FIELDS ONLY, in a fixed order,
//      and an edge that no rule closes is counted OPEN rather than assumed
//      closable.
//   C  external — a target that names something outside the corpus. Split three
//      ways, because "external" and "a file in this repo the analyzer does not
//      model" are different defects with different fixes and folding them
//      together is what makes the column unreadable.
//
// Character tests, not regex: 0 regex literals is a pinned property of this lane
// (script/m12/verify-regex-census.ts is the gate) and every test below is a
// prefix scan or a last-segment scan.

/** The final `.`-segment of a target, or the whole string when it has no dot. */
const lastSegment = (s: string): string => {
  const i = s.lastIndexOf(".")
  return i < 0 ? s : s.slice(i + 1)
}
const startsWith = (s: string, p: string): boolean => s.length >= p.length && s.slice(0, p.length) === p

/**
 * A URI scheme, by RFC 3986's own rule rather than a pattern: a letter, then
 * letters/digits/`+`/`-`/`.`, then `:`. `https://x` has one; `docs/a.md` does
 * not, because the part before the colon must not contain a `/`.
 *
 * Two corrections to the first version of this function, both measured on the
 * 600-file sample rather than argued:
 *
 *  - The scheme must be at least TWO characters. RFC 3986 admits `X:`, and a
 *    Windows drive letter `X:/src` therefore classified as a URI scheme. It is
 *    a repo-relative path, so the one-letter rule put it in the wrong bucket.
 *  - A destination may arrive WRAPPED — `[x]((https://…))` and `[x](<https://…>)`
 *    are both legal CommonMark — and the leading bracket is not the first
 *    character, so the scheme scan found nothing and the wrapped URL fell into
 *    the relative-path bucket. The wrapper is stripped for the test and counted.
 */
const uriSchemeOf = (s: string): string | null => {
  let body = s
  let wrapped = false
  for (let guard = 0; guard < 2; guard++) {
    const c0 = body.charCodeAt(0)
    if (body.length >= 2 && ((c0 === 40 && body.charCodeAt(body.length - 1) === 41) || (c0 === 60 && body.charCodeAt(body.length - 1) === 62))) {
      body = body.slice(1, -1)
      wrapped = true
      continue
    }
    break
  }
  const scheme = scanScheme(body)
  if (scheme === null || scheme.length < 2) return null
  if (wrapped) wrappedDestinations++
  return scheme
}
let wrappedDestinations = 0
const scanScheme = (s: string): string | null => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 58 /* : */) {
      if (i === 0) return null
      const first = s.charCodeAt(0)
      const alpha = (first >= 65 && first <= 90) || (first >= 97 && first <= 122)
      if (!alpha) return null
      for (let k = 1; k < i; k++) {
        const d = s.charCodeAt(k)
        const ok =
          (d >= 65 && d <= 90) ||
          (d >= 97 && d <= 122) ||
          (d >= 48 && d <= 57) ||
          d === 43 /* + */ ||
          d === 45 /* - */ ||
          d === 46 /* . */
        if (!ok) return null
      }
      return s.slice(0, i)
    }
    // A `/`, `?` or `#` before the colon means there is no scheme to find.
    if (c === 47 || c === 63 || c === 35) return null
  }
  return null
}
const URI_SCHEMES_SEEN = new Map<string, number>()

// B — on the unresolved population.
let bUnresolved = 0
let bDotted = 0
let bFinalSegmentPublished = 0
let bFinalSegmentPublishedHereFile = 0
const bRecoverableNames = new Map<string, number>()

// A — on the ambiguous population, closures attempted in a fixed order.
let aAmbiguous = 0
let aClosedByLine = 0
let aClosedBySourceChild = 0
let aClosedByOwnFile = 0
let aStillOpen = 0
const aOpenExamples: string[] = []
const aByRule = new Map<string, number>()
const aPerType = new Map<string, { ambiguous: number; closed: number; open: number; byRule: Record<string, number> }>()
/** The universe check: can an ambiguous target be one whose ONLY declarations
 *  are in other files? If yes, no published per-file field can close it. */
let aForeignOnly = 0

// C — on the unresolved population, three ways.
let cTotal = 0
let cExternal = 0
let cRelativePath = 0
let cBareToken = 0
const cByType = new Map<string, { external: number; relativePath: number; bareToken: number }>()
const cExternalExamples: string[] = []
const cRelativeExamples: string[] = []
const cBareExamples: string[] = []

/** Declarations in the edge's own file publishing `name`, with their lines and ids. */
const declsInFile = (file: string, name: string): Decl[] => decls.filter((d) => d.file === file && d.name === name)

for (const e of edges) {
  const t = e.type
  const byFile = published.get(e.target)
  const here = byFile ? byFile.get(e.file) : undefined

  // ── B. Only an edge that does NOT resolve can be a format mismatch.
  if (!byFile || byFile.size === 0) {
    bUnresolved++
    if (e.target.indexOf(".") >= 0) {
      bDotted++
      const leaf = lastSegment(e.target)
      if (published.has(leaf)) {
        bFinalSegmentPublished++
        bRecoverableNames.set(leaf, (bRecoverableNames.get(leaf) ?? 0) + 1)
        // STRICTLY stronger: the leaf names a declaration in the edge's OWN file.
        if (published.get(leaf)!.has(e.file)) bFinalSegmentPublishedHereFile++
      }
    }

    // ── C. Three ways a target can name nothing here.
    cTotal++
    const ct = cByType.get(t) ?? { external: 0, relativePath: 0, bareToken: 0 }
    const scheme = uriSchemeOf(e.target)
    if (scheme !== null) {
      cExternal++
      ct.external++
      URI_SCHEMES_SEEN.set(scheme, (URI_SCHEMES_SEEN.get(scheme) ?? 0) + 1)
      if (cExternalExamples.length < 14) cExternalExamples.push(`${e.file} :: ${e.source} -[${t}]-> ${e.target}`)
    } else if (e.target.indexOf("/") >= 0 || e.target.indexOf(".") >= 0) {
      // No scheme, but it names a PATH. That is a file in this repository, which
      // this analyzer does not model — a different defect from external, and the
      // fix is a target model rather than a marker.
      cRelativePath++
      ct.relativePath++
      if (cRelativeExamples.length < 14) cRelativeExamples.push(`${e.file} :: ${e.source} -[${t}]-> ${e.target}`)
    } else {
      cBareToken++
      ct.bareToken++
      if (cBareExamples.length < 14) cBareExamples.push(`${e.file} :: ${e.source} -[${t}]-> ${e.target}`)
    }
    cByType.set(t, ct)
    continue
  }

  // ── A. Ambiguous means the name is published in more than one file.
  if (byFile.size <= 1) continue
  aAmbiguous++
  const at = aPerType.get(t) ?? { ambiguous: 0, closed: 0, open: 0, byRule: {} }
  at.ambiguous++

  // Universe: declarations exist ONLY in other files, so no per-file published
  // field can name one of them. Counted, not treated as open-by-rule.
  if (!here || here.size === 0) aForeignOnly++

  // Rule order is fixed and the FIRST rule that picks exactly one wins, so the
  // attribution is a partition rather than a set of overlapping claims.
  let closedBy: string | null = null
  const cands = declsInFile(e.file, e.target)

  // A1 `line_number` — the edge carries the line of the node that holds the name
  //    (real-markdown-analyzer.ts:150-157, M59 #822), and a declaration carries
  //    `range.startLine`. Exactly one declaration at that line closes the edge.
  //    Strongest rule: it names the occurrence, not just the file.
  if (e.line > 0) {
    const atLine = cands.filter((d) => d.line === e.line)
    if (atLine.length === 1) closedBy = "line_number"
  }
  // A2 `source` + published `qualifiedName` — a child site's id is
  //    `${parentId}.${name}` (real-markdown-analyzer.ts:267, :365), so the source's
  //    published id plus the target names exactly one declaration.
  if (!closedBy) {
    const parentIds = decls.filter((d) => d.file === e.file && (d.name === e.source || d.id === e.source)).map((d) => d.id)
    let n = 0
    for (const pid of parentIds)
      n += cands.filter((d) => d.id === `${pid}.${e.target}` || d.id.startsWith(`${pid}.${e.target}#`)).length
    if (parentIds.length > 0 && n === 1) closedBy = "source+qualifiedName"
  }
  // A3 `ownFile` — exactly one declaration IN THE EDGE'S OWN FILE publishes the
  //    target name, so the file scopes it. This is the rule the first run was
  //    missing, and its absence is why 2,084 edges read OPEN while their own
  //    examples printed `1 here`: the file had already decided and the probe
  //    required `cands.length > 1` before it would look.
  //
  //    It is sound because the SOURCE is a symbol in that file, so a consumer
  //    walking back from the source knows the file without any new field. It is
  //    also the weakest of the three — it rules candidates IN rather than naming
  //    an occurrence — so it is tried last and reported separately.
  if (!closedBy && cands.length === 1) closedBy = "ownFile"

  if (closedBy) {
    at.closed++
    at.byRule[closedBy] = (at.byRule[closedBy] ?? 0) + 1
    aByRule.set(closedBy, (aByRule.get(closedBy) ?? 0) + 1)
    if (closedBy === "line_number") aClosedByLine++
    else if (closedBy === "source+qualifiedName") aClosedBySourceChild++
    else aClosedByOwnFile++
  } else {
    at.open++
    aStillOpen++
    if (aOpenExamples.length < 16) {
      const ids = cands.slice(0, 4).map((d) => `${d.id}@${d.line}`)
      aOpenExamples.push(
        `${e.file} :: ${e.source} -[${t}]-> ${e.target} @${e.line} :: ${cands.length} here [${ids.join(", ")}]`,
      )
    }
  }
  aPerType.set(t, at)
}

console.log("")
console.log("=".repeat(72))
console.log("B  FORMAT MISMATCH — unresolved targets whose FINAL SEGMENT is published")
console.log("-".repeat(72))
console.log(`  unresolved targets          ${bUnresolved}`)
console.log(`  of those, dotted            ${bDotted}`)
console.log(`  final segment published     ${bFinalSegmentPublished}   <- recoverable by a string convention`)
console.log(`  ... in the edge's OWN file  ${bFinalSegmentPublishedHereFile}   <- the strict form`)
const bTop = [...bRecoverableNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
if (bTop.length) console.log(`  leaves: ${bTop.map(([k, v]) => `${k}(${v})`).join(" ")}`)
console.log(
  bFinalSegmentPublishedHereFile === 0
    ? `  VERDICT 0. Cause B does not apply to this lane. All ${bFinalSegmentPublished} leaves are\n` +
        `          published in OTHER files, so they are a coincidental name collision with a URL\n` +
        `          tail, not one symbol spelled two ways. A format mismatch is by definition\n` +
        `          about the same declaration, so the in-own-file count is the one that decides\n` +
        `          it, and it is 0. Nothing to fix here.`
    : `  VERDICT ${bFinalSegmentPublishedHereFile}. These edges are recoverable by a naming convention.`,
)

console.log("")
console.log("=".repeat(72))
console.log("A  NAME IS NOT AN IDENTIFIER — ambiguous targets, closed from PUBLISHED FIELDS")
console.log("-".repeat(72))
console.log(`  ambiguous targets           ${aAmbiguous}`)
console.log(`  of those FOREIGN-ONLY      ${aForeignOnly}   (no per-file field can name these)`)
console.log(`  closed by line_number       ${aClosedByLine}`)
console.log(`  closed by source+qualName   ${aClosedBySourceChild}`)
console.log(`  closed by ownFile            ${aClosedByOwnFile}   <- rules candidates IN, does not name an occurrence`)
console.log(`  STILL OPEN                  ${aStillOpen}`)
for (const [k, v] of [...aByRule.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${pad(k, 24)} ${v}`)
console.log("  per type:")
for (const [k, v] of [...aPerType.entries()].sort((a, b) => b[1].ambiguous - a[1].ambiguous)) {
  console.log(
    `    ${pad(k, 12)} ambiguous ${rpad(v.ambiguous, 7)} closed ${rpad(v.closed, 7)} open ${rpad(v.open, 6)}  ${Object.entries(v.byRule).map(([r, n]) => `${r}=${n}`).join(" ")}`,
  )
}
if (aOpenExamples.length) {
  console.log(`  open examples:`)
  for (const s of aOpenExamples) console.log(`      ${s}`)
}

console.log("")
console.log("=".repeat(72))
console.log("C  EXTERNAL — unresolved targets, three ways")
console.log("-".repeat(72))
console.log(`  unresolved targets          ${cTotal}`)
console.log(`  C1 external (URI scheme)    ${cExternal}`)
console.log(`  C2 relative path in-repo    ${cRelativePath}   <- a target model, not a marker`)
console.log(`  C3 bare token               ${cBareToken}`)
console.log(`  wrapped destinations stripped  ${wrappedDestinations}`)
console.log(`  schemes: ${[...URI_SCHEMES_SEEN.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")}`)
console.log("  per type:")
for (const [k, v] of [...cByType.entries()].sort((a, b) => b[1].external + b[1].relativePath + b[1].bareToken - (a[1].external + a[1].relativePath + a[1].bareToken))) {
  console.log(`    ${pad(k, 12)} external ${rpad(v.external, 7)} relative ${rpad(v.relativePath, 7)} bare ${rpad(v.bareToken, 7)}`)
}
for (const [label, arr] of [
  ["C1 external", cExternalExamples],
  ["C2 relative", cRelativeExamples],
  ["C3 bare", cBareExamples],
] as const) {
  if (!arr.length) continue
  console.log(`  ${label}:`)
  for (const s of arr) console.log(`      ${s}`)
}

if (OUT) {
  const perTypeAmbOut: Record<string, Record<AmbiguityKind, number>> = {}
  for (const t of ALL_TYPES) perTypeAmbOut[t] = perTypeAmb[t]
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        instrument: "markdown ambiguity split (validation/m14/fixtures/markdown/ambiguity-split.ts)",
        whatThisIs:
          "the per-type split of ambiguous edge targets into the three buckets the round brief names, from production parseFile, plus a reproduction of script/m14/incoming-check.ts's own ambiguousTargets definition on the same edge set so the two are comparable",
        whatThisIsNot:
          "script/m14/incoming-check.ts's output. That file is shared machinery (workstream §8) and was not edited; its definition is recomputed here and both numbers are reported.",
        analyzerSha256: HASH_BEFORE,
        analyzerStableDuringRun: analyzerHash() === HASH_BEFORE,
        sample: {
          files: sample.length,
          admittedPopulation: files.length,
          order: "repo ascending, then rel ascending — the same ordering as validation/m14/fixtures/markdown/whole-corpus-census.ts, so this sample is a PREFIX of the whole-corpus population and not an independent draw",
          populationSha256,
          admissionTest: "detectLanguageFromPath(abs, text) === \"markdown\", size <= 512 KB, git ls-files",
          limitEnv: "BB_MARKDOWN_AMBIGUITY_FILES",
        },
        walk: {
          total: stats.total,
          alreadyDone: stats.alreadyDone,
          walked: stats.walked,
          skippedBad: stats.skippedBad,
          partial: stats.partial,
          checkpoint: path.relative(process.cwd(), CHECKPOINT),
        },
        symbols,
        degraded,
        parseFailures,
        parseFailureExamples,
        edges: edges.length,
        distinctPublishedNames: published.size,
        distinctDeclarations: decls.length,
        sharedInstrumentReproduction: {
          definition: "target name published with more than one DISTINCT SymbolKind, file discarded — incoming-check.ts:107,176-188",
          ambiguous: sharedInstrumentAmbiguous,
          resolvableTargets: sharedInstrumentDistinct,
          recordedInIncomingWholeTsv: 68,
          note: "a name published many times under ONE kind reads unambiguous to that map, so its figure and this one answer different questions; both are reported rather than reconciled by assertion",
        },
        perType,
        ambiguitySplit: {
          perType: perTypeAmbOut,
          totals: {
            resolvingTargets: ambTotal,
            a_scopeCollisionSameFile: aTot,
            b_crossFileNoScopeModel: bTot,
            c_sharedPublishedName: cTot,
          },
          repairableInThisAnalyzer: {
            buckets: ["a_scopeCollisionSameFile", "b_crossFileNoScopeModel"],
            edges: aTot + bTot,
            note: "(c) is a fact about the published-name contract: the unique spelling IS published, as qualifiedName (src/ast/real-markdown-analyzer.ts:284), but it is not the edge's endpoint spelling",
          },
        },
        sourceDisambiguation: {
          of_a_scopeCollisionSameFile: disambiguatedBySource,
          ofTotal: aTot,
          test: "exactly one symbol in the edge's own file publishes the target name AND its id is the edge's source or a child of it, so (source,target) is unique although target alone is not",
        },
        abcClosure: {
          whatThisIs:
            "the round brief's three causes measured against the fields this analyzer actually publishes: B on the unresolved population, A on the ambiguous population with closure attempted from published fields in a fixed order, C on the unresolved population split three ways",
          B_formatMismatch: {
            unresolvedTargets: bUnresolved,
            dotted: bDotted,
            finalSegmentPublished: bFinalSegmentPublished,
            finalSegmentPublishedInOwnFile: bFinalSegmentPublishedHereFile,
            leaves: [...bRecoverableNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40),
            verdict: bFinalSegmentPublishedHereFile === 0 ? 0 : bFinalSegmentPublishedHereFile,
            test: "target does not resolve, contains a '.', and its last dot-segment is a published name",
            decidingTest: "the leaf must be published in the EDGE'S OWN FILE; a leaf published only elsewhere is a coincidental collision with a URL tail, and the 13 such leaves here are all of that shape",
            leavesAreAllForeignToTheEdge: bFinalSegmentPublished === bFinalSegmentPublishedHereFile ? false : true,
          },
          A_nameIsNotAnIdentifier: {
            ambiguousTargets: aAmbiguous,
            foreignOnly: aForeignOnly,
            closedByLineNumber: aClosedByLine,
            closedBySourcePlusQualifiedName: aClosedBySourceChild,
            closedByOwnFile: aClosedByOwnFile,
            stillOpen: aStillOpen,
            byRule: Object.fromEntries(aByRule),
            perType: Object.fromEntries(aPerType),
            openExamples: aOpenExamples,
            fieldSources: {
              line_number: "src/ast/real-markdown-analyzer.ts:150-157 (M59 #822) and :319/:384/:421/:474",
              qualifiedName: "src/ast/real-markdown-analyzer.ts:283-284, built from siteId() at :79-87",
            },
            ruleOrderIsAPartition: "the first rule that picks exactly one declaration wins; rules are not overlapping claims",
          },
          C_external: {
            unresolvedTargets: cTotal,
            external_uriScheme: cExternal,
            relativePathInRepo: cRelativePath,
            bareToken: cBareToken,
            schemes: Object.fromEntries(URI_SCHEMES_SEEN),
            perType: Object.fromEntries(cByType),
            externalExamples: cExternalExamples,
            relativeExamples: cRelativeExamples,
            bareExamples: cBareExamples,
            schemeRule: "RFC 3986 alpha *( ALPHA / DIGIT / '+' / '-' / '.' ) ':', with '/' '?' '#' ending the scan, minimum TWO characters so a Windows drive letter is not a scheme, after stripping one balanced (...) or <...> wrapper",
            wrappedDestinations,
          },
        },
        storeLeafResolution: {
          whatThisMeasures:
            "what the production store searches for. extractLeaf is applied to the target before the name is matched (src/ast/parallel-indexer.ts:3377-3391, called :3393, used :3498-3501), so a dotted target is NOT searched for as the analyzer spelled it.",
          extractLeafSource: "src/ast/parallel-indexer.ts:3377-3391, copied verbatim",
          columnMeanings: {
            edges: "targets that resolve at least once, by type",
            targetNamesASymbolInThisFile: "the analyzer's own spelling names a symbol in the edge's own file",
            leafEqualsTarget: "extractLeaf is the identity here, so the store searches exactly what was published",
            leafNamesASymbolInThisFile: "the REWRITTEN string names a symbol in the edge's own file",
            leafNamesASymbolAnyFile: "the REWRITTEN string names a symbol somewhere in the index",
            leafIsAWrongKindOfThing:
              "target was rewritten AND the rewritten string names a symbol in this file AND it is not the declaration the edge is about",
          },
          perType: perTypeLeaf,
          totals: leafTotals,
          rewrittenTargets: [...leafPairs.entries()]
            .sort((a, b) => b[1].edges - a[1].edges)
            .slice(0, 80)
            .map(([target, v]) => ({ target, ...v })),
          codeBlockCounterfactual: {
            edgesWithDottedCodeBlockTarget: codeBlockEdges,
            ownFilePublishesBareCodeBlock: codeBlockFileDeclaresBareCodeBlock,
            ownFilePublishesNoCodeBlockAtAll: codeBlockFileDeclaresNothingCalledCodeBlock,
            examples: codeBlockFileExamples,
            question:
              "if the fenced block published `code_block` and carried the language in metadata.language (where it already is, real-markdown-analyzer.ts:470), how many of these edges' files would declare the name the edge would then address?",
          },
        },
        storeResolutionSimulation: {
          whatThisIs:
            "the production target-binding order replayed over this 600-file index: extractLeaf, then the insert-time name match with its per-type ORDER BY, then the post-index strategies for whatever insert time left NULL",
          whatThisIsNot:
            "the store. is_declaration, the project-wide symbol table the post-index passes read, and SQLite's tiebreak among equally-ranked candidates are all outside a single-file index, so this counts WHICH STRING the store searches and whether any declaration in this index carries it — not which row SQLite returns.",
          stageSources: {
            extractLeaf: "src/ast/parallel-indexer.ts:3377-3391",
            insertTime: "src/ast/parallel-indexer.ts:3498-3502",
            resolveContainsTargetStmt: "src/ast/parallel-indexer.ts:2354-2360",
            resolveTargetStmt: "src/ast/parallel-indexer.ts:2239-2245",
            postStrategy1QualifiedName: "src/ast/parallel-indexer.ts:3976-4005",
            postStrategy3UniqueName: "src/ast/parallel-indexer.ts:4008-4020",
            postStrategy4DottedLeaf: "src/ast/parallel-indexer.ts:3822-3833",
            i13: "src/ast/parallel-indexer.ts:4127-4146 (bare names only, non-contains, overwrites)",
            reverseWalkJoins: [
              "src/lsp/impact.ts:529-539",
              "src/lsp/relations.ts:130-134",
              "src/lsp/navigation.ts:440-453",
            ],
          },
          perType: { insertTime: stageInsert, afterPostIndex: stageAfterPost },
          totals: stageTotals,
          stageTally: Object.fromEntries(storeStageTally),
          stageTallyByType: storeStageByType,
          misbindings: {
            count: storeMisbindings.length,
            definition:
              "the store matched a REWRITTEN leaf onto some declaration, and that declaration's name is not the one the edge names — so the edge is bound, to the wrong thing, which is worse than unbound",
            examples: storeMisbindings.slice(0, 60),
          },
        },
        unresolved: {
          edges: tUnres,
          distinctNames: unresolvedNames.size,
          note: "bounded, not a verdict: this index is the sample and the corpus is the admitted population; an unresolved target naming a file outside the window is not a defect",
          topNames: unresolvedNames.size > 0 ? [...unresolvedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40) : [],
        },
        topCrossFileCollisionNames: [...collisionNames.entries()]
          .filter(([, v]) => v.files > 1)
          .sort((a, b) => b[1].edges - a[1].edges)
          .slice(0, 60)
          .map(([name, v]) => ({ name, ...v })),
        declaredLimit:
          "resolves by NAME. A name that a file outside this sample declares is counted unresolved, which conflates 'outside the window' with 'nowhere'. Ambiguity is keyed on name and on distinct kinds, both of which the shared harness also does, so the definitions differ and both numbers are given.",
      },
      null,
      2,
    ),
  )
  console.log(
    `analyzer sha256 after the walk : ${HASH_BEFORE.slice(0, 16)}${
      analyzerHash() === HASH_BEFORE
        ? "  (unchanged — every number above is tied to this analyzer state)"
        : "  CHANGED DURING THE RUN — the numbers above are a MIXTURE of two analyzer states"
    }`,
  )
  console.log(`\nwrote ${OUT}`)
}