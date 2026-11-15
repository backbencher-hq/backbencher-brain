import fs from "node:fs"
import path from "node:path"
const ROOT = process.cwd()
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  for (const [name, file] of [["javascript", "tree-sitter-javascript.wasm"], ["csharp", "tree-sitter-c_sharp.wasm"], ["typescript", "tree-sitter-typescript.wasm"], ["kotlin", "tree-sitter-kotlin.wasm"]] as const) {
    const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", file)))
    const anon: string[] = []
    for (let i = 0; i < lang.nodeTypeCount; i++) if (!lang.nodeTypeIsNamed(i)) anon.push(lang.nodeTypeForId(i))
    const probe = ["true", "false", "null", "this", "break", "string", "private", "override", "number", "any", "val"]
    console.log(`${name}: anon=${anon.length} sample=[${anon.slice(0, 12).join(",")}]`)
    console.log(`   membership: ${probe.map((p) => `${p}:${anon.includes(p) ? "Y" : "n"}`).join(" ")}`)
  }
}
main()
