#!/usr/bin/env bun
/**
 * SVELTE — merge the SPLIT census's two halves into the canonical census JSON.
 *
 * WHY THE CENSUS IS SPLIT (measured 2026-10-23): the census's per-file work is a production parse
 * (pool worker) followed by a main-thread construct parse. Run INTERLEAVED over the whole population
 * it HANGS — reproducibly at admitted file #678, `shadcn-svelte/…/github/codespaces-card.svelte`,
 * while that file takes 25 ms in isolation, each leg ALONE completes 700 files, and both bounded
 * validation arms exit 0. So the hang is the interleaving after ~600 files of accumulated state, not
 * a file and not a leg. The fix is the yaml lane's chunking lesson applied to the legs: the emission
 * half and the construct half run in SEPARATE PROCESSES, and this script merges their JSONs.
 *
 * The merged file is the census artifact the declaration cites; both halves' own JSONs stay beside
 * it, and `legs` records which half produced which block — a merged file that silently mixed halves
 * would be the same defect class as a partial table.
 *
 * Usage: bun run script/m14/svelte-census-merge.ts <emission.json> <construct.json> <out.json>
 */
import { readFileSync, writeFileSync } from "node:fs"

const [emPath, coPath, outPath] = process.argv.slice(2)
if (!emPath || !coPath || !outPath) {
  console.error("usage: svelte-census-merge.ts <emission.json> <construct.json> <out.json>")
  process.exit(2)
}
const em: any = JSON.parse(readFileSync(emPath, "utf8"))
const co: any = JSON.parse(readFileSync(coPath, "utf8"))

const failures: string[] = []
if (em?.legs?.emission !== true || em?.legs?.construct !== false) failures.push(`emission half says legs=${JSON.stringify(em?.legs)} (expected emission:true construct:false)`)
if (co?.legs?.emission !== false || co?.legs?.construct !== true) failures.push(`construct half says legs=${JSON.stringify(co?.legs)} (expected emission:false construct:true)`)
for (const k of ["population", "grammars", "buildPreconditions", "controlArms"]) {
  if (JSON.stringify(em?.[k]) !== JSON.stringify(co?.[k])) failures.push(`${k} differs between the halves — the halves were not run on the same corpus`)
}
if (failures.length > 0) {
  console.error("MERGE REFUSED —")
  for (const f of failures) console.error("  " + f)
  process.exit(3)
}

const merged = {
  ...co,
  legs: {
    emission: true,
    construct: true,
    splitRationale:
      "the two legs run in separate processes: their INTERLEAVING hangs the census at admitted file #678 (measured 2026-10-23; each leg alone completes 700 files, that file takes 25 ms in isolation)",
    emissionHalf: { artifact: emPath, filesMeasured: em?.emission?.filesMeasured, relationships: em?.emission?.relationships },
    constructHalf: { artifact: coPath, filesMeasured: co?.construct?.filesMeasured },
  },
  emission: em.emission,
  construct: co.construct,
  _mergeNote: `merged by script/m14/svelte-census-merge.ts from ${emPath} + ${coPath}; the halves agreed on population, grammars, build preconditions and control arms`,
}
writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n")
const counts = merged.emission?.typeCounts ?? {}
console.log(`merged → ${outPath}`)
console.log(`  emission: files ${merged.emission?.filesMeasured} · relationships ${merged.emission?.relationships}`)
console.log(`  construct: template tags ${merged.construct?.template?.componentTags} · script blocks ${merged.construct?.scriptBlocks} (ts ${merged.construct?.tsScriptBlocks}) · decorators ${merged.construct?.decorators?.total} · call-heritage ${merged.construct?.mixesIn?.callShapedHeritageClasses} · directives ${merged.construct?.partOf?.referenceDirectiveNodes}+${merged.construct?.partOf?.tripleSlashCommentNodes}`)
console.log(`  extended edges: decorates ${counts.decorates ?? 0} · renders ${counts.renders ?? 0} · mixes_in ${counts.mixes_in ?? 0} · part_of ${counts.part_of ?? 0}`)
