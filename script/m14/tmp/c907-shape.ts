import { readFileSync } from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P(); parser.setLanguage(lang)
const lines = readFileSync("<corpus-root>/bb_tests/repositories/jq/src/jv_print.c", "utf8").split("\n")
const src = lines.slice(218, 420).join("\n")
const t = parser.parse(src)
const kids: any[] = []
for (let i = 0; i < t.rootNode.namedChildCount; i++) kids.push(t.rootNode.namedChild(i))
console.log("root children:", kids.map((c: any) => `${c.type}@L${c.startPosition.row + 219}-L${c.endPosition.row + 219}`).join(", "))
const outer = kids.find((c: any) => c.type === "function_definition") ?? kids[0]
const body = outer.childForFieldName("body")
console.log("outer fn:", outer.type, "body type:", body?.type, "children:", body?.namedChildCount)
for (let i = 0; i < (body?.namedChildCount ?? 0); i++) {
  const c = body!.namedChild(i)
  const row = (c.startPosition.row + 219)
  const first = c.text.split("\n")[0].slice(0, 58)
  console.log(`  ${String(i).padStart(3)} ${c.type.padEnd(22)} L${String(row).padEnd(5)} ${first}`)
}
