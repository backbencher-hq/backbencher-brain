import fs from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P(); parser.setLanguage(lang)
  const files = fs.readFileSync("/tmp/scala3-all.txt", "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
  let damaged = 0
  const out: string[] = []
  for (const f of files) {
    const root = parser.parse(fs.readFileSync(path.join("<corpus-root>/bb_tests/repositories/scala3", f), "utf8")).rootNode
    if (root.hasError) { damaged++; out.push(f) }
  }
  console.log(`# scala3: ${files.length} files, ${damaged} with rootNode.hasError`)
  fs.writeFileSync("/tmp/scala3-damaged.txt", out.join("\n") + "\n")
  for (const f of out.slice(0, 12)) console.log("  " + f)
}
main().catch((e) => { console.error(e); process.exit(1) })
