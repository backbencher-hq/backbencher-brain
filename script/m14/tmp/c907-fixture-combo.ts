// Does concatenating the real slices preserve the round-2 shapes? A single
// fixture covering all three arrivals (root ERROR plain declarator, root ERROR
// pointer-wrapped, body-swallowed wrapped-static) is preferable to three files,
// but only if the glue survives the join — which is a measurement, not a guess.
//
// Run: bun script/m14/tmp/c907-fixture-combo.ts
import { readFileSync, writeFileSync } from "node:fs"
import { parseFile } from "../../../src/ast/pool-worker"

const jv = readFileSync("/home/ishaq2321/bb_tests/repositories/jq/src/jv.c", "utf8").split("\n")
const util = readFileSync("/home/ishaq2321/bb_tests/repositories/jq/src/util.c", "utf8").split("\n")
const dtoa = readFileSync("/home/ishaq2321/bb_tests/repositories/jq/src/jv_dtoa.c", "utf8").split("\n")

const slice = (ls: string[], a: number, b: number): string => ls.slice(a - 1, b).join("\n")

const COMBOS: Array<[string, string, string[]]> = [
  ["dtoa+util", slice(dtoa, 1060, 1100) + "\n" + slice(util, 600, 640), ["ulp", "strptime"]],
  ["util+dtoa", slice(util, 600, 640) + "\n" + slice(dtoa, 1060, 1100), ["strptime", "ulp"]],
  ["jv+dtoa", slice(jv, 673, 700) + "\n" + slice(dtoa, 1060, 1100), ["jv_number", "ulp"]],
  ["jv+util+dtoa", slice(jv, 673, 700) + "\n" + slice(util, 600, 640) + "\n" + slice(dtoa, 1060, 1100), ["jv_number", "strptime", "ulp"]],
]

for (const [label, src, want] of COMBOS) {
  const tmp = `/tmp/c907-combo-${label.replace(/\+/g, "_")}.c`
  writeFileSync(tmp, src)
  const r: any = await parseFile(tmp, "/tmp")
  const fns = (r.symbols ?? []).filter((s: any) => s.kind === "function").map((s: any) => `${s.name}@${s.startLine}:${s.visibility}`)
  const got = new Set((r.symbols ?? []).filter((s: any) => s.kind === "function").map((s: any) => String(s.name)))
  console.log(`\n${label}: want ${want.join(",")}`)
  console.log(`   functions: ${fns.join(", ") || "(none)"}`)
  console.log(`   all recovered: ${want.every((w) => got.has(w)) ? "YES" : `NO (missing ${want.filter((w) => !got.has(w)).join(",")})`}`)
}
