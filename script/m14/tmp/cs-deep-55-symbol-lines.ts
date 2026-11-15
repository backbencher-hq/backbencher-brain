import * as fs from "fs"; import * as path from "path"
const ROOT = process.cwd()
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const files = fs.readFileSync("/home/sano/ishaq/bb_tests/lists/roslyn-src.txt", "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, 200)
let total = 0, nullLine = 0, nullButRange = 0, nullNoRange = 0
const byKind = new Map<string, number>()
for (const f of files) {
  let src: string
  try { src = fs.readFileSync(f, "utf8") } catch { continue }
  if (src.length > 1_000_000) continue
  let res: any
  try { res = await ASTEngine.parseFile(f, src) } catch { continue }
  for (const s of res.symbols ?? []) {
    total++
    const ln = s.line ?? s.startLine
    if (ln !== null && ln !== undefined) continue
    nullLine++
    byKind.set(String(s.kind), (byKind.get(String(s.kind)) ?? 0) + 1)
    if (s.range && (s.range.startLine ?? s.range.start_line)) nullButRange++
    else nullNoRange++
  }
}
console.log(`  symbols: ${total}   with no line: ${nullLine}   of those, a range EXISTS: ${nullButRange}   no range either: ${nullNoRange}`)
console.log(`  by kind:`)
for (const [k, v] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(5)}  ${k}`)
