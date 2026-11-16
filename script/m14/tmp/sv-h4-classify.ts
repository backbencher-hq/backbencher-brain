// Classify the H4 FAIL: what column does a top-level function symbol carry
// in the PLAIN JS analyzer (control), and what does svelte emit vs the
// script-relative truth? Convention check, not a claim verdict.
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"
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

async function main() {
  await parsers()
  // CONTROL 1: plain JS — top-level `function alpha()` at line 1 col 0
  {
    const src = `function alpha() {\n  return beta();\n}\nfunction beta() { return 1; }\n`
    const p = new P(); p.setLanguage(LANGS.js)
    const a = new RealJavaScriptAnalyzer() as any
    const r = await a.analyze(p.parse(src).rootNode, src, "C.js", {})
    const s = (r.symbols ?? []).find((x: any) => x.name === "alpha")
    console.log("JS control alpha range:", JSON.stringify(s?.range))
  }
  // CONTROL 2: JS where alpha is NOT on line 1 (line-2 decl)
  {
    const src = `// lead\nfunction alpha() {}\n`
    const p = new P(); p.setLanguage(LANGS.js)
    const a = new RealJavaScriptAnalyzer() as any
    const r = await a.analyze(p.parse(src).rootNode, src, "C2.js", {})
    const s = (r.symbols ?? []).find((x: any) => x.name === "alpha")
    console.log("JS control alpha (line2) range:", JSON.stringify(s?.range))
  }
  // SVELTE: same shape; script content begins at SFC line 3, col 0.
  // Print BOTH the emitted range and the raw sub-parse truth.
  {
    const src = `<nav />\n<script>\nfunction alpha() {\n  return beta();\n}\nfunction beta() { return 1; }\n</script>\n`
    const p = new P(); p.setLanguage(LANGS.svelte)
    const root = p.parse(src).rootNode
    const trees: any[] = [], lines: number[] = [], cols: number[] = [], idx: number[] = []
    for (const se of findAll(root, (n) => n.type === "script_element")) {
      const raw = se.namedChildren.find((c: any) => c.type === "raw_text")
      if (!raw || !raw.text.trim()) continue
      const sp = new P(); sp.setLanguage(LANGS.js)
      trees.push(sp.parse(raw.text))
      lines.push(raw.startPosition.row + 1); cols.push(raw.startPosition.column); idx.push(raw.startIndex)
      console.log("raw text node: row(1b)=" + (raw.startPosition.row + 1) + " col=" + raw.startPosition.column + " idx=" + raw.startIndex)
    }
    const a = new RealSvelteAnalyzer() as any
    const ctx: any = { sfcScriptTrees: trees, sfcScriptLines: lines, sfcScriptCols: cols, sfcScriptStartIndex: idx, sfcScriptLangs: [""] }
    const r = await a.analyze(root, src, "T.svelte", ctx)
    for (const nm of ["alpha", "beta"]) {
      const s = (r.symbols ?? []).find((x: any) => x.name === nm)
      console.log("svelte " + nm + " range:", JSON.stringify(s?.range))
    }
    // script-relative truth for alpha: row 0 (of raw text), col 0 of `function`
    // SFC truth: line 3, col 0, byte idx = 16 (7+1+8 = <nav />\\n<script>\\n)
    console.log("SFC byte offset of line 3 = " + ("<nav />\n<script>\n".length))
  }
}
main()
