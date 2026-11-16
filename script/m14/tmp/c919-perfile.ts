import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
const ROOT = "."
const CORPUS = "<corpus-root>/bb_tests/repositories"
const { macroDeclaredBody, RealCppAnalyzer } = await import("../../../src/ast/real-cpp-analyzer.ts")
const pred: any = new RealCppAnalyzer()
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(readFileSync("wasm/tree-sitter-cpp.wasm"))
const parser = new P(); parser.setLanguage(lang)
const files: string[] = []
for (const repo of ["fmt", "nlohmann-json"]) {
  const collect = (dir: string) => { let e: any[] = []; try { e = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const x of e) { const p = path.join(dir, x.name); if (x.isDirectory()) collect(p); else if (/\.(cpp|cc|cxx|hpp|hh|h)$/.test(x.name)) files.push(p) } }
  collect(path.join(CORPUS, repo))
}
const isCp2 = (n: any) => { if (!n || n.type !== "function_definition") return false
  const det = pred.getFunctionDetails(n)
  return !!(det && !det.isDestructor && !String(det.name).startsWith("operator") && pred.isMacroFunctionShape(n, det.name) && n.childForFieldName("body")) }
const rows: string[] = []
for (const f of files) {
  let src: string; try { src = readFileSync(f, "utf8") } catch { continue }
  const root = parser.parse(src).rootNode
  const st: any[] = [root]; let p = 0, u = 0, esP = 0
  while (st.length) { const n = st.pop()!
    if (isCp2(n)) p++
    else if (macroDeclaredBody(n)) { const prev = n.previousNamedSibling, par = n.parent
      if ((par && isCp2(par)) || (prev && isCp2(prev))) esP++; else u++ }
    for (let i = 0; i < n.childCount; i++) st.push(n.child(i)) }
  if (p + u + esP > 0) rows.push(`${(p + u + esP).toString().padStart(5)}  paired=${String(p).padStart(4)}  unpaired=${String(u).padStart(4)}  es-also-paired=${esP}  ${path.relative(CORPUS, f)}`)
}
rows.sort((a, b) => Number(b.trim().split(/\s+/)[0]) - Number(a.trim().split(/\s+/)[0]))
console.log(rows.slice(0, 12).join("\n"))
console.log(`... total rows ${rows.length}`)
