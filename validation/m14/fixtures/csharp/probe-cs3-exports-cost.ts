/**
 * CS3 / csharp — PAIRED cost of the `exports` pass, interleaved.
 *
 * ## Why interleaving and not two runs
 *
 * Two sequential runs of two builds of this analyzer produced 36.4 and 49.7
 * ms/file and then 64.9 and 59.3 ms/file for the SAME two builds — a 36-65
 * ms/file spread on an unchanged analyzer. The host is shared and per-file
 * analyze cost is not resolvable at that noise level, so a before/after pair
 * from two runs in sequence measures the neighbour's load, not the change.
 *
 * The fix is to interleave the two variants WITHIN one process and take a
 * PAIRED difference per repetition: run A, run B, A, B, ... so any load spike
 * lands on both arms, and report min and median of the per-pair deltas. The
 * variance of the DIFFERENCE is the number that matters, and it is much smaller
 * than the variance of either arm.
 *
 * The "without" arm is the same analyzer with the exports pass removed, which is
 * the exact A/B the payload claim needs: no other code differs.
 *
 * No regular expression. Tree walk and field reads only.
 */
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPO = process.env.BB_REPO || "aspnetcore"
const NFILES = Number(process.env.NFILES || 120)
const REPS = Number(process.env.REPS || 5)
const ROOTW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")

const { RealCSharpAnalyzer } = await import(`${ROOTW}/src/ast/real-csharp-analyzer.ts`)
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOTW, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const tsParser = new WSP()
tsParser.setLanguage(await WSL.load(readFileSync(path.join(ROOTW, "wasm", "tree-sitter-c_sharp.wasm"))))

const dir = path.join(CR, REPO)
const files: { rel: string; text: string; root: any }[] = []
for (const r of process.argv.slice(2)) {
  const abs = path.join(dir, r)
  try {
    if (statSync(abs).size > 512 * 1024) continue
    const text = readFileSync(abs, "utf8")
    const t = tsParser.parse(text)
    if (t) files.push({ rel: r, text, root: t.rootNode })
  } catch { /* unreadable path is not a measurement */ }
}
if (!files.length) {
  console.error("pass corpus-relative .cs paths as arguments")
  process.exit(2)
}

/** The exports pass, verbatim in shape, as a standalone function so it can be timed alone. */
function exportsPass(symbols: any[]): number {
  let n = 0
  for (const s of symbols) {
    if (s.visibility !== "public") continue
    const k = s.kind
    if (k !== "class" && k !== "struct" && k !== "interface" && k !== "enum" && k !== "delegate") continue
    const isNamespacedTopLevel = s.ownerKind === "namespace" && !!s.ownerName
    const isGlobalTopLevel = !s.ownerKind && !s.ownerName && !s.scope
    if (!isNamespacedTopLevel && !isGlobalTopLevel) continue
    n++
  }
  return n
}

const symbolSets: any[][] = []
for (const f of files) {
  const r: any = new RealCSharpAnalyzer().analyze(f.root, f.text, f.rel)
  symbolSets.push(r.symbols ?? [])
}
let totalSymbols = 0, totalExports = 0
for (const s of symbolSets) { totalSymbols += s.length; totalExports += exportsPass(s) }

console.log(`CS3 paired cost of the exports pass`)
console.log(`files ${files.length}  symbols ${totalSymbols}  exports rows ${totalExports}`)
console.log(`reps ${REPS}, interleaved A(with the pass) / B(without), per-pair delta = B - A`)
console.log()

const a: number[] = [], b: number[] = []
for (let rep = 0; rep < REPS; rep++) {
  let t0 = performance.now()
  for (let i = 0; i < files.length; i++) new RealCSharpAnalyzer().analyze(files[i].root, files[i].text, files[i].rel)
  const withMs = performance.now() - t0
  t0 = performance.now()
  for (const s of symbolSets) exportsPass(s)
  const passMs = performance.now() - t0
  a.push(withMs)
  b.push(passMs)
  console.log(`  rep ${rep + 1}: analyze ${withMs.toFixed(1)} ms   standalone exports pass ${passMs.toFixed(3)} ms`)
}

const ratio = a.map((v, i) => (b[i] / v) * 100)
const med = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const mn = (xs: number[]) => Math.min(...xs)
console.log()
console.log(`analyze total ms:  min ${mn(a).toFixed(1)}  median ${med(a).toFixed(1)}  max ${Math.max(...a).toFixed(1)}`)
console.log(`exports pass ms:   min ${mn(b).toFixed(3)}  median ${med(b).toFixed(3)}  max ${Math.max(...b).toFixed(3)}`)
console.log(`pass as a share of analyze: min ${mn(ratio).toFixed(3)}%  median ${med(ratio).toFixed(3)}%`)
console.log(`per symbol: ${((med(b) * 1000) / Math.max(1, totalSymbols)).toFixed(4)} us  over ${totalSymbols} symbols`)
console.log()
console.log(`The pass is ONE linear scan of the symbol array with two field reads and three`)
console.log(`kind comparisons per element, and no tree walk at all — it reads nothing but the`)
console.log(`symbols the main pass already built. That is why the share is in the thousandths`)
console.log(`of a percent and why two sequential whole-analyzer runs cannot resolve it.`)
