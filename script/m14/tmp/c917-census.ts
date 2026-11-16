// #917: exact size of the class, counted with the SHARED shape rule (headings
// the analyzer accepts), per file, over the two corpora's c files.
import fs from "node:fs"
import path from "node:path"
import { macroWrappedHeadingShape, wrappedBodyAfter } from "../../../src/ast/real-c-analyzer"

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const cLang: any = await L.load(fs.readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-c.wasm")))
const parser = new P()
parser.setLanguage(cLang)

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|build|target)/.test(e.name)) filesUnder(p, out) }
    else if (e.name.endsWith(".c")) out.push(p)
  }
  return out
}

for (const repo of ["sqlite", "jq"]) {
  const dir = `<corpus-root>/bb_tests/repositories/${repo}`
  let total = 0
  const perFile = new Map<string, number>()
  for (const f of filesUnder(dir)) {
    const src = fs.readFileSync(f, "utf8")
    const root = parser.parse(src).rootNode
    const st: any[] = [root]
    let n = 0
    while (st.length) {
      const node = st.pop()!
      if (node.type === "expression_statement" && macroWrappedHeadingShape(node) && wrappedBodyAfter(node)) n++
      for (let i = 0; i < node.childCount; i++) st.push(node.child(i))
    }
    if (n) { perFile.set(path.relative(dir, f), n); total += n }
  }
  console.log(`${repo}: ${total} wrapped heading(s) with a body in ${perFile.size} file(s)`)
  for (const [f, n] of [...perFile.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${n}  ${f}`)
}
