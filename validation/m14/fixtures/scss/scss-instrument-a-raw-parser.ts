/**
 * SCSS INSTRUMENT-A RAW PARSER REPRODUCTION — why the arbiter exits 1 after printing a
 * correct table.
 *
 * ## WHAT THE ARBITER DOES, IN ORDER
 *
 * `script/m14/ontology-coverage-gate.ts` on `--fresh` prints its table and then exits 1:
 *
 *     emitted 8/10   ruled-sound 2   FALSIFIED 0   ruled-without-justification 0
 *     [BB-HANG] parser stuck 120s on .../components/informed-action/index.scss — exiting
 *
 * The table is printed BEFORE instrument A runs, so the verdict is already decided when
 * the process dies; the two RULED-SOUND rows are the ones instrument A is supposed to
 * check. Instrument A is this loop, and it is the only part of the gate that does NOT go
 * through `parseFile`:
 *
 *     const parser = new WSP()
 *     parser.setLanguage(await WSL.load(readFileSync(".../wasm/tree-sitter-scss.wasm")))
 *     for (const f of files) { const t = parser.parse(f.text); ... t.delete?.() }
 *
 * Two differences from the engine's own path, both of which matter:
 *
 *   1. NO per-file self-destruct timer. `engine.ts:1438-1443` sets a 120 s `setTimeout`
 *      immediately around its `parser.parse` and `process.exit(1)`s if it fires. Instrument
 *      A has no equivalent, so a slow file there is an unbounded hang rather than a named
 *      failure.
 *   2. NO parser recreation. `engine.ts:743-749` deletes and reloads the parser every 500
 *      parses specifically because "WASM memory accumulation causes hangs after ~9,000
 *      parses on large projects (e.g. IntelliJ)". Instrument A reuses ONE parser for all
 *      4,433 admitted files and never evicts.
 *
 * ## WHAT THIS FILE MEASURES
 *
 * It runs instrument A's loop verbatim, with a wall-clock timer per file and a periodic
 * heartbeat (a `setInterval` cannot fire during a synchronous parse either, so the timer
 * is measured AROUND each call) and reports:
 *
 *   - the per-file parse time distribution, so a degradation curve is visible rather than
 *     asserted;
 *   - the slowest files, which is the actionable list;
 *   - whether the loop reaches its last file.
 *
 * The comparison arm parses the same file through production `parseFile` at its slowest, so
 * "the raw parser is slow here" is separated from "the grammar is slow here".
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/scss/scss-instrument-a-raw-parser.ts [maxFiles]
 *
 * 0 (the default) = every admitted file, which is what instrument A does.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX = Number(process.argv[2] ?? 0)

const files: { abs: string; rel: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
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
    if (detectLanguageFromPath(abs, text) !== "scss") continue
    files.push({ abs, rel: `${e}/${rel}`, text })
  }
}
files.sort((a, b) => (a.abs < b.abs ? -1 : 1))
const list = MAX > 0 ? files.slice(0, MAX) : files

console.log("scss instrument-A raw-parser reproduction")
console.log(`corpus root   ${CR}`)
console.log(`admitted      ${files.length.toLocaleString()}   walking ${list.length.toLocaleString()}`)
console.log("")

// Verbatim instrument A's construction, from script/m14/ontology-coverage-gate.ts.
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-scss.wasm"))))

const nodeTypes = new Map<string, number>()
const times: { rel: string; ms: number; bytes: number }[] = []
let i = 0
const t0 = Date.now()
for (const f of list) {
  const s = Date.now()
  const tree = parser.parse(f.text)
  const ms = Date.now() - s
  times.push({ rel: f.rel, ms, bytes: f.text.length })
  if (tree) {
    const v = (n: any): void => {
      nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
      for (let k = 0; k < n.childCount; k++) v(n.child(k))
    }
    v(tree.rootNode)
    tree.delete?.()
  }
  i++
  if (i % 500 === 0) {
    const recent = times.slice(-500)
    const sum = recent.reduce((a, t) => a + t.ms, 0)
    console.log(`  ${String(i).padStart(5)}/${list.length}  total ${((Date.now() - t0) / 1000).toFixed(1)}s  last-500 mean ${(sum / recent.length).toFixed(1)}ms  max ${Math.max(...recent.map((t) => t.ms))}ms  distinct node types ${nodeTypes.size}`)
  }
}

const totalMs = Date.now() - t0
const sorted = [...times].sort((a, b) => b.ms - a.ms)
const sumAll = times.reduce((a, t) => a + t.ms, 0)
console.log("")
console.log(`RAN TO THE LAST FILE. ${list.length.toLocaleString()} files in ${(totalMs / 1000).toFixed(1)}s   mean ${(sumAll / times.length).toFixed(1)}ms/file`)
console.log(`distinct node types collected  ${nodeTypes.size}`)
console.log(`p50 ${sorted[Math.floor(sorted.length * 0.5)].ms}ms   p90 ${sorted[Math.floor(sorted.length * 0.1)].ms}ms   max ${sorted[0].ms}ms`)
console.log(`files over the engine's 120s guard: ${times.filter((t) => t.ms > 120000).length}`)
console.log(`files over 1s:                     ${times.filter((t) => t.ms > 1000).length}`)
console.log(`\nthe 15 slowest files:`)
for (const t of sorted.slice(0, 15)) console.log(`  ${String(t.ms).padStart(7)}ms  ${String(t.bytes).padStart(8)} bytes  ${t.rel}`)

// The comparison arm: production parseFile on the slowest file. If this is fast and the raw
// arm is slow, the cost is in the un-evicted parser, not in the grammar.
if (sorted.length > 0) {
  const worst = list.find((f) => f.rel === sorted[0].rel)!
  const s = Date.now()
  const r: any = await parseFile(worst.abs, path.dirname(worst.abs))
  console.log(
    `\nsame file through production parseFile: ${Date.now() - s}ms, ${(r.errors ?? []).length} errors, ${(r.symbols ?? []).length} symbols, ${(r.relationships ?? []).length} edges`,
  )
  console.log(`  raw parser on the same file:        ${sorted[0].ms}ms`)
}
