// Dump the php analyzer's RAW relationship objects for one file — the field set
// decides which constraints a fixture can honestly pin (line_number, metadata).
import * as fs from "fs"
import * as path from "path"
import { RealPhpAnalyzer } from "../../../src/ast/real-php-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
  const file = process.argv[2] ?? path.join(ROOT, "validation/m14/fixtures/php/header-reads.php")
  const src = fs.readFileSync(file, "utf8")
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(src).rootNode
  const r: any = await new RealPhpAnalyzer().analyze(root, src, path.basename(file))
  const keys = new Set<string>()
  for (const rel of r.relationships ?? []) for (const k of Object.keys(rel)) keys.add(k)
  console.log("relationship keys:", [...keys].join(", "))
  console.log("edges with a line:", (r.relationships ?? []).filter((x: any) => typeof x.line_number === "number").length, "of", (r.relationships ?? []).length)
  for (const rel of (r.relationships ?? []).slice(0, 6)) console.log(JSON.stringify(rel))
  console.log("--- errors:", r.errors?.length ?? 0)
}
main()
