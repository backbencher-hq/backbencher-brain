// cpp-jsonassert-tree.ts — the narrowed fallback still mints `property:JSON_ASSERT`
// (owner `lexer`) at json_v3_10_5.hpp:7705, where the source is
//     JSON_ASSERT(std::char_traits<char_type>::to_char_type(current) == literal_text[0]);
// inside the body of `token_type scan_literal(...)`. So the node reaching the
// declaration branch is NOT shaped the way the narrowing assumes. This dumps the
// ACTUAL node and its declarator chain, plus what the analyzer publishes for it.
//
//   bun script/m14/tmp/cpp-jsonassert-tree.ts
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const FILE = "/home/ishaq2321/bb_tests/repositories/nlohmann-json/tests/abi/include/nlohmann/json_v3_10_5.hpp"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-cpp-analyzer"))
  const src = fs.readFileSync(FILE, "utf8")
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(src).rootNode

  // The node whose start row is 7704 (0-based line 7705).
  let found: any = null
  const walk = (n: any, depth: number) => {
    if (n.startPosition.row === 7704 && !found) found = n
    for (const c of n.children) walk(c, depth + 1)
  }
  walk(root, 0)
  let cur = found
  const chain: string[] = []
  while (cur && chain.length < 8) { chain.push(`${cur.type}${cur.isNamed ? "" : "(anon)"}`); cur = cur.parent }
  console.log(`node at line 7705: ${found?.type}`)
  console.log(`  ancestry: ${chain.join(" < ")}`)
  console.log(`  sexp: ${(found?.toString() ?? "").replace(/\s+/g, " ").slice(0, 260)}`)
  const declAncestor = (() => {
    let n = found
    while (n && n.startPosition.row === 7704) n = n.parent
    return n
  })()
  console.log(`  parent at that row: ${declAncestor?.type}`)
  const declField = declAncestor?.childForFieldName?.("declarator")
  console.log(`  parent's declarator field: ${declField ? `${declField.type} :: ${JSON.stringify(declField.text.slice(0, 60))}` : "(none)"}`)
  if (declField) {
    const inner = declField.childForFieldName?.("declarator")
    console.log(`  its inner declarator: ${inner ? `${inner.type} :: ${JSON.stringify(inner.text.slice(0, 40))}` : "(none)"}`)
  }

  const res: any = await new mod.RealCppAnalyzer().analyze(root, src, "tests/abi/include/nlohmann/json_v3_10_5.hpp")
  const syms = (res.symbols as any[]).filter((s: any) => ["JSON_ASSERT", "assert_invariant", "static_cast", "dump"].includes(s.name))
  console.log(`\n  analyzer symbols for those names: ${syms.length}`)
  for (const s of syms) console.log(`    ${s.kind}:${s.name} owner=${s.ownerName}/${s.ownerKind} nameLine=${s.metadata?.nameLine}`)
}
main()
