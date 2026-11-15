/**
 * NIM EXTENSION SPLIT — what the SHARED differential's extension map drops.
 *
 * ## Why this exists
 *
 * `src/ast/language-detection.ts:53` routes three extensions to this analyzer:
 *
 *     nim: "nim", nims: "nim", nimble: "nim",
 *
 * and `census.ts` selects its corpus by that function, so every number in
 * `docs/analyzers/nim.md` covers all three. But
 * `script/m14/differential.ts:25174` — the shared differential's own language
 * map, which is workstream §8 and is not edited here — declares:
 *
 *     nim: { ..., ext: "nim,nims" }
 *
 * so `nimble` is absent from the extension list the differential sweeps. The
 * corpus holds 166 tracked `.nimble` files, so the differential walks 51 fewer
 * files than this lane's own census does.
 *
 * A file count is the cheap half of that statement. This script measures the
 * other half: how many symbols and how many edges of each of the TEN types live
 * in the files the shared map does not name. That is what a reader needs in
 * order to judge whether the omission is worth fixing, and it is a per-type
 * number rather than a single total because the ten types are not equally
 * present in a NimScript or a `.nimble` package file.
 *
 * ## Method
 *
 * Same walk as `census.ts` — `git ls-files`, `detectLanguageFromPath`, a 512 KB
 * cap — and the same production entry point `parseFile` from
 * `src/ast/pool-worker`, NOT `analyze()`. The file is split by extension AFTER
 * the language test, so the three groups partition exactly the census's own file
 * set and the three edge totals sum to the census total. That sum is the
 * instrument's own check: if it does not reconcile, this script is wrong.
 *
 * NO REGEX. The extension is derived with `path.extname`, not a pattern.
 *
 * ## What it deliberately does NOT claim
 *
 * It does not claim the differential is wrong to sweep fewer files. A `.nimble`
 * is a package manifest and a `.nims` is a build script; whether the
 * differential's ORACLE should audit them is the supervisor's decision, not this
 * lane's. It reports the size of what that decision is about.
 *
 * READ-ONLY except an optional JSON path in argv[2].
 *
 * Run: BB_NIM_WORKERS=1 npx tsx validation/m14/fixtures/nim/extension-split.ts [out.json]
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const WORKERS = Math.max(1, Number(process.env.BB_NIM_WORKERS ?? 6) || 6)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "nim"
const OUT = process.argv[2] && process.argv[2].endsWith(".json") ? process.argv[2] : null

const ANALYZER = path.resolve(process.cwd(), "src/ast/real-nim-analyzer.ts")
const HASH_BEFORE = createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
const analyzerHash = (): string => createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")

/** The extensions language-detection routes here, and the two groups the shared
 *  differential's `ext: "nim,nims"` map makes of them. */
const EXTS = [".nim", ".nims", ".nimble"] as const
type Ext = (typeof EXTS)[number]
/** What `script/m14/differential.ts:25174` names. A file whose extension is
 *  absent from this list is not swept by the shared differential. */
const SHARED_MAP_SWEEPS: ReadonlySet<string> = new Set([".nim", ".nims"])

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const

// ─────────────────────────────────────────────────────────────── corpus walk
const files: { repo: string; dir: string; rel: string; abs: string; text: string; ext: Ext }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    const ext = path.extname(rel).toLowerCase() as Ext
    // A file the detector routed here whose extension is not one of the three is
    // counted under `.other` rather than dropped, so the partition is total and
    // the reconciliation below can fail if the assumption is wrong.
    files.push({ repo: e, dir, rel, abs, text, ext: (EXTS as readonly string[]).includes(ext) ? ext : (".other" as Ext) })
  }
}

// ─────────────────────────────────────────────────────────────── accumulators
const blank = (): Record<string, number> => {
  const o: Record<string, number> = { files: 0, symbols: 0, edges: 0 }
  for (const t of ALL_TYPES) o[t] = 0
  return o
}
const byExt: Record<string, ReturnType<typeof blank>> = {}
for (const x of [...EXTS, ".other"]) byExt[x] = blank()

let parseFailures = 0
const failLabels: string[] = []
let idx = 0

async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch {
      parseFailures++
      if (failLabels.length < 10) failLabels.push(`${f.repo}/${f.rel}`)
      continue
    }
    const row = byExt[f.ext]
    row.files++
    row.symbols += (r.symbols ?? []).length
    for (const x of r.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase()
      row.edges++
      if ((ALL_TYPES as readonly string[]).includes(t)) row[t]++
    }
  }
}

await Promise.all(Array.from({ length: WORKERS }, () => worker()))

const swept = EXTS.filter((e) => SHARED_MAP_SWEEPS.has(e))
const dropped = EXTS.filter((e) => !SHARED_MAP_SWEEPS.has(e))
const sum = (xs: Ext[], k: string): number => xs.reduce((a, e) => a + byExt[e][k], 0)

const body = {
  lang: LANG,
  corpusRoot: CR,
  analyzerSha256: HASH_BEFORE,
  analyzerStableDuringRun: HASH_BEFORE === analyzerHash(),
  workers: WORKERS,
  sharedDifferentialMap: { file: "script/m14/differential.ts", line: 25174, ext: "nim,nims" },
  sharedMapSweeps: swept,
  sharedMapDrops: dropped,
  files: files.length,
  parseFailures,
  parseFailureExamples: failLabels,
  byExtension: byExt,
  reconciliation: {
    totalFiles: sum([...EXTS, ".other"] as Ext[], "files"),
    censusFiles: files.length,
    filesReconcile: sum([...EXTS, ".other"] as Ext[], "files") === files.length,
    sweptFiles: sum(swept, "files"),
    droppedFiles: sum(dropped, "files"),
    sweptEdges: sum(swept, "edges"),
    droppedEdges: sum(dropped, "edges"),
    totalEdges: sum([...EXTS, ".other"] as Ext[], "edges"),
  },
}

console.log(`nim extension split — production parseFile`)
console.log(`analyzer    : sha256:${HASH_BEFORE.slice(0, 16)}`)
console.log(`corpus      : ${CR}`)
console.log(`workers     : ${WORKERS}`)
console.log(`files       : ${files.length}   parse failures: ${parseFailures}`)
console.log(``)
console.log(`script/m14/differential.ts:25174 declares ext: "nim,nims". This walk, which`)
console.log(`selects by detectLanguageFromPath exactly as census.ts does, covers:`)
console.log(``)
const w = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)
console.log(`${w("ext", 9)}${w("files", 8)}${w("symbols", 10)}${w("edges", 9)}  swept by the shared map`)
for (const e of [...EXTS, ".other"]) {
  const r = byExt[e]
  console.log(`${w(e, 9)}${String(r.files).padStart(6)}  ${String(r.symbols).padStart(8)}  ${String(r.edges).padStart(7)}   ${SHARED_MAP_SWEEPS.has(e) ? "yes" : "NO"}`)
}
console.log(``)
console.log(`swept  (.nim .nims)   : ${body.reconciliation.sweptFiles} files, ${body.reconciliation.sweptEdges} edges`)
console.log(`DROPPED (.nimble)     : ${body.reconciliation.droppedFiles} files, ${body.reconciliation.droppedEdges} edges`)
console.log(``)
console.log(`per type, in the DROPPED files only:`)
for (const t of ALL_TYPES) {
  const d = sum(dropped, t)
  if (d === 0) continue
  const tot = sum([...EXTS, ".other"] as Ext[], t)
  const pct = tot === 0 ? "0.0" : (100 * d / tot).toFixed(2)
  console.log(`  ${w(t, 14)}${String(d).padStart(6)} edges   ${pct.padStart(6)}% of all ${tot} ${t} edges in the corpus`)
}
console.log(``)
console.log(`files reconcile : ${body.reconciliation.filesReconcile}  (${body.reconciliation.totalFiles} == ${files.length})`)
console.log(`analyzer sha256 after the walk : ${HASH_BEFORE.slice(0, 16)}${body.analyzerStableDuringRun ? "  (unchanged)" : "  CHANGED DURING THE RUN"}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify(body, null, 2))
  console.log(`\nwrote ${OUT}`)
}
