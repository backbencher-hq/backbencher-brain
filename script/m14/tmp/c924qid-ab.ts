// #924 row 2 A/B: the qualified-declarator name fix vs HEAD's analyzer, over the
// two pinned cpp corpora, through the ANALYZER (same tree, both implementations),
// reporting: names that changed, names that appeared/disappeared, whitespace
// names before/after, scope changes, and any edge delta.
import { readFileSync, writeFileSync, rmSync } from "node:fs"
import { execSync } from "node:child_process"
import { getParser } from "../run-fixtures"

const ROOTS: Array<[string, string, string[]]> = [
  ["fmt:cpp", "<corpus-root>/bb_tests/repositories/fmt", ["*.h", "*.cc", "*.cpp"]],
  ["nlohmann-json:cpp", "<corpus-root>/bb_tests/repositories/nlohmann-json", ["*.hpp", "*.cpp", "*.h"]],
]

const TMP = "src/ast/zz-tmp-head-cpp-analyzer.ts"
writeFileSync(TMP, execSync(`git show HEAD:src/ast/real-cpp-analyzer.ts`, { encoding: "utf8", maxBuffer: 1 << 28 }))
const headMod: any = await import(`../../../${TMP}`)
const curMod: any = await import("../../../src/ast/real-cpp-analyzer")
const head = new headMod.RealCppAnalyzer()
const cur = new curMod.RealCppAnalyzer()

function files(root: string, exts: string[]): string[] {
  const names = exts.map((e) => `-name '${e}'`).join(" -o ")
  return execSync(`find ${root} -type f \\( ${names} \\) -not -path '*/build/*' -not -path '*/.git/*'`, {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  })
    .split("\n")
    .filter(Boolean)
    .sort()
}

let nFiles = 0
let symsB = 0
let symsA = 0
let edgesB = 0
let edgesA = 0
let wsB = 0
let wsA = 0
let renamed = 0
let lost = 0
let added = 0
let scopeChanged = 0
let lineChanged = 0
const renameSamples: string[] = []
const lossSamples: string[] = []
const addSamples: string[] = []
const scopeSamples: string[] = []
const lineSamples: string[] = []

const key = (s: any): string => `${s.kind}|${s.range?.startLine}|${s.range?.startColumn}|${s.name}|${s.metadata?.scope ?? ""}`

for (const [label, root, exts] of ROOTS) {
  const list = files(root, exts)
  process.stderr.write(`[${label}] ${list.length} files\n`)
  for (const f of list) {
    const src = readFileSync(f, "utf8")
    const parser = await getParser("cpp")
    const tree: any = parser.parse(src)
    const b: any = await head.analyze(tree.rootNode, src, f)
    const parser2 = await getParser("cpp")
    const tree2: any = parser2.parse(src)
    const a: any = await cur.analyze(tree2.rootNode, src, f)
    nFiles++
    symsB += (b.symbols ?? []).length
    symsA += (a.symbols ?? []).length
    edgesB += (b.relationships ?? []).length
    edgesA += (a.relationships ?? []).length
    const rel = f.replace("<corpus-root>/bb_tests/repositories/", "")

    // whitespace names, before/after (macro-heading names are deliberate)
    const isDeliberate = (s: any): boolean => s.metadata?.expandedFrom === "macro-heading"
    wsB += (b.symbols ?? []).filter((s: any) => /\s/.test(String(s.name)) && !isDeliberate(s)).length
    wsA += (a.symbols ?? []).filter((s: any) => /\s/.test(String(s.name)) && !isDeliberate(s)).length

    // name changes for symbols matching by kind+position
    const mapA = new Map<string, any>()
    for (const s of a.symbols ?? []) mapA.set(`${s.kind}|${s.range?.startLine}|${s.range?.startColumn}`, s)
    const seenA = new Set<string>()
    for (const sb of b.symbols ?? []) {
      const kk = `${sb.kind}|${sb.range?.startLine}|${sb.range?.startColumn}`
      const sa = mapA.get(kk)
      if (!sa) { lost++; if (lossSamples.length < 12) lossSamples.push(`${rel}:${sb.range?.startLine} [${sb.kind}] ${JSON.stringify(sb.name)}`) ; continue }
      seenA.add(kk)
      if (sa.name !== sb.name) {
        renamed++
        if (renameSamples.length < 25) renameSamples.push(`${rel}:${sb.range?.startLine} ${JSON.stringify(sb.name)} -> ${JSON.stringify(sa.name)}`)
      }
      const scB = sb.metadata?.scope ?? ""
      const scA = sa.metadata?.scope ?? ""
      if (scA !== scB) { scopeChanged++; if (scopeSamples.length < 12) scopeSamples.push(`${rel}:${sb.range?.startLine} ${JSON.stringify(sb.name)} scope ${JSON.stringify(scB)} -> ${JSON.stringify(scA)}`) }
      const lnB = sb.metadata?.nameLine
      const lnA = sa.metadata?.nameLine
      if (lnA !== lnB) { lineChanged++; if (lineSamples.length < 12) lineSamples.push(`${rel}:${sb.range?.startLine} ${JSON.stringify(sb.name)} nameLine ${lnB} -> ${lnA}`) }
    }
    for (const [kk, sa] of mapA) {
      if (seenA.has(kk)) continue
      added++
      if (addSamples.length < 12) addSamples.push(`${rel}:${sa.range?.startLine} [${sa.kind}] ${JSON.stringify(sa.name)}`)
    }
  }
}

rmSync(TMP, { force: true })

console.log(`files=${nFiles}`)
console.log(`symbols: before=${symsB} after=${symsA} (delta ${symsA - symsB})`)
console.log(`edges:   before=${edgesB} after=${edgesA} (delta ${edgesA - edgesB})`)
console.log(`NON-macro whitespace symbol names: before=${wsB} after=${wsA}`)
console.log(`renamed=${renamed} lost=${lost} added=${added} scopeChanged=${scopeChanged} nameLineChanged=${lineChanged}`)
console.log(`\n-- renamed (sample) --`)
for (const s of renameSamples) console.log("  " + s)
console.log(`\n-- lost (sample) --`)
for (const s of lossSamples) console.log("  " + s)
console.log(`\n-- added (sample) --`)
for (const s of addSamples) console.log("  " + s)
console.log(`\n-- scope changed (sample) --`)
for (const s of scopeSamples) console.log("  " + s)
console.log(`\n-- nameLine changed (sample) --`)
for (const s of lineSamples) console.log("  " + s)
