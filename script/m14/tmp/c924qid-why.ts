// #924 row 2: WHY does a fix to qualified-declarator naming change which symbol
// occupies base.h:1692? Dump every symbol (both implementations) in the window.
import { readFileSync, writeFileSync, rmSync } from "node:fs"
import { execSync } from "node:child_process"
import { getParser } from "../run-fixtures"

const TMP = "src/ast/zz-tmp-head-cpp-analyzer4.ts"
writeFileSync(TMP, execSync(`git show HEAD:src/ast/real-cpp-analyzer.ts`, { encoding: "utf8", maxBuffer: 1 << 28 }))
const headMod: any = await import(`../../../${TMP}`)
const curMod: any = await import("../../../src/ast/real-cpp-analyzer")

const CASES: Array<[string, number, number]> = [
  ["/home/ishaq2321/bb_tests/repositories/fmt/include/fmt/base.h", 1685, 1700],
  ["/home/ishaq2321/bb_tests/repositories/fmt/include/fmt/compile.h", 570, 580],
]
for (const [f, lo, hi] of CASES) {
  const src = readFileSync(f, "utf8")
  const rb: any = await new headMod.RealCppAnalyzer().analyze((await getParser("cpp")).parse(src).rootNode, src, f)
  const ra: any = await new curMod.RealCppAnalyzer().analyze((await getParser("cpp")).parse(src).rootNode, src, f)
  const inWin = (s: any): boolean => s.range?.startLine >= lo && s.range?.startLine <= hi
  const fmt = (list: any[]): string => list.filter(inWin).map((s) => `      L${s.range.startLine}-${s.range.endLine} ${s.kind} ${JSON.stringify(s.name)} scope=${JSON.stringify(s.metadata?.scope ?? null)}`).join("\n")
  console.log(`\n=== ${f.split("/").pop()} lines ${lo}-${hi}`)
  console.log("   BEFORE (HEAD):")
  console.log(fmt(rb.symbols ?? []) || "      (none)")
  console.log("   AFTER (fix):")
  console.log(fmt(ra.symbols ?? []) || "      (none)")
  console.log("   source:")
  for (let i = lo; i <= hi; i++) console.log(`      ${i}: ${src.split("\n")[i - 1] ?? ""}`)
}
rmSync(TMP, { force: true })
