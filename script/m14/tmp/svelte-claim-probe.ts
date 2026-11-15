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
  const syms = (r: any, n: string) => (r.symbols ?? []).filter((s: any) => s.name === n)

  await run("S-each-order", `<ul>\n{#each items as item}\n<li>{item.name} {suffix}</li>\n{/each}\n</ul>\n<script>\nlet items = [];\nlet suffix = "!";\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses")) + " syms=" + JSON.stringify((r.symbols ?? []).map((s: any) => s.name)))
    if (!rels(r, "uses").some((x: any) => x.target === "items")) throw new Error("collection use missed (claim TRUE)")
    if (rels(r, "uses").some((x: any) => x.target === "item")) throw new Error("loop var leaked as use (claim TRUE)")
    if (!rels(r, "uses").some((x: any) => x.target === "suffix")) throw new Error("plain member use missed")
  })
  await run("S-shorthand-attr", `<Comp {value} />\n<script>\nimport Comp from "./c";\nlet value = 1;\n</script>`, (r, root) => {
    const dump: string[] = []
    const d = (n: any, dp: number) => { if (dp > 3) return; dump.push("  ".repeat(dp) + n.type + " = " + JSON.stringify(n.text.slice(0, 30))); for (let i = 0; i < n.namedChildCount && i < 6; i++) d(n.namedChild(i), dp + 1) }
    d(findAll(root, (n) => n.type === "element" || n.type === "self_closing_tag")[0], 0)
    console.log("   shape:\n" + dump.join("\n") + "\n   uses=" + JSON.stringify(rels(r, "uses")))
    if (!rels(r, "uses").some((x: any) => x.target === "value")) throw new Error("shorthand attr unread (claim TRUE)")
  })
  await run("S-dynamic-this", `<svelte:component this={Comp} />\n<script>\nimport Comp from "./c";\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses")) + " instantiates=" + JSON.stringify(rels(r, "instantiates")))
    // H2 design: import-bound bare this= is a DYNAMIC component usage →
    // instantiates (static-<Comp/> semantics); member-bound this= stays a
    // template uses via 3c. Either way Comp must be READ (claim FALSE).
    if (!rels(r, "instantiates").some((x: any) => x.target === "Comp")) throw new Error("this={Comp} unread (claim TRUE)")
  })
  await run("S-await-x-shadow", `{#await promise then value}\n<span>{x}</span>\n{/await}\n<script>\nlet promise = null;\nlet x = 1;\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses")))
    if (!rels(r, "uses").some((x: any) => x.target === "x")) throw new Error("member x shadowed by phantom (claim TRUE)")
  })
  await run("S-const-eq-string", `{@const t = f("x")}\n<span>{f} {x}</span>\n<script>\nfunction f(a) { return a; }\nlet x = 1;\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses")))
    if (!rels(r, "uses").some((x: any) => x.target === "f")) throw new Error("real f use lost (claim TRUE)")
    if (!rels(r, "uses").some((x: any) => x.target === "x")) throw new Error("real x use lost (claim TRUE)")
  })
  await run("S-spread-attr", `<Comp {...props} />\n<script>\nimport Comp from "./c";\nlet props = {};\n</script>`, (r) => {
    console.log("   uses=" + JSON.stringify(rels(r, "uses")))
    if (!rels(r, "uses").some((x: any) => x.target === "props")) throw new Error("spread unread (claim TRUE)")
  })
  await run("S-script-ranges", `<h1>T</h1>\n<script>\nfunction helper() { return work(); }\nfunction work() { return 1; }\n</script>`, (r) => {
    const h = syms(r, "helper")[0]
    console.log("   helper range=" + JSON.stringify(h?.range) + " qc=" + JSON.stringify(h?.qualified_calls))
    if (h && h.range.startLine !== 3) throw new Error("symbol line not SFC-mapped, got " + h.range.startLine + " (claim TRUE)")
    if (h && (h.range.startColumn !== 1 || h.range.startIndex < 20)) console.log("   NOTE columns/indices script-relative (claim TRUE)")
  })
}
main()
