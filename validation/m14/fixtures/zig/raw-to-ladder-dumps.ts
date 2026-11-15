/**
 * RAW DUMPS -> MISS-CAUSE LADDER DUMPS.
 *
 * ## Why this exists
 *
 * `ontology-census.ts --raw` and `analyzer-owned-miss-cause.ts` disagree about
 * the dump SHAPE, and the disagreement is not cosmetic:
 *
 *   - the census writes `drawHash`; the ladder reads `popHash`
 *   - the census keys every edge by its shard-local file INDEX; the ladder reads
 *     a file KEY string
 *   - the census writes `fallbackFiles` as a COUNT; the ladder reads an ARRAY
 *     and refuses the run when it is non-empty
 *
 * So the ladder had been reading dumps from an OLDER generation of the census,
 * which is the pass-19 §B defect class one level down: not a wrong default path
 * this time, but an instrument pair that cannot both be current. Converting
 * rather than forking the ladder keeps ONE miss-cause implementation and makes
 * the transform a stated, checkable artifact rather than a divergence between
 * two readers.
 *
 * ## What it checks before writing anything
 *
 * The population hash, because a ladder run over a truncated union is a correct
 * number about the wrong files — and it says so by refusing rather than by
 * printing a caveat. It also refuses if any shard reported fallback, since that
 * shard measured `extractFallback` and not the analyzer.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/raw-to-ladder-dumps.ts <rawdir> <outdir>
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"

const rawDir = process.argv[2]
const outDir = process.argv[3]
/** The published draw hash, as an ARGUMENT. Its absence is fatal, and for the
 *  reason shard-merge.py records: a guard that reads `if (published && …)` never
 *  runs, and the artifact field saying `null` is the only trace it leaves. */
const RAW_PUB = process.argv[4] ?? ""
const PUBLISHED = RAW_PUB.startsWith("sha256:") ? RAW_PUB.slice("sha256:".length) : RAW_PUB
if (!rawDir || !outDir || !PUBLISHED) {
  console.error("usage: raw-to-ladder-dumps.ts <rawdir with raw-N.json> <outdir> <published sha256:...>")
  process.exit(2)
}

// `startsWith`/`endsWith`, the filter the rest of this lane uses on artifact names.
const shards = readdirSync(rawDir).filter((f) => f.startsWith("raw-") && f.endsWith(".json")).sort()
if (shards.length === 0) {
  console.error(`REFUSING: no raw-N.json in ${rawDir}`)
  process.exit(2)
}

mkdirSync(outDir, { recursive: true })

type Raw = {
  drawHash: string
  drawFiles: string[]
  /** Stamped by the census; see its header. Carried through so a ladder can tell
   *  WHICH definition of `declaredNames` its input was built under. */
  declaredNamesDefinition?: string
  filesParsed: number
  corpusFilesAdmitted: number
  fallbackFiles: number
  files: { key: string; symbols: unknown[]; declaredNames: [string, string][] }[]
  /** `line`/`c`/`m`/`s` are NULLABLE and were nullable because the census did not
   *  write them at all until pass 26. The consequence was measured both ways on the
   *  same 3,834-file population: `incoming-resolve.ts` read `targetScope ABSENT
   *  395974` — every edge — over dumps built without them, and 0 absent over dumps
   *  built with them. `conf<0.7` reads 0 in BOTH runs, so that one is a property of
   *  the analyzer's value range (nothing below 0.75), not of this transform. Nullable
   *  keeps "not recorded" visibly different from a recorded 0 or a recorded 0.0. */
  edges: { t: string; src: string; tgt: string; file: number; line: number | null; c: number | null; m: unknown; s: string | null }[]
}

const raws: Raw[] = []
for (const shard of shards) {
  const raw = JSON.parse(readFileSync(path.join(rawDir, shard), "utf8")) as Raw
  if (!raw.drawHash) {
    console.error(`REFUSING: ${shard} carries no drawHash — it is the census REPORT, not the --raw dump.`)
    process.exit(2)
  }
  raws.push(raw)
}

// EVERY refusal runs before a single file is written. A converter that has
// already written three of eight shards and then refuses leaves the output
// directory holding a partial population, and the next reader merges it.
const allDrawFiles = raws.flatMap((r) => r.drawFiles)
const admitted = new Set(raws.map((r) => r.corpusFilesAdmitted))
const fallbackTotal = raws.reduce((a, r) => a + (r.fallbackFiles ?? 0), 0)

// `drawHash` is PER SHARD — each shard hashed its own file list — so comparing
// them to each other is meaningless, and a first version of this converter did
// exactly that and refused eight shards that partitioned the draw perfectly.
// What has to hold is that the shards cover one published draw, which is the
// union rule `shard-merge.py` uses: sha256 over the sorted, de-duplicated union
// of every shard's `drawFiles`.
const union = [...new Set(allDrawFiles)].sort()
const unionHash = createHash("sha256").update(union.join("\n")).digest("hex")

// The shards partition ONE draw, so a definition stamped differently on two of
// them means the shards came from different generations of the census, and every
// rung count merged from them would be a comparison across a definition change
// that no column records. Refuse rather than merge.
const defs = new Set(raws.map((r) => r.declaredNamesDefinition ?? null))
if (defs.size !== 1) {
  console.error(`REFUSING: shards disagree on declaredNamesDefinition: ${[...defs].map((d) => JSON.stringify(d)).join(", ")}`)
  console.error("         The shards were produced by different generations of the census, so a rung")
  console.error("         count merged from them compares two definitions of the column. Re-draw them.")
  process.exit(2)
}

if (admitted.size !== 1) {
  console.error(`REFUSING: shards disagree on corpusFilesAdmitted: ${[...admitted].join(", ")}`)
  process.exit(2)
}
if (unionHash !== PUBLISHED) {
  console.error(`REFUSING: union hash ${unionHash} != published ${PUBLISHED}`)
  console.error(`         The shards cover ${union.length} files, not the published draw, so every`)
  console.error("         number a ladder run derives from them would be about the wrong files.")
  process.exit(2)
}
if (fallbackTotal > 0) {
  console.error(`REFUSING: ${fallbackTotal} shard-file(s) reported parseFile fallback — they measured`)
  console.error("         extractFallback, not the analyzer, so the ladder would classify noise.")
  process.exit(2)
}

// Z65. Same rule as the three refusals above, and it was WRITTEN IN THE WRONG PLACE
// the first time: this check sat after the write loop, so it exited 2 with all eight
// `dump-N.json` already on disk — its own header's invariant ("EVERY refusal runs
// before a single file is written") broken by the refusal added last. A partial
// population is exactly what the next reader merges, so a guard that fires after
// the write is worse than no guard: it looks like it held. Measured on the
// pre-Z65 dumps: exit 2, 8 of 8 dumps written.
const keyCover = (() => {
  let line = 0, conf = 0, meta = 0, scope = 0, n = 0
  for (const r of raws) for (const e of (r.edges ?? [])) {
    n++
    if (e.line !== undefined && e.line !== null) line++
    if (e.c !== undefined && e.c !== null) conf++
    if (e.m !== undefined && e.m !== null) meta++
    if (e.s !== undefined && e.s !== null) scope++
  }
  return { line, conf, meta, scope, n }
})()
if (keyCover.n > 0 && keyCover.conf === 0) {
  console.error(`REFUSING: 0 of ${keyCover.n} edge records carry a confidence.`)
  console.error("         `incoming-resolve.ts`'s per-type `conf<0.7` column would read 0 for")
  console.error("         every type and mean nothing. Re-draw the raws with a census that writes them.")
  process.exit(2)
}
if (keyCover.n > 0 && keyCover.scope === 0) {
  console.error(`REFUSING: 0 of ${keyCover.n} edge records carry targetScope. The Z65 column would`)
  console.error("         report ABSENT for every edge, which reads as a finding about the analyzer")
  console.error("         and is a fact about the census instead. Re-draw the raws.")
  process.exit(2)
}

let edgeTotal = 0
let fileTotal = 0
for (let i = 0; i < raws.length; i++) {
  const raw = raws[i]
  const keys = raw.drawFiles
  // The census records the FALLBACK COUNT per shard, not which files. The ladder
  // only needs the array to be non-empty to refuse, so one sentinel entry per
  // fallback file says exactly as much as the count did.
  const fallbackFiles: string[] = []
  for (let k = 0; k < (raw.fallbackFiles ?? 0); k++) fallbackFiles.push(`(fallback ${k + 1} in ${shards[i]})`)
  const out = {
    popHash: unionHash,
    declaredNamesDefinition: raw.declaredNamesDefinition ?? null,
    filesParsed: raw.filesParsed,
    files: raw.files,
    edges: raw.edges.map((e) => ({
      file: keys[e.file],
      source: e.src,
      target: e.tgt,
      type: e.t,
      line: e.line,
      conf: e.c,
      meta: e.m,
      scope: e.s,
    })),
    fallbackFiles,
  }
  edgeTotal += out.edges.length
  fileTotal += out.files.length
  writeFileSync(path.join(outDir, `dump-${shards[i].slice("raw-".length)}`), JSON.stringify(out) + "\n")
}

console.log(`converted ${shards.length} shard(s) -> ${outDir}`)
console.log(`  union of ${shards.length} shards: ${union.length} files  sha256:${unionHash}`)
console.log(`  == published draw  sha256:${PUBLISHED}`)
console.log(`  declaredNames definition carried: ${JSON.stringify([...defs][0])}`)
console.log(`  per-edge keys present: line ${keyCover.line}/${keyCover.n}  conf ${keyCover.conf}/${keyCover.n}  meta ${keyCover.meta}/${keyCover.n}  scope ${keyCover.scope}/${keyCover.n}`)
console.log(`  ${fileTotal} file records · ${edgeTotal} edges · fallback 0`)
