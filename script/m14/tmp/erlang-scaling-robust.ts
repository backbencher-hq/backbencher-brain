// ER3 — the scaling term, measured so that MACHINE INTERFERENCE CANNOT FAKE IT.
//
// The ablations on this box were inconclusive because the same code measured
// 4,182 ms and then 2,376 ms on the same tree (other lanes share the host). The
// fix is a design that interference cannot bias: the two analyzers are
// ALTERNATED within one loop, many times, and the MINIMUM is taken for each.
// Interference can only ever ADD time, so a minimum is the interference-free
// estimate — and because both sides are minimised under the same interference,
// the RATIO is sound even where the absolute numbers are not.
//
// Usage: bun run script/m14/tmp/erlang-scaling-robust.ts [--reps N]
import * as fs from "fs"
import * as path from "path"
import { RealErlangAnalyzer } from "../../../src/ast/real-erlang-analyzer"
const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const REPO = "/home/sano/ishaq/bb_tests/repositories"
const D = "/home/sano/ishaq/bb_tests/er3-perf"
function arg(n: string, d: string) { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? (process.argv[i + 1] ?? d) : d }

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm"))))
  const old: any = await import(path.join(D, "old-erlang-analyzer.ts"))
  const er3 = new RealErlangAnalyzer()
  const pre = new old.RealErlangAnalyzer()
  const REPS = parseInt(arg("reps", "5"), 10)
  const warm = "f() -> ok.\n"
  for (const a of [er3, pre]) a.analyze(parser.parse(warm)!.rootNode, warm, "w.erl")

  const files: string[] = []
  for (const d of ["otp", "rebar3", "cowboy"]) {
    const base = path.join(REPO, d); if (!fs.existsSync(base)) continue
    const st = [base]
    while (st.length) { const cur = st.pop()!; let es: fs.Dirent[]; try { es = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
      for (const e of es) { if (e.name === ".git") continue; const p = path.join(cur, e.name); if (e.isDirectory()) st.push(p); else if (e.name.endsWith(".erl")) files.push(p) } }
  }
  files.sort()
  const stride = Math.max(1, Math.floor(files.length / 120))
  const sample = files.filter((_, i) => i % stride === 0).slice(0, 120)
  const items = sample.map((f) => { const content = fs.readFileSync(f, "utf8"); const tree = parser.parse(content)!; let nodes = 0
    const dfs = (n: any) => { nodes++; for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) dfs(c) } }
    dfs(tree.rootNode)
    return { file: path.relative(REPO, f), content, root: tree.rootNode, nodes, lines: content.split("\n").length } })
  items.sort((a, b) => a.nodes - b.nodes)
  const q = Math.max(1, Math.floor(items.length / 4))
  console.log(`interleaved min-of-${REPS}, ${items.length} files`)
  console.log("| quartile | files | node range | ER3 us/node | pre-ER3 us/node | ratio |")
  console.log("|---|---|---|---|---|---|")
  for (let i = 0; i < 4; i++) {
    const band = items.slice(i * q, (i + 1) * q)
    if (!band.length) continue
    const b3 = band.map(() => Number.POSITIVE_INFINITY)
    const bp = band.map(() => Number.POSITIVE_INFINITY)
    for (let rep = 0; rep < REPS; rep++) {
      for (let k = 0; k < band.length; k++) {
        const it = band[k]
        let t0 = Date.now(); er3.analyze(it.root, it.content, it.file); b3[k] = Math.min(b3[k], Date.now() - t0)
        t0 = Date.now(); pre.analyze(it.root, it.content, it.file); bp[k] = Math.min(bp[k], Date.now() - t0)
      }
    }
    const sum = (a: number[]) => a.reduce((s, v) => s + v, 0)
    const nodes = band.reduce((s, it) => s + it.nodes, 0)
    const u3 = (sum(b3) * 1000) / nodes
    const up = (sum(bp) * 1000) / nodes
    console.log(`| Q${i + 1} | ${band.length} | ${band[0].nodes}-${band[band.length - 1].nodes} | ${u3.toFixed(1)} | ${up.toFixed(1)} | ${(u3 / up).toFixed(1)}x |`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
