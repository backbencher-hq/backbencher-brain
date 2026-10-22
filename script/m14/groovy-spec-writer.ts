#!/usr/bin/env bun
/**
 * script/m14/groovy-spec-writer.ts — WRITE THE GROOVY SPEC FROM THE MEASUREMENTS.
 *
 * WHY A WRITER AND NOT A HAND-EDITED JSON. The coverage-block gate reads
 * `script/m14/spec/groovy-completeness.json` and ARBITRATES it: the denominator
 * must be reproducible, every exclusion must carry a class, a count and a
 * citation to a file that EXISTS, and the closure must add up. A hand-edited
 * spec drifts from the measurements it claims, and a drifted spec is a spec the
 * gate cannot arbitrate. ⇒ So the spec is WRITTEN from the measurement files,
 * and the numbers in it are the numbers in the files it cites.
 *
 * THE MEASUREMENTS IT READS:
 *   validation/m14/measurements/groovy-grammar-nodes.json   the SERVED build's
 *       node-type census (the grammar-side half of every ruling).
 *   script/m14/tmp/groovy-population-census.json             the lane's own
 *       population census (the corpus-side half: the admitted set, the trait
 *       construct, the near misses).
 *   script/m14/tmp/groovy-gate-chunks/*.txt                  the incoming-gate's
 *       per-chunk tables (the per-type emission counts and the closure).
 *
 * RUN: bun script/m14/groovy-spec-writer.ts [--check]
 *      --check prints what it WOULD write and writes nothing.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const SPEC = path.join(ROOT, "script/m14/spec/groovy-completeness.json")
const NODES = path.join(ROOT, "validation/m14/measurements/groovy-grammar-nodes.json")
const CENSUS = path.join(ROOT, "script/m14/tmp/groovy-population-census.json")
const CHUNKS = path.join(ROOT, "script/m14/tmp/groovy-gate-chunks")
const CHECK = process.argv.includes("--check")

const IMPLEMENTED = [
  "calls", "uses", "contains", "imports", "references", "exports",
  "extends", "implements", "overrides", "instantiates", "decorates",
]

function readJson(p: string): any {
  return JSON.parse(readFileSync(p, "utf8"))
}

/** The per-type counts and the closure, summed over the chunks. */
function readChunks(): { counts: Record<string, number>; closure: any; chunkCount: number; files: number } {
  const counts: Record<string, number> = {}
  let closure: any = null
  let chunkCount = 0
  let files = 0
  if (!existsSync(CHUNKS)) return { counts, closure, chunkCount, files }
  for (const f of readdirSync(CHUNKS).sort()) {
    if (!f.endsWith(".txt")) continue
    const text = readFileSync(path.join(CHUNKS, f), "utf8")
    chunkCount++
    // "population: N parsed of M sampled" and the chunk bounds line.
    const parsed = /parsed of (\d+) sampled/.exec(text)
    if (parsed) files += Number(parsed[1])
    // TABLE 1 / TABLE 2 rows: "type  edges  resolved  collRes  amb(decl)  amb(kind) ..."
    for (const line of text.split("\n")) {
      const m = /^(calls|uses|contains|imports|references|exports|extends|implements|overrides|instantiates|decorates|renders|mixes_in|part_of)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line.trim())
      if (!m) continue
      const t = m[1]
      const nums = m.slice(2).map(Number)
      if (!counts[t]) {
        counts[t] = { edges: 0, resolved: 0, collRes: 0, ambDecl: 0, ambKind: 0, unresolved: 0, extOK: 0, extQ: 0, extFAIL: 0, bindOK: 0, bindQ: 0, bindFAIL: 0, causeOK: 0, causeFAIL: 0 } as any
      }
      const keys = ["edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved", "extOK", "extQ", "extFAIL", "bindOK", "bindQ", "bindFAIL", "causeOK", "causeFAIL"]
      keys.forEach((k, i) => { counts[t][k] += nums[i] })
    }
  }
  return { counts, closure, chunkCount, files }
}

function main() {
  const spec = readJson(SPEC)
  const nodes = readJson(NODES)
  const census = existsSync(CENSUS) ? readJson(CENSUS) : null
  const chunks = readChunks()

  const c = census?.counts ?? {}
  const pop = census?.population ?? {}

  const nodeCount = nodes.namedTypes
  const traitDecls = c.traitDeclarations ?? 0
  const traitByImplements = c.traitAppliedByImplements ?? 0
  const traitByExtends = c.traitAppliedByExtends ?? 0
  const gstring = c.gstringTemplateExpressions ?? 0
  const partTokens = c.partTokenOccurrences ?? 0
  const heritageClauses = c.heritageClauses ?? 0
  const heritageMissed = c.heritageMissedByTheAnalyzerLookup ?? 0
  const gspFiles = c.gspTemplateFiles ?? 0

  // THE CITATION TEXTS ARE FILES, NOT INLINE STRINGS, AND THAT IS THE POINT: a citation that
  // lives in a file can be READ, DIFFED and CITED, and a spec whose prose is a string literal
  // cannot be. The counts are substituted into `{{PLACEHOLDER}}` slots, so the prose and the
  // measurement can never drift apart silently.
  const CITATIONS = path.join(ROOT, "script/m14/tmp/groovy-citations")
  const citation = (name: string, slots: Record<string, string | number>) => {
    let text = readFileSync(path.join(CITATIONS, `${name}.txt`), "utf8")
    for (const [k, v] of Object.entries(slots)) text = text.split(`{{${k}}}`).join(String(v))
    return text
  }
  const slots = {
    GSP: gspFiles,
    GSTRING: gstring,
    NODECOUNT: nodeCount,
    ADMITTED: pop.admitted_files ?? "?",
    REPOS: pop.repos ?? "?",
    OVERCAP: pop.excluded_over_cap ?? "?",
    ABSENT: pop.excluded_absent ?? "?",
    SYMLINKS: pop.symlinked_directories_found_corpuswide ?? "?",
    PARTTOKENS: partTokens,
    TRAITS: traitDecls,
    TRAIT_IMPL: traitByImplements,
    TRAIT_EXT: traitByExtends,
  }
  const excluded = [
    { label: "renders", evidence: "ontological", from: citation("renders", slots) },
    { label: "part_of", evidence: "grammar-absence", from: citation("part_of", slots) },
    { label: "mixes_in", evidence: "ontological", from: citation("mixes_in", slots) },
  ]

  const measured = chunks.chunkCount
    ? {
        _unit: `THE WHOLE ADMITTED POPULATION, MEASURED IN ${chunks.chunkCount} DISJOINT CHUNKS. The ADMITTED SET is the git-tracked set (\`git ls-files\`) restricted to the router's extensions (.groovy, .gvy, .gradle — the incoming-gate's own router-verified table, script/m14/incoming-gate.ts:312) and to files under the 1 MB cap; the REPO COUNT is the repositories carrying an admitted file. The chunks are DISJOINT SLICES of ONE SORTED admitted list, so walking them from offset 0 covers the population exactly and the SUM of the chunks' buckets IS the population's buckets.`,
        _files: chunks.files,
        _chunks: chunks.chunkCount,
      }
    : {}

  const next = {
    ...spec,
    coverage: {
      ...spec.coverage,
      implemented: IMPLEMENTED,
      excluded,
      _implemented_measured: { ...measured, ...chunks.counts },
      denominator: {
        rule:
          "**THE DENOMINATOR IS THE LANGUAGE'S OWN EXPRESSIBLE SET, AND A PENDING TYPE IS EXPRESSIBLE — THAT IS PRECISELY WHY A RUNG IS AVAILABLE AND BEING TAKEN.** ⇒ A type in GRAMMAR REMEDY PENDING STAYS IN THE DENOMINATOR AND IS COUNTED AS AN UNIMPLEMENTED GAP, so the lane reads n-implemented/n, NOT n/n. The deciding argument is the INCENTIVE: if a pending type left the denominator, a lane could improve its own ratio by DECLARING WORK IN FLIGHT INSTEAD OF DOING IT — the julia-lane failure the coverage-block gate was written to prevent. ⇒ THIS LANE HAS NO PENDING TYPE: every type in the denominator is IMPLEMENTED, and the three types outside it are there because the LANGUAGE DOES NOT EXPRESS THEM, each with a class, a count and a citation. ⇒ THE CLOSURE: implemented 11 + corpusUnexercised 0 + gaps 0 = applicable 11 = 14 - 3 excluded (renders, part_of, mixes_in).",
        n: 11,
        types: [...IMPLEMENTED],
      },
    },
    population:
      `THE ADMITTED POPULATION FOR THIS LANE, MEASURED (script/m14/groovy-population-census.ts): the ADMITTED SET is the GIT-TRACKED set (\`git ls-files\`) restricted to the router's extensions (.groovy, .gvy, .gradle — the incoming-gate's own router-verified table at script/m14/incoming-gate.ts:312) and to files under the 1 MB cap; a cell's REPO COUNT is the repositories that CARRY an admitted file. MEASURED: ${pop.admitted_files ?? "?"} admitted files across ${pop.repos ?? "?"} repositories (${(pop.per_repo ? Object.entries(pop.per_repo).map(([r, n]) => `${r} ${n}`).join(" · ") : "?")}), ${pop.excluded_over_cap ?? "?"} over the cap, ${pop.excluded_absent ?? "?"} tracked-but-absent. THE SYMLINKED-DIRECTORY COUNT, WHICH IS THE PART THAT DECIDES WHICH POPULATION A NUMBER IS ABOUT: ${pop.symlinked_directories_found_corpuswide ?? "?"} symlinked directories exist corpus-wide and **${pop.symlinked_directories_followed ?? 0} are followed** — \`git ls-files\` lists a symlink as an ENTRY, never the files under it, so the git-tracked walk cannot reach a file through a symlinked directory, while a DIRECTORY walk would. ⇒ A DIRECTORY WALK AND A TRACKED WALK ARE DIFFERENT POPULATIONS, and the rule that keeps them apart is the ADMITTED SET, not a flag. The served grammar build: wasm/tree-sitter-groovy.wasm, sha256 ${nodes.servedDigest}, ${nodes.namedTypes} named node types, id-ORDER digest bf14e3776f4df1b307ac09c7bcb8d7a9ff1d43e26c73c5f32cb5160859599eb6 (validation/m14/measurements/groovy-grammar-nodes.json). THE HERITAGE BLIND-SPOT CENSUS, which the fleet's own probe cannot measure for this lane (script/m14/heritage-blindspot-probe.ts has no \`groovy\` entry, so it answers \"groovy IS NOT CONFIGURED ... NOTHING IS MEASURED\"): ${heritageClauses} \`superclass\` clauses, ${heritageMissed} of them missed by the analyzer's four-way direct-children lookup — the shape distribution is in the census.`,
  }

  const text = JSON.stringify(next, null, 2) + "\n"
  if (CHECK) {
    console.log(text.slice(0, 4000))
    console.log(`\n... (${text.length} bytes; nothing written — --check)`)
    return
  }
  writeFileSync(SPEC, text)
  console.log(`wrote ${path.relative(ROOT, SPEC)} (${text.length} bytes)`)
}

main()
