// Aggregate the chunk JSONs `erlang-census-all.sh` writes into one verdict.
//
// The aggregation is deliberately strict about what it is allowed to claim:
//
//  - it reports how many chunks are MISSING, because a partial run that reads
//    "0 unexplained" over half the corpus is the exact failure this lane keeps
//    hitting (a reused parser skipping 422 files while the header said 4,326);
//  - it sums the disagreement LISTS, not the per-chunk verdicts, so a chunk that
//    silently disagreed cannot be averaged away;
//  - it fails if any chunk is missing or any chunk failed, so a partial run cannot
//    be mistaken for a clean one.
import * as fs from "node:fs"
import * as path from "node:path"

const dir = process.argv[2] ?? "/home/sano/ishaq/bb_tests/erl-evidence/census"

function main(): void {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^chunk-\d+\.json$/.test(f))
    .sort()
  const expected = fs.readdirSync(dir).filter((f) => /^chunk-\d+\.log$/.test(f)).length
  if (files.length === 0) {
    console.error(`no chunk JSON in ${dir} — nothing to aggregate`)
    process.exit(1)
  }

  const t = {
    filesRead: 0,
    parsed: 0,
    grammarErrors: 0,
    symbols: 0,
    relationships: 0,
    oracleRelationships: 0,
    unexplained: 0,
    missing: 0,
    lineMismatch: 0,
    symbolMismatch: 0,
    noTree: 0,
    macroModuleRemotes: 0,
    grammarDamaged: 0,
  }
  const samples: Record<string, string[]> = {
    unexplained: [],
    missing: [],
    lineMismatch: [],
    symbolMismatch: [],
    noTree: [],
  }
  const perCorpus = new Map<string, { files: number; symbols: number; relationships: number; ms: number }>()
  let worstChunk = 0

  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))
    t.filesRead += d.filesRead
    t.parsed += d.parsed
    t.grammarErrors += d.grammarErrors
    t.symbols += d.symbols
    t.relationships += d.relationships
    t.oracleRelationships += d.oracleRelationships
    t.unexplained += d.unexplained
    t.missing += d.missing
    t.lineMismatch += d.lineMismatch
    t.symbolMismatch += d.symbolMismatch
    t.noTree += d.noTree
    t.macroModuleRemotes += d.macroModuleRemotes
    t.grammarDamaged += d.grammarDamaged ?? 0
    const bad = d.unexplained + d.missing + d.lineMismatch + d.symbolMismatch
    if (bad > worstChunk) worstChunk = bad
    for (const k of Object.keys(samples) as (keyof typeof samples)[]) {
      const src = (d as any)[`${k}Sample`] as string[] | undefined
      if (src) samples[k].push(...src)
    }
    for (const [c, v] of Object.entries(d.perCorpus ?? {})) {
      const cur = perCorpus.get(c) ?? { files: 0, symbols: 0, relationships: 0, ms: 0 }
      cur.files += v.files
      cur.symbols += v.symbols
      cur.relationships += v.relationships
      cur.ms += v.ms
      perCorpus.set(c, cur)
    }
  }

  const pct = t.relationships ? ((t.oracleRelationships / t.relationships) * 100).toFixed(4) : "n/a"
  console.log("")
  console.log("# ER3 corpus dual lens — FULL CORPUS, aggregated from chunks")
  console.log(`  chunks present: ${files.length}${expected ? ` of ${expected} attempted` : ""}`)
  console.log(`  files read ${t.filesRead} | examined by BOTH lenses ${t.parsed} | grammar errors ${t.grammarErrors}`)
  console.log(`  yielded no tree (NOT examined by either lens): ${t.noTree}`)
  console.log("")
  console.log("| metric | value |")
  console.log("|---|---|")
  console.log(`| symbols emitted | ${t.symbols} |`)
  console.log(`| relationships emitted | ${t.relationships} |`)
  console.log(`| oracle-derived relationships | ${t.oracleRelationships} |`)
  console.log(`| agreement (oracle/analyzer) | ${pct}% |`)
  console.log(`| UNEXPLAINED (analyzer-only) | ${t.unexplained} |`)
  console.log(`| MISSING (oracle-only) | ${t.missing} |`)
  console.log(`| line-contract mismatches | ${t.lineMismatch} |`)
  console.log(`| symbol mismatches | ${t.symbolMismatch} |`)
  console.log(`| ruled-empty: macro-module remotes (ER-D35) | ${t.macroModuleRemotes} |`)
  console.log(`| whole-file grammar damage (no top-level form survives) | ${t.grammarDamaged} |`)
  console.log("")
  console.log("## per corpus")
  console.log("")
  console.log("| corpus | files | symbols | relationships | ms |")
  console.log("|---|---|---|---|---|")
  for (const [c, v] of [...perCorpus.entries()].sort()) {
    console.log(`| ${c} | ${v.files} | ${v.symbols} | ${v.relationships} | ${v.ms} |`)
  }
  for (const [k, arr] of Object.entries(samples)) {
    if (arr.length === 0) continue
    console.log("")
    console.log(`## ${k} (${arr.length} sampled, first 20)`)
    for (const s of arr.slice(0, 20)) console.log(`  ${s}`)
  }

  const missingChunks = expected - files.length
  const disagreements = t.unexplained + t.missing + t.lineMismatch + t.symbolMismatch
  const out = {
    gate: "ER3 corpus dual lens (erlang, full corpus, chunked)",
    chunksPresent: files.length,
    chunksAttempted: expected,
    filesRead: t.filesRead,
    examinedByBothLenses: t.parsed,
    yieldedNoTree: t.noTree,
    grammarErrors: t.grammarErrors,
    symbols: t.symbols,
    relationships: t.relationships,
    oracleRelationships: t.oracleRelationships,
    unexplained: t.unexplained,
    missing: t.missing,
    lineMismatch: t.lineMismatch,
    symbolMismatch: t.symbolMismatch,
    macroModuleRemotes: t.macroModuleRemotes,
    grammarDamaged: t.grammarDamaged,
    missingChunks,
    perCorpus: Object.fromEntries(perCorpus.entries()),
    verdict:
      missingChunks === 0 && disagreements === 0 ? "PASS" : missingChunks === 0 ? "FAIL" : "INCOMPLETE",
  }
  fs.writeFileSync(path.join(dir, "aggregate.json"), JSON.stringify(out, null, 2) + "\n")
  console.log("")
  console.log(`verdict: ${out.verdict}  (chunks ${files.length}/${expected}, disagreements ${disagreements})`)
  console.log(`written: ${path.join(dir, "aggregate.json")}`)
  if (out.verdict !== "PASS") process.exitCode = 1
}

main()