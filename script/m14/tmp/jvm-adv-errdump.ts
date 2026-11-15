// Classify the three error-bearing rows: item-sized honest diagnostics vs cascade.
import { writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"

const CASES: Array<[string, string, string]> = [
  ["java:module-import", "D.java", `import module java.base;\npublic class D {\n  List<String> names() { return List.of("a"); }\n}\n`],
  ["java:record-pattern-for", "E.java", `public class E {\n  record Pair(int a, int b) {}\n  int total(Pair[] ps) {\n    int t = 0;\n    for (Pair(int a, int b) : ps) { t += a + b; }\n    return t;\n  }\n}\n`],
  ["kotlin:context-parameters", "A.kt", `context(name: String)\nfun greet(): String = "hi $name"\n\nclass K {\n  fun run(): String = context(Int) { greet() }\n}\n`],
]
for (const [name, ext, src] of CASES) {
  const f = join(tmpdir(), `jvm-adv-errdump-${ext}`)
  writeFileSync(f, src)
  const r = await parseFile(f, process.cwd())
  console.log(`== ${name}: ${(r.errors ?? []).length} errors`)
  for (const e of (r.errors ?? []).slice(0, 8)) {
    console.log(`   [${e.severity ?? "?"}] ${(e.message ?? "").slice(0, 90)} @${e.line ?? e.line_number ?? "?"}`)
  }
  const names = (r.symbols ?? []).map((s: any) => `${s.kind}:${s.name}`).slice(0, 12)
  console.log(`   symbols: ${names.join(" ")}`)
}
