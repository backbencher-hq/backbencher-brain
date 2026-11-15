// Review instrument (NOT a gate): re-measure the M12 css manifest's corpus
// numbers on the file set the corpus-errors artifact ACTUALLY measured, and
// rewrite the committed sample file to that same set.
//
//   bun script/m14/tmp/css-manifest-remeasure.ts [--write-sample]
//
// Why. `validation/m12/results/css-corpus-sample.txt` held 181 paths while
// `css-corpus-errors.json` measured 186 — the sample was drawn by a glob that
// misses `_*expected.css`, so 4 Svelte SSR fixtures and 1 playground stylesheet
// were never in it. The manifest's prose repeated the 181, and its
// `corpusSymbols`/`corpusRelationships` were measured on that same 181. Three
// numbers, one corpus, and no artifact tying them to a file set. This is the
// #859 SAMPLE DRIFT class, already registered for typescript.
//
// The fix is to make ONE file set the subject of all of them: the full tracked
// set, which is what a `full-corpus` artifact measures.

import { ASTEngine } from "../../../src/ast/engine"
import { readFileSync, writeFileSync } from "fs"
import { spawnSync } from "child_process"

const CORPUS = "/home/ishaq2321/bb_tests/repositories/svelte"
const argv = process.argv.slice(2)
const WRITE = argv.includes("--write-sample")

const tracked = spawnSync("git", ["ls-files", "*.css"], { cwd: CORPUS, encoding: "utf8" })
  .stdout.split("\n").map((s) => s.trim()).filter(Boolean).sort()

const nonEmpty = tracked.filter((p) => readFileSync(`${CORPUS}/${p}`, "utf8").length > 0)
console.log(`tracked *.css        : ${tracked.length}`)
console.log(`  non-empty          : ${nonEmpty.length}`)
const empty = tracked.filter((p) => !nonEmpty.includes(p))
if (empty.length) console.log(`  EMPTY (excluded)   : ${empty.length}  ${empty.join(", ")}`)

const prev = readFileSync("validation/m12/results/css-corpus-sample.txt", "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
const added = nonEmpty.filter((p) => !prev.includes(p))
const dropped = prev.filter((p) => !nonEmpty.includes(p))
console.log(`\ncommitted sample     : ${prev.length}`)
console.log(`  ADDED by this fix  : ${added.length}`)
for (const a of added) console.log(`      + ${a}`)
console.log(`  dropped            : ${dropped.length}`)

if (WRITE) {
  writeFileSync("validation/m12/results/css-corpus-sample.txt", nonEmpty.join("\n") + "\n")
  console.log(`\nwrote validation/m12/results/css-corpus-sample.txt (${nonEmpty.length} paths)`)
}

// Measure the manifest's symbol/relationship numbers on EXACTLY this set.
await ASTEngine.init?.()
let symbols = 0
let relationships = 0
let errorFiles = 0
let crashFiles = 0
for (const rel of nonEmpty) {
  const abs = `${CORPUS}/${rel}`
  const content = readFileSync(abs, "utf8")
  let res: any
  try { res = await ASTEngine.parseFile(abs, content) } catch { crashFiles++; continue }
  if ((res.errors?.length ?? 0) > 0) errorFiles++
  symbols += res.symbols?.length ?? 0
  relationships += res.relationships?.length ?? 0
}
console.log(`\n=== manifest numbers, measured on the ${nonEmpty.length}-file set ===`)
console.log(`  corpusSymbols        : ${symbols}   (manifest said 722 on 181 files)`)
console.log(`  corpusRelationships  : ${relationships}   (manifest said 1854 on 181 files)`)
console.log(`  grammarErrorFiles    : ${errorFiles}   (manifest said 14)`)
console.log(`  crashFiles           : ${crashFiles}`)
