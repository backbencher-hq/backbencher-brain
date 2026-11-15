/**
 * ZIG WAVE 1 PROBE — SHAPE DUMP.
 *
 * Prints the exact tree for a synthetic snippet so a finding can be pinned to
 * the grammar rather than to a memory of what zig "should" parse to. Every
 * arrow line is `indent type [field:]  "text"`.
 *
 * Usage: npx tsx script/m14/tmp/zigw-shape.ts <file-with-snippets>
 */
import * as fs from "fs"
import { init, parser } from "./zigw-harness"

function dump(n: any, ind: string, src: string): void {
  const fname = n.parent && n.parent.fieldNameForChild ? n.parent.fieldNameForChild(n.parent.children.indexOf(n)) : null
  const text = n.text.length > 46 ? n.text.slice(0, 46).replace(/\n/g, "\\n") + "..." : n.text.replace(/\n/g, "\\n")
  console.log(`${ind}${n.isNamed ? "" : '"'}${n.type}${n.isNamed ? "" : '"'}${fname ? `:${fname}` : ""}  ${JSON.stringify(text)}`)
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) dump(c, ind + "  ", src)
  }
}

async function main(): Promise<void> {
  await init()
  const file = process.argv[2]
  const src = fs.readFileSync(file, "utf8")
  const parts = src.split(/^---+\s*$/m).filter((p) => p.trim().length > 0)
  for (const part of parts) {
    const label = part.split("\n")[0].trim()
    console.log(`\n########## ${label}`)
    const tree = parser().parse(part)
    console.log(`hasError=${tree.rootNode.hasError}`)
    dump(tree.rootNode, "  ", part)
    tree.delete()
  }
}
void main()
