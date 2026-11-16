// M49 W9 — isolate exactly what the param-binding fix changed on the zls
// corpus (the lane showing unexplained=3). Run twice: once with the fix on
// disk, once with the pre-fix subtree binding — the delta IS the fix's effect.
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const REPO = "<corpus-root>/bb_tests/repositories/zls"

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "zig-cache" || e.name === "zig-out") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith(".zig")) out.push(p)
  }
  return out
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
  const mod: any = await import(path.resolve(ROOT, "src/ast/real-zig-analyzer.ts"))
  const Analyzer = mod.RealZigAnalyzer ?? mod.default

  const files = walk(REPO)
  const out: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const parser = new P()
    parser.setLanguage(grammar)
    const tree = parser.parse(src)
    if (!tree) continue
    const az = new Analyzer()
    let res: any
    try {
      res = await az.analyze(tree.rootNode, src, path.relative(REPO, f))
    } catch { continue }
    for (const r of res.relationships ?? []) {
      if (r.type === "uses" && (r.metadata ?? {}).relationshipType === "identifier_usage") {
        out.push(`${path.relative(REPO, f)} :: ${r.source} -> ${r.target}`)
      }
    }
  }
  out.sort()
  console.log(`TOTAL identifier_usage reads: ${out.length} across ${files.length} files`)
  fs.writeFileSync(process.env.ZIG_DELTA_OUT || "/tmp/zls-usage.txt", out.join("\n") + "\n")
}

main()
