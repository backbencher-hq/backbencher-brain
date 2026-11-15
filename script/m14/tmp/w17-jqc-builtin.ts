// W17: builtin.c gen_last_1 — WHY does the oracle not emit truth for
// last_var etc? The decls and reads are all inside ONE function. The oracle's
// fnLocals collectLocalDecl walks `declaration` nodes; `block last_var = ...`
// is a declaration whose type is `block` — should be collected. UNLESS: the
// declaration node shape differs (type_identifier "block" + init_declarator).
// Dump the tree shape of L2068.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const SRC = fs.readFileSync("/home/ishaq2321/bb_tests/repositories/jq/src/builtin.c", "utf8")
const lineOf = (idx: number) => SRC.slice(0, idx).split("\n").length
async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(SRC).rootNode
  const st: any[] = [root]
  let shown = 0
  while (st.length && shown < 6) {
    const n = st.pop()!
    if ((n.type === "identifier") && ["last_var","is_empty_var","call_arg","if_empty"].includes(n.text)) {
      const L2 = lineOf(n.startIndex)
      if (L2 >= 2068 && L2 <= 2086) {
        const chain: string[] = []
        let c: any = n
        while (c) { chain.push(c.type); c = c.parent }
        console.log(`L${L2} ${n.text}: ${chain.join(" < ")}`)
        shown++
      }
    }
    for (let k = 0; k < n.namedChildCount; k++) st.push(n.namedChild(k))
  }
}
main().catch(e => { console.error(e); process.exit(1) })
