// Characterise TS's Uses surface honestly: which shapes emit, which don't.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
let P: any, LANG: any

async function probe(tag: string, src: string) {
  const wts: any = await import("web-tree-sitter")
  P = P ?? wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  LANG = LANG ?? (await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm"))))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(src).rootNode
  const a = new RealTypeScriptAnalyzer() as any
  const r = await a.analyze(root, src, "probe.ts", {})
  const uses = (r.relationships ?? []).filter((x: any) => x.type === "uses")
  console.log(`${tag}: ${uses.length ? uses.map((u: any) => `${u.source}->${u.target}@${u.confidence}`).join(", ") : "(none)"}`)
}

async function main() {
  await probe("this.member read", `class A { count = 0; m() { return this.count; } }`)
  await probe("local obj member read", `function f() { const o = { a: 1 }; return o.a; }`)
  await probe("module obj member read", `const o = { a: 1 };\nfunction f() { return o.a; }`)
  await probe("bare local read", `function f() { const x = 1; return x; }`)
  await probe("bare module read", `const x = 1;\nfunction f() { return x; }`)
  await probe("param read", `function f(p: number) { return p; }`)
  await probe("template interp", "function f(n: number) { return `hi ${n}`; }")
  await probe("type reference", `class A {}\nfunction f(x: A) { return x; }`)
  await probe("import binding read", `import { a } from "./m";\nconsole.log(a);`)
}

main()
