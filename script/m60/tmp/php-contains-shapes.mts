/**
 * F1 PRE-PROBE — what does the analyzer's `contains` surface actually look like,
 * and what are the shapes an INDEPENDENT oracle would have to derive?
 *
 * The point is to enumerate the shapes BEFORE writing the oracle, so the oracle
 * is written from PHP's containment semantics and then measured against the
 * analyzer — not reverse-engineered from its output and called a check.
 */
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import * as path from "node:path"
const ROOT = "$HOME/backbencher-brain"
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const grammar = await (wts as any).Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-php.wasm")))
const parser = new P(); parser.setLanguage(grammar)

// Which grammar node types sit directly under a type body, and what name does
// the analyzer's contains target carry for each?
const underBody = new Map<string, number>()
const anonClassMembers = new Map<string, number>()
let files = 0
const samples: string[] = []

for (const repo of ["phpunit", "phpmyadmin"]) {
  const dir = path.join("$HOME/fixtures/repositories", repo)
  for (const f of execSync(`git ls-files -z -- '*.php'`, { cwd: dir, maxBuffer: 1 << 28 }).toString().split("\0").filter(Boolean).sort()) {
    let src: string, root: any
    try { src = readFileSync(path.join(dir, f), "utf8"); root = parser.parse(src).rootNode } catch { continue }
    files++
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()!
      let body: any = null
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && ["declaration_list", "enum_declaration_list"].includes(c.type)) { body = c; break } }
      if (body) {
        for (let i = 0; i < body.namedChildCount; i++) {
          const m = body.namedChild(i)
          if (m) underBody.set(m.type, (underBody.get(m.type) ?? 0) + 1)
        }
      }
      if (n.type === "class" || n.type === "anonymous_class" || (n.type === "object_creation_expression" && n.namedChildren.some((c: any) => c.type === "class"))) {
        // anonymous class: `new class { ... }`
        const owner = n.parent
        for (let i = 0; i < (owner?.namedChildCount ?? 0); i++) {
          const m = owner.namedChild(i)
          if (m && ["declaration_list", "enum_declaration_list"].includes(m.type)) {
            for (let j = 0; j < m.namedChildCount; j++) {
              const mm = m.namedChild(j)
              if (mm) anonClassMembers.set(mm.type, (anonClassMembers.get(mm.type) ?? 0) + 1)
            }
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  }
}
console.log(`files=${files}`)
console.log("\n=== direct children of a type body (declaration_list / enum_declaration_list) ===")
for (const [k, v] of [...underBody.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(40)} ${v}`)
console.log("\n=== same, for ANONYMOUS class bodies (`new class { ... }`) ===")
for (const [k, v] of [...anonClassMembers.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(40)} ${v}`)
process.exit(0)
