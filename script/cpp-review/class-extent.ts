/**
 * The class-body extent probe: for a `class X` in a file, where does the
 * grammar's class_specifier node actually END, and where does the source's
 * class actually end? A gap between them is a grammar recovery limit, and
 * everything after the gap is walked at the wrong scope — which is how a
 * file-scope function_definition ends up owning thousands of lines of members.
 *
 *   bun run script/cpp-review/class-extent.ts <file> <ClassName>
 */
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"

const [, , file, cls] = process.argv
const content = readFileSync(file, "utf8")
const lines = content.split("\n")
const { tree } = await ASTEngine.parseTree(file, content)

// The source's own class extent, by brace counting from the class line.
const srcStart = lines.findIndex((l) => new RegExp(`\\b(class|struct)\\s+${cls}\\b`).test(l)) + 1
let depth = 0, srcEnd = -1, started = false
for (let i = srcStart - 1; i < lines.length; i++) {
  for (const ch of lines[i]) {
    if (ch === "{") { depth++; started = true }
    else if (ch === "}") { depth--; if (started && depth === 0) { srcEnd = i + 1; break } }
  }
  if (srcEnd > 0) break
}

let found: any = null
const visit = (n: any) => {
  if (found) return
  if (n.type === "class_specifier" || n.type === "struct_specifier") {
    const nm = n.childForFieldName?.("name") ?? n.namedChild(0)
    if (nm && nm.text === cls) { found = n; return }
  }
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) visit(c) }
}
visit(tree.rootNode)

if (!found) { console.log(`no class_specifier named ${cls}`); process.exit(0) }
const body = found.childForFieldName?.("body") ??
  (() => { for (let i = 0; i < found.namedChildCount; i++) { const c = found.namedChild(i); if (c && (c.type === "class_body" || c.type === "field_declaration_list")) return c } return null })()
console.log(`class_specifier  ${found.type}  lines ${found.startPosition.row + 1}..${found.endPosition.row + 1}   hasError=${found.hasError}`)
console.log(`  body node:     ${body ? body.type + " lines " + (body.startPosition.row + 1) + ".." + (body.endPosition.row + 1) : "NONE"}`)
console.log(`  named children of the specifier: ${found.namedChildCount} -> ${[...Array(found.namedChildCount).keys()].map((i) => { const c = found.namedChild(i); return c ? `${c.type}@${c.startPosition.row + 1}` : "?" }).join(", ")}`)
console.log(`SOURCE class extent: lines ${srcStart}..${srcEnd}`)
console.log(`GAP: grammar ends at ${found.endPosition.row + 1}, source ends at ${srcEnd}  ->  ${(srcEnd - found.endPosition.row - 1)} lines walked OUTSIDE the class`)
if (srcEnd > found.endPosition.row + 1) {
  console.log(`  first line outside: ${JSON.stringify(lines[found.endPosition.row + 1] ?? "").slice(0, 100)}`)
  console.log(`  last  line of source class: ${JSON.stringify(lines[srcEnd - 1] ?? "").slice(0, 100)}`)
}
