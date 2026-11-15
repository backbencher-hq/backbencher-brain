import fs from "node:fs"
import path from "node:path"
const ROOT = process.cwd()
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  for (const f of ["tree-sitter-typescript.wasm", "tree-sitter-c_sharp.wasm", "tree-sitter-python.wasm"]) {
    try {
      const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", f)))
      console.log(f, "types=", lang.nodeTypeCount)
    } catch (e: any) {
      console.log(f, "FAILED:", String(e).slice(0, 120))
    }
  }
}
main()
