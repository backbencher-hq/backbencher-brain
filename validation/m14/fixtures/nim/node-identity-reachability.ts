/**
 * NODE-IDENTITY REACHABILITY PROBE — arm 1 of the A/B in
 * `validation/m14/measurements/nim/node-identity-ab.txt`.
 *
 * ## The question
 *
 * `src/ast/real-nim-analyzer.ts` guarded a `namedChild` loop with
 *
 *     if (!c || c === symDecl) continue
 *
 * where `symDecl` is `node.namedChild(0)` and `c` is `node.namedChild(i)`. Both
 * are web-tree-sitter `Node`s off the same parent. The hygiene gate's rule is that
 * object identity never matches because the wrappers are fresh per access, which
 * would make the guard dead code. **A class rule is not a measurement**, so this
 * walks the corpus and asks whether the guard is ever TRUE — at the one index
 * where it could be.
 *
 * It also asks the two questions that DO discriminate, `.id` equality and span
 * equality, so a `0` on the identity column is visibly a property of the
 * comparison operator and not of the nodes.
 *
 * ## What it is NOT
 *
 * Not an oracle, and it reads no analyzer output. It parses with `web-tree-sitter`
 * directly and counts parse-tree nodes, so a grammar bug shared with the analyzer
 * would be invisible to it — stated here rather than left to be discovered.
 *
 * READ-ONLY with respect to the corpus. Writes nothing.
 * Run: npx tsx validation/m14/fixtures/nim/node-identity-reachability.ts
 */

import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const files: string[] = []
for (const repo of execFileSync("ls", ["-1", CR], { encoding: "utf8" }).split("\n").filter(Boolean)) {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "*.nim"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size <= 512 * 1024) files.push(abs) } catch {}
  }
}
const SAMPLE = files.filter((_, i) => i % 40 === 0)
const wts: any = await import("web-tree-sitter")
const WSP: any = wts.Parser ?? wts.default
const WSL: any = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-nim.wasm"))))

let decls = 0, guardTrue = 0, guardFalseAtI0 = 0, spansEqual = 0, idEqual = 0
const examples: string[] = []
for (const abs of SAMPLE) {
  let tree: any
  try { tree = parser.parse(readFileSync(abs, "utf8")) } catch { continue }
  const stack = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "type_declaration" && n.namedChildCount > 0) {
      const symDecl = n.namedChild(0)
      if (symDecl && symDecl.type === "type_symbol_declaration") {
        decls++
        // the analyzer's loop, verbatim, for i = 0
        const c = n.namedChild(0)
        if (!c || c === symDecl) { guardTrue++ } else { guardFalseAtI0++ }
        // the two ways to compare them that DO work
        if (c && c.id === symDecl.id) idEqual++
        if (c && c.startIndex === symDecl.startIndex && c.endIndex === symDecl.endIndex) spansEqual++
        if (guardFalseAtI0 <= 2 && examples.length < 3) examples.push(`${abs}:${n.startPosition.row + 1}`)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }
}
console.log(`sampled            : ${SAMPLE.length} corpus files (every 40th, deterministic)`)
console.log(`type_declarations  : ${decls}`)
console.log(`i=0 guard  TRUE  (c === symDecl)          : ${guardTrue}   <- the analyzer's skip, at the ONE index where it could fire`)
console.log(`i=0 guard  FALSE (c === symDecl)          : ${guardFalseAtI0}`)
console.log(`c.id === symDecl.id                       : ${idEqual}`)
console.log(`c.startIndex/endIndex === symDecl's       : ${spansEqual}`)
console.log(examples.map(e => `  e.g. ${e}`).join("\n"))
console.log(guardTrue === 0
  ? "\nVERDICT: the identity guard NEVER fires. Object identity is not preserved by web-tree-sitter."
  : "\nVERDICT: the identity guard DOES fire — the class rule does not hold for this parser.")
