// W17: what does the ORACLE emit for the 23 unexplained targets? Find each
// target's declaration shape in the corpus and check whether the tree-truth
// (declarations + uses) covers the analyzer's edges. Usage: bun run
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const JQ = "<corpus-root>/bb_tests/repositories/jq"
const TARGETS = ["ITER_FINISHED","YY_INITIAL_VALUE","yyg","yy_cp","yy_current_state","yy_act","escapes","yy_amount_of_matched_text","yy_next_state","offset","last_var","is_empty_var","call_arg","if_empty","builtin_defs","builtin_def_1arg","rangestart","rangevar","range","Round_up","Round_down","Round_near","Round_zero"]

async function loadParser() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  return p
}

async function main() {
  const p = await loadParser()
  // walk every sampled .c file in jq/src, find each target's DECLARATION shape
  const decls: Record<string, { file: string; parent: string; text: string }[]> = {}
  const files = fs.readdirSync(path.join(JQ, "src")).filter(f => f.endsWith(".c")).map(f => path.join("src", f))
  for (const rel of files) {
    const src = fs.readFileSync(path.join(JQ, rel), "utf8")
    const root = p.parse(src).rootNode
    const walk = (n: any): void => {
      if (n.type === "identifier" || n.type === "type_identifier") {
        if (TARGETS.includes(n.text)) {
          const parent = n.parent
          // walk up to the declaration-ish ancestor for a shape summary
          let a: any = parent, depth = 0, shape = parent?.type ?? "?"
          while (a && depth++ < 3) {
            if (/declaration|definition|enumerator|parameter|declarator/.test(a.type)) { shape = a.type; break }
            a = a.parent
          }
          ;(decls[n.text] ??= []).push({ file: rel, parent: parent?.type ?? "?", text: (a?.text ?? "").slice(0, 70).replace(/\s+/g, " ") })
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(root)
  }
  for (const t of TARGETS) {
    const ds = decls[t] ?? []
    console.log(`${t}: ${ds.length} declaration-ish occurrence(s)`)
    for (const d of ds.slice(0, 2)) console.log(`    ${d.parent} @ ${d.file}: ${d.text}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
