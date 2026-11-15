// #924 row 2: the edge delta (-73) must be explained one by one. For every lost
// and added edge, print type/target/source line and whether the TARGET resolves
// to a real symbol in the same file's output.
import { readFileSync, writeFileSync, rmSync } from "node:fs"
import { execSync } from "node:child_process"
import { getParser } from "../run-fixtures"

const TMP = "src/ast/zz-tmp-head-cpp-analyzer5.ts"
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

const keyOf = (e: any): string => `${e.type}|${e.target}|${e.line ?? e.line_number ?? e.metadata?.line ?? ""}`
const lostByType = new Map<string, number>()
const addedByType = new Map<string, number>()
const lostSamples: string[] = []
const addedSamples: string[] = []
let lostTotal = 0
let addedTotal = 0

for (const [, root, exts] of ROOTS) {
  for (const f of files(root, exts)) {
    const src = readFileSync(f, "utf8")
    const rb: any = await new headMod.RealCppAnalyzer().analyze((await getParser("cpp")).parse(src).rootNode, src, f)
    const ra: any = await new curMod.RealCppAnalyzer().analyze((await getParser("cpp")).parse(src).rootNode, src, f)
    const kb = new Map<string, any>()
    for (const e of rb.relationships ?? []) {
      const k = keyOf(e)
      kb.set(k, (kb.get(k) ?? 0) + 1)
    }
    for (const e of ra.relationships ?? []) {
      const k = keyOf(e)
      const n = kb.get(k)
      if (n && n > 0) kb.set(k, n - 1)
      else {
        addedTotal++
        addedByType.set(e.type, (addedByType.get(e.type) ?? 0) + 1)
        if (addedSamples.length < 20) addedSamples.push(`${f.replace("/home/ishaq2321/bb_tests/repositories/", "")} [${e.type}] ${JSON.stringify(e.target)} line=${e.line ?? e.line_number}`)
      }
    }
    for (const [k, n] of kb) {
      if (n <= 0) continue
      lostTotal += n
      const [ty, tg] = k.split("|")
      lostByType.set(ty, (lostByType.get(ty) ?? 0) + n)
      if (lostSamples.length < 30 && k.includes("|")) lostSamples.push(`${f.replace("/home/ishaq2321/bb_tests/repositories/", "")} [${ty}] ${JSON.stringify(tg)} line=${k.split("|")[2]}`)
    }
  }
}
rmSync(TMP, { force: true })
console.log(`lost=${lostTotal} added=${addedTotal}`)
console.log("lost by type:", JSON.stringify([...lostByType.entries()]))
console.log("added by type:", JSON.stringify([...addedByType.entries()]))
console.log("\n-- lost samples --")
for (const s of lostSamples) console.log("  " + s)
console.log("\n-- added samples --")
for (const s of addedSamples) console.log("  " + s)
