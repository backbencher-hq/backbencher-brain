// cpp-decl-ab.ts — controlled A/B of the CPPD12/CPPD13 declarator fixes.
//
// HEAD's analyzer is materialized at run time (`git show HEAD:` into a temp file,
// only import specifiers rewritten to absolute paths) and both versions are run
// over the SAME two real corpus files. The edge/symbol sets are then diffed, so
// every consequence of the change is named — including the three
// `uses … -> get_ref` edges the nlohmann full extent reported as NEW, which this
// has to explain rather than tolerate.
//
//   bun script/m14/tmp/cpp-decl-ab.ts
import * as fs from "fs"
import * as path from "path"
import { execFileSync } from "child_process"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CORPUS = "/home/ishaq2321/bb_tests/repositories/nlohmann-json"
const TMP = "/tmp/cpp-ab"

const FILES = [
  "tests/thirdparty/Fuzzer/FuzzerUtilDarwin.cpp",
  "tests/abi/include/nlohmann/json_v3_10_5.hpp",
  "include/nlohmann/json.hpp",
]

function materializeHead(): string {
  fs.mkdirSync(TMP, { recursive: true })
  const src = execFileSync("git", ["show", "HEAD:src/ast/real-cpp-analyzer.ts"], { cwd: ROOT, maxBuffer: 64 << 20 }).toString()
  // Rewrite relative imports to absolute so the temp file resolves the real modules.
  const rewritten = src.replace(/from\s+"(\.\.?\/[^"]+)"/g, (_m, rel: string) => {
    const abs = path.resolve(ROOT, "src/ast", rel)
    const noExt = abs.replace(/\.(ts|js)$/, "")
    return `from "${noExt}"`
  })
  const out = path.join(TMP, "head-cpp-analyzer.ts")
  fs.writeFileSync(out, rewritten)
  return out
}

async function runOne(label: string, modPath: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")))
  const mod: any = await import(modPath)
  const A: any = mod.RealCppAnalyzer
  const res: Record<string, { edges: Set<string>; syms: Set<string> }> = {}
  for (const rel of FILES) {
    const src = fs.readFileSync(path.join(CORPUS, rel), "utf8")
    const p = new P(); p.setLanguage(LANG)
    const root = p.parse(src).rootNode
    const out: any = await new A().analyze(root, src, rel)
    res[rel] = {
      edges: new Set((out.relationships as any[]).map((r: any) => `${r.type} ${r.source} -> ${r.target} @${r.line_number}`)),
      syms: new Set((out.symbols as any[]).map((s: any) => `${s.kind}:${s.name}@${s.metadata?.nameLine ?? s.range?.startLine}`)),
    }
  }
  console.log(`--- ${label}: ${Object.entries(res).map(([f, v]) => `${f.split("/").pop()} ${v.edges.size}e/${v.syms.size}s`).join("  ")} ---`)
  return res
}

async function main() {
  const headPath = materializeHead()
  const head = await runOne("HEAD (pre-fix)", headPath)
  const mine = await runOne("MINE (CPPD12/13)", path.join(ROOT, "src/ast/real-cpp-analyzer.ts"))
  for (const rel of FILES) {
    console.log(`\n=== ${rel} ===`)
    const h = head[rel], m = mine[rel]
    const add = [...m.edges].filter((e) => !h.edges.has(e))
    const rm = [...h.edges].filter((e) => !m.edges.has(e))
    console.log(`  edges added by the fix:   ${add.length}`)
    for (const e of add.slice(0, 25)) console.log(`    + ${e}`)
    console.log(`  edges removed by the fix: ${rm.length}`)
    for (const e of rm.slice(0, 25)) console.log(`    - ${e}`)
    const sa = [...m.syms].filter((s) => !h.syms.has(s))
    const sr = [...h.syms].filter((s) => !m.syms.has(s))
    console.log(`  symbols added: ${sa.length}; removed: ${sr.length}`)
    for (const s of sa.slice(0, 12)) console.log(`    + ${s}`)
    for (const s of sr.slice(0, 12)) console.log(`    - ${s}`)
  }
}
main()
