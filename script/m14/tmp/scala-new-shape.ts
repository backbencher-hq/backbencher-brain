import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
async function main(): Promise<void> {
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const p = new P(); p.setLanguage(gl)
  const root = p.parse(fs.readFileSync(process.argv[2], "utf8")).rootNode
  const walk = (n: any): void => {
    if (n.type === "instance_expression" || (n.type.includes("instance") && String(n.text).includes("{"))) {
      const tn = n.namedChild(0)
      console.log(`${n.type}  head=${tn?.type}  ${JSON.stringify(String(tn?.text))}`)
      console.log(`   namedChildren: ${(n.namedChildren ?? []).map((c: any) => c.type).join(", ")}`)
    }
    for (const c of n.namedChildren ?? []) walk(c)
  }
  walk(root)
}
main()
