import { readFileSync } from "node:fs"
import * as path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-powershell.wasm"))))
for (const src of ["Get-Thing -R2R $x\n", "Get-Thing -Verbose\n", "Get-Thing -PS7 $x\n", "Get-Thing -Base64 $x\n"]) {
  console.log(`\n${src.trim()}\n  ${parser.parse(src).rootNode.toString()}`)
}
