// script/m71/diagnose-parameter-binding.ts — REVIEW PROBE (not a gate).
//
// The shadow guard (`collectShadowScopes`) finds a shadow binding by looking for a
// BODY RANGE that encloses the binding site. A PARAMETER is declared in the
// parameter list, BEFORE the body it shadows, so there is no enclosing body range
// and the guard never saw it. MEASURED consequence: `export function use(target:
// number) { return target + 1 }` had its BODY reference renamed while the parameter
// kept its name — in the declaration file too, so this predates the import coverage.
//
// The fix needs the real parentType strings, per language, not a guess. This prints
// them, plus the body ranges of each fixture, so the rule can be written against
// what tree-sitter actually reports.
//
// Run: npx tsx script/m71/diagnose-parameter-binding.ts

import { parseForSafety } from "../../src/ast/safety-primitives"

const FIXTURES: Array<{ lang: string; file: string; code: string; what: string }> = [
  { lang: "typescript", file: "a.ts", what: "function parameter + body reference", code: `export function use(target: number): number {\n  return target + 1\n}\n` },
  { lang: "typescript", file: "a.ts", what: "parameter CALLED in the body", code: `export function use(target: () => number): number {\n  return target()\n}\n` },
  { lang: "typescript", file: "a.ts", what: "block-local (the case that already worked)", code: `export function use(): number {\n  const target = 5\n  return target + 1\n}\n` },
  { lang: "typescript", file: "a.ts", what: "arrow-function parameter", code: `export const use = (target: number): number => target + 1\n` },
  { lang: "typescript", file: "a.ts", what: "CASE W: parameter whose TYPE is a function type, called in the body", code: `import { target } from './a'\nexport function outer(target: () => number): number {\n  return target()\n}\nexport const n = target()\n` },
  { lang: "typescript", file: "a.ts", what: "CASE S control: parameter typed number, referenced in the body", code: `import { target } from './a'\nexport function outer(target: number): number {\n  return target + 10\n}\nexport const n = target()\n` },
  { lang: "javascript", file: "a.js", what: "function parameter", code: `export function use(target) {\n  return target + 1\n}\n` },
  { lang: "java", file: "A.java", what: "method parameter", code: `class A {\n    int use(int target) {\n        return target + 1;\n    }\n}\n` },
  { lang: "python", file: "a.py", what: "function parameter", code: `def use(target):\n    return target + 1\n` },
  { lang: "go", file: "a.go", what: "function parameter", code: `package main\n\nfunc use(target int) int {\n\treturn target + 1\n}\n` },
  { lang: "rust", file: "a.rs", what: "function parameter", code: `fn use(target: i32) -> i32 {\n    target + 1\n}\n` },
  { lang: "kotlin", file: "a.kt", what: "function parameter", code: `fun use(target: Int): Int {\n    return target + 1\n}\n` },
  { lang: "csharp", file: "A.cs", what: "method parameter", code: `class A {\n    int Use(int target) {\n        return target + 1;\n    }\n}\n` },
  { lang: "ruby", file: "a.rb", what: "method parameter", code: `def use(target)\n  target + 1\nend\n` },
  { lang: "c", file: "a.c", what: "function parameter", code: `int use(int target) {\n  return target + 1;\n}\n` },
]

for (const f of FIXTURES) {
  try {
    const parsed = await parseForSafety(f.file, f.code)
    console.log(`── ${f.lang} · ${f.what}`)
    console.log(`   language=${parsed.language} syntaxError=${parsed.hasSyntaxError}`)
    for (const o of parsed.occurrences) {
      if (o.text !== "target") continue
      console.log(`   occurrence text=target parentType=${o.parentType} line=${o.startLine} [${o.startIndex},${o.endIndex}]`)
    }
    for (const b of parsed.bodyRanges) {
      console.log(`   bodyRange nodeType=${b.nodeType} [${b.startIndex},${b.endIndex}]`)
    }
    if (parsed.declaredNames.length) {
      for (const d of parsed.declaredNames) console.log(`   declaredName ${d.text} type=${d.declarationType} decl=[${d.declarationStart},${d.declarationEnd}]`)
    }
  } catch (e: any) {
    console.log(`── ${f.lang} · ${f.what}\n   PARSE ERROR ${e?.message ?? String(e)}`)
  }
}
console.log("PROBE COMPLETE")
