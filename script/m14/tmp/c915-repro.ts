// #915 sibling class in the C corpora: what tree shape produces the ALL-CAPS
// variable symbols, and is the REAL symbol beside it emitted? One site per
// shape, taken from the measured sqlite census.
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = (wts.Parser ?? wts.default) as any
const L = (wts.Language ?? wts.default?.Language) as any
await P.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const lang = await L.load(readFileSync(`${ROOT}/wasm/tree-sitter-c.wasm`))
const parser = new P()
parser.setLanguage(lang)

const SITES: Array<[string, number, string]> = [
  ["<corpus-root>/bb_tests/repositories/sqlite/src/btmutex.c", 53, "SQLITE_NOINLINE between type and name (function prototype)"],
  ["<corpus-root>/bb_tests/repositories/sqlite/src/btree.c", 87, "SQLITE_WSD after the type (global pointer)"],
  ["<corpus-root>/bb_tests/repositories/sqlite/src/main.c", 138, "SQLITE_CDECL inside a function-pointer declarator"],
  ["<corpus-root>/bb_tests/repositories/sqlite/ext/jni/src/c/sqlite3-jni.c", 6244, "JNICALL before a function name (macro decorator)"],
]

for (const [file, line, why] of SITES) {
  const src = readFileSync(file, "utf8")
  const tree = parser.parse(src)
  const want = line - 1
  // innermost declaration-ish nodes covering the line
  const hits: any[] = []
  const walk = (n: any) => {
    if (n.startPosition.row <= want && n.endPosition.row >= want) {
      if (/declaration|function_definition|ERROR/.test(n.type)) hits.push(n)
      for (const c of n.children ?? []) walk(c)
    }
  }
  walk(tree.rootNode)
  console.log(`\n=== ${path.basename(file)}:${line} — ${why}`)
  console.log(`    source: ${JSON.stringify(src.split("\n")[want])}`)
  const innermost = hits.slice(-3)
  for (const n of innermost) {
    const dump = (m: any, d: number): string =>
      `${"  ".repeat(d)}${m.type}${m.isMissing ? "[MISSING]" : ""}${m.isError ? "[ERROR]" : ""} ${JSON.stringify(m.text.length > 50 ? m.text.slice(0, 50) : m.text)}`
    const lines = [dump(n, 0)]
    for (const c of n.children ?? []) lines.push(dump(c, 1))
    console.log(lines.join("\n"))
  }
  const { parseFile } = await import(`${ROOT}/src/ast/engine.ts`)
  const res: any = await parseFile(file, src, { language: "c" })
  const region = (res.symbols ?? []).filter((s: any) => s.range.startLine >= line - 2 && s.range.startLine <= line + 2)
  console.log("    symbols in ±2 lines:")
  for (const s of region) console.log(`      @${s.range.startLine} ${s.kind} ${s.name}`)
}
