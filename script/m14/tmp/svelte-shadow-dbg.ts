import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
import { RealSvelteAnalyzer } from "../../../src/ast/real-svelte-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const slang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-svelte.wasm")))
  const jlang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
  const src = `{#await p}\n{:then v}\n<span>{x}</span>\n{/await}\n<script>\nlet p = null;\nlet x = 1;\n</script>`
  const p = new P(); p.setLanguage(slang)
  const root = p.parse(src).rootNode
  const findAll = (n: any, pred: any, out: any[] = []): any[] => { if (pred(n)) out.push(n); for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) } return out }
  // dump await subtree shapes
  const dump = (n: any, d: number): void => {
    if (!n || d > 4) return
    console.log("  ".repeat(d) + n.type + " = " + JSON.stringify(String(n.text).slice(0, 30)))
    for (let i = 0; i < n.namedChildCount && i < 8; i++) dump(n.namedChild(i), d + 1)
  }
  dump(findAll(root, (n: any) => n.type === "await_statement")[0], 0)
  const raw = findAll(root, (n: any) => n.type === "raw_text")[0]
  const sp = new P(); sp.setLanguage(jlang)
  const st = sp.parse(raw.text)
  const a = new RealSvelteAnalyzer() as any
  const r = await a.analyze(root, src, "T.svelte", { sfcScriptTrees: [st], sfcScriptLines: [raw.startPosition.row + 1], sfcScriptCols: [raw.startPosition.column], sfcScriptLangs: [""] })
  console.log("syms:", JSON.stringify((r.symbols ?? []).map((s: any) => s.name + ":" + s.kind)))
  console.log("uses:", JSON.stringify((r.relationships ?? []).filter((x: any) => x.type === "uses")))
}
main()
