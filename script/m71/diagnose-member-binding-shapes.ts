// script/m71/diagnose-member-binding-shapes.ts — REVIEW PROBE (not a gate).
//
// `collectShadowScopes` treats every `isBindingParentType` occurrence as a shadow. That
// question ("is this site a declaration rather than a use") is right for the rename
// filter and wrong for shadowing: object keys and member definitions name a member, they
// do not enter any enclosing scope.
//
// MEASURED damage: m67's fixture (`const config = { target: 99 }` + `const helper = {
// target(x) {…} }`) produced a shadow spanning the whole enclosing function, so the call
// site `target()` inside it was skipped by the declaration-file pass — while the
// caller-span pass, which had no shadow check, renamed it. The result was accidentally
// correct and the two passes disagreed (script/m71/diagnose-m67-fixture.ts).
//
// This prints, per language, the parentType of a MEMBER name so the exclusion list is
// written from measurements instead of guessed from tree-sitter node names.
//
// Run: npx tsx script/m71/diagnose-member-binding-shapes.ts

import { parseForSafety } from "../../src/ast/safety-primitives"

const FIXTURES: Array<{ lang: string; file: string; what: string; code: string }> = [
  { lang: "typescript", file: "a.ts", what: "object key", code: `const config = { target: 99 }\nexport const n = target()\n` },
  { lang: "typescript", file: "a.ts", what: "object method", code: `const helper = { target(x: number): number { return x } }\nexport const n = target()\n` },
  { lang: "typescript", file: "a.ts", what: "class method", code: `export class A {\n  target(): number { return 1 }\n}\nexport const n = target()\n` },
  { lang: "typescript", file: "a.ts", what: "class field", code: `export class A {\n  target = 1\n}\nexport const n = target()\n` },
  { lang: "javascript", file: "a.js", what: "object key + method", code: `const config = { target: 99 }\nconst helper = { target(x) { return x } }\nexport const n = target()\n` },
  { lang: "python", file: "a.py", what: "dict key + method", code: `config = {"target": 99}\n\n\nclass A:\n    def target(self):\n        return 1\n\n\nvalue = target()\n` },
  { lang: "ruby", file: "a.rb", what: "hash key + method", code: `config = { target: 99 }\n\nclass A\n  def target\n    1\n  end\nend\n\nvalue = target()\n` },
  { lang: "go", file: "a.go", what: "struct literal key + method", code: `package main\n\ntype A struct {\n\ttarget int\n}\n\nfunc (a A) target() int { return 1 }\n\nfunc use() int { return target() }\n` },
  { lang: "rust", file: "a.rs", what: "struct field + impl fn", code: `struct A {\n    target: i32,\n}\n\nimpl A {\n    fn target(&self) -> i32 { 1 }\n}\n\nfn use_it() -> i32 { target() }\n` },
  { lang: "java", file: "A.java", what: "field + method", code: `class A {\n    int target = 1;\n    int target() { return 1; }\n    int use() { return target(); }\n}\n` },
  { lang: "csharp", file: "A.cs", what: "field + method", code: `class A {\n    int target = 1;\n    int target() { return 1; }\n    int Use() { return target(); }\n}\n` },
  { lang: "kotlin", file: "a.kt", what: "class property + function", code: `class A {\n    val target = 1\n    fun target(): Int { return 1 }\n}\nfun use(): Int = target()\n` },
]

for (const f of FIXTURES) {
  try {
    const parsed = await parseForSafety(f.file, f.code)
    const hits = parsed.occurrences.filter((o) => o.text === "target")
    console.log(`── ${f.lang} · ${f.what}`)
    for (const o of hits) console.log(`   occurrence parentType=${o.parentType} line=${o.startLine} [${o.startIndex},${o.endIndex}]`)
    for (const b of parsed.bodyRanges) console.log(`   bodyRange nodeType=${b.nodeType} [${b.startIndex},${b.endIndex}]`)
  } catch (e: any) {
    console.log(`── ${f.lang} · ${f.what}\n   PARSE ERROR ${e?.message ?? String(e)}`)
  }
}
console.log("PROBE COMPLETE")
