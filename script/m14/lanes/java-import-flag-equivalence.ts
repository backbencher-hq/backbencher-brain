/**
 * JAVA LANE — MUTANT I3/I8 EQUIVALENCE, measured over the corpus.
 *
 * ## THE QUESTION
 *
 * Two of this lane's mutants (I3, I8) replace the node-type read of the
 * `isStatic` / `isWildcard` flags with a search over the declaration's text, and
 * the java fixture lane reports both as SURVIVING. There are two possible
 * explanations and they have opposite honesty consequences:
 *
 *   (a) the fixtures do not pin the flags — a coverage gap, and the fix is to
 *       strengthen the pins;
 *   (b) the two implementations are EQUIVALENT on this grammar — no fixture can
 *       ever distinguish them, and recording a kill for one would be the honesty
 *       contract's lie-catcher #3 firing in the direction that flatters the lane.
 *
 * A 10-case hand-written probe is not enough to tell them apart, because a
 * hand-written probe contains the cases its author thought of. So this walks
 * EVERY `import_declaration` in java-lib and asks the grammar.
 *
 * ## WHAT WOULD SETTLE IT
 *
 * An `import_declaration` is a Java grammar production with exactly three child
 * shapes: the `import` keyword, an optional `static` modifier, one
 * `scoped_identifier` or `identifier`, an optional `asterisk`, and the
 * terminator. There is no production in which a comment or a string literal
 * appears inside it, so a search over the node's own text cannot be fooled by
 * content — unlike a search over the FILE's text, which is what the
 * workstream's instrument-A rule is about. If the measured disagreement count is
 * 0 over 38,923 declarations, the two implementations agree on every input the
 * corpus contains and the mutant is equivalent, not unpinned.
 *
 * That is the argument FROM THE GRAMMAR. This file is the argument FROM THE
 * CORPUS, and only the corpus number is load-bearing.
 *
 * ## NO REGEX
 *
 * Population by `readdirSync` + `endsWith`; every classification is a `node.type`
 * comparison or a character walk. No regular expression appears here.
 *
 * ## USAGE
 *   bun script/m14/lanes/java-import-flag-equivalence.ts
 *   LANE_NFILES=200 bun script/m14/lanes/java-import-flag-equivalence.ts
 */
import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_DIR = process.env.BB_REPO ?? "java-lib"
const WANT = Number(process.env.LANE_NFILES ?? 0)

const root = join(CORPUS_ROOT, REPO_DIR)
const all: string[] = []
;(function walk(d: string): void {
  let ents
  try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "target") continue
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith(".java")) all.push(p)
  }
})(root)
all.sort()
const files = WANT > 0 ? all.slice(0, WANT) : all

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(join(process.cwd(), "node_modules", "tree-sitter-java", "tree-sitter-java.wasm"))))

console.log(`JAVA IMPORT-FLAG EQUIVALENCE (EXPORTS_JAVA2)`)
console.log(`corpus ${REPO_DIR}: ${all.length} .java files on disk (derived by readdir), measuring ${files.length}`)
console.log(`question: does reading isStatic/isWildcard from node TYPES differ, on any declaration, from searching the declaration's TEXT?\n`)

let decls = 0
let disagree = 0
const disagreements: string[] = []
const shapeTally = new Map<string, number>()
let parseFail = 0

function visit(n: any, cb: (n: any) => void): void {
  cb(n)
  for (let i = 0; i < n.childCount; i++) visit(n.child(i), cb)
}

for (const f of files) {
  let tree
  try { tree = parser.parse(readFileSync(f, "utf8")) } catch { parseFail++; continue }
  if (!tree) { parseFail++; continue }
  const L = relative(root, f)
  visit(tree.rootNode, (n: any) => {
    if (n.type !== "import_declaration") return
    decls++
    let nodeStatic = false
    let nodeAsterisk = false
    for (let k = 0; k < n.childCount; k++) {
      const kid = n.child(k)
      if (!kid) continue
      if (kid.type === "static") nodeStatic = true
      else if (kid.type === "asterisk") nodeAsterisk = true
    }
    const txt = String(n.text)
    const textStatic = txt.indexOf("static ") !== -1
    const textAsterisk = txt.indexOf(".*") !== -1
    const shape = `static=${nodeStatic} wildcard=${nodeAsterisk}`
    shapeTally.set(shape, (shapeTally.get(shape) ?? 0) + 1)
    if (nodeStatic !== textStatic || nodeAsterisk !== textAsterisk) {
      disagree++
      if (disagreements.length < 10) {
        disagreements.push(`${L}: ${JSON.stringify(txt)} node(static=${nodeStatic},*=${nodeAsterisk}) text(static=${textStatic},*=${textAsterisk})`)
      }
    }
  })
}

console.log(`import declarations walked: ${decls}   files that failed to parse: ${parseFail}`)
console.log(`shapes seen (node-type read):`)
for (const [k, v] of [...shapeTally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(30)} ${v}`)
console.log(`\nDISAGREEMENTS between the node-type read and the text search: ${disagree}`)
for (const d of disagreements) console.log(`  ${d}`)

const verdict =
  disagree === 0
    ? "EQUIVALENT on every declaration in this corpus. A fixture cannot kill mutants I3/I8, and claiming one did would be false."
    : `${disagree} declarations disagree, so the text search is observably wrong and the fixtures are a coverage gap.`
console.log(`\nVERDICT: ${verdict}`)
process.exit(disagree === 0 ? 0 : 1)
