// #919: the four remaining REAL-LOSS relationships, site by site — is the read
// now SUPPRESSED because the name is bound as a local of the recovered body (the
// analyzer's shadow rule), or is a genuine read gone?
//   bun script/m14/tmp/c919-loss.ts
import { readFileSync } from "node:fs"
import path from "node:path"
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const before = JSON.parse(readFileSync("/tmp/c919-before.json", "utf8"))
const after = JSON.parse(readFileSync("/tmp/c919-after.json", "utf8"))
const CASES: Array<[string, number, string]> = [
  ["nlohmann-json/tests/src/unit-iterators2.cpp", 34, "j"],
  ["nlohmann-json/tests/src/unit-regression1.cpp", 113, "n"],
  ["nlohmann-json/tests/src/unit-serialization.cpp", 186, "binary"],
  ["nlohmann-json/tests/src/unit-serialization.cpp", 186, "values"],
]
for (const [f, line, target] of CASES) {
  const src = readFileSync(path.join(CORPUS, f), "utf8").split("\n")
  console.log(`\n=== ${f}:${line}  target=${target}`)
  console.log(`    source line: ${JSON.stringify((src[line - 1] ?? "").trim())}`)
  const pick = (dump: any) => (dump[f]?.rels ?? []).filter((r: string) => {
    const i = r.lastIndexOf("|")
    const j = r.lastIndexOf("|", i - 1)
    return Number(r.slice(i + 1)) === line && r.slice(j + 1, i) === target
  })
  console.log(`    before: ${JSON.stringify(pick(before))}`)
  console.log(`    after : ${JSON.stringify(pick(after))}`)
  // is the name declared inside the enclosing recovered body?
  const declLines = src.map((t, i) => ({ t: t.trim(), n: i + 1 })).filter(x => new RegExp(`(^|[^A-Za-z0-9_])${target}\\s*(=|;|\\(|\\{|,|:)`).test(x.t) && x.n <= line)
  console.log(`    candidate bindings at/above this line (last 4): ${JSON.stringify(declLines.slice(-4).map(x => `${x.n}: ${x.t.slice(0, 60)}`))}`)
}
