// FS003 — the fsharp lane's tree dumper. Given a file (or `--src`), print the
// parse tree with fields, so every claim about a shape is read off the real grammar
// rather than assumed.
//
// Run:
//   bun script/m14/tmp/fs003-tree.ts --file <path> [--max 60] [--at <line>] [--srt]
//   bun script/m14/tmp/fs003-tree.ts --src 'type X = class end' [--max 40]
//   bun script/m14/tmp/fs003-tree.ts --file <path> --types type_definition,member_defn
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "../../..")
const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const which = argOf("--grammar") === "signature" ? "tree-sitter-fsharp_signature.wasm" : "tree-sitter-fsharp.wasm"
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm", which))))

  const srcArg = argOf("--src")
  const fileArg = argOf("--file")
  let src = srcArg ?? (fileArg ? fs.readFileSync(fileArg, "utf8") : "")
  if (fileArg && !srcArg) {
    const at = argOf("--at")
    if (at) {
      const from = parseInt(at), to = parseInt(argOf("--to") ?? at)
      const lines = src.split("\n")
      src = lines.slice(from - 1, to).join("\n")
    }
  }
  const max = parseInt(argOf("--max") ?? "60")
  const only = (argOf("--types") ?? "").split(",").filter(Boolean)
  const srt = process.argv.includes("--srt")

  const tree = parser.parse(src)
  let printed = 0
  const walk = (n: any, d: number, field: string) => {
    if (printed > max) return
    const anon = !n.isNamed
    const txt = n.text.length > 60 ? n.text.slice(0, 57).replace(/\n/g, "\\n") + "..." : n.text.replace(/\n/g, "\\n")
    const err = n.type === "ERROR" ? " <<ERROR" : n.isMissing ? " <<MISSING" : ""
    const f = field ? `${field}: ` : ""
    console.log(`${"  ".repeat(d)}${anon ? "·" : ""}${f}${n.type}  [${n.startPosition.row + 1}:${n.startPosition.column + 1}-${n.endPosition.row + 1}:${n.endPosition.column + 1}]  ${JSON.stringify(txt)}${err}`)
    printed++
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (!c) continue
      if (only.length && !only.includes(c.type) && c.isNamed) { /* still descend */ }
      walk(c, d + 1, n.fieldNameForChild(i) ?? "")
    }
  }
  if (srt) {
    console.log(tree.rootNode.toString())
  } else {
    const at = argOf("--at")
    if (at && only.length === 0) { void 0 }
    walk(tree.rootNode, 0, "")
  }
  // error summary
  const errs: any[] = []
  const st: any[] = [tree.rootNode]
  while (st.length) { const n = st.pop(); if (n.type === "ERROR" || n.isMissing) errs.push(n); for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) } }
  if (errs.length) {
    console.log(`\n-- ${errs.length} ERROR/MISSING node(s):`)
    for (const e of errs.slice(0, 12)) {
      const smallest = e.children.filter((c: any) => c.type === "ERROR" || c.isMissing).sort((a: any, b: any) => (a.endIndex - a.startIndex) - (b.endIndex - b.startIndex))[0] ?? e
      console.log(`   ${e.type} ${e.startPosition.row + 1}:${e.startPosition.column + 1}-${e.endPosition.row + 1}:${e.endPosition.column + 1}  inner=${smallest.type}@${smallest.startPosition.row + 1}:${smallest.startPosition.column + 1}  ${JSON.stringify(smallest.text.slice(0, 70).replace(/\n/g, "\\n"))}`)
    }
  } else {
    console.log("\n-- 0 ERROR/MISSING nodes")
  }
}
void main()
