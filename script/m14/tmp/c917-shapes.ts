// #917: across every wrapped header in the two real files, what does the
// macro's argument list actually contain, and which extraction rule reads the
// declared NAME correctly?
import fs from "node:fs"

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const FILES = [
  "/home/ishaq2321/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c",
  "/home/ishaq2321/bb_tests/repositories/sqlite/ext/jni/src/c/sqlite3-jni.c",
]

const shapes = new Map<string, number>()
let sites = 0
const samples: string[] = []
const sampleKeys = new Set<string>()
for (const F of FILES) {
  const src = fs.readFileSync(F, "utf8")
  const root = parser.parse(src).rootNode
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()!
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    if (n.type !== "compound_statement") continue
    // is it a wrapped body? previous sibling must be a wrapped header
    let prev = n.previousSibling
    for (let g = 0; prev && g < 3 && (prev.isMissing || prev.type === ";"); g++) prev = prev.previousSibling
    if (!prev || prev.type !== "expression_statement") continue
    const outer = prev.namedChild(0)
    if (!outer || outer.type !== "call_expression") continue
    const inner = outer.childForFieldName("function") ?? outer.namedChild(0)
    if (!inner || inner.type !== "call_expression") continue
    const macro = inner.childForFieldName("function") ?? inner.namedChild(0)
    if (!macro || macro.type !== "identifier") continue
    const args = inner.childForFieldName("arguments") ?? inner.namedChildren.find((c: any) => c.type === "argument_list")
    if (!args) continue
    sites++
    const kids = (args.namedChildren ?? []).map((c: any) => c.type)
    const key = kids.join("+")
    shapes.set(key, (shapes.get(key) || 0) + 1)
    const sampleKey = key
    if (!sampleKeys.has(sampleKey) && samples.length < 20) {
      sampleKeys.add(sampleKey)
      samples.push(
        `[${kids.join("+")}]  ${F.split("/").pop()}:${prev.startPosition.row + 1}  macro=${macro.text}  text=${args.text.replace(/\s+/g, " ")}`,
      )
    }
  }
}
console.log(`wrapped sites with a body: ${sites}`)
console.log("\nargument-list shapes:")
for (const [k, v] of [...shapes.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  [${k}]`)
console.log("\nsamples:")
for (const s of samples) console.log("  " + s)
