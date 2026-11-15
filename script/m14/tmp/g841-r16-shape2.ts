// Count the method-read-as-(field+constructor) shape corpus-wide, both grammars.
import fs from "node:fs"
import path from "node:path"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const REPOS = ["/home/ishaq2321/bb_tests/repositories/grails-core", "/home/ishaq2321/bb_tests/repositories/geb"]
function walkFiles(dir: string, out: string[] = []): string[] {
  let es: any[] = []
  try { es = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of es) {
    if (["node_modules", ".git", "build", "target"].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else if (e.name.endsWith(".groovy")) out.push(p)
  }
  return out
}
const files = REPOS.flatMap((r) => walkFiles(r)).sort()
for (const [name, wasm] of [["OLD", "/tmp/g841-r16-head-fresh.wasm"], ["NEW", "/tmp/g841-r16-vall.wasm"]] as Array<[string, string]>) {
  const lang = await L.load(fs.readFileSync(wasm))
  const parser = new P()
  parser.setLanguage(lang)
  const hits: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const t = parser.parse(src)
    // constructor_declaration whose parent chain includes field_declaration
    const w = (n: any) => {
      if (n.type === "constructor_declaration" && n.parent && n.parent.type === "field_declaration") {
        hits.push(`${path.relative("/home/ishaq2321/bb_tests/repositories", f)}:${n.startPosition.row + 1}`)
      }
      for (let i = 0; i < n.childCount; i++) w(n.child(i))
    }
    w(t.rootNode)
  }
  console.log(`${name}: field+constructor shape = ${hits.length}`)
  for (const h of hits.slice(0, 8)) console.log("   ", h)
}
