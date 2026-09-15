// script/m61/seal-legacy.ts — M61.V1 one-shot migration (D-1): seal every
// legacy (pre-M61) evidence record under validation/m*/results IN PLACE,
// preserving every field. Idempotent: already-sealed files are skipped.
//
// Run: npx tsx script/m61/seal-legacy.ts
// Emits its own report sealed through the same path it migrates to.

import { readdirSync, existsSync, statSync, readFileSync } from "node:fs"
import path from "node:path"
import { sealLegacyFile, readEvidence, SEAL_KEY } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const VALIDATION = path.join(ROOT, "validation")

let sealed = 0
let alreadySealed = 0
let failed = 0
const failures: string[] = []
const dirs = readdirSync(VALIDATION).filter((d) => /^m\d+$/.test(d) && statSync(path.join(VALIDATION, d)).isDirectory())

for (const dir of dirs) {
  const results = path.join(VALIDATION, dir, "results")
  if (!existsSync(results)) continue
  for (const f of readdirSync(results)) {
    if (!f.endsWith(".json") || f.endsWith(".seal")) continue
    const filePath = path.join(results, f)
    try {
      const pre = JSON.parse(readFileSync(filePath, "utf8"))
      if (pre && typeof pre === "object" && (pre as Record<string, unknown>)[SEAL_KEY] !== undefined) {
        alreadySealed++
        continue
      }
    } catch {
      // unparseable — the migration leaves it alone and reports it; a gate
      // consuming it will refuse it loudly anyway.
      failed++
      failures.push(`${dir}/${f}: unparseable JSON — left untouched`)
      continue
    }
    const seal = sealLegacyFile(filePath)
    if (seal === null) {
      alreadySealed++
      continue
    }
    const back = readEvidence(filePath)
    if (!back.ok) {
      failed++
      failures.push(`${dir}/${f}: sealed but failed re-read: ${back.reason}`)
      continue
    }
    sealed++
  }
}

console.log(`M61.V1 migration: ${sealed} sealed, ${alreadySealed} already sealed, ${failed} failed across ${dirs.length} milestone results dirs`)
if (failed > 0) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
  process.exitCode = 1
}
