// Review instrument (NOT a gate): measure the SAME file set through BOTH entry
// points, because the two answer different questions and conflating them is how
// a 47% "undercount" gets claimed against the wrong number.
//
//   bun script/m14/tmp/css-two-paths.ts
//
//   engine path  — ASTEngine.parseFile(path, content): what the ANALYZER emits.
//                  This is the path the M12 differential, the M14 F5
//                  differential, and the fixture runner all take.
//   production   — pool-worker.parseFile(path): what parallel-indexer actually
//                  calls, which applies filterNoiseRelationships (CSS keeps
//                  `contains` only). This is what the STORE receives.
//
// Found 2026-09-26: `m897-corpus-errors.ts` imports `parseFile` from
// `src/ast/pool-worker`, so the M12 corpus-errors artifact has always measured
// the PRODUCTION path. A first reading of the manifest's corpusRelationships
// compared it against an engine-path number and called it a 47% undercount.
// It was not an undercount — the two numbers count different edge sets over
// different file sets. Both are now measured on one file set so the difference
// is a number instead of an argument.

import { ASTEngine } from "../../../src/ast/engine"
import { parseFile as productionParseFile } from "../../../src/ast/pool-worker"
import { readFileSync } from "fs"
import { spawnSync } from "child_process"

const CORPUS = "/home/ishaq2321/bb_tests/repositories/svelte"

const tracked = spawnSync("git", ["ls-files", "*.css"], { cwd: CORPUS, encoding: "utf8" })
  .stdout.split("\n").map((s) => s.trim()).filter(Boolean).sort()
const files = tracked.filter((p) => readFileSync(`${CORPUS}/${p}`, "utf8").length > 0)

await ASTEngine.init?.()

let engSym = 0, engRel = 0, prodSym = 0, prodRel = 0, crashes = 0
const byType: Record<string, number> = {}
for (const rel of files) {
  const abs = `${CORPUS}/${rel}`
  const content = readFileSync(abs, "utf8")
  try {
    const e = await ASTEngine.parseFile(abs, content)
    engSym += e.symbols?.length ?? 0
    for (const r of e.relationships ?? []) {
      engRel++
      byType[String(r.type)] = (byType[String(r.type)] ?? 0) + 1
    }
  } catch { crashes++; continue }
  try {
    const p = await productionParseFile(abs)
    prodSym += p.symbols?.length ?? 0
    prodRel += p.relationships?.length ?? 0
  } catch { /* counted once above */ }
}

console.log(JSON.stringify({
  corpus: CORPUS,
  filesMeasured: files.length,
  trackedTotal: tracked.length,
  excludedEmpty: tracked.length - files.length,
  crashes,
  enginePath: { what: "ASTEngine.parseFile — the ANALYZER's output; the path the M12/M14 differentials and the fixture runner take", symbols: engSym, relationships: engRel, byRelationshipType: byType },
  productionPath: { what: "pool-worker.parseFile — what parallel-indexer calls; filterNoiseRelationships keeps `contains` only for css", symbols: prodSym, relationships: prodRel },
  difference: { relationships: engRel - prodRel, droppedByProductionFilter: engRel - prodRel, pctDropped: engRel ? +(((engRel - prodRel) / engRel) * 100).toFixed(1) : 0 },
}, null, 2))
