// script/m14/tmp/clean-127-pin-verify.ts
//
// After pinning, prove the PRODUCTION engine — not a probe that loads the wasm itself — is on
// v1.2.7. The distinguishing vocabulary is measured, not assumed: `monad_bind`, the keyword
// node types (`where`/`import`/`from`/`of`/`instance`) and `array_generator_sep` do not exist
// in v1.2.4's tree for these inputs and do in v1.2.7's.
//
// Run: bun script/m14/tmp/clean-127-pin-verify.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile, ASTEngine } from "../../../src/ast/engine"

const REPOS = "/home/ishaq2321/bb_tests/repositories"
// Markers are node TYPES that do not exist in v1.2.4's tree for these inputs. (`where` is a
// node type too, but it is an ANONYMOUS token, so a walk over `namedChild` cannot see it — the
// first draft of this probe reported it "ABSENT" for that reason, which is a probe bug, not a
// pin signal. The walk below is over all children.)
const PROBES: [string, string][] = [
  ["Clyde/Clyde/coloured_line.icl", "monad_bind"],
  ["Clyde/Clyde/projwindowcontroller.icl", "array_generator_sep"],
  ["Clyde/Cocoa/tabview.dcl", "class_member"],
  ["clean-stdlib/StdList.icl", "instance_member"],
]

function nodeTypes(root: any): Set<string> {
  const out = new Set<string>()
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    out.add(n.type)
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
  }
  return out
}

let found = 0
for (const [rel, marker] of PROBES) {
  const f = path.join(REPOS, rel)
  const src = fs.readFileSync(f, "utf8")
  const r: any = await parseFile(f, src)
  // parseFile returns a ParseResult; re-parse through the engine's own parser for the tree.
  const root = (await (ASTEngine as any).getParser("clean")).parse(src).rootNode
  const types = nodeTypes(root)
  const has = types.has(marker)
  if (has) found++
  console.log(`${has ? "ok  " : "MISS"} ${rel.padEnd(46)} marker ${JSON.stringify(marker)} ${has ? "present" : "ABSENT"}  (symbols ${r.symbols?.length ?? 0}, errors ${r.errors?.length ?? 0})`)
}
// The grammar's own node-type count is the second, language-level witness: v1.2.4 reported 271
// through F1's oracle (`audit-analyzer-grammar.ts`).
const lang: any = await (ASTEngine as any).getParser("clean").language
const nodes = new Set<string>()
for (let i = 0; i < (lang?.nodeTypeCount ?? 0); i++) {
  const t = lang?.nodeTypeForId?.(i)
  if (t?.type) nodes.add(String(t.type))
}
if (nodes.size) {
  console.log(`\nnode types in the pinned grammar: ${nodes.size} (v1.2.4 reported 271 through the F1 oracle)`)
  for (const t of ["monad_bind", "where", "import", "from", "of", "instance", "wildcard", "uniqueness_star", "array_generator_sep", "generator_sep", "comprehension_sep", "strict_equal", "arrow", "operator_add", "operator_compare"]) {
    console.log(`   ${nodes.has(t) ? "present" : "absent "} ${t}`)
  }
}
console.log(`\n${found} of ${PROBES.length} v1.2.7 markers present through the production engine path`)
