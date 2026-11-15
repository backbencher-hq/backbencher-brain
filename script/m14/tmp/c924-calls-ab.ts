// #924 cpp row 3 A/B: the name-bearing-callee rule vs HEAD (which already has the
// qualified-declarator fix), over the two pinned corpora. Every lost edge must be
// a source-text target; report anything that is not.
import { readFileSync, writeFileSync, rmSync } from "node:fs"
import { execSync } from "node:child_process"
import { getParser } from "../run-fixtures"

const TMP = "src/ast/zz-tmp-head-cpp-analyzer8.ts"
writeFileSync(TMP, execSync(`git show HEAD:src/ast/real-cpp-analyzer.ts`, { encoding: "utf8", maxBuffer: 1 << 28 }))
const headMod: any = await import(`../../../${TMP}`)
const curMod: any = await import("../../../src/ast/real-cpp-analyzer")

const ROOTS: Array<[string, string, string[]]> = [
  ["fmt:cpp", "/home/ishaq2321/bb_tests/repositories/fmt", ["*.h", "*.cc", "*.cpp"]],
  ["nlohmann-json:cpp", "/home/ishaq2321/bb_tests/repositories/nlohmann-json", ["*.hpp", "*.cpp", "*.h"]],
]
function files(root: string, exts: string[]): string[] {
  const names = exts.map((e) => `-name '${e}'`).join(" -o ")
  return execSync(`find ${root} -type f \\( ${names} \\) -not -path '*/build/*' -not -path '*/.git/*'`, { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\n").filter(Boolean).sort()
}
const NAME = (s: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s)
let lost = 0
let added = 0
let lostNonText = 0
let symB = 0
let symA = 0
let edgesB = 0
let edgesA = 0
const lostByType = new Map<string, number>()
const lostNameSamples: string[] = []
const lostTextSamples: string[] = []
const addedSamples: string[] = []

for (const [, root, exts] of ROOTS) {
  for (const f of files(root, exts)) {
    const src = readFileSync(f, "utf8")
    const rb: any = await new headMod.RealCppAnalyzer().analyze((await getParser("cpp")).parse(src).rootNode, src, f)
    const ra: any = await new curMod.RealCppAnalyzer().analyze((await getParser("cpp")).parse(src).rootNode, src, f)
    symB += (rb.symbols ?? []).length
    symA += (ra.symbols ?? []).length
    edgesB += (rb.relationships ?? []).length
    edgesA += (ra.relationships ?? []).length
    const rel = f.replace("/home/ishaq2321/bb_tests/repositories/", "")
    const kb = new Map<string, number>()
    for (const e of rb.relationships ?? []) {
      const k = JSON.stringify([e.type, e.source, e.target, e.line_number])
      kb.set(k, (kb.get(k) ?? 0) + 1)
    }
    for (const e of ra.relationships ?? []) {
      const k = JSON.stringify([e.type, e.source, e.target, e.line_number])
      const n = kb.get(k)
      if (n && n > 0) kb.set(k, n - 1)
      else {
        added++
        if (addedSamples.length < 10) addedSamples.push(`${rel} [${e.type}] ${JSON.stringify(e.source)} -> ${JSON.stringify(e.target)} L${e.line_number}`)
      }
    }
    for (const [k, n] of kb) {
      if (n <= 0) continue
      lost += n
      const [ty, from, to, line] = JSON.parse(k)
      lostByType.set(ty, (lostByType.get(ty) ?? 0) + n)
      if (NAME(String(to))) {
        lostNonText++
        if (lostNameSamples.length < 12) lostNameSamples.push(`${rel} [${ty}] ${JSON.stringify(from)} -> ${JSON.stringify(to)} L${line}`)
      } else if (lostTextSamples.length < 12) {
        lostTextSamples.push(`${rel} [${ty}] ${JSON.stringify(String(to).slice(0, 70))} L${line}`)
      }
    }
  }
}
rmSync(TMP, { force: true })
console.log(`symbols before=${symB} after=${symA}`)
console.log(`edges before=${edgesB} after=${edgesA} (delta ${edgesA - edgesB})`)
console.log(`lost=${lost} added=${added}  lost-with-an-IDENTIFIER-target=${lostNonText}`)
console.log("lost by type:", JSON.stringify([...lostByType.entries()]))
console.log("\n-- lost with a plain-identifier target (should be NONE) --")
for (const s of lostNameSamples) console.log("  " + s)
console.log("\n-- lost source-text targets (expected) --")
for (const s of lostTextSamples) console.log("  " + s)
console.log("\n-- added (should be NONE) --")
for (const s of addedSamples) console.log("  " + s)
