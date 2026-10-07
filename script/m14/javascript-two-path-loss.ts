/**
 * JAVASCRIPT TWO-PATH LOSS — the measurement for "which numbers reach the graph".
 *
 * WHY THIS FILE EXISTS. `script/m14/differential.ts` measures through
 * `ASTEngine.parseFile` (`differential.ts:22090`). The PRODUCT indexes through
 * `pool-worker.parseFile`, which additionally runs `filterNoiseRelationships`
 * (`src/ast/pool-worker.ts:527`). The two are different functions with different
 * outputs, and every differential figure for javascript describes only the first.
 * The lane doc recorded that difference from a probe that lived in the git-excluded
 * `script/m14/tmp/`, so the largest finding in the doc had no committed instrument:
 * a reader could re-run the census and the per-label differential, and neither one
 * would reproduce it. This file is that instrument, and it is lane-owned.
 *
 * WHAT IT MEASURES, per label, on one sample:
 *
 *   ENGINE      rows `ASTEngine.parseFile` produces — what the harness compares.
 *   POOL        rows `pool-worker.parseFile` produces — what the product indexes.
 *   LOST        (source, target, type, line) present in ENGINE, absent in POOL.
 *   NOISE-LEAF  of the LOST rows, how many carry a leaf that is in pool-worker's
 *               own `NOISE_TARGETS` — asked by CALLING `filterNoiseRelationships`,
 *               not by copying its list, because a copy is how an instrument ends
 *               up re-stating a rule that has since moved.
 *   GAINED      rows in POOL absent in ENGINE. Expected 0. A non-zero number means
 *               the two paths disagree in BOTH directions and this file's reading
 *               of the cause ("the filter deletes") is incomplete.
 *
 * AND THE PART THAT DECIDES WHETHER IT MATTERS: a lost row whose target leaf the
 * FILE ITSELF DECLARES is a different defect from one it does not.
 * `filterNoiseRelationships` skips the noise check for a name the file declares
 * (`declaredNames`), so the escape hatch fires for a local `function text() {}`.
 * An IMPORT BINDING is not a declaration this lane publishes, so the hatch cannot
 * fire for it: `import text from "./text.js"` loses both its `imports` edge and
 * every `uses` edge on the same name. The first row is a lost module dependency
 * and the second is a lost read, and both are real rows in a real file.
 *
 * WRITES ONE FILE (validation/m14/tmp/javascript-two-path-<tag>.json). READ-ONLY
 * otherwise. Reads shared files; owns no shared file.
 *
 *   bun run script/m14/javascript-two-path-loss.ts --corpus=<dir> [--sample=N] [--tag=<name>]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile as poolParseFile, filterNoiseRelationships } from "../../src/ast/pool-worker"
import { ASTEngine } from "../../src/ast/engine"
import { decodeSourceText } from "../../src/util/source-text"

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const CR = arg("corpus", "$HOME/fixtures/repositories/svelte")
const TAG = arg("tag", path.basename(CR))
const SAMPLE = parseInt(arg("sample", "600"), 10)
const SIZE_CAP = 512 * 1024
const OUT = `validation/m14/tmp/javascript-two-path-${TAG}.json`

const tracked: string[] = execFileSync("git", ["-C", CR, "ls-files", "-z"], {
  encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
}).split("\0").filter(Boolean)

const admitted: string[] = []
for (const rel of tracked) {
  const abs = path.join(CR, rel)
  try {
    if (statSync(abs).size > SIZE_CAP) continue
    if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "javascript") continue
  } catch { continue }
  admitted.push(rel)
}
admitted.sort()
const sample = admitted.slice(0, SAMPLE)

console.log(`javascript two-path loss — ${TAG}`)
console.log(`corpus: ${CR}`)
console.log(`tracked ${tracked.length}   admitted ${admitted.length}   sample ${sample.length}\n`)

const key = (r: any): string =>
  `${String(r.source ?? "")}|${String(r.target ?? "")}|${String(r.type ?? r.relationshipType ?? "")}|${r.line_number ?? ""}`

type Row = { type: Type; source: string; target: string; line?: number; declaredHere: boolean; survivesFilter: boolean }
const engineRows: Row[] = []
const poolRows: Row[] = []
/** source -> declared symbol names, so the escape hatch can be attributed. */
const declaredByFile = new Map<string, Set<string>>()

let idx = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= sample.length) return
    const rel = sample[i]
    const abs = path.join(CR, rel)
    let engine: any, pool: any, declared: Set<string>
    try {
      const content = decodeSourceText(await import("fs/promises").then((fs) => fs.readFile(abs))).text
      engine = await ASTEngine.parseFile(abs, content)
      pool = await poolParseFile(abs, CR)
      declared = new Set((engine?.symbols ?? []).map((s: any) => String(s?.name ?? "")).filter(Boolean))
    } catch { continue }
    declaredByFile.set(rel, declared)
    for (const r of engine?.relationships ?? []) {
      const t = String(r.type ?? r.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      engineRows.push({
        type: t, source: String(r.source ?? ""), target: String(r.target ?? ""),
        line: r.line_number, declaredHere: declared.has(String(r.target ?? "")),
        survivesFilter: false,
      })
    }
    for (const r of pool?.relationships ?? []) {
      const t = String(r.type ?? r.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      poolRows.push({
        type: t, source: String(r.source ?? ""), target: String(r.target ?? ""),
        line: r.line_number, declaredHere: declared.has(String(r.target ?? "")),
        survivesFilter: false,
      })
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

// Ask pool-worker's OWN filter which rows it would delete, rather than restating
// NOISE_TARGETS here. `filterNoiseRelationships` is exported for exactly this.
const survivors = filterNoiseRelationships(engineRows as any, "javascript")
const survivorKeys = new Set(survivors.map((r: any) => key(r)))
const byKey = new Map<string, Row>()
for (const r of engineRows) if (!byKey.has(key(r))) byKey.set(key(r), r)
const lost: Row[] = []
for (const [k, r] of byKey) if (!survivorKeys.has(k)) { r.survivesFilter = false; lost.push(r) }

const poolKeySet = new Set(poolRows.map((r: any) => key(r)))
const gained = [...byKey.entries()].filter(([k]) => !poolKeySet.has(k) && survivorKeys.has(k)).map(([, r]) => r)

type TypeRow = {
  n: number
  engine: number
  pool: number
  lost: number
  gained: number
  noiseLeafLost: number
  declaredLost: number
  byTargetLeaf: Record<string, number>
}
const fresh = (): TypeRow => ({ n: 0, engine: 0, pool: 0, lost: 0, gained: 0, noiseLeafLost: 0, declaredLost: 0, byTargetLeaf: {} })
const perType = new Map<Type, TypeRow>()
for (const t of ALL_TYPES) perType.set(t, fresh())
for (const r of engineRows) perType.get(r.type)!.engine++
for (const r of poolRows) perType.get(r.type)!.pool++
for (const r of lost) {
  const row = perType.get(r.type)!
  row.lost++
  const leaf = r.target.includes(".") ? r.target.slice(r.target.lastIndexOf(".") + 1)
    : r.target.includes(":") ? r.target.slice(r.target.lastIndexOf(":") + 1)
    : r.target
  row.byTargetLeaf[leaf] = (row.byTargetLeaf[leaf] ?? 0) + 1
  // The escape hatch: would the filter keep this row if the FILE declared the name?
  const keep = filterNoiseRelationships([{ ...r, target: leaf }] as any, "javascript", new Set([leaf]))
  if (keep.length > 0) row.declaredLost++
  else row.noiseLeafLost++
}
for (const r of gained) perType.get(r.type)!.gained++

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`${pad("type", 13)}${pad("engine", 9)}${pad("pool", 8)}${pad("lost", 7)}${pad("gained", 8)}${pad("noise-leaf", 12)}${pad("would-survive-if-declared", 28)}top leaves`)
console.log("-".repeat(150))
const lostTotal = { engine: 0, pool: 0, lost: 0, gained: 0 }
for (const t of ALL_TYPES) {
  const r = perType.get(t)!
  if (r.engine === 0 && r.lost === 0) continue
  lostTotal.engine += r.engine; lostTotal.pool += r.pool; lostTotal.lost += r.lost; lostTotal.gained += r.gained
  const top = Object.entries(r.byTargetLeaf).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join(" ")
  console.log(`${pad(t, 13)}${pad(r.engine.toLocaleString(), 9)}${pad(r.pool.toLocaleString(), 8)}${pad(r.lost.toLocaleString(), 7)}${pad(r.gained.toLocaleString(), 8)}${pad(r.noiseLeafLost.toLocaleString(), 12)}${pad(r.declaredLost.toLocaleString(), 28)}${top}`)
}
console.log("-".repeat(150))
console.log(`TOTAL        ${pad(lostTotal.engine.toLocaleString(), 9)}${pad(lostTotal.pool.toLocaleString(), 8)}${pad(lostTotal.lost.toLocaleString(), 7)}${pad(lostTotal.gained.toLocaleString(), 8)}`)
const pct = lostTotal.engine ? (100 * lostTotal.lost) / lostTotal.engine : 0
console.log(`lost ${lostTotal.lost} of ${lostTotal.engine} = ${pct.toFixed(3)}%   gained ${lostTotal.gained} (0 means the filter only deletes)`)
console.log(`\nsample: ${sample.length} files, hash-relevant set = first ${sample.length} admitted (sorted)`)

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({
  at: new Date().toISOString(), tag: TAG, corpus: CR, sampleFiles: sample.length,
  admittedFiles: admitted.length, totals: lostTotal, lostPercent: pct,
  perType, note: "LOST = present through ASTEngine.parseFile, absent through pool-worker.parseFile. NOISE-LEAF = the filter drops it and would still drop it if the file declared the leaf; would-survive-if-declared = the filter's escape hatch would keep it, so the deletion is the hatch being unreachable for a name the file only READS or BINDS.",
  examples: lost.slice(0, 25).map((r) => `${r.type} ${r.source} -> ${r.target} @${r.line ?? "?"}`),
}, null, 2))
console.log(`\nwrote ${OUT}`)