import { readFileSync } from "node:fs"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const F = "validation/m14/fixtures/c/macro-truncated-declarator-916.c"
const wts: any = await import("web-tree-sitter")
const P = (wts.Parser ?? wts.default) as any
const L = (wts.Language ?? wts.default?.Language) as any
await P.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const lang = await L.load(readFileSync(`${ROOT}/wasm/tree-sitter-c.wasm`))
const parser = new P()
parser.setLanguage(lang)
const src = readFileSync(F, "utf8")
const tree = parser.parse(src)
const dump = (m: any, d: number) => {
  const tag = `${m.type}${m.isMissing ? "[MISSING]" : ""}${m.isError ? "[ERROR]" : ""}`
  const fields = ["type", "declarator", "value", "body", "name"]
    .map(f => (m.childForFieldName?.(f) === m.namedChild(0) ? f : null))
    .filter(Boolean)
  console.log(`${"  ".repeat(d)}${tag} ${JSON.stringify(m.text)}`)
  for (const c of m.children ?? []) dump(c, d + 1)
}
dump(tree.rootNode, 0)
