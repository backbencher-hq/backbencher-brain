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
async function analyzeSvelte(src: string, file = "T.svelte") {
  await parsers()
  const p = new P(); p.setLanguage(LANGS.svelte)
  const root = p.parse(src).rootNode
  const trees: any[] = [], lines: number[] = [], cols: number[] = []
  for (const se of findAll(root, (n) => n.type === "script_element")) {
    const raw = se.namedChildren.find((c: any) => c.type === "raw_text")
    if (!raw || !raw.text.trim()) continue
    const sp = new P(); sp.setLanguage(LANGS.js)
    trees.push(sp.parse(raw.text))
    lines.push(raw.startPosition.row + 1); cols.push(raw.startPosition.column)
  }
  const a = new RealSvelteAnalyzer() as any
  const ctx: any = trees.length ? { sfcScriptTrees: trees, sfcScriptLines: lines, sfcScriptCols: cols, sfcScriptLangs: trees.map(() => "") } : {}
  return { result: await a.analyze(root, src, file, ctx), root }
}
async function main() {
  const run = async (name: string, src: string, checks: (r: any, root: any) => void) => {
    const { result: r, root } = await analyzeSvelte(src)
    try { checks(r, root); console.log("ok   " + name) } catch (e: any) { console.log("FAIL " + name + " :: " + e.message) }
  }
  const rels = (r: any, t: string) => (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === t)
  const syms = (r: any, n: string) => (r.symbols ?? []).filter((s: any) => s.name === n)
  await run("S3-inline-await-value", `{#await promise then value}\n<span>{value}</span>\n{/await}\n<script>\nlet promise = null;\nlet value = 0;\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses")))
    if (rels(r, "uses").some((x: any) => x.target === "value")) throw new Error("inline then-var leaked as member use (claim TRUE)")
  })
  await run("S3-module-exports", `<script context="module">\nexport const helper = 1;\nexport function util() {}\n</script>\n<script>\nlet x = 1;\n</script>`, (r) => {
    console.log("   exports=" + JSON.stringify((r.exports ?? []).map((e: any) => e.name)) + " syms=" + JSON.stringify((r.symbols ?? []).map((s: any) => s.name + ":" + s.kind + (s.ownerName ? "(" + s.ownerName + ")" : ""))))
    if (!(r.exports ?? []).some((e: any) => e.name === "helper")) throw new Error("module export lost (claim TRUE)")
    if ((r.symbols ?? []).some((s: any) => s.ownerName === "T" && (s.name === "helper" || s.name === "util"))) throw new Error("module export misowned as prop (claim TRUE)")
  })
  await run("S3-onclick-handler", `<button on:click={inc}>x</button>\n<script>\nfunction inc() {}\nfunction bump() {}\n</script>`, (r) => {
    console.log("   calls=" + JSON.stringify(rels(r, "calls")))
    if (!rels(r, "calls").some((x: any) => x.target === "inc")) throw new Error("handler call missed (claim TRUE)")
  })
  await run("S3-onclick-arrow", `<button on:click={() => bump()}>x</button>\n<script>\nfunction bump() {}\n</script>`, (r) => {
    console.log("   calls=" + JSON.stringify(rels(r, "calls")))
    if (!rels(r, "calls").some((x: any) => x.target === "bump")) throw new Error("arrow handler leaf missed (claim TRUE)")
  })
}
main()
