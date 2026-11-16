// Like-for-like perf probe for F5's PERF BUDGET line.
//
// The differential's per-lane `perf` is only comparable across two runs when the
// DRAWN FILE SET is the same. A lane whose corpus is smaller than the sample
// (lodash: 55 js files vs a 60-file draw) draws the whole corpus every time, so
// for those lanes a perf delta IS a code delta. This probe times the analyzer
// under `--root=` over exactly the files given, after a warm-up pass, so the
// comparison is not an artifact of which files were drawn.
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const ROOT =
  process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length) ??
  "<corpus-root>/mcp/backbencher-brain"
const CORPUS = process.argv.find((a) => a.startsWith("--corpus="))?.slice("--corpus=".length) ?? ""
const EXT = process.argv.find((a) => a.startsWith("--ext="))?.slice("--ext=".length) ?? ".js"
const WARM = parseInt(process.argv.find((a) => a.startsWith("--warm="))?.slice("--warm=".length) ?? "3")

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith(EXT)) out.push(p)
  }
  return out
}

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const files = walk(CORPUS).sort()
  let edges = 0
  // warm-up: first-touch costs (wasm instantiation, caches) must not land in the average
  for (const f of files.slice(0, WARM)) await ASTEngine.parseFile(f, readFileSync(f, "utf8"))

  const t0 = performance.now()
  for (const f of files) {
    const res: any = await ASTEngine.parseFile(f, readFileSync(f, "utf8"))
    edges += (res?.relationships ?? []).length
  }
  const ms = performance.now() - t0
  console.log(
    `root=${ROOT}  files=${files.length}  edges=${edges}  totalMs=${Math.round(ms)}  avgMsPerFile=${(ms / files.length).toFixed(1)}`,
  )
}

main()
