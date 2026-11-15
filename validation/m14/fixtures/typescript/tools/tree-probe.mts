/**
 * TYPESCRIPT LANE — grammar shape probe (throwaway diagnostic, `.mts` so the fixture runner
 * cannot see it). Prints the tree-sitter S-expression for a snippet file so a callee shape can
 * be read off the GRAMMAR instead of guessed at from its text.
 *
 * CLI: bun validation/m14/fixtures/typescript/tools/tree-probe.mts <file.ts> [lineStart] [lineEnd]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import * as wts from "web-tree-sitter"

const argv = process.argv.slice(2)
const target = argv.find((a) => !a.startsWith("--"))
if (!target) {
  console.error("usage: tree-probe.mts <file.ts> [lineStart] [lineEnd]")
  process.exit(2)
}
const lines = fs.readFileSync(path.resolve(process.cwd(), target), "utf8").split("\n")
const findAt = argv.indexOf("--find")
const needle = findAt >= 0 ? argv[findAt + 1] : undefined
const from = needle ? 1 : Number(argv[1] ?? 1)
const to = needle ? lines.length : Number(argv[2] ?? lines.length)
const src = lines.slice(from - 1, to).join("\n")

const ParserClass: any = (wts as any).Parser ?? (wts as any).default
await ParserClass.init()
const wasm = path.resolve(
  process.cwd(),
  "node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm",
)
const lang = await (wts as any).Language.load(wasm)
const parser = new ParserClass()
parser.setLanguage(lang)
const tree = parser.parse(src)
const print = (n: any, depth: number): void => {
  const field = ((): string => {
    try {
      return ""
    } catch {
      return ""
    }
  })()
  console.log(`${"  ".repeat(depth)}${n.type}${n.isNamed ? "" : " (anon)"}${field}  [${n.startPosition.row + from}-${n.endPosition.row + from}]`)
  for (const c of n.children) print(c, depth + 1)
}
print(tree.rootNode, 0)
if (needle) {
  const hits: any[] = []
  const walk = (n: any): void => {
    if (n.text.includes(needle)) hits.push(n)
    for (const c of n.children) walk(c)
  }
  walk(tree.rootNode)
  // The SMALLEST hits are the innermost nodes whose whole text still contains the needle.
  hits.sort((a, b) => a.text.length - b.text.length)
  console.log(`\n--- ${hits.length} node(s) contain ${JSON.stringify(needle)} ---`)
  for (const h of hits.slice(0, 6)) {
    console.log(`\n${h.type} [${h.startPosition.row + from}-${h.endPosition.row + from}] text=${JSON.stringify(h.text.slice(0, 120))}`)
    print(h, 0)
    const parent = h.parent
    if (parent) {
      console.log("  PARENT CHAIN:")
      let p = parent
      for (let i = 0; i < 6 && p; i++) {
        console.log(`    ${p.type} [${p.startPosition.row + from}-${p.endPosition.row + from}]`)
        p = p.parent
      }
    }
  }
}
process.exit(0)
