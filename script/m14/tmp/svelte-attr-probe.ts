import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
import { RealSvelteAnalyzer } from "../../../src/ast/real-svelte-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
let P: any, LANGS: Record<string, any> = {}
async function parsers() {
  if (P) return
  const wts: any = await import("web-tree-sitter")
  P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  for (const [k, f] of [["svelte", "tree-sitter-svelte.wasm"], ["js", "tree-sitter-javascript.wasm"]] as const)
    LANGS[k] = await L.load(fs.readFileSync(path.join(ROOT, "wasm", f)))
}
function findAll(n: any, pred: (x: any) => boolean, out: any[] = []): any[] {
  if (pred(n)) out.push(n)
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
  return out
}
async function analyzeSvelte(src: string) {
  await parsers()
  const p = new P(); p.setLanguage(LANGS.svelte)
  const root = p.parse(src).rootNode
  const trees: any[] = [], lines: number[] = [], cols: number[] = []
  for (const se of findAll(root, (n) => n.type === "script_element")) {
    const raw = se.namedChildren.find((c: any) => c.type === "raw_text")
    if (!raw || !raw.text.trim()) continue
    const sp = new P(); sp.setLanguage(LANGS.js)
    trees.push(sp.parse(raw.text)); lines.push(raw.startPosition.row + 1); cols.push(raw.startPosition.column)
  }
  const a = new RealSvelteAnalyzer() as any
  return a.analyze(root, src, "T.svelte", trees.length ? { sfcScriptTrees: trees, sfcScriptLines: lines, sfcScriptCols: cols, sfcScriptLangs: trees.map(() => "") } : {})
}
async function main() {
  const r1: any = await analyzeSvelte(`<svelte:component this={currentView} />\n<script>\nlet currentView = null;\n</script>`)
  console.log("this=member uses:", JSON.stringify((r1.relationships ?? []).filter((x: any) => x.type === "uses")))
  const r2: any = await analyzeSvelte(`<Comp label={label} />\n<script>\nimport Comp from "./c";\nlet label = "";\n</script>`)
  console.log("label= uses:", JSON.stringify((r2.relationships ?? []).filter((x: any) => x.type === "uses")))
  const r3: any = await analyzeSvelte(`<Comp label={label} />\n<script>\nimport Comp from "./c";\nlet label = "";\n</script>`)
  console.log("symbols:", JSON.stringify((r3.symbols ?? []).map((s: any) => s.name + ":" + s.kind)));
}
main()
