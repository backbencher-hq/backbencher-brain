/**
 * ZIG PASS 25 — HOW MANY CORPUS FILES DOES THE PINNED GRAMMAR FAIL ON?
 *
 * ## Why this exists
 *
 * Four separate instruments have now died the same way on the zig lane, and each death cost a
 * whole measurement:
 *
 *   [BB-PARSE-ERR] zig | ... | memory access out of bounds
 *   [BB-HANG] parser stuck 120s on <that same file> — exiting        <- process.exit(1)
 *
 * Pass 24 §H.1 recorded 2 of 2 on the shared arbiter; pass 25 reproduced it a third time
 * (`ghostty/src/lib/tinyio/test.zig`) and then a fourth time on this lane's OWN census at the
 * full population (`zig/test/cases/safety/value does not fit in shortening cast.zig`). The
 * arbiter's verdict for zig is therefore not a statement about zig's coverage — it is a
 * statement about which file the guard happened to reach first.
 *
 * The number that would price that is: **how many of the 3,848 zig corpus files does the
 * grammar fail on at all?** Nobody has measured it, and every zig figure in the programme —
 * including the 7/10 emitted verdict — is a lower bound by exactly that count.
 *
 * ## The instrument, and what it is NOT
 *
 * It calls `parser.parse()` from `web-tree-sitter` on the PINNED `wasm/tree-sitter-zig.wasm`,
 * the same file `src/ast/engine.ts` loads, with NO 120 s guard. That is deliberate and it is
 * the instrument's one weakness, stated here rather than buried:
 *
 *   - it is NOT `parseFile`. Per the workstream contract every RELATIONSHIP count must come
 *     from production `parseFile`. This probe counts no relationships, only per-file parse
 *     outcomes, so it does not need the pipeline stages.
 *   - it applies NO size routing, so it measures the grammar on the WHOLE file, while
 *     production reads a 256 KB prefix above 1 MB. Pass 25b measured those 4 files separately.
 *
 * Three outcomes, and they are different claims:
 *
 *   clean   `tree.rootNode.hasError === false` — the grammar's own verdict, no defect
 *   error   parsed, but `hasError` — recoverable; the tree still exists and is still walked
 *   TRAP    `parser.parse()` THREW. This is the class that kills a walk, because engine.ts's
 *           guard converts it into `process.exit(1)` for the WHOLE process.
 *
 * The trap class is also recorded per file SIZE and per repo, because the mechanism matters
 * for the §8 report: if the traps cluster on large files they are a size problem, and if they
 * scatter they are a grammar problem.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/zig/parse-robustness.ts [root] [--out p]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Parser, Language } from "web-tree-sitter"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")

const argv = process.argv.slice(2)
const arg = (n: string, d: string): string => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const corpusRoot = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1]?.startsWith("--") !== true) ?? "/home/ishaq2321/bb_tests/repositories"
const out = arg("out", "")

await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new Parser()
const language: any = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
parser.setLanguage(language)

// The population is every .zig file the corpus root holds, named by an independent walk —
// not a hash draw, because a census of the grammar's failure rate has no sampling step:
// the question is about the corpus, so the corpus is the population.
const files = execFileSync("bash", ["-lc", `find ${corpusRoot} -name '*.zig' -type f -printf '%s\\t%p\\n'`], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const tab = l.indexOf("\t")
    return { size: Number(l.slice(0, tab)), path: l.slice(tab + 1) }
  })
  .sort((a, b) => (a.path < b.path ? -1 : 1))

const drawHash = createHash("sha256")
  .update(files.map((f) => f.path).join("\n"))
  .digest("hex")
  .slice(0, 16)

type Outcome = "clean" | "error" | "TRAP"
const rows: {
  path: string
  size: number
  outcome: Outcome
  bytes: number
  ms: number
  message: string
}[] = []

for (const f of files) {
  let text: string
  try {
    text = readFileSync(f.path, "utf8")
  } catch (e: any) {
    rows.push({ path: f.path, size: f.size, outcome: "TRAP", bytes: 0, ms: 0, message: `READ: ${e?.message ?? e}`.slice(0, 120) })
    continue
  }
  const t0 = Date.now()
  try {
    const tree: any = parser.parse(text)
    const hasError = tree?.rootNode?.hasError === true
    const bytes = Number(tree?.rootNode?.endIndex ?? 0)
    tree?.delete?.()
    rows.push({
      path: f.path,
      size: f.size,
      outcome: hasError ? "error" : "clean",
      bytes,
      ms: Date.now() - t0,
      message: hasError ? "rootNode.hasError" : "",
    })
  } catch (e: any) {
    rows.push({
      path: f.path,
      size: f.size,
      outcome: "TRAP",
      bytes: 0,
      ms: Date.now() - t0,
      message: String(e?.message ?? e).slice(0, 120),
    })
  }
}

const by = (o: Outcome) => rows.filter((r) => r.outcome === o)
const repoOf = (p: string): string => {
  const m = p.match(/\/repositories\/([^/]+)\//)
  return m ? m[1] : "(root)"
}

const traps = by("TRAP")
const trapRepos = new Map<string, number>()
for (const t of traps) trapRepos.set(repoOf(t.path), (trapRepos.get(repoOf(t.path)) ?? 0) + 1)

// Size distribution of the trap class, against the same bands production uses. The bands are
// read from pool-worker so this table cannot drift away from the routing that hides them.
const src = readFileSync(path.join(ROOT, "src/ast/pool-worker.ts"), "utf8")
const fullAstMB = Number(src.match(/FULL_AST_LIMIT\s*=\s*(\d+)/)?.[1] ?? 1)
const structuralMB = Number(src.match(/STRUCTURAL_LIMIT\s*=\s*(\d+)/)?.[1] ?? 5)
const band = (b: number): string => (b > structuralMB ? `>${structuralMB}MB` : b > fullAstMB ? `${fullAstMB}-${structuralMB}MB` : `<=${fullAstMB}MB`)
const bandTable: Record<string, { total: number; trap: number; error: number }> = {}
for (const r of rows) {
  const k = band(r.size / 1024 / 1024)
  bandTable[k] ??= { total: 0, trap: 0, error: 0 }
  bandTable[k].total++
  if (r.outcome === "TRAP") bandTable[k].trap++
  if (r.outcome === "error") bandTable[k].error++
}

const report = {
  instrument: "validation/m14/fixtures/zig/parse-robustness.ts",
  method: "web-tree-sitter Parser.parse on wasm/tree-sitter-zig.wasm, no 120s guard, no size routing; no relationship counted",
  population: {
    root: corpusRoot,
    files: files.length,
    drawHash,
    note: "every .zig file under the root, sorted by path; not a sample",
  },
  outcome: {
    clean: by("clean").length,
    errorNode: by("error").length,
    TRAP: traps.length,
    trapPctOfPopulation: Number(((traps.length / files.length) * 100).toFixed(5)),
  },
  trapFiles: traps.map((t) => ({ path: t.path, size: t.size, ms: t.ms, message: t.message })),
  trapByRepo: Object.fromEntries([...trapRepos.entries()].sort((a, b) => b[1] - a[1])),
  byProductionBand: bandTable,
  slowestFive: [...rows].sort((a, b) => b.ms - a.ms).slice(0, 5).map((r) => ({ path: r.path, size: r.size, ms: r.ms, outcome: r.outcome })),
}

console.log(`ZIG PARSE ROBUSTNESS — ${files.length} files, draw ${drawHash}`)
console.log(`  instrument         web-tree-sitter on the pinned wasm, no 120s guard, no size routing`)
console.log(`  clean              ${report.outcome.clean}  (${((report.outcome.clean / files.length) * 100).toFixed(3)}%)`)
console.log(`  error node         ${report.outcome.errorNode}  (recoverable, tree still produced)`)
console.log(`  TRAP               ${report.outcome.TRAP}  (${report.outcome.trapPctOfPopulation}%)  <- kills a walk`)
console.log("")
console.log(`  by production size band (bands read from pool-worker.ts):`)
for (const [k, v] of Object.entries(bandTable)) {
  console.log(`    ${k.padEnd(11)} total ${String(v.total).padStart(5)}  trap ${String(v.trap).padStart(4)}  error ${String(v.error).padStart(5)}`)
}
console.log("")
console.log(`  traps by repo:`)
for (const [k, v] of Object.entries(report.trapByRepo)) console.log(`    ${String(v).padStart(4)}  ${k}`)
console.log("")
console.log(`  slowest five parses:`)
for (const s of report.slowestFive) console.log(`    ${String(s.ms).padStart(7)} ms  ${s.outcome.padEnd(5)}  ${(s.size / 1024).toFixed(0)} KB  ${s.path}`)
console.log("")
if (traps.length === 0) {
  console.log("NOTE: 0 traps at grammar level. A [BB-HANG] would then not be a grammar failure and")
  console.log("      item 40's mechanism would have to be re-derived from the fan-out, not from the file.")
}
if (out) {
  writeFileSync(out, JSON.stringify(report, null, 2))
  console.log(`  written ${out}`)
}