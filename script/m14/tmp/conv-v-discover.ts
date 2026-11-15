import * as fs from "fs"
import { RealVueAnalyzer } from "../../../src/ast/real-vue-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-vue.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealVueAnalyzer()

  const src = [
    "<script>",
    "import axios from 'axios'",
    "export default {",
    "  data() { return { count: 0, inner: null } },",
    "  methods: {",
    "    save() { this.count = this.count + 1 },",
    "    load() { return axios.get('/x') },",
    "    go(msg) { log('save') },",
    "  },",
    "}",
    "</script>",
    "<template>",
    "  <div>{{ count }}</div>",
    "</template>",
  ].join("\n") + "\n"
  const tree = parser.parse(src)
  const res: any = az.analyze(tree.rootNode, src, "probe.vue")
  process.stdout.write("parseError=" + (tree.rootNode as any).hasError + "\n")
  process.stdout.write("rel: " + JSON.stringify((res.relationships ?? []).map((e: any) => (e.type ?? "?") + ":" + (e.source ?? e.from) + "->" + (e.target ?? e.to))) + "\n")
  process.stdout.write("fw: " + JSON.stringify(res.metadata?.detectedFrameworks) + "\n")
  process.stdout.write("symbols: " + JSON.stringify((res.symbols ?? []).map((s: any) => s.name + ":" + s.kind)) + "\n")
}
main().catch((e) => { console.error(e); process.exit(1) })
