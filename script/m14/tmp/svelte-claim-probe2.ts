import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
import { RealSvelteAnalyzer } from "../../../src/ast/real-svelte-analyzer"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
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
  await run("S2-await-block-x", `{#await p}\n{:then v}\n<span>{x}</span>\n{/await}\n<script>\nlet p = null;\nlet x = 1;\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses")))
    if (!rels(r, "uses").some((x: any) => x.target === "x")) throw new Error("member x shadowed by phantom (claim TRUE)")
    if (!rels(r, "uses").some((x: any) => x.target === "p")) throw new Error("promise use missed")
  })
  await run("S2-string-contents", `{@const t = f("a=b")}\n<span>{f}</span>\n<script>\nfunction f(s) { return s; }\nlet a = 1;\nlet b = 2;\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses")))
    if (!rels(r, "uses").some((x: any) => x.target === "f")) throw new Error("real f use lost")
    if (rels(r, "uses").some((x: any) => x.target === "a" || x.target === "b")) throw new Error("string contents read as members (claim TRUE)")
  })
  await run("S2-bind-directive", `<input bind:value={name} />\n<script>\nlet name = "";\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses")))
    if (!rels(r, "uses").some((x: any) => x.target === "name")) throw new Error("bind: unread (claim TRUE)")
  })
  await run("S2-member-chain", `<span>{user.name}</span>\n<script>\nlet user = {};\nlet name = "";\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses")))
    if (!rels(r, "uses").some((x: any) => x.target === "user")) throw new Error("root use missed")
    if (rels(r, "uses").some((x: any) => x.target === "name")) throw new Error("chain leaf misattributed (claim TRUE)")
  })
}
main()
