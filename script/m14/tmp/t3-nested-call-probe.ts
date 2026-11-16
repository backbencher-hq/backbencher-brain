// T3 probe (M49 W4 second rotated-sample finding): the svelte repo's TS lane
// reported `MISSING calls packages/svelte/tests/runtime-browser/test.ts -> text`
// at line 203 `console[method](message.text());`. Which side is wrong?
import * as fs from "fs"
import * as path from "path"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"
import { deriveTreeEdges, deriveTypeScriptEdges } from "../differential"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const src = [
  "function log(method: string, message: { text(): string }) {",
  "  console[method](message.text());",
  "}",
  "declare const console: any;",
].join("\n")

const CASES: Array<[string, string]> = [
  ["console.log(nested call)", "declare const console: any\nfunction f(m: any) { console.log(m.text()); }\n"],
  ["console[method](nested call)", "declare const console: any\nfunction f(m: any, method: string) { console[method](m.text()); }\n"],
  ["plain call (control)", "function f(m: any, g: any) { g(m.text()); }\n"],
  ["console.log(plain read)", "declare const console: any\nfunction f(m: any) { console.log(m); }\n"],
  ["offset: console.log(1 + m.text())", "declare const console: any\nfunction f(m: any) { console.log(1 + m.text()); }\n"],
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
  const p = new P()
  p.setLanguage(lang)
  for (const [tag, s] of CASES) {
    const root = p.parse(s).rootNode
    const a = new RealTypeScriptAnalyzer() as any
    const r = await a.analyze(root, s, "probe.ts", {})
    const an = (r.relationships ?? []).filter((x: any) => x.type === "calls")
    const truth = deriveTreeEdges(root, "typescript").concat(deriveTypeScriptEdges(root) as any).filter((e: any) => e.label === "calls")
    const fmt = (es: any[]) => es.map((e: any) => `${e.target}`).join(", ") || "(none)"
    console.log(`${tag}: analyzer=[${fmt(an)}] oracle=[${fmt(truth)}]`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
