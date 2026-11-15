/**
 * The measurement behind the operator-named-class spelling correction.
 *
 *   npx tsx validation/m14/fixtures/clean/operator-class-spelling-probe.mts
 *
 * ## THE QUESTION
 *
 * An operator IS a class name in Clean, and the two sites spell it differently:
 *
 *   DECLARATION   class (==) infix 4 a :: !a !a -> Bool   (clean-stdlib/StdOverloaded.icl:23)
 *   INSTANCE      instance == Bool :: !Bool !Bool -> Bool (clean-stdlib/StdBool.dcl:10)
 *
 * So a class declaration publishes its symbol as `(==)` — parentheses included — while the
 * instance that names it reads back `==`. Every lookup keyed on the bare spelling missed,
 * and it missed in two places at once: `implements.isExternalClass` reported a class
 * declared in the SAME file as external, and the `overrides` in-file guard could not reach
 * that class's member set. The second dropped edges silently, so no count rose and no
 * label was wrong; nothing except this probe could see it.
 *
 * ## WHAT IT COUNTS, AND WHY IT IS NOT THE SAME COUNT AS THE GATE'S
 *
 * This probe's headline number is `implements edges whose className is OPERATOR-shaped …
 * AND isExternalClass … AND the class IS declared in the same file`: **24 before the
 * correction, 0 after**, over the 312 `git ls-files`-admitted files.
 *
 * `script/m14/clean-honesty-gate.ts`'s `implements.classNotDeclaredHere` bucket falls by
 * **12** over the same files, not 24, and the two figures are NOT the same edges. That
 * bucket's predicate is `!resolvable(target) && !classNames.has(target) &&
 * !typeNames.has(target)`, which is narrower than the flag's — 12 of the 24 were already
 * resolving by `qualifiedName` and never entered it. Both numbers are recorded rather than
 * reconciled; reconciling them would mean changing a predicate whose exact shape belongs to
 * the gate, which is shared.
 *
 * ## WHAT IT DELIBERATELY DOES NOT CLAIM
 *
 * 1. **The reverse spelling.** It counts bare→parenthesised only, because that is the
 *    direction the corpus produces. No corpus file declares an operator-named class bare and
 *    instances it parenthesised, so a fix for that direction would be a claim without a
 *    measurement. The probe reports it if it ever appears, which is why the
 *    `parenthesisedReadByInstance` counter exists at 0.
 * 2. **A total.** The interesting population is edges where the flag DISAGREES with
 *    reality, not edges where the class is external. 198 of the 239 operator-shaped
 *    `implements` edges legitimately name a class from another file, and they stay.
 * 3. **`parseFile`.** It calls `analyze()` directly, like the honesty gate, so its totals
 *    are NOT comparable with the production census: 772 `implements` edges here against
 *    712 through `parseFile` on the same 312 files. It is a shape probe, not a census, and
 *    every number it prints is over the population named in its own header.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const files: string[] = []
for (const e of fs.readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!fs.statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (fs.statSync(abs).size > 512 * 1024) continue; text = fs.readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "clean") continue
    files.push(abs)
  }
}

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clean.wasm")))
const parser = new P()
parser.setLanguage(grammar)
const { RealCleanAnalyzer } = await import(path.join(ROOT, "src", "ast", "real-clean-analyzer.ts"))

/** Is this a bare operator token rather than an ordinary identifier? Character tests, no regex. */
function isOperatorShaped(name: string): boolean {
  if (name.length === 0) return false
  const isHead = (c: string) => c === "_" || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z")
  if (isHead(name[0])) return false
  return true
}

let implementsEdges = 0
let flaggedExternal = 0
let operatorShaped = 0
let operatorShapedExternal = 0
let flaggedExternalButLocal = 0
let parenthesisedReadByInstance = 0
const examples: string[] = []

for (const f of files.sort()) {
  const src = fs.readFileSync(f, "utf8")
  let tree: any
  try { tree = parser.parse(src) } catch { continue }
  if (!tree) continue
  let r: any
  try { r = new RealCleanAnalyzer().analyze(tree.rootNode, src, f) } catch { tree.delete?.(); continue }
  const localClasses = new Set<string>(r.symbols.filter((s: any) => s.kind === "interface").map((s: any) => s.name))
  for (const x of r.relationships) {
    if (String(x.type).toLowerCase() !== "implements") continue
    implementsEdges++
    const className = String(x.metadata?.className ?? "")
    if (x.metadata?.isExternalClass) flaggedExternal++
    if (!isOperatorShaped(className)) continue
    operatorShaped++
    if (x.metadata?.isExternalClass) {
      operatorShapedExternal++
      const local = [...localClasses].filter((c) => c === className || c === `(${className})`)
      if (local.length > 0) {
        flaggedExternalButLocal++
        if (examples.length < 8) examples.push(`${path.relative(CR, f)}:L${x.line_number} implements ${x.source} -> ${className} (local class published as ${local.join(", ")})`)
      }
    } else {
      // The corrected reading. Recorded so the untried direction is a measured 0 rather
      // than an assumption: an instance that reads a PARENTHESISED class name.
      if (className.startsWith("(")) parenthesisedReadByInstance++
    }
  }
  tree.delete?.()
}

console.log(`operator-class spelling probe — ${files.length} git-tracked clean files, analyze() (NOT parseFile)`)
console.log(`  implements edges                                   ${implementsEdges}`)
console.log(`  … isExternalClass true                             ${flaggedExternal}`)
console.log(`  … className is OPERATOR-shaped                     ${operatorShaped}`)
console.log(`  … operator-shaped AND external (mostly correct)    ${operatorShapedExternal}`)
console.log(`  … operator-shaped AND external AND LOCAL  <-- BUG   ${flaggedExternalButLocal}`)
console.log(`  … external AND read PARENTHESISED (untried dir.)   ${parenthesisedReadByInstance}`)
for (const e of examples) console.log(`       ${e}`)
console.log(`\nThe BUG row must be 0. It read 24 before the correction in src/ast/real-clean-analyzer.ts.`)
if (flaggedExternalButLocal > 0) process.exitCode = 1
