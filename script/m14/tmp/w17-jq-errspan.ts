// W17: how much of jv.c is an ERROR span, and where does the glue header sit
// relative to `enum { ITER_FINISHED }` (L1963)? If the ERROR's first glued
// function header is AFTER L1963, CGD14 suppresses the enum's declaration and
// every later use of ITER_FINISHED becomes unexplained — an artifact of
// recovery, exactly like the sqlite amalgamation floor.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const SRC = fs.readFileSync("/home/ishaq2321/bb_tests/repositories/jq/src/jv.c", "utf8")
const lineOf = (idx: number) => SRC.slice(0, idx).split("\n").length
async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(SRC).rootNode
  for (let i = 0; i < root.namedChildCount; i++) {
    const c = root.namedChild(i)
    if (c.type === "ERROR") {
      console.log(`ERROR span L${lineOf(c.startIndex)}–L${lineOf(c.endIndex)}`)
      // first glued header inside
      const st: any[] = [c]
      let first = -1
      while (st.length) {
        const m = st.pop()!
        if (m.type === "function_definition") { first = m.startIndex; break }
        for (let k = 0; k < m.namedChildCount; k++) st.push(m.namedChild(k))
      }
      console.log(`  first function_definition inside: ${first >= 0 ? "L" + lineOf(first) : "none"}`)
    } else {
      console.log(`${c.type} L${lineOf(c.startIndex)}`)
    }
  }
}
main().catch(e => { console.error(e); process.exit(1) })
