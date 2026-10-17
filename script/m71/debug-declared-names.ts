// script/m71/debug-declared-names.ts — debug probe (not a gate).
import { parseForSafety } from "../../src/ast/safety-primitives"

const CASES = [
  { file: "a.kt", content: `fun target(): Int {\n    return 2\n}` },
  { file: "A.java", content: `int target() {\n    return 2;\n}` },
  { file: "A.cs", content: `int Target() {\n    return 2;\n}` },
  { file: "a.dart", content: `int target() {\n  return 2;\n}` },
  { file: "a.ts", content: `target(): number {\n  return 2\n}` },
  { file: "a.ts", content: `export function target(): number {\n  return 2\n}` },
  { file: "a.hs", content: `target x = x + 2` },
  { file: "a.erl", content: `target(X) -> X + 2.` },
  { file: "a.fs", content: `let target x = x + 2` },
  { file: "a.ex", content: `def target do\n  2\nend\n` },
  { file: "a.php", content: `<?php\nfunction target() {\n  return 2;\n}` },
  { file: "a.rb", content: `def target\n  2\nend\n` },
  { file: "a.ts", content: `const target = (): number => 2` },
]
for (const c of CASES) {
  const p = await parseForSafety(c.file, c.content)
  console.log(`── ${c.file} ${JSON.stringify(c.content.slice(0, 40))}`)
  console.log(`   declaredNames=${JSON.stringify(p.declaredNames)} hasSyntaxError=${p.hasSyntaxError}`)
  console.log(`   bodyRanges=[${p.bodyRanges.map((b) => `${b.nodeType}@${b.startIndex}-${b.endIndex}`).join(", ")}]`)
}
