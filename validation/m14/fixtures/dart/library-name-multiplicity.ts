/**
 * WHY does the dart grammar emit MORE `library_name` nodes than there are `library X;`
 * directives? The directive census found 133 top-level `library_name` nodes in 32 files
 * of a 3,000-file sample, so at least one file declares several. `libraryName` returns
 * the FIRST one whose text looks like a dotted identifier, so "which one wins" is a
 * question about the grammar, not a matter of taste.
 *
 * Prints, for every sampled file with more than one top-level `library_name`, the whole
 * top-level child list with node types and text — the shape that explains it.
 *
 * Usage: npx tsx validation/m14/fixtures/dart/library-name-multiplicity.ts [limit]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.argv[2] ?? 3000)
const IDENT = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/

const files = execFileSync("bash", ["-lc", `find ${CORPUS_ROOT} -name '*.dart' -type f | sort | head -${LIMIT}`], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
  .trim()
  .split("\n")
  .filter(Boolean)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-dart.wasm"))))

const hist = new Map<number, number>()
let multi = 0
let total = 0
let pickedDiffersFromFirst = 0
const shown: string[] = []

for (const f of files) {
  let tree: any
  try {
    tree = parser.parse(readFileSync(f, "utf8"))
  } catch {
    continue
  }
  const root = tree?.rootNode
  if (!root) continue
  const libs: { text: string; kind: string }[] = []
  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i)
    if (!child || child.type !== "library_name") continue
    for (let j = 0; j < child.namedChildCount; j++) {
      const n = child.namedChild(j)
      if (n) libs.push({ text: n.text.trim().replace(/\s+/g, ""), kind: n.type })
    }
  }
  if (libs.length === 0) {
    tree.delete()
    continue
  }
  total++
  hist.set(libs.length, (hist.get(libs.length) ?? 0) + 1)
  const first = libs[0]
  const firstValid = libs.find((l) => IDENT.test(l.text))
  if (libs.length > 1) {
    multi++
    if (shown.length < 4) {
      shown.push(`${f}\n   library_name children: ${libs.map((l) => `${l.kind}:${JSON.stringify(l.text.slice(0, 40))}`).join("  ")}`)
      shown.push(`   FIRST child is ${IDENT.test(first.text) ? "a valid library name" : `NOT a library name (${first.kind})`}; libraryName() would return ${JSON.stringify(firstValid?.text ?? "the file stem")}`)
      shown.push(`   whole top-level child list: ${Array.from({ length: root.namedChildCount }, (_, i) => root.namedChild(i)?.type).join(", ")}`)
      shown.push("")
    }
  }
  if (firstValid && firstValid.text !== first.text) pickedDiffersFromFirst++
  tree.delete()
}

console.log(`population: ${files.length} .dart files; ${total} carry at least one top-level \`library_name\`\n`)
console.log("library_name children per file -> files:")
for (const [k, v] of [...hist].sort((a, b) => Number(a[0]) - Number(b[0]))) console.log(`   ${k} -> ${v}`)
console.log(`\nfiles with MORE THAN ONE: ${multi}`)
console.log(`files where the first child is not a valid library name but a later one is (libraryName() must skip): ${pickedDiffersFromFirst}`)
for (const s of shown) console.log(`\n${s}`)