// cpp-nlohmann-residual-probe.ts — run the cpp analyzer on the TWO REAL files the
// .cpp-inclusive full extent disagreed on, and dump what it actually did:
//
//   tests/thirdparty/Fuzzer/FuzzerUtilDarwin.cpp  :: uses (expr) -> environ   MISSING
//   tests/abi/include/nlohmann/json_v3_10_5.hpp   :: uses binary_reader -> strict  UNEXPLAINED
//
// Synthetic reductions of both shapes emitted nothing at all (see
// cpp-environ-param-probe.ts), so the shape is not the construct — something about
// these files is. This dumps the declared symbols, every relationship, and the
// source text behind each interesting one, so the cause is read off the analyzer
// rather than guessed from the diff row.
//
//   bun script/m14/tmp/cpp-nlohmann-residual-probe.ts
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS = "/home/ishaq2321/bb_tests/repositories/nlohmann-json"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-cpp-analyzer"))

  // ---------------------------------------------------------------- file 1
  {
    const rel = "tests/thirdparty/Fuzzer/FuzzerUtilDarwin.cpp"
    const src = fs.readFileSync(path.join(CORPUS, rel), "utf8")
    const p = new P(); p.setLanguage(LANG)
    const root = p.parse(src).rootNode
    const res: any = await new mod.RealCppAnalyzer().analyze(root, src, rel)
    console.log(`\n=== ${rel} ===`)
    console.log(`  symbols (${res.symbols.length}):`)
    for (const s of res.symbols) console.log(`    ${JSON.stringify({ kind: s.kind, name: s.name, startLine: s.startLine, line: s.line, filePath: s.filePath, keys: Object.keys(s).slice(0, 14) })}`)
    console.log(`  relationships (${res.relationships.length}):`)
    for (const r of res.relationships) console.log(`    ${r.type}  ${r.source} -> ${r.target}  line=${r.line ?? r.startLine ?? "?"}`)
    console.log(`  source lines 18-24 and 94-100:`)
    for (const i of [17, 18, 19, 20, 93, 94, 95, 96, 97]) {
      const t = (src.split("\n")[i] ?? "")
      if (t.trim()) console.log(`    ${i + 1}: ${t}`)
    }
  }

  // ---------------------------------------------------------------- file 2
  {
    const rel = "tests/abi/include/nlohmann/json_v3_10_5.hpp"
    const src = fs.readFileSync(path.join(CORPUS, rel), "utf8")
    const p = new P(); p.setLanguage(LANG)
    const root = p.parse(src).rootNode
    const res: any = await new mod.RealCppAnalyzer().analyze(root, src, rel)
    console.log(`\n=== ${rel} ===`)
    const keys = Object.keys(res.symbols[0] ?? {})
    console.log(`  symbol keys: ${JSON.stringify(keys)}`)
    const strictSyms = res.symbols.filter((s: any) => s.name === "strict")
    console.log(`  symbols named strict (${strictSyms.length}):`)
    for (const s of strictSyms) {
      const line = s.startLine ?? s.line ?? (typeof s.startIndex === "number" ? src.slice(0, s.startIndex).split("\n").length : "?")
      console.log(`    ${JSON.stringify(s).slice(0, 300)}`)
      if (typeof line === "number") console.log(`      source: ${JSON.stringify((src.split("\n")[line - 1] ?? "").trim().slice(0, 100))}`)
    }
    const environSyms = res.symbols.filter((s: any) => s.name === "environ")
    console.log(`  symbols named environ: ${environSyms.length}`)
    const strictRels = res.relationships.filter((r: any) => r.target === "strict")
    console.log(`  relationships with target strict (${strictRels.length}): ${JSON.stringify(strictRels.slice(0, 12))}`)
    // Where does the file mention `strict` in an enumerator position?
    const lines = src.split("\n")
    console.log(`  every source line containing the word strict that is NOT a parameter use:`)
    lines.forEach((t, i) => {
      if (/\bstrict\b/.test(t) && !/@param|bool strict|strict mode|strict &&|strict\)|&& strict|strict,|\bstrict\b\s*=\s*true/.test(t)) {
        console.log(`    ${i + 1}: ${t.trim().slice(0, 120)}`)
      }
    })
  }
}
main()
