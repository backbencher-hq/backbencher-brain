// NIM analyzer A/B performance — two analyzer versions, one process, interleaved.
//
// Written because a before/after comparison on this box is not trustworthy on
// its own: the same 200-file sample measured 91.5 ms/file and 91.1 ms/file on
// back-to-back runs, while the PER-PHASE distribution swung from
// collectCallsAndUses 28.9% to 20.3% and collectDeclarations 15.3% to 20.1% with
// no code change in between. The machine's noise is larger than the effect being
// chased, so "it got faster" is unfalsifiable unless the comparison is immune to
// it. Interleaving the two versions inside one process and taking each one's
// MINIMUM over repeated trials is immune: both see the same neighbours' load, and
// a minimum is the least contaminated sample rather than the average.
//
// It is also the correctness check. The two versions run on the SAME trees and
// their outputs are compared field by field, so an optimization that changes a
// single symbol kind, relationship type, target, line or confidence fails here
// rather than in a fixture three commits later. Speed with identical output is
// the only acceptable result; the ratio is reported either way.
//
//   npx tsx script/m12/nim-perf-ab.mts [baselineRef] [repo] [files] [trials]
//
// baselineRef defaults to HEAD, i.e. "is the working tree faster than what is
// committed?". The baseline is extracted with `git show` into a temporary sibling
// module and deleted afterwards, so it resolves the same relative imports.
import { readFileSync, readdirSync, existsSync, unlinkSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

const ROOT = process.cwd()
const REF = process.argv[2] ?? "HEAD"
const REPO = process.argv[3] ?? "$HOME/fixtures/repositories/nim"
const N = parseInt(process.argv[4] ?? "200", 10)
const TRIALS = parseInt(process.argv[5] ?? "3", 10)

const BASELINE_PATH = path.join(ROOT, "src/ast/__perf_baseline_nim.ts")
const CURRENT_PATH = path.join(ROOT, "src/ast/real-nim-analyzer.ts")

if (!existsSync(REPO)) {
  console.error(`no such repo: ${REPO}`)
  process.exit(1)
}

let baselineSource = ""
try {
  baselineSource = execFileSync("git", ["show", `${REF}:src/ast/real-nim-analyzer.ts`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
} catch (e) {
  console.error(`cannot read ${REF}:src/ast/real-nim-analyzer.ts — ${(e as Error).message}`)
  process.exit(1)
}
if (baselineSource === readFileSync(CURRENT_PATH, "utf8")) {
  console.error(`the working tree is IDENTICAL to ${REF} — there is nothing to compare. Commit first, or pass a ref that differs.`)
  process.exit(1)
}
writeFileSync(BASELINE_PATH, baselineSource)

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const Lang = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.resolve(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await Lang.load(readFileSync(path.resolve(ROOT, "wasm/tree-sitter-nim.wasm"))))

const files: string[] = []
;(function walk(dir: string): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git") continue
    const f = path.join(dir, e.name)
    if (e.isDirectory()) walk(f)
    else if (e.name.endsWith(".nim")) files.push(f)
  }
})(REPO)
const sample = files.sort().filter((_, i) => i % Math.max(1, Math.floor(files.length / N)) === 0).slice(0, N)
const srcs = sample.map((f) => [f, readFileSync(f, "utf8")] as const)
const trees = srcs.map(([, s]) => parser.parse(s))

const curMod: any = await import(CURRENT_PATH)
const baseMod: any = await import(BASELINE_PATH)
const CUR = new curMod.RealNimAnalyzer()
const BASE = new baseMod.RealNimAnalyzer()

const runAll = async (A: any): Promise<{ ms: number; out: any[] }> => {
  const out: any[] = []
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < trees.length; i++) {
    out.push(await A.analyze(trees[i].rootNode, srcs[i][1], srcs[i][0]))
  }
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, out }
}

// warm both, so neither pays JIT/tier-up inside a measured trial
for (let i = 0; i < 15; i++) {
  await runAll(CUR)
  await runAll(BASE)
}

const curTimes: number[] = []
const baseTimes: number[] = []
let curOut: any[] = []
let baseOut: any[] = []
for (let t = 0; t < TRIALS; t++) {
  // interleaved: A then B, so a load spike hits both neighbours equally
  const a = await runAll(CUR)
  const b = await runAll(BASE)
  curTimes.push(a.ms)
  baseTimes.push(b.ms)
  curOut = a.out
  baseOut = b.out
}

const min = (xs: number[]) => Math.min(...xs)
const curMin = min(curTimes)
const baseMin = min(baseTimes)

// ── the correctness half: outputs must be IDENTICAL ──────────────────────────
//
// EDGES ARE COMPARED AS SETS, deliberately. When several passes each own a walk,
// the order of edges in the array is an artifact of WHICH PASS FOUND AN EDGE
// FIRST, not a property of the analysis: a fused walk interleaves them, so the
// same correct graph arrives in a different order. Nothing downstream depends on
// it — the store keys rows, the differential compares (label,target) sets, and
// the fixtures test presence — so treating order as semantic would make this
// harness reject a correct change.
//
// Everything else is compared as an exact ORDERED sequence, because there the
// order is real: symbols are emitted in declaration order, and a reordering
// would mean the traversal changed shape rather than the emission interleaving.
const diffs: string[] = []
const sorted = (xs: string[]) => [...xs].sort()
const norm = (r: any) => ({
  symbols: (r.symbols ?? []).map((s: any) => `${s.kind}|${s.name}|${s.ownerName ?? ""}|${s.visibility ?? ""}|${s.complexity ?? ""}|${JSON.stringify(s.decorators ?? [])}|${s.docstring ?? ""}|${JSON.stringify(s.range ?? null)}`),
  relationships: sorted((r.relationships ?? []).map((x: any) => `${x.type}|${x.source}|${x.target}|${x.line_number ?? ""}|${x.confidence ?? ""}|${x.metadata?.evidenceClass ?? ""}`)),
  imports: sorted((r.imports ?? []).map((i: any) => `${i.module}|${JSON.stringify(i.items ?? [])}`)),
  exports: sorted((r.exports ?? []).map((e: any) => `${e.name}`)),
  errors: (r.errors ?? []).length,
})
for (let i = 0; i < trees.length && diffs.length < 12; i++) {
  const a = JSON.stringify(norm(curOut[i]))
  const b = JSON.stringify(norm(baseOut[i]))
  if (a !== b) {
    diffs.push(`${path.basename(srcs[i][0])}: outputs differ`)
    if (diffs.length <= 3) {
      const A = norm(curOut[i])
      const B = norm(baseOut[i])
      for (const k of ["symbols", "relationships", "imports", "exports"] as const) {
        const sa = new Set<string>((A as any)[k] as string[])
        const sb = new Set<string>((B as any)[k] as string[])
        for (const x of sa) if (!sb.has(x)) diffs.push(`    only in CURRENT ${k}: ${x}`)
        for (const x of sb) if (!sa.has(x)) diffs.push(`    only in ${REF} ${k}: ${x}`)
      }
    }
  }
}

const syms = (curOut[0]?.symbols?.length ?? 0)
const totalSym = curOut.reduce((a, r) => a + (r.symbols?.length ?? 0), 0)
const totalRel = curOut.reduce((a, r) => a + (r.relationships?.length ?? 0), 0)
const speedup = baseMin / curMin
const faster = curMin < baseMin

console.log(`files=${trees.length} trials=${TRIALS} ref=${REF}`)
console.log(`  ${REF.padEnd(10)} ${baseTimes.map((x) => x.toFixed(0)).join(" / ")}ms  min ${baseMin.toFixed(0)}ms  ${(baseMin / trees.length).toFixed(1)}ms/file`)
console.log(`  current    ${curTimes.map((x) => x.toFixed(0)).join(" / ")}ms  min ${curMin.toFixed(0)}ms  ${(curMin / trees.length).toFixed(1)}ms/file`)
console.log(`  speedup    ${speedup.toFixed(3)}x  (${faster ? "FASTER" : "SLOWER"} by ${(Math.abs(1 - speedup) * 100).toFixed(1)}%)`)
console.log(`  symbols=${totalSym} relationships=${totalRel}`)
console.log(diffs.length === 0 ? "  outputs IDENTICAL on every file — semantics preserved" : `  OUTPUT DIFFERENCES (${diffs.length}):\n${diffs.slice(0, 14).join("\n")}`)

unlinkSync(BASELINE_PATH)
process.exit(diffs.length === 0 ? 0 : 2)
