/**
 * `keepSymbol` CENSUS — what the production pipeline DROPS on the way to the index.
 *
 * ## Why this exists
 *
 * `src/ast/pool-worker.ts` filters the analyzer's symbols through `keepSymbol`
 * before anything is indexed, and `keepSymbol` carries a `NOISE_TARGETS` list of
 * names it refuses. That list deletes REAL project symbols whose names happen to
 * collide with a framework convention — a `root`, a `type`, a `parent`, a
 * `firstChild`. The file's own comment documents the defect class for the names it
 * already fixed; this instrument measures which entries are still live, so the
 * answer is a number over real code rather than a reading of a list.
 *
 * This is a SHARED-MACHINERY finding, filed not fixed: `NOISE_TARGETS` lives in
 * `src/ast/pool-worker.ts`, which this lane does not own. It is recorded as
 * SQL-G13 in `script/m14/spec/sql-completeness.json`.
 *
 * ## Why it walks the corpus rather than a fixture
 *
 * The defect needs a symbol whose name collides. Inventing one in a fixture would
 * measure that the filter drops a name, which is already known; what is not known
 * is whether any real declaration in the corpus is affected, and only the corpus
 * answers that.
 *
 * ## What it reports
 *
 * For every symbol the analyzer emits over the admitted corpus, whether
 * `keepSymbol` would drop it, grouped by `kind:name`, with example files. A count
 * of 0 is the pass condition and is reported as loudly as a non-zero one.
 *
 * USAGE:
 *   npx tsx validation/m14/fixtures/sql/keep-symbol-census.mts [--out FILE]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { Parser, Language } from "web-tree-sitter"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { RealSqlAnalyzer } from "../../../../src/ast/real-sql-analyzer"
import * as poolWorker from "../../../../src/ast/pool-worker"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 512 * 1024
const argv = process.argv.slice(2)
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const OUT = argOf("--out")

await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-sql.wasm")))
const parser = new Parser()
parser.setLanguage(lang as any)
;(RealSqlAnalyzer as any).setGrammar(lang, (parser as any).constructor)

// Discovery is identical to `ontology-census.mts` and to the arbiter's, so all
// three describe the same file set.
const files: string[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "sql") continue
    files.push(abs)
  }
}

const keepSymbol = (poolWorker as any).keepSymbol
if (typeof keepSymbol !== "function") {
  console.error("pool-worker does not export keepSymbol; this instrument cannot measure the filter and says so rather than reporting 0")
  process.exit(2)
}

const dropped = new Map<string, { n: number; kind: string; name: string; examples: string[] }>()
let symbols = 0
let droppedTotal = 0
for (const f of files) {
  const text = readFileSync(f, "utf8")
  const tree = parser.parse(text)
  if (!tree) continue
  const r: any = new RealSqlAnalyzer().analyze(tree.rootNode as any, text, f)
  for (const s of r.symbols) {
    symbols++
    if (keepSymbol(s, "sql")) continue
    droppedTotal++
    const key = `${s.kind}:${s.name}`
    const rec = dropped.get(key) ?? { n: 0, kind: String(s.kind), name: String(s.name), examples: [] }
    rec.n++
    if (rec.examples.length < 3) rec.examples.push(f.replace(`${CR}/`, ""))
    dropped.set(key, rec)
  }
}

const rows = [...dropped.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
console.log(`keepSymbol census — ${files.length} admitted files, ${symbols} symbols emitted, ${droppedTotal} dropped (${((droppedTotal / Math.max(symbols, 1)) * 100).toFixed(3)}%)`)
for (const r of rows) console.log(`  ${r.n}x ${r.kind}:${r.name}   e.g. ${r.examples[0]}`)
if (!rows.length) console.log("  (none)")

if (OUT) {
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        instrument: "validation/m14/fixtures/sql/keep-symbol-census.mts",
        entryPoint: "RealSqlAnalyzer.analyze + pool-worker keepSymbol",
        corpusRoot: CR,
        admittedFiles: files.length,
        symbolsEmitted: symbols,
        droppedTotal,
        droppedPct: Number(((droppedTotal / Math.max(symbols, 1)) * 100).toFixed(3)),
        dropped: rows,
        finding: "SQL-G13 in script/m14/spec/sql-completeness.json. src/ast/pool-worker.ts is shared machinery; filed, not edited.",
      },
      null,
      2,
    ) + "\n",
  )
  console.log(`wrote ${OUT}`)
}
