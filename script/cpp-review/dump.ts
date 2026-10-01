/**
 * Node-level truth for the defect classes the census found. For a named shape
 * this prints the EXACT tree-sitter shape (node types, fields, spans), so the
 * ruling is written against what the grammar actually produces rather than
 * against what the source looks like.
 *
 *   bun run script/cpp-review/dump.ts <file> <searchText> [maxHits]
 */
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"

const [, , file, needleRaw, maxRaw] = process.argv
const needle = needleRaw ?? ""
const max = Number(maxRaw ?? 3)

const content = readFileSync(file, "utf8")
const { tree, parser } = await ASTEngine.parseTree(file, content)

const walk = (n: any, d: number, out: string[]) => {
  if (d > 22) return
  const text = n.text.length > 70 ? n.text.slice(0, 70).replace(/\n/g, "\\n") + "…" : n.text.replace(/\n/g, "\\n")
  const fields: string[] = []
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c) continue
    const fname = n.fieldNameForChild ? n.fieldNameForChild(i) : null
    if (fname) fields.push(`${fname}=${c.type}`)
  }
  out.push(
    `${"  ".repeat(d)}${n.type}${n.isMissing ? " [MISSING]" : ""}${n.hasError ? " [ERR]" : ""} ` +
      `<${n.startPosition.row + 1}:${n.startPosition.column}>-${n.endPosition.row + 1}:${n.endPosition.column}> ` +
      `kids=${n.namedChildCount} named [${fields.join(" ")}] ${JSON.stringify(text)}`,
  )
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c) walk(c, d + 1, out)
  }
}

let hits = 0
const visit = (n: any) => {
  if (hits >= max) return
  if (n.text.includes(needle) && n.text.length < 400) {
    const out: string[] = []
    walk(n, 0, out)
    console.log(`\n===== HIT ${++hits}: ${n.type} @ ${n.startPosition.row + 1} =====`)
    console.log(out.join("\n"))
    return
  }
  for (let i = 0; i < n.childCount && hits < max; i++) {
    const c = n.child(i)
    if (c) visit(c)
  }
}
visit(tree.rootNode)
if (hits === 0) console.log(`no hit for ${JSON.stringify(needle)} in ${file}`)
