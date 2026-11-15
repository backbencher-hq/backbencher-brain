// M49.V2: reproduce D1/D2/D3 live before fixing (verify-first).
import * as fs from "fs"
import { RealVueAnalyzer } from "../../../src/ast/real-vue-analyzer"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
let P: any, LANGS: Record<string, any> = {}

async function parsers() {
  if (P) return
  const wts: any = await import("web-tree-sitter")
  P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => ROOT + "/node_modules/web-tree-sitter/tree-sitter.wasm" })
  for (const [k, f] of [["vue", "tree-sitter-vue.wasm"], ["js", "tree-sitter-javascript.wasm"], ["ts", "tree-sitter-typescript.wasm"]] as const) {
    LANGS[k] = await L.load(fs.readFileSync(ROOT + "/wasm/" + f))
  }
}

function findAll(n: any, pred: (x: any) => boolean, out: any[] = []): any[] {
  if (pred(n)) out.push(n)
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
  return out
}

function scriptBlocks(root: any) {
  const blocks: any[] = []
  for (const se of findAll(root, (n) => n.type === "script_element")) {
    const raw = se.namedChildren.find((c: any) => c.type === "raw_text")
    if (!raw) continue
    const stag = se.namedChildren.find((c: any) => c.type === "start_tag")
    const langAttr = stag ? /lang\s*=\s*"([^"]*)"/.exec(stag.text)?.[1] ?? "" : ""
    blocks.push({ body: raw.text, startLine: raw.startPosition.row + 1, startColumn: raw.startPosition.column, startIndex: raw.startIndex, lang: langAttr })
  }
  return blocks
}

async function analyzeVue(src: string, file = "T.vue") {
  await parsers()
  const p = new P(); p.setLanguage(LANGS.vue)
  const root = p.parse(src).rootNode
  const trees: any[] = [], lines: number[] = [], cols: number[] = [], langs: string[] = [], idxs: number[] = []
  for (const b of scriptBlocks(root)) {
    const isTs = b.lang === "ts" || b.lang === "tsx"
    const sp = new P(); sp.setLanguage(isTs ? LANGS.ts : LANGS.js)
    trees.push(sp.parse(b.body))
    lines.push(b.startLine); cols.push(b.startColumn); langs.push(b.lang); idxs.push(b.startIndex)
  }
  const a = new RealVueAnalyzer() as any
  const ctx: any = trees.length ? { sfcScriptTrees: trees, sfcScriptLines: lines, sfcScriptCols: cols, sfcScriptLangs: langs, sfcScriptStartIndex: idxs } : {}
  return a.analyze(root, src, file, ctx)
}

const rels = (r: any, type: string) => (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === type)

async function main() {
  const out: string[] = []

  // D1: string literal contents must NOT emit false Uses
  {
    const r = await analyzeVue(`<template>\n  <button @click="go('save')">x</button>\n</template>\n<script>\nexport default {\n  methods: { save() {}, go(s: string) {} },\n};\n</script>`)
    const targets = rels(r, "uses").map((x: any) => x.target)
    out.push(`D1 uses targets: ${JSON.stringify(targets)}  <- 'save' here = FALSE member read (claim TRUE if present)`)
  }
  {
    const r = await analyzeVue(`<template>\n  <div :label="'save'">x</div>\n</template>\n<script>\nexport default {\n  methods: { save() {} },\n};\n</script>`)
    const targets = rels(r, "uses").map((x: any) => x.target)
    out.push(`D1b :label="'save'" uses: ${JSON.stringify(targets)}  <- same hole`)
  }

  // D2: arrow-function data keys
  {
    const r = await analyzeVue(`<template>\n  <div>{{ count }}</div>\n</template>\n<script>\nexport default {\n  data: () => ({ count: 0 }),\n};\n</script>`)
    const targets = rels(r, "uses").map((x: any) => x.target)
    out.push(`D2 arrow-data uses: ${JSON.stringify(targets)}  <- 'count' missing = claim TRUE`)
  }

  // D3: decorated export default
  {
    const r = await analyzeVue(`<template>\n  <div/>\n</template>\n<script>\n@Component\nexport default {\n  methods: { ping() {} },\n};\n</script>`)
    const ping = (r.symbols ?? []).find((s: any) => s.name === "ping")
    out.push(`D3 ping owner: ${JSON.stringify(ping ? ping.ownerName : null)}  <- undefined = claim TRUE`)
  }

  process.stderr.write(out.join("\n") + "\n")
  process.exit(0)
}
main()
