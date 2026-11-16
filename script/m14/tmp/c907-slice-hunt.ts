// #907 round 2: the fixture must be a REAL shape, so hunt for the smallest slice
// of the real corpus files that still produces a definition header arriving under
// a root-level ERROR (the round-2 arrival). Prints, per candidate slice, whether
// the analyzer loses the definition and where the ERROR sits.
//
// Run: bun script/m14/tmp/c907-slice-hunt.ts
import { readFileSync, writeFileSync } from "node:fs"
import { parseFile } from "../../../src/ast/pool-worker"

const CASES: Array<{ file: string; name: string; ranges: Array<[number, number]> }> = [
  {
    file: "<corpus-root>/bb_tests/repositories/jq/src/jv.c",
    name: "jv_number",
    ranges: [[660, 700], [640, 700], [673, 700], [660, 760]],
  },
  {
    file: "<corpus-root>/bb_tests/repositories/jq/src/util.c",
    name: "strptime",
    ranges: [[600, 640], [560, 700], [440, 700], [40, 700]],
  },
  {
    file: "<corpus-root>/bb_tests/repositories/jq/src/jv_dtoa.c",
    name: "ulp",
    ranges: [[1060, 1100], [1000, 1120]],
  },
]

for (const c of CASES) {
  const lines = readFileSync(c.file, "utf8").split("\n")
  for (const [a, b] of c.ranges) {
    const slice = lines.slice(a - 1, b).join("\n")
    const tmp = `/tmp/c907-slice-${c.name}-${a}-${b}.c`
    writeFileSync(tmp, slice)
    const r: any = await parseFile(tmp, "/tmp")
    const fns = new Set((r.symbols ?? []).filter((s: any) => s.kind === "function").map((s: any) => String(s.name)))
    console.log(`\n${c.name} [${a}-${b}] (${b - a + 1} lines): ${fns.has(c.name) ? "PRESENT" : "LOST   "}  fns=${[...fns].join(",")}`)
  }
}
