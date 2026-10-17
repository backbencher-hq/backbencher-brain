// script/m71/probe-declaration-shapes.ts — REVIEW/FIX PROBE for bb_edit (not a gate).
//
// For every declaration fragment bb_edit's `update` must recognise as a FULL
// declaration, print each occurrence of the symbol with:
//   parentType / isBindingParentType(parentType) / is it inside a body node
//   of the fragment / the body node types it sits inside.
// A declaration is recognisable when at least one occurrence is a binding that
// is not inside a FUNCTION/statement body of the fragment.
//
// Run: npx tsx script/m71/probe-declaration-shapes.ts

import { parseForSafety } from "../../src/ast/safety-primitives"
import { isBindingParentType, isReferenceSite } from "../../src/intelligence/edit/edit-engine"

const FRAGMENTS: Array<{ lang: string; file: string; name: string; content: string }> = [
  { lang: "typescript fn", file: "a.ts", name: "target", content: `export function target(): number {\n  return 2\n}` },
  { lang: "typescript method (class fragment)", file: "a.ts", name: "target", content: `target(): number {\n  return 2\n}` },
  { lang: "typescript arrow", file: "a.ts", name: "target", content: `export const target = (): number => 2` },
  { lang: "javascript method", file: "a.js", name: "target", content: `target() {\n  return 2\n}` },
  { lang: "java method", file: "A.java", name: "target", content: `int target() {\n  return 2;\n}` },
  { lang: "java method with modifier", file: "A.java", name: "target", content: `protected int target() {\n  return 2;\n}` },
  { lang: "csharp method", file: "A.cs", name: "Target", content: `int Target() {\n  return 2;\n}` },
  { lang: "csharp method with modifier", file: "A.cs", name: "Target", content: `public int Target() {\n  return 2;\n}` },
  { lang: "kotlin fun", file: "a.kt", name: "target", content: `fun target(): Int {\n  return 2\n}` },
  { lang: "kotlin fun with modifier", file: "a.kt", name: "target", content: `private fun target(): Int {\n  return 2\n}` },
  { lang: "dart fn", file: "a.dart", name: "target", content: `int target() {\n  return 2;\n}` },
  { lang: "go func", file: "a.go", name: "target", content: `func target() int {\n\treturn 2\n}` },
  { lang: "rust fn", file: "a.rs", name: "target", content: `fn target() -> i32 {\n    2\n}` },
  { lang: "swift func", file: "a.swift", name: "target", content: `func target() -> Int {\n  return 2\n}` },
  { lang: "c fn", file: "a.c", name: "target", content: `int target(void) {\n  return 2;\n}` },
  { lang: "cpp method", file: "a.cpp", name: "target", content: `int target() {\n  return 2;\n}` },
  { lang: "python def", file: "a.py", name: "target", content: `def target():\n    return 2\n` },
  { lang: "ruby def", file: "a.rb", name: "target", content: `def target\n  2\nend\n` },
  { lang: "php function", file: "a.php", name: "target", content: `<?php\nfunction target() {\n  return 2;\n}` },
  { lang: "lua function", file: "a.lua", name: "target", content: `function target()\n  return 2\nend\n` },
  { lang: "elixir def", file: "a.ex", name: "target", content: `def target do\n  2\nend\n` },
  { lang: "haskell binding", file: "a.hs", name: "target", content: `target x = x + 2` },
  { lang: "erlang clause", file: "a.erl", name: "target", content: `target(X) -> X + 2.` },
  { lang: "fsharp let", file: "a.fs", name: "target", content: `let target x = x + 2` },
  { lang: "scala def", file: "a.scala", name: "target", content: `def target(): Int = {\n  2\n}` },
  {
    lang: "NEGATIVE java body fragment",
    file: "A.java",
    name: "target",
    content: `return 2;`,
  },
  {
    lang: "NEGATIVE ts body fragment that calls the symbol",
    file: "a.ts",
    name: "target",
    content: `return target(1)`,
  },
  {
    lang: "NEGATIVE ts body fragment declaring a local of the same name",
    file: "a.ts",
    name: "target",
    content: `if (x) {\n  const target = 1\n  return target\n}`,
  },
]

for (const f of FRAGMENTS) {
  const parsed = await parseForSafety(f.file, f.content)
  const hits = parsed.occurrences.filter((o) => o.text === f.name)
  const lines: string[] = []
  for (const o of hits) {
    const enclosingBodies = parsed.bodyRanges
      .filter((b) => b.startIndex <= o.startIndex && o.endIndex <= b.endIndex)
      .map((b) => b.nodeType)
    lines.push(
      `      ${o.nodeType}/${o.parentType} field=${o.parentField} binding=${isBindingParentType(o.parentType)} insideBody=[${enclosingBodies.join(",")}] member=${o.isMemberName} reference=${isReferenceSite(o, "")}`,
    )
  }
  console.log(`── ${f.lang} (${f.file}) name=${f.name}`)
  console.log(lines.length ? lines.join("\n") : "      (no occurrence of the name at all)")
  console.log(`   bodyTypes=[${parsed.bodyRanges.map((b) => b.nodeType).join(",")}]`)
}
console.log("DECLARATION SHAPES COMPLETE")
