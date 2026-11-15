// ER3 — WHERE the analyzer's super-linear term is. The quartile scaling curve is
// not flat (34 -> 99 ms per 1k lines from the smallest to the largest files), and
// a 77-line OTP file measured 2.3 s earlier, so size is not the variable. This
// probe measures per-file analyze time against the tree's MAXIMUM DEPTH and its
// node count, so the term that grows can be named instead of guessed at.
import * as fs from "fs"
import * as path from "path"
import { RealErlangAnalyzer } from "../../../src/ast/real-erlang-analyzer"
const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const REPO = "/home/sano/ishaq/bb_tests/repositories"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm"))))
  const files: string[] = []
  for (const d of ["otp", "rebar3", "cowboy"]) {
    const base = path.join(REPO, d); if (!fs.existsSync(base)) continue
    const st = [base]
    while (st.length) { const cur = st.pop()!; let es: fs.Dirent[]; try { es = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
      for (const e of es) { if (e.name === ".git") continue; const p = path.join(cur, e.name); if (e.isDirectory()) st.push(p); else if (e.name.endsWith(".erl")) files.push(p) } }
  }
  files.sort()
  const stride = Math.max(1, Math.floor(files.length / 250))
  const sample = files.filter((_, i) => i % stride === 0).slice(0, 250)
  const a = new RealErlangAnalyzer()
  const warm = "f() -> ok.\n"
  a.analyze(parser.parse(warm)!.rootNode, warm, "w.erl")
  const rows: { file: string; lines: number; nodes: number; depth: number; ms: number; us: number; types: number; dens: number }[] = []
  for (const f of sample) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    let tree: any
    try { tree = parser.parse(content) } catch { continue }
    if (!tree) continue
    let nodes = 0
    let depth = 0
    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) { const n = stack.pop()!; nodes++; for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) { if (depth < 60) { /* depth computed below */ } stack.push(c) } } }
    // exact max depth
    const dfs = (n: any, d: number) => { if (d > depth) depth = d; for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) dfs(c, d + 1) } }
    dfs(tree.rootNode, 0)
    const t0 = Date.now()
    a.analyze(tree.rootNode, content, f)
    const ms = Date.now() - t0
    const lines = content.split("\n").length
    // Type-declaration DENSITY per 1k lines: the candidate variable for the
    // quartile curve, if the curve is a dense-but-linear cost rather than a
    // super-linear one.
    let types = 0
    const cnt: any[] = [tree.rootNode]
    while (cnt.length) { const n = cnt.pop()!; if (n.isNamed && (n.type === "spec" || n.type === "callback" || n.type === "type_alias" || n.type === "opaque" || n.type === "nominal" || n.type === "record_decl")) types++
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) cnt.push(c) } }
    const dens = (types / Math.max(1, lines)) * 1000
    rows.push({ file: path.relative(REPO, f), lines, nodes, depth, ms, us: (ms * 1000) / Math.max(1, nodes), types, dens })
    tree.delete()
  }
  rows.sort((x, y) => y.us - x.us)
  console.log("| file | lines | nodes | max depth | type decls | types/1k lines | ms | us/node |")
  console.log("|---|---|---|---|---|---|---|---|")
  for (const r of rows.slice(0, 12)) console.log(`| ${r.file} | ${r.lines} | ${r.nodes} | ${r.depth} | ${r.types} | ${r.dens.toFixed(1)} | ${r.ms} | ${r.us.toFixed(1)} |`)
  console.log("")
  // correlation of us/node with depth
  const byDepth = new Map<string, number[]>()
  for (const r of rows) {
    const b = r.depth <= 8 ? "0-8" : r.depth <= 12 ? "9-12" : r.depth <= 16 ? "13-16" : r.depth <= 24 ? "17-24" : ">24"
    const arr = byDepth.get(b) ?? []
    arr.push(r.us)
    byDepth.set(b, arr)
  }
  console.log("us/node by MAX TREE DEPTH (the variable, if it is one):")
  for (const b of ["0-8", "9-12", "13-16", "17-24", ">24"]) {
    const arr = byDepth.get(b)
    if (!arr) continue
    arr.sort((x, y) => x - y)
    const med = arr[Math.floor(arr.length / 2)]
    console.log(`  depth ${b.padEnd(6)} n=${String(arr.length).padStart(3)}  median ${med.toFixed(1)} us/node   max ${arr[arr.length - 1].toFixed(1)}`)
  }
  const byDens = new Map<string, number[]>()
  for (const r of rows) {
    const b = r.dens < 5 ? "<5" : r.dens < 15 ? "5-15" : r.dens < 40 ? "15-40" : ">=40"
    const arr = byDens.get(b) ?? []
    arr.push(r.us)
    byDens.set(b, arr)
  }
  console.log("")
  console.log("us/node by TYPE-DECLARATION DENSITY (types per 1k lines):")
  for (const b of ["<5", "5-15", "15-40", ">=40"]) {
    const arr = byDens.get(b); if (!arr) continue
    arr.sort((x, y) => x - y)
    console.log(`  ${b.padEnd(6)} types/1k  n=${String(arr.length).padStart(3)}  median ${arr[Math.floor(arr.length / 2)].toFixed(1)} us/node   max ${arr[arr.length - 1].toFixed(1)}`)
  }
  const totMs = rows.reduce((s, r) => s + r.ms, 0)
  const totNodes = rows.reduce((s, r) => s + r.nodes, 0)
  console.log("")
  console.log(`TOTAL ${rows.length} files, ${totNodes} nodes, ${totMs} ms = ${((totMs / totNodes) * 1000).toFixed(1)} us/node`)
}
main().catch(e => { console.error(e); process.exit(1) })
