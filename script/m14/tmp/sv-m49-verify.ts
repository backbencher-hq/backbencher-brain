// M49.Sv independent verification of the co-agent's svelte wave.
// Fresh probe sources (not reused from their harnesses) — each claim gets a
// minimal shape asserting the FIXED contract, plus the 2 refutations.
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
  const trees: any[] = [], lines: number[] = [], cols: number[] = [], idx: number[] = [], langs: string[] = []
  for (const se of findAll(root, (n) => n.type === "script_element")) {
    const raw = se.namedChildren.find((c: any) => c.type === "raw_text")
    if (!raw || !raw.text.trim()) continue
    const sp = new P(); sp.setLanguage(LANGS.js)
    trees.push(sp.parse(raw.text))
    lines.push(raw.startPosition.row + 1); cols.push(raw.startPosition.column); idx.push(raw.startIndex)
    langs.push(se.childForFieldName("start_tag")?.text.includes('lang="ts"') ? "ts" : "")
  }
  const a = new RealSvelteAnalyzer() as any
  const ctx: any = trees.length ? { sfcScriptTrees: trees, sfcScriptLines: lines, sfcScriptCols: cols, sfcScriptStartIndex: idx, sfcScriptLangs: langs } : {}
  return { result: await a.analyze(root, src, file, ctx), root }
}

let pass = 0, fail = 0
async function run(name: string, src: string, checks: (r: any) => void) {
  const { result: r } = await analyzeSvelte(src)
  try { checks(r); pass++; console.log("ok   " + name) } catch (e: any) { fail++; console.log("FAIL " + name + " :: " + e.message) }
}
const rels = (r: any, t: string) => (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === t)
const syms = (r: any, n: string) => (r.symbols ?? []).filter((s: any) => s.name === n)

async function main() {
  // H1: shorthand {value} must produce a use of value
  await run("H1 shorthand attr", `<Card {count} />\n<script>\nimport Card from "./Card.svelte";\nlet count = 0;\n</script>`, (r) => {
    if (!rels(r, "uses").some((x: any) => x.target === "count")) throw new Error("no use of count")
  })

  // H2: this={Comp} dynamic dispatch → instantiates Comp
  await run("H2 this= dynamic component", `<svelte:component this={View} />\n<script>\nimport View from "./View.svelte";\n</script>`, (r) => {
    if (!rels(r, "instantiates").some((x: any) => x.target === "View")) throw new Error("no instantiates(View)")
  })

  // H3: spread {...props} → use of props
  await run("H3 spread attr", `<Box {...rest} />\n<script>\nimport Box from "./Box.svelte";\nlet rest = {};\n</script>`, (r) => {
    if (!rels(r, "uses").some((x: any) => x.target === "rest")) throw new Error("no use of rest")
  })

  // H4: script ranges fully SFC-mapped (line, column, index)
  // Convention (JS-control verified): symbols anchor at the declaration
  // keyword, 1-based columns. `export function` at line-3 col 7 (0-based)
  // → startColumn 8; startIndex 17 = exact SFC byte offset of line 3.
  await run("H4 script range coherence", `<nav />\n<script>\nexport function alpha() {\n  return beta();\n}\nfunction beta() { return 1; }\n</script>`, (r) => {
    const a = syms(r, "alpha")[0]
    if (!a) throw new Error("alpha symbol missing")
    if (a.range.startLine !== 3) throw new Error("line " + a.range.startLine + " != 3 (SFC)")
    if (a.range.startColumn !== 8) throw new Error("column " + a.range.startColumn + " != 8 (SFC 1-based, export prefix = 7 chars)")
    if (a.range.startIndex !== 17 + 7) throw new Error("startIndex " + a.range.startIndex + " != 24 (SFC line-3 offset 17 + col 7)")
  })

  // H4/D1: exports (instance + module blocks) range-mapped
  await run("D1 module-block export ranges", `<div />\n<script module>\nexport const VERSION = 2;\n</script>`, (r) => {
    const v = syms(r, "VERSION")[0]
    if (!v) throw new Error("VERSION missing")
    if (v.range.startLine !== 3) throw new Error("export line " + v.range.startLine + " != 3 (raw script-relative would be 1)")
  })

  // M1: await-block then var must not shadow script members
  await run("M1 await phantom shadow gone", `{#await load then data}\n<p>{title}</p>\n{/await}\n<script>\nlet load = null;\nlet title = "t";\n</script>`, (r) => {
    if (!rels(r, "uses").some((x: any) => x.target === "title")) throw new Error("title use shadowed")
  })

  // M2: string contents not tokenized as members
  await run("M2 string contents skipped", `<p>{fmt("x=y")}</p>\n<script>\nfunction fmt(s) { return s; }\nlet x = 1, y = 2;\n</script>`, (r) => {
    const bad = rels(r, "uses").filter((x: any) => x.target === "x" || x.target === "y")
    if (bad.length) throw new Error("string contents leaked: " + JSON.stringify(bad))
    if (!rels(r, "uses").some((x: any) => x.target === "fmt")) throw new Error("fmt use lost")
  })

  // M3: member-chain leaf misattribution — {user.name} with a script `name` member
  await run("M3 chain leaf receiver-only", `<p>{user.name}</p>\n<script>\nlet user = {};\nlet name = "n";\n</script>`, (r) => {
    if (!rels(r, "uses").some((x: any) => x.target === "user")) throw new Error("receiver user missing")
    const leaf = rels(r, "uses").filter((x: any) => x.target === "name")
    if (leaf.length) throw new Error("leaf name misattributed: " + JSON.stringify(leaf))
  })

  // M4: inline then var registered as template-local (no false member use)
  await run("M4 inline then local", `{#await p then val}\n<span>{val}</span>\n{/await}\n<script>\nlet p = null;\nlet val = "shadow-target";\n</script>`, (r) => {
    const falseUse = rels(r, "uses").filter((x: any) => x.target === "val")
    if (falseUse.length) throw new Error("inline-then val leaked as member use: " + JSON.stringify(falseUse))
  })

  // D3: comments inside template expressions skipped
  await run("D3 comments in expressions", `<p>{compute(input) /* scratch */}</p>\n<p>{fetch(url) // note\n}</p>\n<script>\nfunction compute(i) { return i; }\nfunction fetch(u) { return u; }\nlet input = 1, url = "u";\nlet scratch = 2, note = 3;\n</script>`, (r) => {
    const bad = rels(r, "uses").filter((x: any) => x.target === "scratch" || x.target === "note")
    if (bad.length) throw new Error("comment tokens leaked: " + JSON.stringify(bad))
  })

  // D4: dotted render target resolves to callable leaf
  await run("D4 dotted render leaf", `{@render helpers.row(item)}\n<script>\nlet helpers = {};\nlet item = 1;\n</script>`, (r) => {
    const calls = rels(r, "calls").map((x: any) => x.target)
    if (!calls.includes("row")) throw new Error("calls targets " + JSON.stringify(calls) + " — no leaf 'row'")
    if (calls.includes("helpers")) throw new Error("namespace 'helpers' still targeted (backwards resolution)")
  })

  // D5: {#if} condition head read (isolated — member read nowhere else)
  await run("D5 if-condition read", `{#if ready}\n<p>go</p>\n{/if}\n<script>\nlet ready = false;\n</script>`, (r) => {
    if (!rels(r, "uses").some((x: any) => x.target === "ready")) throw new Error("condition head 'ready' unread")
  })

  // D5b: {:else if} and {#key} heads
  await run("D5b else-if + key heads", `{#if a}\n<p>1</p>\n{:else if b}\n<p>2</p>\n{/if}\n{#key c}\n<p>3</p>\n{/key}\n<script>\nlet a = 1, b = 2, c = 3;\n</script>`, (r) => {
    for (const t of ["a", "b", "c"]) {
      if (!rels(r, "uses").some((x: any) => x.target === t)) throw new Error("head '" + t + "' unread")
    }
  })

  // Refutation D2: aliased this= import resolves via local name
  await run("REF D2 aliased this=", `<svelte:component this={Renamed} />\n<script>\nimport { Comp as Renamed } from "./c";\n</script>`, (r) => {
    if (!rels(r, "instantiates").some((x: any) => x.target === "Renamed")) throw new Error("aliased this= unresolved (refutation broken)")
  })

  console.log(`\n== ${pass} ok, ${fail} FAIL ==`)
  if (fail > 0) process.exitCode = 1
}
main()
