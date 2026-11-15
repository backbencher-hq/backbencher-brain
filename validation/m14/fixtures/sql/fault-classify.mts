/**
 * FAULT CLASSIFY — which corpus files make `parseFile` unusable, solo and under load.
 *
 * WHY THIS EXISTS. `src/ast/engine.ts` answers a 120-second hang around the SYNCHRONOUS
 * `parser.parse()` with `process.exit(1)`, because `setTimeout` cannot interrupt blocked C/WASM code.
 * A file that does that therefore takes the whole measurement down with it: on pass 3 the census was
 * killed three times in a row by three DIFFERENT files, and a fourth (`day04.sql`) and fifth
 * (`day01.sql`) followed. Each kill cost a full corpus walk, and the identity of the faulting file
 * moved between runs.
 *
 * The pass-2 page named three files. Pass 3 observed six. Both lists were assembled by being killed,
 * which is not a measurement — it is a record of which file happened to fault on the day. This
 * script MEASURES the set instead, on two axes that matter separately:
 *
 *   solo        — one parse per PROCESS. Establishes whether a file is unconditionally unfaultable.
 *   contended   — N parses in one process, the way a census runs. Establishes whether the fault is a
 *                 property of the file or of concurrent wasm state, which is the distinction the
 *                 pass-2 page asserted from three solo runs of one file.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/sql/fault-classify.mts --out FILE --concurrency 8 <file> ...
 *   npx tsx validation/m14/fixtures/sql/fault-classify.mts --out FILE --solo <file> ...
 *
 * A file that hangs takes the process with it, so `--solo` is meant to be invoked ONCE PER FILE by
 * the caller (`timeout 45 npx tsx ... --solo f.sql`), which is why solo is a separate mode.
 */
import { writeFileSync } from "node:fs"
import { parseFile } from "../../../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const SOLO = argv.includes("--solo")
function readFlag(name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const CONCURRENCY = Number(readFlag("--concurrency") ?? 8)
const OUT = readFlag("--out")
// Positional arguments are the FILES. A naive filter is how `--concurrency 8` ends up being parsed
// as a filename (measured: 2 spurious ENOENT rows per run), so flags are consumed positionally.
const FILES: string[] = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === "--solo") continue
  if (a === "--out" || a === "--concurrency") { i++; continue }
  FILES.push(a)
}

/**
 * The three outcomes, named by what they are rather than by whether they are inconvenient:
 *   ok             — a real analyzer result
 *   okZeroSymbols  — a real analyzer result that declares nothing (NOT a fault)
 *   regexFallback  — pool-worker's catch answered a real parse error with `extractFallback`
 *   timeoutFallback— engine.ts answered its own 120s analyzer timeout with a basic parse result
 *
 * No regex (lane policy): substring tests only.
 */
function classify(r: any): string {
  if (!r) return "timeoutFallback"
  const errs: any[] = Array.isArray(r.errors) ? r.errors : []
  for (const e of errs) {
    const m = String(e?.message ?? "").toLowerCase()
    if (m.includes("timeout")) return "timeoutFallback"
  }
  if (String(r?.metadata?.analysisVersion ?? "") === "2.0-basic-fallback") return "timeoutFallback"
  if (r.fallback === true) return "regexFallback"
  const n = Array.isArray(r.symbols) ? r.symbols.length : 0
  return n > 0 ? "ok" : "okZeroSymbols"
}

const rows: any[] = []
if (SOLO) {
  for (const f of FILES) {
    const t0 = Date.now()
    let verdict = "threw"
    let detail = ""
    let syms = -1
    let rels = -1
    try {
      const r: any = await parseFile(f, process.cwd())
      verdict = classify(r)
      syms = Array.isArray(r?.symbols) ? r.symbols.length : 0
      rels = Array.isArray(r?.relationships) ? r.relationships.length : 0
      for (const e of (Array.isArray(r?.errors) ? r.errors : [])) detail = String(e?.message ?? detail)
    } catch (e) {
      detail = String((e as Error)?.message ?? e)
    }
    rows.push({ file: f, mode: "solo", verdict, ms: Date.now() - t0, symbols: syms, relationships: rels, detail: detail.slice(0, 160) })
    console.log(`${verdict.padEnd(16)} ${String(Date.now() - t0).padStart(7)}ms  sym=${String(syms).padStart(5)} rel=${String(rels).padStart(5)}  ${f}${detail ? "  | " + detail.slice(0, 90) : ""}`)
  }
} else {
  let idx = 0
  async function worker() {
    for (;;) {
      const i = idx++
      if (i >= FILES.length) return
      const f = FILES[i]
      const t0 = Date.now()
      let verdict = "threw"
      let detail = ""
      let syms = -1
      let rels = -1
      try {
        const r: any = await parseFile(f, process.cwd())
        verdict = classify(r)
        syms = Array.isArray(r?.symbols) ? r.symbols.length : 0
        rels = Array.isArray(r?.relationships) ? r.relationships.length : 0
        for (const e of (Array.isArray(r?.errors) ? r.errors : [])) detail = String(e?.message ?? detail)
      } catch (e) {
        detail = String((e as Error)?.message ?? e)
      }
      rows.push({ file: f, mode: `concurrency-${CONCURRENCY}`, verdict, ms: Date.now() - t0, symbols: syms, relationships: rels, detail: detail.slice(0, 160) })
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  const by = new Map<string, number>()
  for (const r of rows) by.set(r.verdict, (by.get(r.verdict) ?? 0) + 1)
  console.log(`contended (${CONCURRENCY}-way), ${FILES.length} file(s): ` + [...by.entries()].map(([k, v]) => `${k}=${v}`).join("  "))
  for (const r of rows.filter((r) => r.verdict !== "ok" && r.verdict !== "okZeroSymbols")) {
    console.log(`  ${r.verdict.padEnd(16)} ${String(r.ms).padStart(7)}ms  ${r.file}${r.detail ? "  | " + r.detail.slice(0, 90) : ""}`)
  }
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    instrument: "validation/m14/fixtures/sql/fault-classify.mts",
    entryPoint: "parseFile (src/ast/pool-worker.ts)",
    mode: SOLO ? "solo" : `concurrency-${CONCURRENCY}`,
    note: "engine.ts answers a 120s parser hang with process.exit(1), so a file that hangs CANNOT appear in this artifact — it kills the run. Absence here is not evidence of safety unless the run completed.",
    rows,
  }, null, 2))
  console.log(`wrote ${OUT}`)
}