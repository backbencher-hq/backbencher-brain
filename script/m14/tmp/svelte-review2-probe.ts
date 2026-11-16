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
async function analyzeSvelte(src: string, file = "T.svelte") {
  await parsers()
  const p = new P(); p.setLanguage(LANGS.svelte)
  const root = p.parse(src).rootNode
  const trees: any[] = [], lines: number[] = [], cols: number[] = [], idx: number[] = []
  for (const se of findAll(root, (n) => n.type === "script_element")) {
    const raw = se.namedChildren.find((c: any) => c.type === "raw_text")
    if (!raw || !raw.text.trim()) continue
    const sp = new P(); sp.setLanguage(LANGS.js)
    trees.push(sp.parse(raw.text))
    lines.push(raw.startPosition.row + 1); cols.push(raw.startPosition.column); idx.push(raw.startIndex)
  }
  const a = new RealSvelteAnalyzer() as any
  const ctx: any = trees.length ? { sfcScriptTrees: trees, sfcScriptLines: lines, sfcScriptCols: cols, sfcScriptStartIndex: idx, sfcScriptLangs: trees.map(() => "") } : {}
  return { result: await a.analyze(root, src, file, ctx), root }
}
async function main() {
  const run = async (name: string, src: string, checks: (r: any, root: any) => void) => {
    const { result: r, root } = await analyzeSvelte(src)
    try { checks(r, root); console.log("ok   " + name) } catch (e: any) { console.log("FAIL " + name + " :: " + e.message) }
  }
  const rels = (r: any, t: string) => (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === t)
  const tu = (r: any) => rels(r, "uses").map((x: any) => x.target)
  await run("D1-module-export-ranges", `<h1>T</h1>\n<script context="module">\nexport const helper = 1;\n</script>`, (r) => {
    const e = (r.exports ?? [])[0]
    console.log("   export=" + JSON.stringify(e?.range))
    if (!e?.range || e.range.startLine !== 3 || e.range.startIndex < 20) throw new Error("export range still script-relative")
  })
  await run("D3-comment-contents", `<span>{f(a) /* b */}</span>\n<span>{g(c)}</span>\n<script>\nfunction f(x) { return x; }\nfunction g(x) { return x; }\nlet a = 1;\nlet b = 2;\nlet c = 3;\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(tu(r)))
    for (const t of ["f", "a", "g", "c"]) if (!tu(r).includes(t)) throw new Error("real read lost: " + t)
    if (tu(r).includes("b")) throw new Error("comment content b still read")
  })
  await run("D3-line-comment", `<span>{\nurl // pick the url\n}</span>\n<script>\nlet url = "x";\nlet pick = 1;\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(tu(r)))
    if (!tu(r).includes("url")) throw new Error("real read url lost")
    if (tu(r).includes("pick")) throw new Error("line-comment content still read")
  })
  await run("D4-render-dotted", `{@render helpers.row(it)}\n{@render row(it)}\n{@render children?.()}\n<script>\nlet helpers = {};\nfunction row(x) {}\nlet it = 1;\nlet children = null;\n</script>`, (r) => {
    console.log("   calls=" + JSON.stringify(rels(r, "calls").map((x: any) => x.target)))
    const c = rels(r, "calls").map((x: any) => x.target)
    if (!c.includes("row")) throw new Error("leaf row lost")
    if (c.includes("helpers")) throw new Error("first-segment helpers still emitted")
    if (!c.includes("children")) throw new Error("children?.() fallback lost")
  })
  await run("D5-if-only", `{#if visible}<b>y</b>{/if}\n<script>\nlet visible = true;\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(tu(r)))
    if (!tu(r).includes("visible")) throw new Error("if condition unread")
  })
  await run("D5-else-if-key-only", `{#if a}<b>1</b>{:else if b}<b>2</b>{/if}\n{#key k}<span>x</span>{/key}\n<script>\nlet a = true;\nlet b = false;\nlet k = 1;\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(tu(r)))
    for (const t of ["a", "b", "k"]) if (!tu(r).includes(t)) throw new Error("condition unread: " + t)
  })
}
main()
