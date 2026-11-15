/**
 * EX perf — per-file analyze cost on the heaviest Elixir files, and the
 * SHAPE of the cost curve (ms per KiB against file size). A linear analyzer
 * keeps ms/KiB flat; an O(n^2) one shows the ratio climbing with size, which a
 * per-file average hides. Reads files, never writes.
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/sano/ishaq/backbencher-brain"
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const REPO = arg("repo") ?? "ash"
const TOP = Number(arg("top") ?? "30")

function walk(d: string, out: string[] = []): string[] {
  let e: fs.Dirent[]
  try { e = fs.readdirSync(d, { withFileTypes: true }) } catch { return out }
  for (const x of e) {
    if ([".git", "_build", "deps", "node_modules"].includes(x.name)) continue
    const p = path.join(d, x.name)
    if (x.isDirectory()) walk(p, out)
    else if (x.name.endsWith(".ex") || x.name.endsWith(".exs")) out.push(p)
  }
  return out
}

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const files = walk(path.join(CORPUS_ROOT, REPO))
  const sized = files.map((f) => ({ f, bytes: fs.statSync(f).size })).sort((a, b) => b.bytes - a.bytes)
  const picked = sized.slice(0, TOP)
  // parse-only baseline, so the analyzer's own cost is separable from the
  // grammar's (a slow grammar is a grammar pin's problem, not this lane's).
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
  const p = new P(); p.setLanguage(g)
  const rows: any[] = []
  for (const { f, bytes } of picked) {
    const text = fs.readFileSync(f, "utf8")
    const t0 = process.hrtime.bigint()
    const tree = p.parse(text)
    const t1 = process.hrtime.bigint()
    const res: any = await ASTEngine.parseFile(f, text)
    const t2 = process.hrtime.bigint()
    const parseMs = Number(t1 - t0) / 1e6
    const totalMs = Number(t2 - t0) / 1e6
    rows.push({
      file: path.relative(CORPUS_ROOT, f),
      kib: Math.round(bytes / 1024),
      lines: text.split("\n").length,
      parseMs: Math.round(parseMs * 10) / 10,
      analyzeMs: Math.round((totalMs - parseMs) * 10) / 10,
      msPerKiB: Math.round(((totalMs - parseMs) / (bytes / 1024)) * 1000) / 1000,
      symbols: (res.symbols ?? []).length,
      rels: (res.relationships ?? []).length,
    })
  }
  rows.sort((a, b) => a.kib - b.kib)
  console.log(`repo=${REPO} files=${picked.length} (largest by bytes)`)
  console.log("  kib  lines  parseMs  analyzeMs  ms/KiB  syms  rels  file")
  for (const r of rows) console.log(`${String(r.kib).padStart(5)} ${String(r.lines).padStart(6)} ${String(r.parseMs).padStart(8)} ${String(r.analyzeMs).padStart(10)} ${String(r.msPerKiB).padStart(7)} ${String(r.symbols).padStart(5)} ${String(r.rels).padStart(5)}  ${r.file}`)
  const small = rows.filter((r) => r.kib <= rows[Math.floor(rows.length / 3)]!.kib)
  const big = rows.filter((r) => r.kib >= rows[Math.floor((rows.length * 2) / 3)]!.kib)
  const avg = (xs: any[], k: string) => (xs.reduce((a, r) => a + r[k], 0) / Math.max(1, xs.length)).toFixed(3)
  console.log(`\nms/KiB  small-third avg ${avg(small, "msPerKiB")} (n=${small.length})   large-third avg ${avg(big, "msPerKiB")} (n=${big.length})`)
  console.log(`analyze total ${rows.reduce((a, r) => a + r.analyzeMs, 0).toFixed(0)}ms over ${rows.reduce((a, r) => a + r.kib, 0)}KiB (${picked.length} files)`)
}
main().catch((e) => { console.error(e); process.exit(1) })
