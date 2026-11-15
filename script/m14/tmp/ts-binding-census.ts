// Does the TS analyzer fabricate reads for binding positions too?
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
let P: any, LANG: any

async function parsers() {
  const wts: any = await import("web-tree-sitter")
  P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  LANG = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
}

async function probe(tag: string, src: string) {
  await parsers()
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(src).rootNode
  if (root.hasError) { console.log(`${tag}: PARSE ERROR`); return }
  const a = new RealTypeScriptAnalyzer() as any
  const r = await a.analyze(root, src, "probe.ts", {})
  const reads = (r.relationships ?? []).filter((x: any) => x.type === "uses")
  console.log(`${tag}: ${reads.length ? reads.map((u: any) => `${u.source}->${u.target}@${u.confidence}`).join(", ") : "(none)"}`)
}

const SRC = [
  `import Default from "./d";`,
  `import { named, other as alias } from "./n";`,
  `import * as ns from "./s";`,
  `const base = { count: 0 };`,
  `export function reader(flag: number) { return base.count + flag; }`,
  `export function binder(alpha: string, beta: string) { return 1; }`,
  `export function catcher() { try { reader(1); } catch (err) {} return 0; }`,
  `export const destructured = ({ first, second: renamed, ...third }: any) => 1;`,
  `export const [one, two] = [1, 2];`,
  `export { named as reexported };`,
].join("\n") + "\n"

async function main() {
  await probe("TS all-shapes", SRC)
  await probe("TS import binding", `import { named } from "./n";\n`)
  await probe("TS params", `export function binder(alpha: string, beta: string) { return 1; }\n`)
  await probe("TS genuine member read", `const base = { count: 0 };\nexport function reader(flag: number) { return base.count + flag; }\n`)
  await probe("TS genuine bare read", `const flag = 1;\nexport function reader() { return flag; }\n`)
}

main()
