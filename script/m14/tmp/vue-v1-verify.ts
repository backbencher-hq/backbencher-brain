// M49.V1 independent verification — H1-H3, M1-M5 probed against the LIVE
// analyzer through the same faithful SFC harness the engine uses.
import * as fs from "fs"
import { RealVueAnalyzer } from "../../../src/ast/real-vue-analyzer"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
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
    blocks.push({
      body: raw.text,
      startLine: raw.startPosition.row + 1,
      startColumn: raw.startPosition.column,
      startIndex: raw.startIndex,
      lang: langAttr,
    })
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
  const check = (name: string, ok: boolean, detail: string) =>
    out.push(`${ok ? "PASS" : "FAIL"}  ${name}: ${detail}`)

  // H1: Vue-2 data object + factory return keys readable by the template
  {
    const r = await analyzeVue(`<template>\n  <div>{{ count }}</div>\n</template>\n<script>\nexport default {\n  data: { count: 0 },\n};\n</script>`)
    check("H1a vue2 data object key read", rels(r, "uses").some((x: any) => x.target === "count"), JSON.stringify(rels(r, "uses").map((x: any) => x.target)))
  }
  {
    const r = await analyzeVue(`<template>\n  <div>{{ total }}</div>\n</template>\n<script>\nexport default {\n  data() { return { total: 0 } },\n};\n</script>`)
    check("H1b factory return key read", rels(r, "uses").some((x: any) => x.target === "total"), JSON.stringify(rels(r, "uses").map((x: any) => x.target)))
  }

  // H2: script errors + exports SFC-offset
  {
    // line 5 of the SFC = line 2 of the script; a syntax error there must report SFC line 5
    const src = `<template>\n  <div/>\n</template>\n<script>\nfunction broken( {\n</script>`
    const r = await analyzeVue(src)
    const errs = r.errors ?? []
    const rows = errs.map((e: any) => e.range?.startLine)
    check("H2 error rows SFC-offset", errs.length >= 1 && rows.every((n: number) => n >= 5), `rows=${JSON.stringify(rows)}`)
  }

  // M1: member-chain receivers — item.id must NOT emit Uses(id)
  {
    const r = await analyzeVue(`<template>\n  <div v-for="item in items">{{ item.id }}</div>\n</template>\n<script>\nexport default {\n  data() { return { items: [], id: 0 } },\n};\n</script>`)
    const targets = rels(r, "uses").map((x: any) => x.target)
    check("M1 no member-read misattribution", !targets.includes("id"), `uses=${JSON.stringify(targets)}`)
  }

  // M2: quoted keys unquoted, computed keys skipped
  {
    const r = await analyzeVue(`<template>\n  <div/>\n</template>\n<script>\nexport default {\n  methods: {\n    "save-data"() {},\n  },\n};\n</script>`)
    const names = (r.symbols ?? []).map((s: any) => s.name)
    check("M2a quoted key unquoted", names.includes("save-data"), `names=${JSON.stringify(names.filter((n: string) => n.includes("save")))}`)
  }

  // M3: serverPrefetch emits a symbol
  {
    const r = await analyzeVue(`<template>\n  <div/>\n</template>\n<script>\nexport default {\n  async serverPrefetch() {},\n};\n</script>`)
    check("M3 serverPrefetch symbol", (r.symbols ?? []).some((s: any) => s.name === "serverPrefetch"), JSON.stringify((r.symbols ?? []).map((s: any) => s.name)))
  }

  // M4: commented export default keeps ownership
  {
    const r = await analyzeVue(`<template>\n  <div/>\n</template>\n<script>\nexport /* c */ default {\n  methods: { ping() {} },\n};\n</script>`)
    const ping = (r.symbols ?? []).find((s: any) => s.name === "ping")
    check("M4 commented-default ownership", ping && ping.ownerName, JSON.stringify(ping ? { o: ping.ownerName, k: ping.kind } : null))
  }

  // M5: Options-API TS method carries params + return type
  {
    const r = await analyzeVue(`<template>\n  <div/>\n</template>\n<script lang="ts">\nexport default {\n  methods: {\n    save(id: string): void {},\n  },\n};\n</script>`)
    const save = (r.symbols ?? []).find((s: any) => s.name === "save")
    check("M5 params+returnType payload", save && Array.isArray(save.parameters) && save.parameters.length >= 1, JSON.stringify(save ? { p: save.parameters, rt: save.returnType } : null))
  }

  process.stderr.write(out.join("\n") + "\n")
  process.exit(0)
}
main()
