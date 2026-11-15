/**
 * M72 Phase 2b-6 — lead-density funnel per corpus.
 *
 * WHY THIS EXISTS
 *   Five real repositories produced 9 leads total. Three of them (graphql-js, rake,
 *   rebar3) produced zero. Before deciding whether to widen specs or accept a lower
 *   ceiling, we need to know WHERE the candidates are lost, with counts at each stage:
 *
 *     files → language-eligible files → symbols → non-container symbols
 *           → symbols with a SOURCE match → symbols with a SINK match
 *           → symbols with BOTH (candidates) → ACCEPTED leads
 *
 *   A stage that drops to zero names the actual limit. "The spec lacks sinks" and
 *   "the flow engine rejected every candidate" are different problems with different
 *   fixes, and guessing between them is how a tool ends up claiming coverage it
 *   cannot produce.
 *
 * WHAT IT DOES NOT DO
 *   Read-only over the corpus DBs and the working tree. No engine change, no spec
 *   change, no index write. It reports rejection reasons so the limit is evidence,
 *   not narration.
 *
 * COMMAND: npx tsx script/m72/oracle/probe-density.ts
 * EVIDENCE: validation/m72/results/density.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, "..", "..", "..")
const EVIDENCE = join(REPO_ROOT, "validation", "m72", "results", "density.json")

interface CorpusRow {
  name: string
  dbPath: string
  root: string
}

interface StageCounts {
  files: number
  languageEligibleFiles: number
  symbols: number
  nonContainerSymbols: number
  withSource: number
  withSink: number
  withBoth: number
  accepted: number
}

interface CorpusFunnel extends StageCounts {
  corpus: string
  rejectionReasons: Record<string, number>
  topFamilies: Record<string, number>
}

function loadRows(): CorpusRow[] {
  const p = join(REPO_ROOT, "validation", "tools", "bb_security", "REAL-CORPUS.json")
  if (!existsSync(p)) return []
  const doc = JSON.parse(readFileSync(p, "utf8"))
  const rows: CorpusRow[] = []
  for (const c of doc.corpora ?? []) {
    const dbPath = c?.census?.dbPath
    const root = c?.path
    if (typeof dbPath === "string" && existsSync(dbPath) && typeof root === "string") {
      rows.push({ name: String(c.name ?? "?"), dbPath, root })
    }
  }
  return rows
}

async function main(): Promise<number> {
  const Database = (await import("better-sqlite3")).default
  const { parseFile } = await import("../../../src/ast/pool-worker")
  const { matchSymbol } = await import("../../../src/intelligence/security/rebuild/matcher")
  const { evaluateSinkFlow } = await import("../../../src/intelligence/security/rebuild/flow")
  const { specForLanguage } = await import("../../../src/intelligence/security/rebuild/specs/index")
  const { isTestFileCandidate } = await import("../../../src/ast/test-classification")

  const rows = loadRows()
  if (rows.length === 0) {
    console.error("no corpus DBs found in REAL-CORPUS.json")
    return 1
  }

  const CONTAINER = new Set(["class", "interface", "struct", "enum", "impl", "object", "trait", "module", "namespace", "type", "record"])
  const funnels: CorpusFunnel[] = []

  for (const row of rows) {
    const db = new Database(row.dbPath, { readonly: true })
    const files = db.prepare(
      `SELECT id, relative_path, language, is_test_file FROM brain_file WHERE is_test_file = 0`,
    ).all() as Array<{ id: string; relative_path: string; language: string; is_test_file: number }>
    db.close()

    const counts: StageCounts = {
      files: files.length,
      languageEligibleFiles: 0,
      symbols: 0,
      nonContainerSymbols: 0,
      withSource: 0,
      withSink: 0,
      withBoth: 0,
      accepted: 0,
    }
    const rejectionReasons: Record<string, number> = {}
    const topFamilies: Record<string, number> = {}

    const byLanguage = new Map<string, typeof files>()
    for (const f of files) {
      if (!specForLanguage(f.language)) continue
      counts.languageEligibleFiles++
      const list = byLanguage.get(f.language) ?? []
      list.push(f)
      byLanguage.set(f.language, list)
    }

    for (const [language, langFiles] of byLanguage) {
      const spec = specForLanguage(language)!
      for (const f of langFiles) {
        const abs = join(row.root, f.relative_path)
        if (!existsSync(abs)) continue
        let parsed: any
        try {
          parsed = await parseFile(abs, row.root, {})
        } catch {
          continue
        }
        const content: string = readFileSync(abs, "utf8")
        for (const sym of parsed.symbols ?? []) {
          counts.symbols++
          const kind = String(sym.kind ?? sym.type ?? "").toLowerCase()
          if (CONTAINER.has(kind)) continue
          counts.nonContainerSymbols++
          const start = sym.range?.startIndex ?? sym.startIndex
          const end = sym.range?.endIndex ?? sym.endIndex
          if (typeof start !== "number" || typeof end !== "number" || end <= start) continue
          if (end - start > 64 * 1024) continue
          const body = content.slice(start, end)
          if (!body) continue

          let m: any
          try {
            m = matchSymbol(spec, body)
          } catch {
            continue
          }
          const hasSource = (m.sources ?? []).length > 0
          const hasSink = (m.sinks ?? []).length > 0
          if (hasSource) counts.withSource++
          if (hasSink) counts.withSink++
          if (!hasSource || !hasSink) continue
          counts.withBoth++

          for (const sink of m.sinks ?? []) {
            let decision: any
            try {
              decision = evaluateSinkFlow(spec, m, sink, m.assignments ?? [])
            } catch {
              rejectionReasons["evaluate-threw"] = (rejectionReasons["evaluate-threw"] ?? 0) + 1
              continue
            }
            if (decision.accepted) {
              counts.accepted++
              const fam = decision.vulnerability ?? sink.vulnerability ?? "?"
              topFamilies[fam] = (topFamilies[fam] ?? 0) + 1
            } else {
              const why = decision.rejection ?? "unknown"
              rejectionReasons[why] = (rejectionReasons[why] ?? 0) + 1
            }
          }
        }
      }
    }

    const funnel: CorpusFunnel = { corpus: row.name, ...counts, rejectionReasons, topFamilies }
    funnels.push(funnel)
    console.log(
      `${row.name.padEnd(12)} files=${counts.files} eligible=${counts.languageEligibleFiles} symbols=${counts.symbols} ` +
        `nonContainer=${counts.nonContainerSymbols} src=${counts.withSource} sink=${counts.withSink} both=${counts.withBoth} accepted=${counts.accepted}`,
    )
    const rej = Object.entries(rejectionReasons).sort((a, b) => b[1] - a[1]).slice(0, 5)
    if (rej.length) console.log(`             rejections: ${rej.map(([k, v]) => `${k}=${v}`).join(", ")}`)
  }

  const totals = funnels.reduce(
    (a, f) => ({
      files: a.files + f.files,
      languageEligibleFiles: a.languageEligibleFiles + f.languageEligibleFiles,
      symbols: a.symbols + f.symbols,
      nonContainerSymbols: a.nonContainerSymbols + f.nonContainerSymbols,
      withSource: a.withSource + f.withSource,
      withSink: a.withSink + f.withSink,
      withBoth: a.withBoth + f.withBoth,
      accepted: a.accepted + f.accepted,
    }),
    { files: 0, languageEligibleFiles: 0, symbols: 0, nonContainerSymbols: 0, withSource: 0, withSink: 0, withBoth: 0, accepted: 0 },
  )

  console.log(`\nTOTALS: ${JSON.stringify(totals)}`)
  console.log("\nWhere the loss happens (ratio to previous stage):")
  const stages: Array<[string, number, number]> = [
    ["files -> language-eligible", totals.languageEligibleFiles, totals.files],
    ["eligible -> symbols", totals.symbols, totals.languageEligibleFiles],
    ["symbols -> non-container", totals.nonContainerSymbols, totals.symbols],
    ["non-container -> with a source", totals.withSource, totals.nonContainerSymbols],
    ["non-container -> with a sink", totals.withSink, totals.nonContainerSymbols],
    ["with source/sink -> both", totals.withBoth, Math.min(totals.withSource, totals.withSink)],
    ["both -> accepted lead", totals.accepted, totals.withBoth],
  ]
  for (const [label, num, den] of stages) {
    const pct = den > 0 ? ((num / den) * 100).toFixed(1) + "%" : "n/a"
    console.log(`  ${label.padEnd(32)} ${num}/${den} = ${pct}`)
  }

  const out = {
    probe: "m72-density-funnel",
    what: "per-corpus counts at each stage from files to accepted leads; names the stage where candidates are lost",
    generatedAt: new Date().toISOString(),
    corpora: funnels,
    totals,
    limits: [
      "read-only: no engine, spec or index change; counts come from the real specs and flow engine",
      "a symbol with both a source and a sink in the same body is a CANDIDATE; acceptance is the flow engine's decision",
      "rejection reasons are the engine's own, not a guess; 'no_reaching_source' means the sink argument was not provably source-derived",
      "this is a density measurement over the five Phase-2a corpora, not a precision or recall figure",
    ],
  }
  mkdirSync(dirname(EVIDENCE), { recursive: true })
  writeFileSync(EVIDENCE, JSON.stringify(out, null, 2) + "\n")
  console.log(`\nevidence: ${EVIDENCE}`)
  return 0
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error instanceof Error ? error.stack ?? String(error) : String(error))
  process.exit(1)
})