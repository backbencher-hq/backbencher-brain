/**
 * JULIA `overrides` DIFFERENTIAL — the DERIVATION finding, paid down.
 *
 * ## What this is for
 *
 * `overrides` was the lane's one DERIVATION finding: the analyzer emits the type, the graph stores
 * the edges, and nothing compared them against an independent derivation. A DERIVATION edge is stored
 * and compared against nothing, which is a state that reads exactly like coverage — and the previous
 * version of this lane DECLINED the type on prose, which is the failure
 * `script/m14/ontology-coverage-gate.ts`'s header records as BD8b for bash.
 *
 * `script/m14/oracles/julia-overrides.ts` is the independent derivation, written from julia's method
 * table rule and sharing no rule set, key set, guard list or resolver with `RealJuliaAnalyzer`. This
 * script is what makes it comparable: it drives BOTH sides over the same corpus and reports the
 * disagreement in both directions, because an oracle that is only ever checked for "did the analyzer
 * find what the oracle found" cannot see an edge the ANALYZER invented.
 *
 * It runs the oracle over the whole admitted corpus rather than a sample, because the surface is
 * THREE edges: a sample of 971 files at 3 edges would be a sample of everything, and the honest
 * denominator is the population.
 *
 * ## The limitation, declared rather than implied
 *
 * The oracle is a SECOND WALKER OVER THE SAME GRAMMAR. It can disagree with the analyzer when either
 * is wrong, and it is BLIND when a construct is absent from both — which is exactly how the original
 * omission survived a differential that was green throughout. A 3-of-3 agreement here is evidence
 * that the three edges are real and correctly shaped. It is NOT evidence that no fourth edge exists,
 * and nothing in this file can be.
 *
 * USAGE
 *   npx tsx validation/m14/fixtures/julia/overrides-differential.ts [--json <path>]
 *   BB_JULIA_WORKERS=1 npx tsx validation/m14/fixtures/julia/overrides-differential.ts
 *
 * READ-ONLY. Writes only to the path given by `--json`.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { deriveJuliaOverridesTruth } from "../../../../script/m14/oracles/julia-overrides"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const jsonOut = (() => {
  const i = process.argv.indexOf("--json")
  return i >= 0 ? process.argv[i + 1] : null
})()
const LIMIT = Number(process.env.BB_CENSUS_LIMIT ?? 0) || 0

/**
 * Worker count, and why it is 1 rather than the 4 this file used to hardcode.
 *
 * `const WORKERS = 4` was a constant, so a re-run reproduced the committed numbers only by
 * reproducing the constant. But width 4 is the width `docs/analyzers/julia.md`
 * §8 row 2 MEASURED to degrade: 4 degraded parses in 7,940 against width 1's 0 in 7,940, and 4 in
 * 7,940 again on a second interleaved pair. On 2026-10-04 this file at width 4 printed THREE
 * `[BB-PARSE-ERR] memory access out of bounds` lines — `Graphs.jl/test/community/louvain.jl`,
 * `StaticArrays.jl/test/matrix_multiply_add.jl`, `StaticArrays.jl/test/pinv.jl` — and then died to
 * `[BB-HANG]` with **no totals at all**, so the agreement count it exists to produce was not a small
 * number but no number.
 *
 * A hardcoded width that has been measured to fail is not reproducibility, it is a coin re-run
 * until it lands. `BB_JULIA_WORKERS` matches `census.ts` so both instruments are steered the same
 * way, and the default is the width that completes.
 */
const WORKERS = Number(process.env.BB_JULIA_WORKERS ?? 1)

/**
 * ORPHANED-BOMB SURVIVAL — the same survival `census.ts` installs, and for the same reason.
 *
 * `src/ast/engine.ts:1441-1447` arms a 120 s `process.exit(1)` BEFORE `parser.parse(content)` and
 * clears it AFTER, so a parse that THROWS leaves its bomb armed. `parseFile` catches the throw, logs
 * `[BB-PARSE-ERR]`, returns `extractFallback`, and the orphan kills the process 120 s later — naming
 * whichever file armed the OLDEST surviving bomb, not the file that threw. This file prints its
 * report AFTER the walk, so the bomb fires before there is anything to read.
 *
 * Without this, one degraded file out of 1,985 costs the whole measurement, and the cost is
 * invisible: the run prints parse errors, prints a hang, prints nothing else, and exits 1. That is
 * the shape recorded as run 5 in the analyzer doc's degraded-run table, and this instrument
 * reproduced it. The exit is stubbed for the duration of the callback, the fire is RECORDED, and the
 * run finishes — so a degraded file becomes a number with a filename attached instead of a silence.
 * Nothing is suppressed: every fire is printed with its count beside the degraded count, because a
 * fire is the SIGNAL and the degraded list is what names the file.
 *
 * Installed before `parseFile` is imported, so there is no module-init ordering question.
 */
const BOMB_MS = 120000
const bombFires: { at: number; named: string; exitCode: number | null }[] = []
{
  const realSetTimeout = globalThis.setTimeout
  const realWrite = process.stderr.write.bind(process.stderr)
  let lastHangName = "<none>"
  ;(process.stderr as any).write = function (chunk: any, ...rest: any[]): boolean {
    const text = typeof chunk === "string" ? chunk : String(chunk)
    if (text.includes("[BB-HANG]")) lastHangName = text.split("on ")[1]?.split(" —")[0] ?? "<unparsed>"
    return realWrite(chunk, ...rest) as unknown as boolean
  }
  ;(globalThis as any).setTimeout = function (fn: any, ms?: number, ...rest: any[]) {
    if (ms !== BOMB_MS) return realSetTimeout(fn, ms, ...rest)
    lastHangName = "<none>"
    return realSetTimeout(
      () => {
        const realExit = process.exit
        const record = { code: null as number | null }
        ;(process as any).exit = function (code?: number): never {
          record.code = typeof code === "number" ? code : 0
          return undefined as never
        }
        try {
          fn()
        } catch {
          /* the real exit is stubbed; anything it throws is the stub, not a finding */
        } finally {
          ;(process as any).exit = realExit
        }
        bombFires.push({ at: Date.now(), named: lastHangName, exitCode: record.code })
      },
      ms,
      ...rest,
    )
  }
}

const files: { repo: string; rel: string; abs: string; dir: string; text: string }[] = []
let skippedLarge = 0
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) { skippedLarge++; continue }
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "julia") continue
    files.push({ repo: e, rel, abs, dir, text })
  }
}
const admitted = files.length
if (LIMIT > 0) files.length = Math.min(files.length, LIMIT)
console.log(`julia overrides differential`)
console.log(`corpus root: ${CR}`)
console.log(`admitted files: ${admitted}${admitted !== files.length ? `  *** TRUNCATED to ${files.length} — NOT the population ***` : ""}   excluded: >512 KB (${skippedLarge})`)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-julia.wasm"))))

type Row = { file: string; line: number; from: string; target: string; signature?: string; replacesLine?: number; via?: string }
const analyzerRows: Row[] = []
const truthRows: Row[] = []
let parseFailures = 0
let idx = 0

async function worker() {
  const local = new WSP()
  local.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-julia.wasm"))))
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let r: any = null
    try {
      r = await parseFile(f.abs, f.dir)
    } catch {
      parseFailures++
    }
    for (const x of r?.relationships ?? []) {
      if (String(x.type ?? "") !== "overrides") continue
      const md = (x.metadata ?? {}) as Record<string, unknown>
      analyzerRows.push({
        file: label, line: Number(x.line_number ?? 0), from: String(x.source), target: String(x.target),
        signature: typeof md.signature === "string" ? md.signature : undefined,
        replacesLine: typeof md.replacesLine === "number" ? md.replacesLine : undefined,
        via: typeof md.via === "string" ? md.via : undefined,
      })
    }
    let t: any = null
    try {
      t = local.parse(f.text)
    } catch {
      t = null
    }
    if (!t) continue
    for (const e of deriveJuliaOverridesTruth(t.rootNode)) {
      truthRows.push({ file: label, line: 0, from: e.from, target: e.target })
    }
    t.delete?.()
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

const key = (r: { file: string; from: string; target: string }) => `${r.file}|${r.from}->${r.target}`
const truthKeys = new Set(truthRows.map(key))
const analyzerKeys = new Set(analyzerRows.map(key))

const covered = analyzerRows.filter((r) => truthKeys.has(key(r)))
const missing = truthRows.filter((r) => !analyzerKeys.has(key(r)))
const unexplained = analyzerRows.filter((r) => !truthKeys.has(key(r)))

console.log(`\nSIDES\n`)
console.log(`  analyzer  \`overrides\` edges via parseFile: ${analyzerRows.length} in ${new Set(analyzerRows.map((r) => r.file)).size} file(s)`)
console.log(`  oracle    \`overrides\` edges independently derived: ${truthRows.length} in ${new Set(truthRows.map((r) => r.file)).size} file(s)`)
console.log(`  parseFile threw: ${parseFailures}`)
console.log(`  width: ${WORKERS} worker(s)${WORKERS > 1 ? "  — a width MEASURED to degrade; see the header" : "  (the width measured clean)"}`)
console.log(
  `  ORPHANED BOMBS that fired during this run: ${bombFires.length} ` +
    `(each fire is the SIGNAL that some file degraded; the file it NAMES is the oldest surviving bomb, NOT the file that threw)`,
)
for (const f of bombFires.slice(0, 12)) {
  console.log(`      named ${f.named}   attempted exit(${f.exitCode ?? 0})`)
}
if (bombFires.length > 12) console.log(`      …and ${bombFires.length - 12} more`)

console.log(`\nAGREEMENT\n`)
console.log(`  COVERED      analyzer edge the oracle also derives: ${covered.length}`)
console.log(`  MISSING      oracle edge the analyzer does not emit: ${missing.length}`)
console.log(`  UNEXPLAINED  analyzer edge the oracle does not derive: ${unexplained.length}`)
const rate = analyzerRows.length ? (100 * covered.length) / analyzerRows.length : 0
console.log(`  covered rate: ${rate.toFixed(1)}%   unexplained rate: ${analyzerRows.length ? (100 * unexplained.length) / analyzerRows.length : 0}%`)
console.log(`  heuristic edges (confidence < 0.7): ${analyzerRows.length ? "see census" : 0} — the analyzer emits \`overrides\` at confidence 1.0 only`)

console.log(`\nEVERY EDGE, BOTH SIDES\n`)
for (const r of analyzerRows) {
  console.log(`  analyzer  ${r.file}:${r.line}  ${r.from} -> ${r.target}  signature=${JSON.stringify(r.signature)} replacesLine=${r.replacesLine} via=${r.via}`)
}
for (const r of truthRows) {
  const mark = analyzerKeys.has(key(r)) ? "AGREES" : "MISSING"
  console.log(`  oracle    ${r.file}  ${r.from} -> ${r.target}  ${mark}`)
}
for (const r of unexplained) {
  console.log(`  !! analyzer edge with NO independent derivation: ${r.file}:${r.line} ${r.from} -> ${r.target}`)
}
for (const r of missing) {
  console.log(`  !! oracle edge the analyzer misses: ${r.file} ${r.from} -> ${r.target}`)
}

const report = {
  corpusRoot: CR,
  admittedFiles: files.length,
  population: admitted === files.length,
  parseFileThrows: parseFailures,
  analyzerEdges: analyzerRows.length,
  oracleEdges: truthRows.length,
  covered: covered.length,
  missing: missing.length,
  unexplained: unexplained.length,
  coveredPct: Number(rate.toFixed(2)),
  analyzerRows,
  truthRows: truthRows.map((r) => ({ ...r, verdict: analyzerKeys.has(key(r)) ? "AGREES" : "MISSING" })),
  limitation:
    "The oracle is a second walker over the SAME grammar. It can disagree when either side is wrong and is " +
    "blind when a construct is absent from both — which is how the original `overrides` omission survived a " +
    "green differential. Agreement here is evidence the edges are real and correctly shaped; it is not " +
    "evidence that no further edge exists.",
}
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(report, null, 2))
  console.log(`\nwrote ${jsonOut}`)
}
process.exitCode = unexplained.length + missing.length === 0 ? 0 : 1
