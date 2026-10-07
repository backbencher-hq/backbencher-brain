/**
 * GO LANE — PRODUCTION-ENTRY DENYLIST COLLISIONS.
 *
 * `keepSymbol` (src/ast/pool-worker.ts, MASTER-owned) drops any symbol whose
 * name is in a UNIVERSAL denylist — "language keywords / conventions and
 * synthetic tree-sitter artifact names — never legitimate declarations in any
 * language". One entry is `unknown`.
 *
 * Go declares `unknown` as an ordinary package-scope identifier. In the corpus
 * this lane measures, `src/cmd/compile/internal/ssacompile/prove.go` writes
 *
 *     const (
 *         unknown branch = iota
 *         positive
 *         negative
 *     )
 *
 * The analyzer publishes all three. The production entry publishes two: the
 * symbol named `unknown` is dropped AFTER the analyzer ran, so every edge that
 * targets it (`uses prove -> unknown`) is an endpoint no consumer can resolve,
 * and the corpus measure that says "this file declares 4 constants" is wrong by
 * one for every reader downstream.
 *
 * This probe counts the collision over a stated draw: package-scope
 * declarations whose name the denylist would drop. It reads the SAME set the
 * denylist uses by importing `keepSymbol`, so the number cannot drift from the
 * rule.
 *
 * CLI: npx tsx script/m14/go-denylist-probe.ts [--sample N] [--repo a,b]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "go-stdlib,cobra") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const SAMPLE = parseInt(argOf("--sample", "2000") ?? "2000")

const files: { repo: string; dir: string; rel: string; abs: string }[] = []
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
      if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "go") continue
    } catch { continue }
    files.push({ repo: e, dir, rel, abs })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
const draw = files.slice(0, SAMPLE)
console.log(`go denylist probe — repos ${REPOS.join(",")} admitted ${files.length} drawn ${draw.length}`)

// The analyzer's own symbols, before the production entry filters them. The
// analyzer is driven directly with a plain tree-sitter parse so the comparison
// is between the ANALYZER's output and `keepSymbol`'s rule, with no other stage
// in between to confuse the reading.
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-go.wasm"))))
const mod: any = await import("../../src/ast/real-go-analyzer")
const { keepSymbol } = await import("../../src/ast/pool-worker")

const dropped = new Map<string, { n: number; files: Set<string>; kinds: Map<string, number> }>()
let symbols = 0
let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    const text = readFileSync(f.abs, "utf8")
    const t = parser.parse(text)
    if (!t) continue
    let res: any
    try {
      res = new mod.RealGoAnalyzer().analyze(t.rootNode, text, `fixtures/go/${f.rel}`)
    } catch {
      t.delete?.()
      continue
    }
    t.delete?.()
    for (const s of (res?.symbols ?? []) as any[]) {
      symbols++
      if (keepSymbol(s, "go")) continue
      const name = String(s.name ?? "")
      const row = dropped.get(name) ?? { n: 0, files: new Set<string>(), kinds: new Map<string, number>() }
      row.n++
      row.files.add(`${f.repo}/${f.rel}`)
      row.kinds.set(String(s.kind), (row.kinds.get(String(s.kind)) ?? 0) + 1)
      dropped.set(name, row)
    }
  }
}
await Promise.all(Array.from({ length: Number(process.env.BB_CENSUS_WORKERS ?? 4) }, () => worker()))

console.log(`\nanalyzer symbols produced: ${symbols}`)
if (dropped.size === 0) {
  console.log("dropped by keepSymbol: 0")
} else {
  let total = 0
  for (const [name, row] of [...dropped].sort((a, b) => b[1].n - a[1].n)) {
    total += row.n
    console.log(`  ${JSON.stringify(name).padEnd(12)} ${String(row.n).padStart(5)} dropped in ${row.files.size} file(s)  kinds ${JSON.stringify(Object.fromEntries(row.kinds))}  e.g. ${[...row.files].slice(0, 3).join(", ")}`)
  }
  console.log(`\ndropped by keepSymbol: ${total} of ${symbols} symbols (${((total / symbols) * 100).toFixed(3)}%)`)
}
process.exit(0)
