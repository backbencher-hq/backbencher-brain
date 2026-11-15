/**
 * Does the DART corpus actually declare libraries, and does the grammar expose them
 * the way `libraryName` reads them?
 *
 * `library X;` is DEPRECATED in Dart 2 and removed from the corpus's idiom, so if the
 * directive never appears then `libraryName` is dead code on real input and the dotted
 * name its comment defends (`_fe_analyzer_shared.scanner.token`) is a claim no
 * measurement supports. Two questions, on the parse tree and on the TEXT, so an
 * agreement between two different instruments is worth something and a disagreement
 * names a bug in one of them:
 *
 *   1. how many sampled files carry a `library X;` directive, by each instrument
 *   2. is the child shape the code assumes (`dotted_identifier_list` | `identifier`)?
 *
 * Usage: npx tsx validation/m14/fixtures/dart/library-directive-census.ts [limit]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.argv[2] ?? 3000)
const LIST = process.argv[3] ?? ""
const IDENT = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/

// A second argument names a committed file list instead of taking the sorted prefix,
// so the census can be run on exactly the population another measurement used.
const files = LIST
  ? readFileSync(LIST, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
  : execFileSync("bash", ["-lc", `find ${CORPUS_ROOT} -name '*.dart' -type f | sort | head -${LIMIT}`], {
      encoding: "utf8",
      maxBuffer: 1 << 28,
    })
      .trim()
      .split("\n")
      .filter(Boolean)

const DIRECTIVE = /^[ \t]*library[ \t]+([A-Za-z_$][\w$]*(\s*\.\s*[A-Za-z_$][\w$]*)*)[ \t]*;/m
const textDeclared = new Map<string, string>()
for (const f of files) {
  const m = DIRECTIVE.exec(readFileSync(f, "utf8"))
  if (m) textDeclared.set(f, m[1].replace(/\s+/g, ""))
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-dart.wasm"))))

const treeDeclared = new Map<string, string>()
const emptyLibFiles = new Set<string>()
const hasEmptyLib = (f: string) => emptyLibFiles.has(f)
const childTypes = new Map<string, number>()
const directiveNodeTypes = new Map<string, number>()
let parsed = 0
let failed = 0
for (const f of files) {
  let tree: any
  try {
    tree = parser.parse(readFileSync(f, "utf8"))
    parsed++
  } catch {
    failed++
    continue
  }
  const root = tree?.rootNode
  if (!root) continue
  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i)
    if (!child || child.type !== "library_name") continue
    directiveNodeTypes.set(child.type, (directiveNodeTypes.get(child.type) ?? 0) + 1)
    if (child.namedChildCount === 0) emptyLibFiles.add(f)
    for (let j = 0; j < child.namedChildCount; j++) {
      const n = child.namedChild(j)
      if (!n) continue
      const key = `${child.type} > ${n.type} -> ${JSON.stringify(n.text.trim().slice(0, 48))}`
      childTypes.set(key, (childTypes.get(key) ?? 0) + 1)
      if (!treeDeclared.has(f)) treeDeclared.set(f, n.text.trim().replace(/\s+/g, ""))
    }
  }
  tree.delete()
}

console.log(`population: ${files.length} .dart files${LIST ? ` from ${LIST}` : ` (sorted prefix of ${CORPUS_ROOT})`}`)
console.log(`parsed ${parsed}  failed ${failed}\n`)
console.log(`files whose TEXT carries a \`library X;\` directive  : ${textDeclared.size}`)
console.log(`files whose TREE has a top-level \`library_name\` node: ${treeDeclared.size}`)
const onlyText = [...textDeclared.keys()].filter((f) => !treeDeclared.has(f))
const onlyTree = [...treeDeclared.keys()].filter((f) => !textDeclared.has(f))
console.log(`text-only (the TEXT regex found what the tree did not): ${onlyText.length}`)
console.log(`tree-only (the tree found what the TEXT regex did not): ${onlyTree.length}`)
for (const f of onlyText.slice(0, 6)) console.log(`   TEXT-ONLY ${f}  declared ${JSON.stringify(textDeclared.get(f))}`)
for (const f of onlyTree.slice(0, 6)) console.log(`   TREE-ONLY ${f}  declared ${JSON.stringify(treeDeclared.get(f))}`)

let same = 0
let differ = 0
for (const [f, t] of treeDeclared) if (textDeclared.get(f) === t) same++
  else if (textDeclared.has(f)) differ++
console.log(`\nagreement on the DECLARED NAME where both instruments fire: ${same} same, ${differ} different`)
const examples = [...treeDeclared.entries()].slice(0, 12)
for (const [f, t] of examples) console.log(`   TREE ${JSON.stringify(t).padEnd(40)} ${f}`)

const forms = { named: 0, unnamed: 0, annotationOnly: 0, implicit: 0 }
for (const f of files) {
  const declared = treeDeclared.get(f)
  if (declared === undefined) {
    // no usable name: either an empty `library_name` (`library;`) or none at all
    forms.unnamed++
  } else if (IDENT.test(declared)) forms.named++
  else forms.annotationOnly++
}
for (const f of files) if (!treeDeclared.has(f) && !hasEmptyLib(f)) forms.implicit++
console.log(`\nDECLARED NAME, three forms, over all ${files.length} files: named ${forms.named}  annotationOnly ${forms.annotationOnly}  noUsableName ${forms.unnamed}  implicit ${forms.implicit}`)
console.log(`top-level node types carrying a \`library_name\`: ${JSON.stringify(Object.fromEntries(directiveNodeTypes))}`)
console.log(`child shape (node.type > child.type -> text), top 12:`)
for (const [k, v] of [...childTypes].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${String(v).padStart(5)}  ${k}`)