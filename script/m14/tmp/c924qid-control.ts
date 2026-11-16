// #924 row 2 CONTROL: HEAD's analyzer vs a SECOND HEAD instance over the same
// files. If transitions appear here too, the probe (not the fix) is producing
// them — e.g. per-file state carried on the analyzer instance.
import { readFileSync, writeFileSync, rmSync } from "node:fs"
import { execSync } from "node:child_process"
import { getParser } from "../run-fixtures"

const TMP = "src/ast/zz-tmp-head-cpp-analyzer3.ts"
writeFileSync(TMP, execSync(`git show HEAD:src/ast/real-cpp-analyzer.ts`, { encoding: "utf8", maxBuffer: 1 << 28 }))
const headMod: any = await import(`../../../${TMP}`)
const A = new headMod.RealCppAnalyzer()
const B = new headMod.RealCppAnalyzer()

const ROOTS: Array<[string, string, string[]]> = [
  ["fmt:cpp", "<corpus-root>/bb_tests/repositories/fmt", ["*.h", "*.cc", "*.cpp"]],
  ["nlohmann-json:cpp", "<corpus-root>/bb_tests/repositories/nlohmann-json", ["*.hpp", "*.cpp", "*.h"]],
]
function files(root: string, exts: string[]): string[] {
  const names = exts.map((e) => `-name '${e}'`).join(" -o ")
  return execSync(`find ${root} -type f \\( ${names} \\) -not -path '*/build/*' -not -path '*/.git/*'`, { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\n").filter(Boolean).sort()
}

let diffs = 0
const samples: string[] = []
for (const [, root, exts] of ROOTS) {
  for (const f of files(root, exts)) {
    const src = readFileSync(f, "utf8")
    const ra: any = await A.analyze((await getParser("cpp")).parse(src).rootNode, src, f)
    const rb: any = await B.analyze((await getParser("cpp")).parse(src).rootNode, src, f)
    const ka = (ra.symbols ?? []).map((s: any) => `${s.range?.startLine}|${s.range?.startColumn}|${s.kind}|${s.name}`).sort()
    const kb = (rb.symbols ?? []).map((s: any) => `${s.range?.startLine}|${s.range?.startColumn}|${s.kind}|${s.name}`).sort()
    if (JSON.stringify(ka) !== JSON.stringify(kb)) {
      diffs++
      if (samples.length < 8) samples.push(`${f}\n  A-only: ${ka.filter((x: string) => !kb.includes(x)).slice(0, 4).join(" ; ")}\n  B-only: ${kb.filter((x: string) => !ka.includes(x)).slice(0, 4).join(" ; ")}`)
    }
  }
}
rmSync(TMP, { force: true })
console.log(`CONTROL (HEAD vs HEAD2): files with different symbol sets = ${diffs}`)
for (const s of samples) console.log(s)
