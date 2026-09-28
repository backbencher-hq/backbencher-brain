// script/m12/verify-differential-freshness.ts — #893 acceptance item 3.
//
//   "a gate exists that fails when an M12 differential artifact's inputs have
//    moved, so a `1.000` cannot outlive the code it describes"
//
// The failure this closes, measured: `groovy-differential.json` recorded
// `precision 1.000 / FP 0` from bafcce7a onward, unchanged, while the analyzer
// changed 12 times underneath it — and `62239b9d`, whose subject is "commit
// regenerated milestone evidence at HEAD", committed that byte-identical
// content against a tree that measures 0.861. Nothing in the tree compared any
// of the 42 `*-differential.json` artifacts to the code they described, which
// is why it survived five commits.
//
// This gate is that comparison. Every artifact produced after
// `script/m12/differential-provenance.ts` landed carries an `inputs` block; this
// recomputes those inputs from the tree and fails when they moved.
//
// Statuses, and what each one means:
//
//   FRESH      inputs recorded and unchanged.
//   STALE      inputs recorded and moved — the artifact no longer describes
//              this tree. This is the failure the gate exists for, and it names
//              the path that moved, because "stale" without a file is a
//              riddle, not a finding.
//   UNPINNED   no `inputs` block: the artifact cannot be checked at all, which
//              is the state #893 was found in. Reported with a count and a
//              list, never silently passed. `--allow-unpinned` downgrades it to
//              a printed disclosure so the gate can be adopted family by
//              family while the remaining artifacts are re-emitted — the
//              disclosure is a list, not a number, so "38 unpinned" cannot be
//              read as "covered".
//
// Usage:
//   bun script/m12/verify-differential-freshness.ts
//   bun script/m12/verify-differential-freshness.ts --allow-unpinned
//   bun script/m12/verify-differential-freshness.ts --lang groovy
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { computeInputs, diffInputs, type FileFingerprint } from "./differential-provenance"

const ROOT = process.cwd()
const RESULTS = path.join(ROOT, "validation/m12/results")
const args = process.argv.slice(2)
const allowUnpinned = args.includes("--allow-unpinned")
const only = args.includes("--lang") ? String(args[args.indexOf("--lang") + 1]).split(",") : null

type Artifact = {
  lang: string
  file: string
  inputs?: { files?: Record<string, FileFingerprint>; parser?: { path: string; sha256: string } | null }
  metrics?: Record<string, unknown>
}

const artifacts: Artifact[] = []
for (const f of readdirSync(RESULTS).sort()) {
  if (!f.endsWith("-differential.json")) continue
  const lang = f.slice(0, -"-differential.json".length)
  if (only && !only.includes(lang)) continue
  const doc = JSON.parse(readFileSync(path.join(RESULTS, f), "utf8")) as Artifact
  artifacts.push({ ...doc, lang, file: f })
}

if (artifacts.length === 0) {
  console.error(only ? `no differential artifact for: ${only.join(",")}` : "no differential artifacts found")
  process.exit(1)
}

const stale: { lang: string; changed: string[]; added: string[]; removed: string[] }[] = []
const unpinned: string[] = []
const parserDrift: string[] = []
let fresh = 0

for (const a of artifacts) {
  const recorded = a.inputs?.files
  if (!recorded || Object.keys(recorded).length === 0) {
    unpinned.push(a.lang)
    continue
  }
  const diff = diffInputs(ROOT, recorded, a.lang)
  if (diff.changed.length || diff.added.length || diff.removed.length) {
    stale.push({ lang: a.lang, ...diff })
    continue
  }
  fresh++
  const rec = a.inputs?.parser
  const now = diff.current.parser
  if (rec && now && rec.sha256 !== now.sha256) parserDrift.push(a.lang)
}

console.log(`=== M12 differential freshness (${artifacts.length} artifact(s) checked) ===`)
console.log(`FRESH     ${fresh}`)
console.log(`STALE     ${stale.length}`)
console.log(`UNPINNED  ${unpinned.length}${allowUnpinned ? "  (allowed by --allow-unpinned, disclosed below)" : ""}`)

for (const s of stale) {
  let m = "n/a"
  try {
    const doc = JSON.parse(readFileSync(path.join(RESULTS, `${s.lang}-differential.json`), "utf8"))
    m = `precision=${doc?.passing?.metrics?.precision}`
  } catch {}
  console.log(`\n  STALE ${s.lang} — recorded ${m}`)
  for (const p of s.changed) console.log(`    changed  ${p}`)
  for (const p of s.added) console.log(`    added    ${p}`)
  for (const p of s.removed) console.log(`    removed  ${p}`)
  console.log(`    re-emit: bun script/m12/verify-analyzer.ts ${s.lang}`)
}

if (unpinned.length) {
  console.log(`\n  UNPINNED (no inputs block — cannot be checked, NOT covered):`)
  for (const l of unpinned) console.log(`    ${l}`)
  console.log(`    re-emit each with: bun script/m12/verify-analyzer.ts <lang>`)
}

if (parserDrift.length) {
  // Informational by construction: the wasm is not byte-reproducible, so a
  // rebuild of unchanged grammar source changes this hash without changing
  // behaviour. Printed so the reader knows which parser the numbers came from.
  console.log(`\n  parser artifact differs from the recorded one (informational, not a failure):`)
  for (const l of parserDrift) console.log(`    ${l}`)
}

const failed = stale.length > 0 || (unpinned.length > 0 && !allowUnpinned)
if (failed) {
  console.log(`\nFAIL: ${stale.length} stale, ${unpinned.length} unpinned`)
  process.exitCode = 1
} else {
  console.log(`\nPASS: every pinned artifact describes this tree${unpinned.length ? ` (${unpinned.length} unpinned and disclosed)` : ""}`)
}
