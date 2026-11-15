/**
 * What produces an EMPTY top-level `library_name` node? The directive census found 101
 * of them in 116 files of a 3,000-file sample. `library;` — the unnamed library
 * directive — is legal Dart and is the obvious candidate; this checks it, and prints
 * the source line either way, because publishing a library node whose name came from the
 * file stem while the file declared `library;` is a claim the analyzer makes about a file
 * that said nothing about its name.
 *
 * Usage: npx tsx validation/m14/fixtures/dart/empty-library-name.ts [limit]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.argv[2] ?? 3000)
const LIST = process.argv[3] ?? ""
// A second argument names a committed file list instead of taking the sorted prefix,
// so this census can be run on exactly the population another measurement used.
const files = LIST
  ? readFileSync(LIST, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
  : execFileSync("bash", ["-lc", `find ${CORPUS_ROOT} -name '*.dart' -type f | sort | head -${LIMIT}`], {
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

const kinds = new Map<string, number>()
let emptyNodes = 0
let emptyFiles = 0
let explainedByBareLibrary = 0
const examples: string[] = []
for (const f of files) {
  const text = readFileSync(f, "utf8")
  let tree: any
  try {
    tree = parser.parse(text)
  } catch {
    continue
  }
  const root = tree?.rootNode
  if (!root) continue
  let empties = 0
  for (let i = 0; i < root.namedChildCount; i++) {
    const c = root.namedChild(i)
    if (!c || c.type !== "library_name" || c.namedChildCount > 0) continue
    empties++
    emptyNodes++
    const line = text.slice(c.startIndex, c.endIndex).trim()
    kinds.set(line, (kinds.get(line) ?? 0) + 1)
    if (/^library\s*;?$/.test(line)) explainedByBareLibrary++
    // the node is EMPTY, so its own span is empty too: recover the line from the parent
    const parent = c.parent
    const ptext = parent ? parent.text.trim().slice(0, 60) : ""
    if (examples.length < 6) examples.push(`${f}\n   empty library_name at line ${c.startPosition.row + 1}; parent ${parent?.type} = ${JSON.stringify(ptext)}`)
  }
  if (empties) emptyFiles++
  tree.delete()
}

console.log(`population: ${files.length} .dart files${LIST ? ` from ${LIST}` : " (sorted prefix)"}\n`)
console.log(`empty top-level \`library_name\` nodes : ${emptyNodes} in ${emptyFiles} files`)
console.log(`explained by the unnamed \`library;\` directive (the node's own text is empty, so the PARENT carries it): ${explainedByBareLibrary}`)
console.log(`\nthe node's own text (empty nodes have an empty span, so this is the empty string when unrecoverable):`)
for (const [k, v] of [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`   ${String(v).padStart(5)}  ${JSON.stringify(k)}`)
for (const s of examples) console.log(`\n${s}`)