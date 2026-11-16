// #924 row 2: the ONLY non-contains deltas are one lost and one added `uses`
// edge. The containment delta is the rename itself (the edge names the child).
// Print the uses pair in full — that is the whole semantic delta of the fix.
import { readFileSync, writeFileSync, rmSync } from "node:fs"
import { execSync } from "node:child_process"
import { getParser } from "../run-fixtures"

const TMP = "src/ast/zz-tmp-head-cpp-analyzer6.ts"
writeFileSync(TMP, execSync(`git show HEAD:src/ast/real-cpp-analyzer.ts`, { encoding: "utf8", maxBuffer: 1 << 28 }))
const headMod: any = await import(`../../../${TMP}`)
const curMod: any = await import("../../../src/ast/real-cpp-analyzer")

const ROOTS: Array<[string, string, string[]]> = [
  ["fmt:cpp", "<corpus-root>/bb_tests/repositories/fmt", ["*.h", "*.cc", "*.cpp"]],
  ["nlohmann-json:cpp", "<corpus-root>/bb_tests/repositories/nlohmann-json", ["*.hpp", "*.cpp", "*.h"]],
]
function files(root: string, exts: string[]): string[] {
  const names = exts.map((e) => `-name '${e}'`).join(" -o ")
  return execSync(`find ${root} -type f \\( ${names} \\) -not -path '*/build/*' -not -path '*/.git/*'`, { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\n").filter(Boolean).sort()
}
let movedContains = 0
const movedSamples: string[] = []
for (const [, root, exts] of ROOTS) {
  for (const f of files(root, exts)) {
    const src = readFileSync(f, "utf8")
    const rbs: any = await new headMod.RealCppAnalyzer().analyze((await getParser("cpp")).parse(src).rootNode, src, f)
    const ras: any = await new curMod.RealCppAnalyzer().analyze((await getParser("cpp")).parse(src).rootNode, src, f)
    const nonContains = (r: any, type: string): any[] => (r.relationships ?? []).filter((e: any) => e.type === type)
    for (const ty of ["uses", "calls", "references", "contains"]) {
      const kb = new Map<string, number>()
      for (const e of nonContains(rbs, ty)) {
        const k = JSON.stringify([e.target, e.line ?? e.line_number ?? e.metadata?.line, e.metadata?.source ?? e.source ?? ""])
        kb.set(k, (kb.get(k) ?? 0) + 1)
      }
      for (const e of nonContains(ras, ty)) {
        const k = JSON.stringify([e.target, e.line ?? e.line_number ?? e.metadata?.line, e.metadata?.source ?? e.source ?? ""])
        const n = kb.get(k)
        if (n && n > 0) kb.set(k, n - 1)
        else if (ty !== "contains" && movedSamples.length < 20) movedSamples.push(`ADDED  ${f.replace("<corpus-root>/bb_tests/repositories/", "")} [${ty}] ${JSON.stringify(e)}`)
      }
      for (const [k, n] of kb) {
        if (n <= 0) continue
        if (ty === "contains") { movedContains += n; continue }
        if (movedSamples.length < 20) movedSamples.push(`LOST   ${f.replace("<corpus-root>/bb_tests/repositories/", "")} [${ty}] ${k} x${n}`)
      }
    }
  }
}
rmSync(TMP, { force: true })
console.log(`contains-key deltas (parent-blind key) = ${movedContains}`)
console.log(movedSamples.join("\n") || "(no non-contains deltas)")
