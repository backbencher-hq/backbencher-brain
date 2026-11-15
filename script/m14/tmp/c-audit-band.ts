import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
async function bench(lang: "c" | "cpp") {
  const language = await L.load(readFileSync(`wasm/tree-sitter-${lang}.wasm`))
  const parser = new P(); parser.setLanguage(language)
  const mod: any = await import(`../../../src/ast/real-${lang}-analyzer`)
  const A = mod.RealCAnalyzer ?? mod.RealCppAnalyzer ?? mod.default
  const an = new A()
  const Z = "/home/ishaq2321/bb_tests/repositories/zig"
  const files = execFileSync("bash", ["-c", `find ${Z} -name '*.${lang}' -size +8k -size -40k | sort | head -25`], { encoding: "utf8" }).split("\n").filter(Boolean)
  let ms = 0, nodes = 0, kb = 0
  for (const f of files) {
    const src = readFileSync(f, "utf8")
    const tree = parser.parse(src)
    const t = performance.now()
    await an.analyze(tree.rootNode, src, f)
    ms += performance.now() - t
    let c = 0; const walk = (n: any) => { c++; for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i)) }
    walk(tree.rootNode); nodes += c; kb += src.length / 1024
  }
  console.log(`${lang}: ${files.length} files in [8k,40k) | ${kb.toFixed(0)}KB ${nodes} nodes | analyze ${ms.toFixed(0)}ms = ${(ms/kb).toFixed(2)}ms/KB, ${(ms/nodes*1000).toFixed(1)}ms/1k nodes`)
}
await bench("c"); await bench("cpp")
