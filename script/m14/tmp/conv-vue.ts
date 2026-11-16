// Convergence sweep: vue probes for the 7 shared blind-spot classes.
// Vue needs the engine-preparsed SFC script context — this module supplies its
// own analyze() (same plumbing as the V1/V2 verification probes, verified there).
import * as fs from "fs"
import { RealVueAnalyzer } from "../../../src/ast/real-vue-analyzer"
import type { Probe } from "./conv-harness"

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
    blocks.push({ body: raw.text, startLine: raw.startPosition.row + 1, startColumn: raw.startPosition.column, startIndex: raw.startIndex, lang: langAttr })
  }
  return blocks
}

// Custom analyze: parse the SFC, preparse script blocks, run the vue analyzer.
// The probe lines are the SFC source; parse-error checking happens here.
export async function analyze(lines: string[], file: string): Promise<any> {
  await parsers()
  const src = lines.join("\n") + "\n"
  const p = new P(); p.setLanguage(LANGS.vue)
  const root = p.parse(src).rootNode
  if (root.hasError) throw new Error("PARSE_ERROR: probe source has ERROR nodes — fix the probe, not the analyzer")
  const trees: any[] = [], slines: number[] = [], cols: number[] = [], langs: string[] = [], idxs: number[] = []
  for (const b of scriptBlocks(root)) {
    const isTs = b.lang === "ts" || b.lang === "tsx"
    const sp = new P(); sp.setLanguage(isTs ? LANGS.ts : LANGS.js)
    trees.push(sp.parse(b.body))
    slines.push(b.startLine); cols.push(b.startColumn); langs.push(b.lang); idxs.push(b.startIndex)
  }
  const a = new RealVueAnalyzer() as any
  const ctx: any = trees.length ? { sfcScriptTrees: trees, sfcScriptLines: slines, sfcScriptCols: cols, sfcScriptLangs: langs, sfcScriptStartIndex: idxs } : {}
  return a.analyze(root, src, file, ctx)
}

const rels = (res: any) => res.relationships ?? []
const ofType = (res: any, t: string) => rels(res).filter((e: any) => e.type === t)

const probes: Probe[] = [
  // C1: substring disease — dotted user call survives
  {
    cls: "C1",
    name: "dotted user call survives builtin filter",
    lines: [
      "<script>",
      "const Service = { doWork() {} }",
      "export default {",
      "  methods: {",
      "    run() { Service.doWork() },",
      "  },",
      "}",
      "</script>",
    ],
    check: (res) => {
      const hits = rels(res).filter((e: any) => String(e.target).includes("doWork"))
      return { ok: hits.length > 0, detail: "edges reaching doWork: " + hits.length }
    },
  },
  // C2: write-gate — this.count = v must NOT read-use count from the LHS
  {
    cls: "C2",
    name: "assignment LHS is a write, not a read",
    lines: [
      "<script>",
      "export default {",
      "  data() { return { count: 0 } },",
      "  methods: {",
      "    save(v) { this.count = v },",
      "  },",
      "}",
      "</script>",
    ],
    check: (res) => {
      // LHS write must not emit a read edge for count (only the RHS read of v's
      // chain would; count appears only as write here)
      const bad = ofType(res, "uses").filter((e: any) => String(e.target) === "count")
      return { ok: bad.length === 0, detail: "uses edges on write LHS count: " + bad.length + " (D1 pin keeps template refs separate)" }
    },
  },
  // C2+: template interpolation {{ count }} MUST read count (V1 pin)
  {
    cls: "C2+",
    name: "template interpolation still reads (V1 pin)",
    lines: [
      "<script>",
      "export default {",
      "  data() { return { count: 0 } },",
      "}",
      "</script>",
      "<template>",
      "  <div>{{ count }}</div>",
      "</template>",
    ],
    check: (res) => {
      const uses = ofType(res, "uses").filter((e: any) => String(e.target) === "count")
      return { ok: uses.length > 0, detail: "template uses edges on count: " + uses.length }
    },
  },
  // C3: 1-based lines — script-side symbol on SFC line 4 reports 4
  {
    cls: "C3",
    name: "script symbol line is SFC-coherent (H3 pin)",
    lines: [
      "<script>",
      "export default {",
      "  methods: {",
      "    target() {},",
      "  },",
      "}",
      "</script>",
    ],
    check: (res) => {
      const t = (res.symbols ?? []).find((s: any) => s.name === "target")
      if (!t) return { ok: false, detail: "target symbol not found" }
      return { ok: t.range?.startLine === 4, detail: "reported=" + t.range?.startLine + " expected=4 (SFC line, H3 byte-base pin)" }
    },
  },
  // C4: duplicate method keys in the options object — last body-carrying wins
  {
    cls: "C4",
    name: "duplicate method keys: last not silently dropped",
    lines: [
      "<script>",
      "export default {",
      "  methods: {",
      "    foo() { return 1 },",
      "    foo() { return 2 },",
      "  },",
      "}",
      "</script>",
    ],
    check: (res) => {
      const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
      const lines = foos.map((s: any) => s.range?.startLine)
      return { ok: foos.length >= 1 && lines.includes(5), detail: "count=" + foos.length + " lines=" + JSON.stringify(lines) }
    },
  },
  // C5: string contents never become edges (vue D1 pin)
  {
    cls: "C5",
    name: "quoted strings stay inert (D1 pin)",
    lines: [
      "<template>",
      "  <button @click=\"go('save')\">x</button>",
      "</template>",
      "<script>",
      "export default {",
      "  methods: { go(s) {} },",
      "}",
      "</script>",
    ],
    check: (res) => {
      const bad = rels(res).filter((e: any) => String(e.target) === "save" && (e.metadata?.isFieldAccess || String(e.source ?? "").includes("'")))
      // template handlers emit USES on the handler name (verified contract —
      // conv-v-c5 probe: uses probe -> go), never a member-read of the string
      const goUses = ofType(res, "uses").filter((e: any) => String(e.target) === "go")
      return { ok: bad.length === 0 && goUses.length > 0, detail: "string-read edges: " + bad.length + ", uses go: " + goUses.length }
    },
  },
  // C6: template-to-script cross-reference keeps root (vue's core contract)
  {
    cls: "C6",
    name: "template reads script member (cross-reference)",
    lines: [
      "<script>",
      "export default {",
      "  data() { return { user: null } },",
      "}",
      "</script>",
      "<template>",
      "  <div>{{ user.name }}</div>",
      "</template>",
    ],
    check: (res) => {
      const uses = ofType(res, "uses").filter((e: any) => String(e.target) === "user")
      return { ok: uses.length > 0, detail: "template uses on user: " + uses.length }
    },
  },
  // C7: framework detection surfaces in payload
  {
    cls: "C7",
    name: "vue framework detected",
    lines: [
      "<script>",
      "export default {",
      "  data() { return { a: 1 } },",
      "}",
      "</script>",
    ],
    check: (res) => {
      const fw: string[] = res.metadata?.detectedFrameworks ?? []
      return { ok: fw.includes("Vue"), detail: "detectedFrameworks=" + JSON.stringify(fw) }
    },
  },
]

export { probes }
