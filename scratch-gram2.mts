import { readFileSync } from "node:fs"
import * as path from "node:path"
import { admittedFiles } from "$HOME/mcp/bb-lanes/json/validation/m14/fixtures/json/admitted-files"

const wts: any = await import("web-tree-sitter")
const Parser = wts.Parser ?? wts.default
const Language = wts.Language ?? wts.default?.Language
await Parser.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasm = readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-json.wasm"))
const p = new Parser()
const lang = await Language.load(wasm)
p.setLanguage(lang)

const walk = admittedFiles(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories")
let ok = 0
let bad = 0
const firstBad: string[] = []
for (const f of walk.files) {
  try {
    const t = p.parse(readFileSync(f.abs, "utf8"))
    if (!t?.rootNode) throw new Error("no root")
    ok++
    t.delete?.()
  } catch (e: any) {
    bad++
    if (firstBad.length < 5) firstBad.push(`${f.abs} :: ${String(e?.message ?? e).slice(0, 80)}`)
  }
}
console.log("ok", ok, "bad", bad)
console.log(firstBad.join("\n"))