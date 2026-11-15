/**
 * WHAT THE ANALYZER PUBLISHES FOR THE FILES WHOSE ROOT COLLAPSED — through production `parseFile`.
 *
 * `root-error-census.mts` measures the grammar's half: how many corpus `.sql` files parse to an
 * `ERROR` root rather than a `program` root, and how many `CREATE <object>` heads their text
 * carries. Measured 2026-10-05 over the whole corpus (1,893 files discovered, 1,885 parsed under
 * the 512 KB cap, 19 repositories): **21 files have an `ERROR` root, 6 of them carry 1,030
 * declaration heads, and those 1,030 are 21.96 % of the 4,690 heads in the corpus.** 1.11 % of
 * files hold 22 % of the declarations.
 *
 * This instrument measures the analyzer's half, which is a different question and can only be
 * answered by driving `parseFile` from `src/ast/pool-worker.ts`. `analyze()` is not used: the
 * brief forbids it because it skips the pipeline stages (pool-worker, timeouts, truncation,
 * enhancements), and the whole question is about what production publishes.
 *
 * The claim under test is the analyzer's own `resyncNeeded`, which per its source fires only when
 * some top-level CHILD of the root is an `ERROR` spanning >= RESYNC_ERROR_SPAN_RATIO (0.6) of the
 * file. When the ROOT ITSELF is the `ERROR`, the root's named children are bare `keyword_*` /
 * `identifier` leaves, so there is no ERROR CHILD and the trigger cannot fire. If that is what
 * happens, a file with 627 declarations publishes 0.
 *
 * THE REPRO IS IN THE ARTIFACT, not only in this header, because the census's own counter was
 * found vacuous on 2026-10-05 (it returned 0 for every file including a bare
 * `CREATE TABLE a (id int);`, from an off-by-one word-boundary test) and a header claim with no
 * executable artifact behind it is the same failure one level up. `repro` below is the minimal
 * two-dollar-quote file the census header claims collapses, run through the SAME `parseFile` the
 * corpus files go through.
 *
 * Usage: npx tsx validation/m14/fixtures/sql/root-error-loss.mts --out FILE
 *        [--census FILE]   the merged census artifact; defaults to the committed pass-12 one
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const outIdx = argv.indexOf("--out")
const OUT = outIdx >= 0 ? argv[outIdx + 1] : undefined
const censusIdx = argv.indexOf("--census")
const CENSUS =
  censusIdx >= 0
    ? argv[censusIdx + 1]
    : "validation/m14/fixtures/sql/measurements/pass12-root-error-census.json"
const ROOT = "/home/ishaq2321/mcp/bb-lanes/sql"
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SCRATCH = mkdtempSync(path.join(tmpdir(), "sql-root-error-loss-"))

/**
 * The minimal repro from `root-error-census.mts`'s header: two `CREATE FUNCTION`s, two
 * `$$`-bodies. Written as its own case rather than only described, because the census counts
 * declaration heads from TEXT and this case is what ties the text count to what is published.
 */
const REPRO = `CREATE FUNCTION repro_a() RETURNS text LANGUAGE sql AS $$ SELECT 1 $$;
CREATE FUNCTION repro_b() RETURNS text LANGUAGE sql AS $$ SELECT 2 $$;
`
const REPRO_ONE_BODY = `CREATE FUNCTION repro_c() RETURNS text LANGUAGE sql AS $$ SELECT 1 $$;
`

interface Case {
  label: string
  file: string
  source: string
}

const cases: Case[] = []
if (!existsSync(CENSUS)) {
  console.error(`census artifact not found: ${CENSUS} — run root-error-census.mts first`)
  process.exit(2)
}
const census = JSON.parse(readFileSync(CENSUS, "utf8"))
for (const r of census.rows as Array<{ file: string; rootType: string; declHeads: number }>) {
  if (r.rootType !== "ERROR") continue
  const abs = path.join(CORPUS, r.file)
  if (!existsSync(abs)) continue
  cases.push({ label: "corpus", file: r.file, source: readFileSync(abs, "utf8") })
}
// The one-body control is the falsifier for the "two or more bodies" wording in the census header.
cases.push({ label: "repro-two-bodies", file: "<repro: two dollar-quoted functions>", source: REPRO })
cases.push({ label: "repro-one-body", file: "<repro: one dollar-quoted function>", source: REPRO_ONE_BODY })

const rows: Array<Record<string, unknown>> = []
let declHeadsTotal = 0
let recoveredTotal = 0
let missingTotal = 0
let publishedSymbolsTotal = 0
let resyncFired = 0
for (const c of cases) {
  // OUTSIDE the fixtures tree, deliberately. A `.sql` file written under
  // `validation/m14/fixtures/sql/` is picked up by `script/m14/run-fixtures.ts` as a FIXTURE and
  // reported as a missing expectation file — measured: writing here made the suite report
  // `FAIL sql/tmp/reloss - missing expectation file` for a scratch file the instrument created.
  const tmp = path.join(SCRATCH, "reloss.sql")
  writeFileSync(tmp, c.source)
  const res: any = await parseFile(tmp, c.source)
  const symbols: any[] = res?.symbols ?? []
  const rels: any[] = res?.relationships ?? []
  // The declared names come from the census row, produced by the SAME counter, so both sides of
  // the recovery measure are one function's output rather than two unrelated walks.
  const row = (census.rows as any[]).find((r) => r.file === c.file)
  const declNames: string[] = row?.declHeadNames ?? (c.label === "repro-two-bodies" ? ["repro_a", "repro_b"] : ["repro_c"])
  const declHeads = declNames.length
  // `resyncStatements` is set to a positive count only inside `runResync`, so 0 is the analyzer's
  // own statement that `resyncNeeded` returned false for this file. Read, not inferred.
  const meta: any = res?.metadata ?? {}
  const amb: any = meta.ambiguity ?? {}
  const resyncFiredHere = Number(amb.resyncStatements ?? 0) > 0
  const declaredKinds = new Map<string, number>()
  for (const s of symbols) {
    const k = String(s.kind)
    declaredKinds.set(k, (declaredKinds.get(k) ?? 0) + 1)
  }
  // RECOVERY, per declaration and not per symbol. A symbol count can exceed a head count and
  // still mean nothing was recovered, because columns are symbols too — `postgrest`
  // big_schema.sql publishes 943 symbols against 627 heads. So each declared NAME is looked up in
  // the published symbol names and the ratio is reported per file.
  const publishedNames = new Set<string>()
  for (const s of symbols) publishedNames.add(String(s.name))
  const publishedQualified = new Set<string>()
  for (const s of symbols) {
    const qn = (s as any).qualifiedName
    if (typeof qn === "string") publishedQualified.add(qn)
    if (typeof qn === "string") for (const part of qn.split(".")) publishedQualified.add(part)
  }
  const recovered: string[] = []
  const missing: string[] = []
  for (const n of declNames) {
    if (publishedNames.has(n) || publishedQualified.has(n)) recovered.push(n)
    else missing.push(n)
  }
  if (resyncFiredHere) resyncFired++
  declHeadsTotal += declHeads
  recoveredTotal += recovered.length
  missingTotal += missing.length
  publishedSymbolsTotal += symbols.length
  rows.push({
    label: c.label,
    file: c.file,
    declHeadsInText: declHeads,
    declHeadsRecovered: recovered.length,
    declHeadsMissing: missing.length,
    missingSample: missing.slice(0, 12),
    symbolsPublished: symbols.length,
    relationshipsPublished: rels.length,
    resyncStatements: amb.resyncStatements ?? null,
    resyncDeclarations: amb.resyncDeclarations ?? null,
    resyncSkipped: amb.resyncSkipped ?? null,
    errorNodes: amb.errorNodes ?? null,
    symbolKinds: Object.fromEntries([...declaredKinds.entries()].sort()),
    firstFiveSymbols: symbols.slice(0, 5).map((s) => `${s.kind}:${s.name}`),
    firstFiveRelationships: rels.slice(0, 5).map((e) => `${e.type ?? e.relationshipType} ${e.source}->${e.target}`),
  })
  process.stderr.write(`${c.label} ${c.file}: heads=${declHeads} recovered=${recovered.length} symbols=${symbols.length} rels=${rels.length} resyncStatements=${amb.resyncStatements ?? "-"} errorNodes=${amb.errorNodes ?? "-"}\n`)
}

const summary = {
  censusArtifact: CENSUS,
  corpusFilesWithErrorRoot: cases.filter(c => c.label === "corpus").length,
  casesRun: cases.length,
  declarationHeadsInThoseFiles: declHeadsTotal,
  declarationHeadsRecovered: recoveredTotal,
  declarationHeadsMissing: missingTotal,
  recoveryRate: declHeadsTotal === 0 ? null : Number((recoveredTotal / declHeadsTotal).toFixed(4)),
  symbolsPublishedTotal: publishedSymbolsTotal,
  filesWhereResyncCounterFired: resyncFired,
  ranAt: new Date().toISOString(),
}
if (OUT) writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2))
console.log(JSON.stringify(summary, null, 2))