/**
 * SCSS INCOMING WALK — the corpus half of the incoming/ambiguity audit.
 *
 * ## Why this exists
 *
 * `script/m14/incoming-check.ts` measures incoming resolution against the files it is
 * HANDED. That is correct for its question and insufficient for this round's, because
 * this round's question is what happens to the 1,185 unresolved targets the 600-file
 * sweep left: are they names that exist in a file OUTSIDE the window (not a defect), or
 * names that exist NOWHERE (a defect)? Answering that needs two universes — the window
 * and the whole corpus — and one parse of every file, so that a name can be asked about
 * both at once.
 *
 * So this file only DUMPS. It walks the admitted corpus through production `parseFile`
 * and writes one NDJSON record per symbol and per relationship edge, with nothing
 * computed from them. `scss-incoming-audit.ts` reads the dump and does the arithmetic.
 * The split matters: a re-run of the arithmetic against a fixed dump is reproducible to
 * the byte, whereas re-walking the corpus re-parses 4,433 files and the degraded set is
 * not the same set twice (see `scss-relationship-census.ts` for that measurement).
 *
 * ## What is recorded per edge, and why each field
 *
 *   type                the store label, verbatim — never normalized here, because a
 *                       normalizer is a place a label can be silently dropped
 *   source, target      endpoint STRINGS. These are NAMES, not symbol ids: the SCSS
 *                       analyzer publishes `source: ctx.moduleName, target: name`, and
 *                       a consumer that wants to join an edge to a declaration has to
 *                       match on the name. That is the published-name contract, and it
 *                       is the thing the ambiguity split measures.
 *   confidence          RECORDED VERBATIM INCLUDING ABSENCE. `null` means the row
 *                       carried no confidence field, which is a different fact from
 *                       1.0 and the previous census could not tell them apart: it read
 *                       `typeof c === "number" ? c : 1`, so a missing confidence was
 *                       counted as a confident edge and the `conf<0.7` column read 0.
 *   evidenceClass       `metadata.evidenceClass`, the honesty contract's own label
 *   line, conf           pass-through for auditing an individual edge
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/scss/scss-incoming-walk.ts <out.ndjson> [sampleSize]
 *
 * The file set is DETERMINISTIC — every admitted path sorted, then every Nth — so two
 * runs at the same sample size walk the same FILES. What is not deterministic is the
 * degraded set, so the dump records each file's flags and a differencing can say
 * whether a mover was explained by the fallback path.
 *
 * READ-ONLY with respect to the corpus. Writes only the dump path given.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = process.argv[2] ?? "/tmp/opencode/scss/scss-incoming-walk.ndjson"
const SAMPLE = Number(process.argv[3] ?? 0) // 0 = the whole admitted corpus

/** The admitted population, exactly the census's and the gate's admission rule. */
const all: string[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) all.push(path.join(dir, rel))
}
const admitted: string[] = []
for (const abs of all) {
  let text: string
  try {
    if (statSync(abs).size > 512 * 1024) continue
    text = readFileSync(abs, "utf8")
  } catch {
    continue
  }
  if (detectLanguageFromPath(abs, text) !== "scss") continue
  admitted.push(abs)
}
admitted.sort()
const walkList = SAMPLE > 0 ? admitted.filter((_, i) => i % Math.max(1, Math.floor(admitted.length / SAMPLE)) === 0).slice(0, SAMPLE) : admitted

const lines: string[] = []
let idx = 0
let symbols = 0
let edges = 0
let filesWithEdges = 0
let degraded = 0
let thrown = 0
let confMissing = 0

async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= walkList.length) return
    const abs = walkList[i]
    const rel = path.relative(CR, abs)
    let r: any
    try {
      r = await parseFile(abs, path.dirname(abs))
    } catch {
      thrown++
      lines.push(JSON.stringify({ k: "file", f: rel, thrown: true }))
      continue
    }
    const out: string[] = []
    if (r?.fallback === true || r?.degraded === true) degraded++
    for (const s of Array.isArray(r?.symbols) ? r.symbols : []) {
      symbols++
      out.push(
        JSON.stringify({
          k: "s",
          f: rel,
          n: String(s?.name ?? ""),
          k2: String(s?.kind ?? ""),
          q: String(s?.qualifiedName ?? ""),
          sc: String(s?.scope ?? ""),
          l: s?.startLine ?? 0,
        }),
      )
    }
    const n = Array.isArray(r?.relationships) ? r.relationships.length : 0
    if (n > 0) filesWithEdges++
    for (const e of Array.isArray(r?.relationships) ? r.relationships : []) {
      edges++
      const hasConf = typeof e?.confidence === "number"
      if (!hasConf) confMissing++
      out.push(
        JSON.stringify({
          k: "e",
          f: rel,
          t: String(e?.type ?? e?.relationshipType ?? ""),
          s: String(e?.source ?? e?.from ?? e?.fromSymbol ?? ""),
          g: String(e?.target ?? e?.to ?? e?.toSymbol ?? ""),
          c: hasConf ? e.confidence : null,
          ec: String(e?.metadata?.evidenceClass ?? ""),
          ln: e?.line_number ?? 0,
        }),
      )
    }
    out.push(JSON.stringify({ k: "file", f: rel, fb: r?.fallback === true, dg: r?.degraded === true, err: Array.isArray(r?.errors) ? r.errors.length : 0, ns: (r?.symbols ?? []).length, ne: n }))
    lines.push(out.join("\n"))
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

writeFileSync(OUT, lines.join("\n") + "\n")
console.log(`scss incoming walk — production parseFile`)
console.log(`corpus root        ${CR}`)
console.log(`admitted .scss     ${admitted.length}`)
console.log(`walked             ${walkList.length}${SAMPLE > 0 ? ` (every ${Math.max(1, Math.floor(admitted.length / SAMPLE))}th of the sorted admitted list)` : " (the whole admitted corpus)"}`)
console.log(`files with >=1 edge ${filesWithEdges};  degraded ${degraded};  thrown ${thrown}`)
console.log(`symbols ${symbols.toLocaleString()}   edges ${edges.toLocaleString()}   edges with NO confidence field ${confMissing.toLocaleString()}`)
console.log(`dump               ${OUT} (${(lines.join("\n").length / 1e6).toFixed(1)} MB)`)
