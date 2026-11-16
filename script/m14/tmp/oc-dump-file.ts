// Dump the objc analyzer's full output for one file, plus each symbol's parent
// node so a mismatch can be resolved from the tree rather than guessed.
// Usage: bun script/m14/tmp/oc-dump-file.ts <path> [--tree]
import * as fs from "fs"
import * as path from "path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"

const args = process.argv.slice(2)
const file = path.isAbsolute(args[0]) ? args[0] : path.join(ROOT, args[0])
const src = fs.readFileSync(file, "utf8")

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang: any = await L.load(fs.readFileSync(process.env["OC_WASM"] ?? path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
const ocmod: any = await import(path.join(ROOT, "src/ast/real-objective-c-analyzer"))

const p = new P()
p.setLanguage(lang)
const tree: any = p.parse(src)
console.log(`hasError=${tree.rootNode.hasError}`)
console.log(`top-level: ${tree.rootNode.children.map((c: any) => c.type).join(" ")}`)
const res: any = await ocmod.RealObjectiveCAnalyzer
  ? await new ocmod.RealObjectiveCAnalyzer().analyze(tree.rootNode, src, file)
  : await (await import(path.join(ROOT, "src/ast/engine"))).analyzerFor("objective-c", "wasm/tree-sitter-objc.wasm")!.analyze(file, src, src)

console.log(`\n-- symbols (${(res.symbols ?? []).length}) --`)
for (const s of res.symbols ?? []) {
  console.log(`  ${String(s.kind).padEnd(10)} ${String(s.name).padEnd(34)} line ${(s as any).line_number ?? (s as any).line ?? "?"}`)
}
console.log(`\n-- relationships (${(res.relationships ?? []).length}) --`)
for (const r of res.relationships ?? []) {
  console.log(`  ${String(r.type).padEnd(14)} ${String(r.source).padEnd(20)} -> ${String(r.target)}`)
}

if (args.includes("--tree")) {
  console.log(`\n-- tree (depth 4) --`)
  const out: string[] = []
  const walk = (n: any, d: number) => {
    if (d > 4) return
    out.push(
      `${"  ".repeat(d)}${n.type}${n.childCount === 0 ? " " + JSON.stringify(n.text.slice(0, 30)) : ""} [${n.startPosition.row + 1}]`,
    )
    for (const c of n.children) walk(c, d + 1)
  }
  walk(tree.rootNode, 0)
  console.log(out.join("\n"))
}
process.exit(0)
