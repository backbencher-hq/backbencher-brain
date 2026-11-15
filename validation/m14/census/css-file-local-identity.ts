/**
 * IS THE CSS LANE'S AMBIGUITY REPAIRABLE WITH A FILE-SCOPED IDENTIFIER?
 *
 * ## The number this file exists to produce
 *
 * `archive/docs-pre-consolidation/ROUND-BRIEF.md` cause A is "name is not an identifier": the css analyzer publishes no
 * `qualifiedName` at all (`grep -c qualifiedName src/ast/real-css-analyzer.ts` -> 0), so
 * every name is a bare simple name and two files that both declare `body` collapse into one
 * node. Measured at 80 files by the shared `script/m14/diagnose-incoming.mts`:
 *
 *   distinct targets 8,410   ambiguous (>1 file declaring) 8,121 (96.6%)   of those with
 *   NO distinct qualifiedName 8,121 (100%)
 *
 * A file-scoped identifier is only a REPAIR if the identity it publishes is unique. If the
 * collision is between declarations INSIDE one file -- the same custom property under
 * twenty rule sets of the same stylesheet -- then scoping by file changes nothing at all,
 * and the fix for cause A in this lane is something else or nothing. So this file measures
 * that, and nothing else:
 *
 *   for every edge production `parseFile` produced, is the edge's TARGET NAME declared
 *   exactly ONCE inside the edge's OWN source file?
 *
 *     1       -> a file-scoped name `<file>::<name>` is project-unique BY CONSTRUCTION,
 *                because the file key is unique in the project and the name is unique in
 *                the file. The edge can be retargeted and it means one specific thing.
 *     >1      -> the file scope cannot disambiguate it. Naming it would be picking a winner
 *                by a rule nobody chose, which is the defect, not the fix.
 *     0       -> the declaration is not in this file at all. Nothing a file-scoped name can
 *                do; this is the cross-file case and it is reported separately, because
 *                `diagnose-incoming`'s B column and this one count different populations.
 *
 * ## What each bucket is NOT allowed to be claimed as
 *
 * `1` is a statement about IDENTITY, not about resolution. The store already prefers a
 * same-file declaration when binding a target (`parallel-indexer.ts` resolveTargetStmt
 * orders `(s.file_id = ?) DESC`), so many `>1` edges bind correctly TODAY by that rule.
 * What they do not have is a way to be looked up by name without ambiguity. Both numbers
 * are reported; neither is presented as the other.
 *
 * ## Population
 *
 * The admission rule is transcribed from `script/m14/ontology-coverage-gate.ts` (the
 * arbiter) argument for argument -- git-tracked, real directory, <= 512 KB,
 * `detectLanguageFromPath(abs, text) === "css"` -- and the WHOLE admitted corpus is walked,
 * not a window, because a name's uniqueness is a property of the corpus and a window can
 * turn a unique name into a colliding one by omitting the file that also declares it. The
 * count of admitted files is printed so a reader can see the denominator, and the corpus
 * can move under us: other lanes clone into it.
 *
 * ## ZERO REGEX
 *
 * No regex anywhere. `script/m12/verify-regex-census.ts` must keep printing 0 for this lane,
 * and a census is a file in the working tree. Nothing here needs a text matcher anyway: every
 * name it compares already arrived as a published symbol name or a relationship endpoint.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/census/css-file-local-identity.ts --json out.json
 *
 * READ-ONLY with respect to the corpus. Writes nothing unless --json is given.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const jsonAt = argv.indexOf("--json")
const JSON_OUT = jsonAt >= 0 ? String(argv[jsonAt + 1]) : ""
const PROBE = argv.indexOf("--probe") >= 0 ? Number(argv[argv.indexOf("--probe") + 1]) || 25 : 0

/**
 * Store label -> the ten ontology type names. Copied from `css-incoming-split.ts` because
 * the same ten types have to be counted under the same names, and the store's label for
 * `imports` is a fourth spelling (`brain_import`) that a hand-written map here would get
 * wrong in a way the census would then report as a real finding.
 */
const LABEL: Record<string, string> = {
  calls: "calls", call: "calls",
  uses: "uses",
  contains: "contains", composition: "contains", part_of: "contains",
  imports: "imports", brain_import: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides",
  instantiates: "instantiates",
}

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const

type Bucket = "unique-in-source-file" | "multi-in-source-file" | "absent-from-source-file"
type Cell = { edges: number; names: Set<string> }
const cell = (): Cell => ({ edges: 0, names: new Set() })
const blank = (): Record<Bucket, Cell> => ({
  "unique-in-source-file": cell(),
  "multi-in-source-file": cell(),
  "absent-from-source-file": cell(),
})

// ---------------------------------------------------------------- admitted corpus

type Admitted = { repo: string; rel: string; abs: string }
const admitted: Admitted[] = []
let reposSeen = 0
let overSize = 0
let unreadable = 0

for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  reposSeen++
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch {
    unreadable++
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) { overSize++; continue }
      text = readFileSync(abs, "utf8")
    } catch {
      unreadable++
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "css") continue
    admitted.push({ repo: e, rel, abs })
  }
}

// ---------------------------------------------------------------- one pass over the corpus

/**
 * Per admitted file: the declaration COUNT of every name it publishes, and its edges.
 *
 * The count, not a Set: "declared once" and "declared twice" are the whole question, and a
 * Set would throw away the difference between them.
 */
const perFile = new Map<string, { counts: Map<string, number>; edges: { type: string; target: string; source: string }[] }>()
/** name -> number of files in the corpus declaring it, for the project-wide comparison. */
const projectCount = new Map<string, number>()
let filesParsed = 0
let degraded = 0
let parseFailures = 0
let symbols = 0
let symbolsWithQualifiedName = 0
let emptyNames = 0

for (const f of admitted) {
  let r: any
  try {
    r = await parseFile(f.abs, path.dirname(f.abs))
  } catch {
    parseFailures++
    continue
  }
  filesParsed++
  if (r?.fallback === true) degraded++
  const counts = new Map<string, number>()
  for (const s of Array.isArray(r?.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) { emptyNames++; continue }
    counts.set(name, (counts.get(name) ?? 0) + 1)
    symbols++
    if (s?.qualifiedName !== undefined && s?.qualifiedName !== null && String(s.qualifiedName) !== name) {
      symbolsWithQualifiedName++
    }
  }
  for (const [name, c] of counts) {
    projectCount.set(name, (projectCount.get(name) ?? 0) + c)
  }
  const edges: { type: string; target: string; source: string }[] = []
  for (const rel of Array.isArray(r?.relationships) ? r.relationships : []) {
    const t = String(rel?.type ?? "")
    const type = LABEL[t]
    if (!type) continue
    edges.push({ type, target: String(rel?.target ?? ""), source: String(rel?.source ?? "") })
  }
  perFile.set(`${f.repo}/${f.rel}`, { counts, edges })
}

// ---------------------------------------------------------------- the measurement

const byType = new Map<string, Record<Bucket, Cell>>()
for (const t of ALL_TYPES) byType.set(t, blank())

/** name -> edges, for the biggest populations, so a reader can see WHICH names collide. */
const multiTop = new Map<string, { files: number; edges: number }>()
const absentTop = new Map<string, { edges: number }>()

for (const [key, { counts, edges }] of perFile) {
  for (const e of edges) {
    const row = byType.get(e.type)
    if (!row) continue
    const n = counts.get(e.target) ?? 0
    const bucket: Bucket =
      n === 1 ? "unique-in-source-file" : n === 0 ? "absent-from-source-file" : "multi-in-source-file"
    row[bucket].edges++
    row[bucket].names.add(e.target)
    if (bucket === "multi-in-source-file") {
      const row2 = multiTop.get(e.target) ?? { files: 0, edges: 0 }
      row2.edges++
      row2.files = n
      multiTop.set(e.target, row2)
    } else if (bucket === "absent-from-source-file") {
      const row2 = absentTop.get(e.target) ?? { edges: 0 }
      row2.edges++
      absentTop.set(e.target, row2)
    }
  }
}

const shape = (row: Record<Bucket, Cell>) => ({
  edges: row["unique-in-source-file"].edges + row["multi-in-source-file"].edges + row["absent-from-source-file"].edges,
  uniqueInSourceFile: row["unique-in-source-file"].edges,
  multiInSourceFile: row["multi-in-source-file"].edges,
  absentFromSourceFile: row["absent-from-source-file"].edges,
  distinctNames: new Set([
    ...row["unique-in-source-file"].names,
    ...row["multi-in-source-file"].names,
    ...row["absent-from-source-file"].names,
  ]).size,
})

const total = blank()
const typesOut: Record<string, unknown> = {}
for (const t of ALL_TYPES) {
  const row = byType.get(t) as Record<Bucket, Cell>
  typesOut[t] = shape(row)
  for (const b of Object.keys(total) as Bucket[]) total[b].edges += row[b].edges
}

const report = {
  tool: "css-file-local-identity",
  corpusRoot: CR,
  population: {
    reposScanned: reposSeen,
    admittedFiles: admitted.length,
    filesParsed,
    parseFailures,
    degraded,
    filesOverSizeCap: overSize,
    unreadable,
    admissionRule: "git-tracked, real dir, <=512KB, detectLanguageFromPath(abs,text)==='css'  (transcribed from ontology-coverage-gate.ts)",
  },
  published: {
    symbols,
    symbolsWithADistinctQualifiedName: symbolsWithQualifiedName,
    emptyNames,
  },
  headline: shape(total),
  byType: typesOut,
  multiTop: [...multiTop.entries()]
    .sort((a, b) => b[1].edges - a[1].edges)
    .slice(0, PROBE || 25)
    .map(([name, v]) => ({ name, ...v, declaredInThisManyPlaces: v.files })),
  absentTop: [...absentTop.entries()]
    .sort((a, b) => b[1].edges - a[1].edges)
    .slice(0, PROBE || 25)
    .map(([name, v]) => ({ name, ...v })),
  limitations: [
    "The three buckets are about IDENTITY, not about what the store binds today. parallel-indexer.ts resolveTargetStmt orders (s.file_id = ?) DESC, so a same-file declaration already wins the bind for many multi-in-source-file edges; this file does not measure that bind.",
    "`unique-in-source-file` is a claim about the NAME, so a `<file>::<name>` identifier built from it is project-unique by construction. It is not a claim that the CSS cascade resolves the read to that declaration: a var() read can be satisfied by an inherited value from another file, and where several rule sets in the same file declare the token, the cascade is not statically decidable.",
    "The corpus is shared and other lanes clone into it, so the admitted-file count is a reading, not a constant.",
  ],
}

console.log(JSON.stringify({ ...report, multiTop: report.multiTop.slice(0, 12), absentTop: report.absentTop.slice(0, 12) }, null, 2))
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + "\n")