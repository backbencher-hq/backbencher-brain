import * as WTS from "web-tree-sitter"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"
const CASES: [string, string][] = [
  ["for-of, bare identifier", `function files() {}\nfunction audit() { for (const file of files()) { use(file) } }`],
  ["for-of, array pattern",   `function pairs() {}\nfunction audit() { for (const [a, b] of pairs()) { use(a) } }`],
  ["for-of, object pattern",  `function entries() {}\nfunction audit() { for (const { a } of entries()) { use(a) } }`],
  ["for-in, bare identifier", `function obj() {}\nfunction audit() { for (let k in obj()) { use(k) } }`],
  ["catch, bare identifier",  `const e = 1\nfunction audit() { try {} catch (e) { use(e) } }`],
  ["catch, object pattern",   `function audit() { try {} catch ({ e }) { use(e) } }`],
  ["no const (for-in x in y)", `function obj() {}\nfunction audit() { for (k in obj()) { use(k) } }`],
]
async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load(`${process.cwd()}/wasm/tree-sitter-typescript.wasm`)
  for (const [label, src] of CASES) {
    const p = new P(); p.setLanguage(lang)
    const r: any = await new RealTypeScriptAnalyzer().analyze(p.parse(src).rootNode, src, "/tmp/opencode/h.ts")
    const refs = (r.relationships ?? []).filter((x: any) => x.type === "references").map((x: any) => `${x.source}->${x.target}`)
    console.log(`${label.padEnd(26)} [${refs.join(" | ")}]`)
  }
}
main()
