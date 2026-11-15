/**
 * The directive census counted 133 top-level `library_name` nodes in 3,000 files but
 * only 32 files with a usable child, while a TEXT instrument found 69 files carrying a
 * `library X;` directive. That leaves 101 empty `library_name` nodes and ~52 declared
 * libraries the tree does not expose — and `libraryName` FALLS BACK TO THE FILE STEM for
 * every one of them, which would publish a name that is not the library's name.
 *
 * So: for the files the TEXT instrument says declare a library and the tree did not
 * report, print the whole top-level child list with text. That names the node type the
 * grammar produced instead, which is the thing to fix or the thing to document.
 *
 * Usage: npx tsx validation/m14/fixtures/dart/library-directive-gap.ts [limit]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.argv[2] ?? 3000)
const DIRECTIVE = /^[ \t]*library[ \t]+([A-Za-z_$][\w$]*(\s*\.\s*[A-Za-z_$][\w$]*)*)[ \t]*;/m
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

const shapeCounts = new Map<string, number>()
let emptyLibNodes = 0
let filesWithEmptyLib = 0
const gapExamples: string[] = []
let textDeclared = 0
let gap = 0

for (const f of files) {
  const text = readFileSync(f, "utf8")
  const m = DIRECTIVE.exec(text)
  let tree: any
  try {
    tree = parser.parse(text)
  } catch {
    continue
  }
  const root = tree?.rootNode
  if (!root) continue
  const declared = m ? m[1].replace(/\s+/g, "") : null
  if (declared) textDeclared++

  let libs = 0
  let usable = 0
  for (let i = 0; i < root.namedChildCount; i++) {
    const child = root.namedChild(i)
    if (!child || child.type !== "library_name") continue
    libs++
    if (child.namedChildCount === 0) emptyLibNodes++
    for (let j = 0; j < child.namedChildCount; j++) {
      const n = child.namedChild(j)
      if (n && IDENT.test(n.text.trim().replace(/\s+/g, ""))) usable++
    }
  }
  if (libs > 0 && usable === 0) filesWithEmptyLib++
  if (declared && usable === 0) {
    gap++
    const kinds: string[] = []
    for (let i = 0; i < Math.min(root.namedChildCount, 6); i++) {
      const child = root.namedChild(i)
      if (!child) continue
      kinds.push(`${child.type}${child.namedChildCount === 0 ? "(empty)" : ""}:${JSON.stringify(child.text.trim().slice(0, 34))}`)
    }
    const key = kinds.map((k) => k.split(":")[0]).join("+") || "(no named children)"
    shapeCounts.set(key, (shapeCounts.get(key) ?? 0) + 1)
    if (gapExamples.length < 5) gapExamples.push(`${f}\n   declared by TEXT: ${JSON.stringify(declared)}  tree hasError=${root.hasError}\n   top-level named children: ${kinds.join("  ")}`)
  }
  tree.delete()
}

console.log(`population: ${files.length} .dart files\n`)
console.log(`files whose TEXT declares a library          : ${textDeclared}`)
console.log(`files with an EMPTY top-level library_name   : ${filesWithEmptyLib}`)
console.log(`empty library_name nodes, total              : ${emptyLibNodes}`)
console.log(`declared libraries the TREE cannot expose    : ${gap}`)
console.log(`\ntop-level child shape of those ${gap} files (node types, first 6 named children):`)
for (const [k, v] of [...shapeCounts].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`   ${String(v).padStart(4)}  ${k}`)
for (const s of gapExamples) console.log(`\n${s}`)