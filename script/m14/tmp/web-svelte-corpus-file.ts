// Exact-corpus-file probe: what calls edges does the analyzer emit, with what sources?
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
import { RealSvelteAnalyzer } from "../../../src/ast/real-svelte-analyzer"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const FILE = "<corpus-root>/bb_tests/repositories/svelte/packages/svelte/tests/runtime-runes/samples/class-state-raw/main.svelte"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANGS: Record<string, any> = {}
  for (const [k, f] of [["svelte", "tree-sitter-svelte.wasm"], ["js", "tree-sitter-javascript.wasm"]] as const)
    LANGS[k] = await L.load(fs.readFileSync(path.join(ROOT, "wasm", f)))

  const src = fs.readFileSync(FILE, "utf8")
  const p = new P(); p.setLanguage(LANGS.svelte)
  const root = p.parse(src).rootNode
  const findAll = (n: any, t: string, out: any[] = []): any[] => {
    if (n.type === t) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, t, out) }
    return out
  }
  const trees: any[] = [], lines: number[] = [], cols: number[] = [], idx: number[] = []
  for (const se of findAll(root, "script_element")) {
    const raw = se.namedChildren.find((c: any) => c.type === "raw_text")
    if (!raw || !raw.text.trim()) continue
    const sp = new P(); sp.setLanguage(LANGS.js)
    trees.push(sp.parse(raw.text))
    lines.push(raw.startPosition.row + 1); cols.push(raw.startPosition.column); idx.push(raw.startIndex)
  }
  const a = new RealSvelteAnalyzer() as any
  const ctx: any = { sfcScriptTrees: trees, sfcScriptLines: lines, sfcScriptCols: cols, sfcScriptStartIndex: idx, sfcScriptLangs: [""] }
  const r = await a.analyze(root, src, "main.svelte", ctx)
  const calls = (r.relationships ?? []).filter((x: any) => x.type === "calls")
  for (const c of calls) console.log("calls:", c.source, "->", c.target)
}
main()
