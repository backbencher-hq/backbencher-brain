// M12 per-analyzer complexity measurement.
//
// Measures the extraction complexity envelope of a single analyzer on its
// fixtures: wall time, symbols/s, relationships/s, peak RSS. Optionally runs
// a corpus subset too (pass the corpus dir as second arg).
//
// Usage: bun script/m12/measure-analyzer.ts <lang> [corpusDir]
// Example: bun script/m12/measure-analyzer.ts java
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { measureOperation } from "../m11/differential-harness"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = process.cwd()
const lang = process.argv[2]
const corpusDir = process.argv[3]
if (!lang) {
  console.error("usage: bun script/m12/measure-analyzer.ts <lang> [corpusDir]")
  process.exit(1)
}

const FIXTURE_DIR = join(ROOT, "validation/m12/fixtures", lang)
const OUT_FILE = join(ROOT, "validation/m12/results", `${lang}-complexity.json`)

function listFiles(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return []
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (st.isFile() && st.size > 0 && st.size <= 1 * 1024 * 1024) out.push(full)
    }
  }
  walk(dir)
  return out
}

async function runSet(label: string, files: string[]): Promise<{ name: string; measurement: any; symbols: number; relationships: number }> {
  const started = Date.now()
  const result = await measureOperation(
    `${label}:${lang}`,
    async () => {
      let symbols = 0
      let relationships = 0
      for (const f of files) {
        try {
          const p = await parseFile(f, ROOT)
          symbols += p.symbols?.length ?? 0
          relationships += p.relationships?.length ?? 0
        } catch {}
      }
      return { symbols, relationships }
    },
    { files: files.length },
  )
  const wallMs = result.measurement.wallTimeMs || (Date.now() - started)
  const { measurement, value } = result
  // measureOperation only wires counts it was told about; patch throughput
  // from the actual symbol/relationship totals so the envelope is complete.
  measurement.symbols = value.symbols
  measurement.relationships = value.relationships
  measurement.symbolsPerSecond = wallMs > 0 ? (value.symbols / (wallMs / 1000)) : null
  measurement.relationshipsPerSecond = wallMs > 0 ? (value.relationships / (wallMs / 1000)) : null
  return { name: label, measurement, ...value }
}

async function main() {
  const fixtureFiles = listFiles(FIXTURE_DIR)
  if (fixtureFiles.length === 0) {
    console.error(`no fixtures in ${FIXTURE_DIR}`)
    process.exit(1)
  }
  const runs: any[] = []

  runs.push(await runSet("fixtures", fixtureFiles))

  let corpusStats: { files: number; symbols: number; relationships: number; measurement: any } | null = null
  if (corpusDir) {
    const corpusFiles = listFiles(corpusDir)
    if (corpusFiles.length > 0) {
      corpusStats = await runSet("corpus_subset", corpusFiles)
      runs.push(corpusStats)
    }
  }

  const document = {
    schemaVersion: 1,
    kind: `per_analyzer_complexity:${lang}`,
    fixtureDir: `validation/m12/fixtures/${lang}`,
    corpusDir: corpusDir ?? null,
    runs,
    note: "Complexity envelope per analyzer: wall time, symbols/s, relationships/s, peak RSS. Budgets are declared per analyzer in docs/analyzers/.",
  }
  writeFileSync(OUT_FILE, JSON.stringify(document, null, 2) + "\n")

  for (const run of runs) {
    const m = run.measurement
    console.log(`[${run.name}] files=${m.files} symbols=${run.symbols} rels=${run.relationships} wall=${m.wallTimeMs.toFixed(1)}ms syms/s=${m.symbolsPerSecond?.toFixed(0) ?? "n/a"} rels/s=${m.relationshipsPerSecond?.toFixed(0) ?? "n/a"} peakRSS=${(m.peakRssBytes / 1048576).toFixed(1)}MB`)
  }
  console.log(`wrote ${OUT_FILE}`)
  process.exit(0)
}

main().catch((e) => {
  console.error(`measure-analyzer ${lang} failed:`, e)
  process.exit(1)
})
