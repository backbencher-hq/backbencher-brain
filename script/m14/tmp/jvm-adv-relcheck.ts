// Relationship spot-check on the corpus-absent constructs where an edge is
// the point: sealed permits/implements, record component properties, and the
// pattern-destructured record.
import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"

const CASES: Array<[string, string, string, string[]]> = [
  ["java:record-pattern-switch rels", "J1.java", "java",
    `public class J1 {\n  record Point(int x, int y) {}\n  static String describe(Object o) {\n    return switch (o) {\n      case Point(int x, int y) -> "p";\n      default -> "?";\n    };\n  }\n}\n`,
    ["Point x", "Point y"]],
  ["groovy:sealed implements", "J2.groovy", "groovy",
    `sealed interface Shape permits Circle, Square {}\nclass Circle implements Shape {}\nclass Square implements Shape {}\n`,
    ["Circle Shape", "Square Shape"]],
  ["kotlin:when-guard data class", "J3.kt", "kotlin",
    `sealed interface Msg\ndata class Text(val body: String): Msg\nfun handle(m: Msg): String = when (m) {\n  is Text if m.body.length > 3 -> "long"\n  else -> "?"\n}\n`,
    ["Text Msg", "body"]],
]
for (const [name, fname, lang, src, expectEdges] of CASES) {
  const f = join(tmpdir(), "jvm-adv-rel-" + fname)
  writeFileSync(f, src)
  const r = await parseFile(f, process.cwd())
  const rels: string[] = (r.relationships ?? []).map((x: any) => `${x.source ?? x.fromSymbol} -> ${x.target ?? x.toSymbol} (${x.type ?? x.relationshipType})`)
  console.log(`== ${name}`)
  for (const e of rels.slice(0, 14)) console.log("   " + e)
  for (const want of expectEdges) {
    const hit = rels.some((s) => s.includes(want))
    console.log(`   ${hit ? "OK  " : "GAP "} expect edge containing: ${want}`)
  }
}
