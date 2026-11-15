import * as WTS from "web-tree-sitter"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"
// now the shadowed name IS a file-level declaration, which is the only way a false edge can appear
const CASES: [string, string][] = [
  ["for-of bare id", `function file() {}\nfunction files() {}\nfunction audit() { for (const file of files()) { use(file) } }`],
  ["for-in bare id", `function k() {}\nfunction obj() {}\nfunction audit() { for (let k in obj()) { use(k) } }`],
  ["catch bare id", `function e() {}\nfunction audit() { try {} catch (e) { use(e) } }`],
  ["catch no bind", `function e() {}\nfunction audit() { try {} catch { use(e) } }`],
  ["for-of object pattern", `function a() {}\nfunction entries() {}\nfunction audit() { for (const { a } of entries()) { use(a) } }`],
  ["for-of after body use", `function file() {}\nfunction files() {}\nfunction audit() { for (const file of files()) {} use(file) }`],
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
    console.log(`${label.padEnd(24)} [${refs.join(" | ")}]`)
  }
}
main()
