/**
 * THE CENSUS MERGE — five disjoint chunks of the admitted population, summed.
 *
 * WHAT IT READS. `validation/m14/measurements/html-census/chunk-{0,2000,4000,6000,8000}.json`, each
 * the construct census's own JSON artifact over one slice of the SORTED admitted list. Every
 * counter in the census is ADDITIVE — node counts, block counts, per-file booleans, per-kind
 * breakdowns — so the sum of the five slices IS the whole-population census, and this file
 * checks the slices are disjoint and cover the population rather than asserting it.
 *
 * ★ WHY THE CENSUS IS CHUNKED AT ALL. The census is a whole-population parse, so it needs the
 *   fleet's HEAVY arm, and the heavy arm is ONE at a time with a queue in front of it. So the
 *   census takes the SMALL slot (≤2,000 files per call) and runs as five slices of the same
 *   sorted list the arm takes. The slices are the arm's own `--offset=N` slices, so the census
 *   and the arm are over the same population in the same order.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = process.cwd()
const DIR = "validation/m14/measurements/html-census"
const CHUNKS = [0, 2000, 4000, 6000, 8000]
const OUT = "validation/m14/measurements/html-extended-constructs-2026-10-22.json"

type Json = Record<string, any>

const numericKeys = new Set([
  "files", "filesWithEmbedded", "embeddedBlocks",
  "decoratorNodes", "filesWithDecorator",
  "implementsClauses", "filesWithImplements",
  "jsxElements", "filesWithJsx",
  "mixinClauses", "filesWithMixin",
  "partDirectives", "filesWithPart",
  "classHeritageClauses", "filesWithClassHeritage",
  "templateIncludeDirectives", "filesWithTemplateInclude",
])

const sum: Json = {}
const blocksByLang: Record<string, number> = {}
const templateIncludeByKind: Record<string, number> = {}
const perChunk: unknown[] = []
let admitted: number | null = null
let missing: string[] = []
const slices: [number, number][] = []

for (const off of CHUNKS) {
  const p = `${DIR}/chunk-${off}.json`
  if (!existsSync(resolve(ROOT, p))) { missing.push(p); continue }
  const j: Json = JSON.parse(readFileSync(resolve(ROOT, p), "utf8"))
  const c: Json = j.counts ?? {}
  for (const [k, v] of Object.entries(c)) {
    if (numericKeys.has(k) && typeof v === "number") sum[k] = (sum[k] ?? 0) + v
    else if (k === "blocksByLang" && v && typeof v === "object") {
      for (const [lang, n] of Object.entries(v as Record<string, number>)) blocksByLang[lang] = (blocksByLang[lang] ?? 0) + n
    } else if (k === "templateIncludeByKind" && v && typeof v === "object") {
      for (const [kind, n] of Object.entries(v as Record<string, number>)) templateIncludeByKind[kind] = (templateIncludeByKind[kind] ?? 0) + n
    }
  }
  if (typeof j.admitted === "number") admitted = j.admitted
  const s = j.slice as [number, number] | undefined
  if (s) slices.push(s)
  perChunk.push({ offset: off, file: p, slice: s, admitted: j.admitted, files: c.files, blocks: c.embeddedBlocks })
}

slices.sort((a, b) => a[0] - b[0])
let coverageOk = slices.length === CHUNKS.length && slices[0]?.[0] === 0
for (let i = 0; i < slices.length; i++) if (i > 0 && slices[i][0] !== slices[i - 1][1]) coverageOk = false
if (admitted != null && slices.length > 0 && slices[slices.length - 1][1] !== admitted) coverageOk = false

// THE TEMPLATE TOTAL IS THE SUM OF ITS DISJOINT BUCKETS, computed here rather than accumulated in
// parallel, so the printed total IS the printed breakdown and the two cannot drift apart.
sum.templateIncludeDirectives = Object.values(templateIncludeByKind).reduce((n, v) => n + v, 0)
sum.blocksByLang = blocksByLang
sum.templateIncludeByKind = templateIncludeByKind

const doc = {
  instrument: "html-extended-construct-probe (FIVE DISJOINT CHUNKS, MERGED)",
  command: "bun script/m14/html-arm-chunks.sh — the census is run as five slices of the sorted admitted list and summed by script/m14/html-census-merge.ts",
  population: {
    admitted,
    chunks: perChunk.length,
    coverageOk,
    slices,
    note: "The census is a whole-population parse, so it runs on the fleet's SMALL slot (≤2,000 files per call) as five DISJOINT SLICES of the same sorted admitted list the arm takes. Every counter is additive, so the sum is the census.",
  },
  counts: sum,
  perChunk,
  missing,
}
writeFileSync(resolve(ROOT, OUT), JSON.stringify(doc, null, 2) + "\n")

console.log(`HTML CENSUS MERGE — ${perChunk.length}/5 chunks · admitted ${admitted} · coverage ${coverageOk ? "OK" : "FAILED"}`)
console.log(`  files parsed                    ${sum.files ?? 0}`)
console.log(`  files carrying an embedded block ${sum.filesWithEmbedded ?? 0}`)
console.log(`  embedded blocks                 ${sum.embeddedBlocks ?? 0}  ${JSON.stringify(blocksByLang)}`)
console.log(`  decorator nodes                 ${sum.decoratorNodes ?? 0}   in ${sum.filesWithDecorator ?? 0} files`)
console.log(`  implements clauses              ${sum.implementsClauses ?? 0}   in ${sum.filesWithImplements ?? 0} files`)
console.log(`  jsx elements                    ${sum.jsxElements ?? 0}   in ${sum.filesWithJsx ?? 0} files`)
console.log(`  mixin clauses                   ${sum.mixinClauses ?? 0}   in ${sum.filesWithMixin ?? 0} files`)
console.log(`  part directives                 ${sum.partDirectives ?? 0}   in ${sum.filesWithPart ?? 0} files`)
console.log(`  class_heritage clauses          ${sum.classHeritageClauses ?? 0}   in ${sum.filesWithClassHeritage ?? 0} files`)
console.log(`  template include/extends        ${sum.templateIncludeDirectives ?? 0}   in ${sum.filesWithTemplateInclude ?? 0} files`)
for (const [k, v] of Object.entries(templateIncludeByKind).sort((a, b) => (b[1] as number) - (a[1] as number))) {
  console.log(`      ${String(v).padStart(6)}  ${k}`)
}
console.log(`  written: ${OUT}`)
if (missing.length) console.log(`  MISSING CHUNK FILES: ${missing.join(", ")}`)
