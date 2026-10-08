/**
 * java-ownerless-why.ts — DERIV_EXPORTS_JAVA3.
 *
 * java-ownerless-path.ts established the shape of the defect:
 *
 *   53 methods at  program > class_declaration > class_body > method_declaration
 *   30 methods at  program > method_declaration          <- NOT in the class
 *
 * So `parentContext` really is undefined for those 30, and the analyzer is
 * reporting the tree faithfully. The question is why the tree says it.
 *
 * This probe prints the top-level (program) children in source order with their
 * node types and ranges, plus every ERROR / MISSING node and its range, plus
 * the class_declaration's own end line. A class_body that ends 400 lines before
 * the file does is the signature of a parser recovery boundary, and the ERROR
 * node it recovers at is the construct to name.
 *
 * NO REGEX. Tree walk only.
 */
import { readFileSync } from "node:fs"
import { getParser } from "../../../src/ast/engine"

const FILE = process.env.PROBE_FILE ??
  "$HOME/fixtures/repositories/java-lib/guava/src/com/google/common/base/Preconditions.java"

async function main() {
  const src = readFileSync(FILE, "utf8")
  const parser = await getParser("java")
  const tree = parser.parse(src)
  if (!tree) throw new Error("parser.parse returned no tree (null result)")
  const root = tree.rootNode
  console.log(`FILE ${FILE}   lines ${src.split("\n").length}`)
  console.log(`root.hasError=${root.hasError}  root.text byte-length=${src.length}`)

  console.log(`\nprogram's named children, in source order:`)
  for (let i = 0; i < root.namedChildCount; i++) {
    const c = root.namedChild(i)!
    console.log(`  #${String(i).padStart(3)} ${c.type.padEnd(28)} lines ${c.startPosition.row + 1}..${c.endPosition.row + 1}  hasError=${c.hasError}`)
  }

  console.log(`\nclass_declaration extent and its class_body extent:`)
  const stack: any[] = [root]
  let cls: any = null
  while (stack.length) {
    const n = stack.pop(); if (!n) continue
    if (n.type === "class_declaration") { cls = n; break }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  if (cls) {
    console.log(`  class_declaration "${cls.child(1)?.text ?? ""}" lines ${cls.startPosition.row + 1}..${cls.endPosition.row + 1}`)
    for (let i = 0; i < cls.namedChildCount; i++) {
      const c = cls.namedChild(i)!
      console.log(`    #${i} ${c.type.padEnd(24)} lines ${c.startPosition.row + 1}..${c.endPosition.row + 1}`)
      if (c.type === "class_body") {
        console.log(`      class_body namedChildCount=${c.namedChildCount}`)
        const n = c.namedChildCount
        for (let j = Math.max(0, n - 4); j < n; j++) {
          const cc = c.namedChild(j)!
          console.log(`        last #${j} ${cc.type.padEnd(24)} lines ${cc.startPosition.row + 1}..${cc.endPosition.row + 1}`)
        }
      }
    }
  }

  console.log(`\nEVERY ERROR / MISSING node in the tree:`)
  let errs = 0
  const estack: any[] = [root]
  while (estack.length) {
    const n = estack.pop(); if (!n) continue
    if (n.type === "ERROR" || n.isMissing) {
      errs++
      const snippet = src.slice(n.startIndex, Math.min(n.endIndex, n.startIndex + 160)).replace(/\n/g, "\\n")
      console.log(`  ${n.isMissing ? "MISSING" : "ERROR"} lines ${n.startPosition.row + 1}..${n.endPosition.row + 1} bytes ${n.startIndex}..${n.endIndex}  text="${snippet}"`)
    }
    for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) estack.push(c) }
  }
  console.log(`  total: ${errs}`)

  // What sits between the class_declaration's end and the first orphan method?
  if (cls) {
    const after = cls.endIndex
    console.log(`\nTEXT IMMEDIATELY AFTER class_declaration ends (byte ${after}, line ${cls.endPosition.row + 1}):`)
    console.log(`  ${JSON.stringify(src.slice(after, after + 400))}`)
    console.log(`\nTEXT IMMEDIATELY BEFORE it ends (last 300 bytes):`)
    console.log(`  ${JSON.stringify(src.slice(Math.max(0, cls.endIndex - 300), cls.endIndex))}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })