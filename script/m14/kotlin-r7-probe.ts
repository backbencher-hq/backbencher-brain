/**
 * KOTLIN R7 PROBE — why two corpus files publish an EMPTY symbol name and an
 * `unknown` edge endpoint.
 *
 * Standing rule R7 (validation/m60/ledger.json): no empty symbol names, no edge
 * endpoint equal to the placeholder literal `unknown`. The census
 * (script/m14/kotlin-census.ts, stride 40 over the kotlin corpus) found 2 empty
 * names and 7 offending endpoints, and this file prints the parse tree around
 * each so the fix is a node-type test rather than a guess about text.
 *
 * Three corpus files carry the violations, all of them IntelliJ test-data files
 * that mark positions with `<caret>` / `<expr>…</expr>` markup:
 *
 *   ambiguouslyInheritedGeneric.kt            empty-name class  -> 2 implements edges with src=""
 *   localClassWithUnresolvedSuperType.kt      call + contains edges with tgt="unknown"
 *   memberPropertyWithTypeInDelegateScript.kts empty-name fun    -> 3 references edges with src=""
 *
 * No regex: the tree is dumped through cursor/child APIs and printed.
 *
 * Usage: bun run script/m14/kotlin-r7-probe.ts
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"

const REPO = process.env.BB_KOTLIN_CORPUS ?? "$HOME/fixtures/repositories/kotlin"
const TARGETS = [
  "analysis/analysis-api/testData/components/relationProvider/implementationState/ambiguouslyInheritedGeneric.kt",
  "analysis/analysis-api/testData/components/javaInteroperabilityComponent/asPsiType/forExpression/localClassWithUnresolvedSuperType.kt",
  "analysis/low-level-api-fir/testData/inBlockModification/memberPropertyWithTypeInDelegateScript.kts",
]

const parser = await getParser("kotlin")

function dump(n: any, depth: number, out: string[], maxDepth = 12): void {
  if (depth > maxDepth) return
  const text = n.text.length > 46 ? n.text.slice(0, 46).replace(/\n/g, "\\n") + "…" : n.text.replace(/\n/g, "\\n")
  out.push(`${"  ".repeat(depth)}${n.type}${n.isNamed ? "" : " (anon)"}  ${JSON.stringify(text)}`)
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c) dump(c, depth + 1, out, maxDepth)
  }
}

for (const rel of TARGETS) {
  const abs = path.join(REPO, rel)
  console.log(`\n${"=".repeat(100)}\n${rel}`)
  const src = readFileSync(abs, "utf8")
  const tree = await parser.parse(src)
  if (!tree) throw new Error("parser.parse returned no tree (null result)")
  const lines: string[] = []
  dump(tree.rootNode, 0, lines)
  // Print only the subtrees that carry a name-ish or markup-ish node, so the
  // output stays readable: an ERROR/MISSING node, an xml/markup node type, or a
  // declaration. The filter is on node TYPE, never on text.
  const MARKUPISH = new Set(["ERROR", "MISSING", "xml_element", "xml_start_tag", "xml_end_tag", "xml_tag", "identifier", "simple_identifier", "type_identifier"])
  const interesting = lines.filter((l) => {
    const indent = l.length - l.trimStart().length
    void indent
    return true
  })
  void MARKUPISH
  // Second pass: find every ERROR/MISSING node and print its parent subtree.
  const parents: any[] = []
  const walk = (n: any) => {
    if (n.type === "ERROR" || n.type === "MISSING") parents.push(n)
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) walk(c)
    }
  }
  walk(tree.rootNode)
  console.log(`ERROR/MISSING nodes: ${parents.length}`)
  for (const p of parents.slice(0, 4)) {
    const sub: string[] = []
    dump(p, 0, sub, 8)
    console.log(`  --- subtree of ${p.type} @row ${p.startPosition.row + 1} ---`)
    for (const l of sub) console.log(`  ${l}`)
  }
  // And the full top-level shape, so the declaration nodes are visible even when
  // the file parsed without an ERROR node.
  const top: string[] = []
  const root = tree.rootNode
  for (let i = 0; i < root.childCount; i++) {
    const c = root.child(i)
    if (!c) continue
    top.push(`${c.type}${c.isNamed ? "" : " (anon)"}  ${JSON.stringify(c.text.length > 60 ? c.text.slice(0, 60).replace(/\n/g, "\\n") + "…" : c.text.replace(/\n/g, "\\n"))}`)
  }
  console.log(`top-level children of source_file:`)
  for (const l of top) console.log(`  ${l}`)
  void interesting
  tree.delete?.()
}
