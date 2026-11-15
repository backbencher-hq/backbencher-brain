// script/m14/tmp/clean-127-class-shape.ts
//
// The one residue symbol that looked like a candidate-side loss:
//   vanished  1030:method:scan_module_symbol_from_input@File
//   added     1030:function:scan_module_symbol_from_input@PmParse
// The source is `class ScanInput a where` (line 1007) + `instance ScanInput File where`
// (1015). `@File` is the INSTANCE target, not the class, so the pinned owner is already
// wrong. The open question is whether the candidate still exposes the class member at all —
// if it does, the analyzer (which requires a `class_member` child) is what drops it; if it
// does not, the grammar moved the shape and the analyzer needs a new path.
//
// Run: bun script/m14/tmp/clean-127-class-shape.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = process.cwd()
const CANDIDATE = process.env.CLEAN_CANDIDATE ?? "/tmp/tree-sitter-clean-127.wasm"
const PINNED = path.join(ROOT, "wasm/tree-sitter-clean.wasm")

const CASES: [string, string][] = [
  ["class with two member signatures", `class ScanInput a\nwhere\n\tScanInput :: !(Input *a) -> (!Input *a, !Symbol, !Int, !Int)\n\tscan_module_symbol_from_input :: !(Input *a) -> (!Input *a, !Symbol, !Int, !Int)\n`],
  ["class of one member", `class Eq a\nwhere\n\t(==) infix 2 :: a a -> Bool\n`],
  ["instance of that class", `instance ScanInput File\nwhere\n\tscan_module_symbol_from_input {offside,curpos}\n\t\t# (eof,curposa) = SkipLayOut1 offside 0 curpos\n\t\t= (inputb, sym)\n`],
  ["class then instance, real file order", `class ScanInput a\nwhere\n\tScanInput :: !(Input *a) -> !Symbol\n\ninstance ScanInput File\nwhere\n\tScanInput input\n\t\t= EofSym\n`],
]

async function makeParser(): Promise<any> {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const mk = async (wasm: string) => {
    const language = await L.load(readFileSync(wasm))
    const p = new P()
    p.setLanguage(language)
    return p
  }
  return { pinned: await mk(PINNED), candidate: await mk(CANDIDATE) }
}

function shapeOf(root: any, src: string): string[] {
  const out: string[] = []
  const walk = (n: any, depth: number) => {
    if (n.type === "class_declaration" || n.type === "instance_declaration" || n.type.startsWith("class_") || n.type.startsWith("instance_")) {
      out.push(`${"  ".repeat(depth)}${n.type}: ${JSON.stringify(src.slice(n.startIndex, n.endIndex).replace(/\s+/g, " ").slice(0, 70))}`)
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), n.type.startsWith("class") || n.type.startsWith("instance") ? depth + 1 : depth)
  }
  walk(root, 0)
  return out
}

async function main() {
  const p = await makeParser()
  for (const [name, src] of CASES) {
    console.log(`### ${name}`)
    for (const [label, parser] of [["pinned", p.pinned], ["candidate", p.candidate]] as const) {
      const t = parser.parse(src)
      console.log(`  -- ${label}  errors=${t.rootNode.hasError}`)
      for (const line of shapeOf(t.rootNode, src)) console.log(`     ${line}`)
      console.log(`     top: ${(t.rootNode.toString().split("\n")[0] ?? "").slice(0, 260)}`)
    }
    console.log()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
