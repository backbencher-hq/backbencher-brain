// M59 (#825) groovy shape probe — measure, never assume.
// 1. Does the pinned groovy grammar expose a `field`/`name` field on
//    field_access / method_invocation (java's grammar does; groovy may not)?
// 2. Multi-line chain: which node is written where?
// 3. Symbol range vs leading annotation: does a groovy class symbol start at
//    its annotation (the java defect), or at the declaration?
import * as path from "path"

const ROOT = "$HOME/mcp/backbencher-brain"

const SRC = `package com.acme

import org.springframework.beans.factory.annotation.Autowired

@Service
class Svc {
    def repo

    void run() {
        repo
            .findAll()
            .each { it }
        def x = repo.items
        def y = this.repo.items
    }
}

class Plain {
    int n
}
`

async function main(): Promise<void> {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const { tree } = await ASTEngine.parseTree("/tmp/probe-shape.groovy", SRC)
  const res: any = await ASTEngine.parseFile("/tmp/probe-shape.groovy", SRC)
  const lines = SRC.split("\n")
  const root = tree.rootNode

  const find = (n: any, types: string[], out: any[] = []): any[] => {
    if (types.includes(n.type)) out.push(n)
    for (let i = 0; i < n.namedChildCount; i++) find(n.namedChild(i), types, out)
    return out
  }

  console.log("=== declaration children (annotations?) ===")
  for (const c of find(root, ["class_declaration", "method_declaration", "field_declaration"])) {
    const kids: string[] = []
    for (let i = 0; i < c.namedChildCount; i++) kids.push(`${c.namedChild(i).type}@${c.namedChild(i).startPosition.row + 1}`)
    console.log(`  ${c.type} @${c.startPosition.row + 1} kids=[${kids}]`)
  }

  for (const t of ["field_access", "method_invocation", "juxt_function_call", "leading_dot_call", "object_creation_expression"]) {
    const nodes = find(root, [t])
    console.log(`\n=== ${t} (${nodes.length}) ===`)
    for (const n of nodes) {
      const kids: string[] = []
      for (let i = 0; i < n.namedChildCount; i++) kids.push(n.namedChild(i).type)
      const fName = n.childForFieldName?.("name")?.type
      const fObj = n.childForFieldName?.("object")?.type
      const fField = n.childForFieldName?.("field")?.type
      console.log(
        `  ${n.type} @${n.startPosition.row + 1}..${n.endPosition.row + 1} text="${n.text.replace(/\n/g, "\\n").slice(0, 40)}" kids=[${kids}] fields:name=${fName} object=${fObj} field=${fField}`,
      )
    }
  }

  console.log(`\n=== symbols ===`)
  for (const s of res.symbols ?? []) {
    console.log(`  ${String(s.kind).padEnd(10)} ${String(s.name).padEnd(10)} range.startLine=${s.range?.startLine} :: ${(lines[(s.range?.startLine ?? 1) - 1] ?? "").trim()}`)
  }
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
