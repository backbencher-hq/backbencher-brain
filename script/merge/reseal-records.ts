// script/merge/reseal-records.ts — seal EXACTLY the records a merge line re-emitted
// through a producer that is still on the pre-M61 raw write path.
//
// Why this is not hand-editing evidence: the sealing is done by the M61 library's own
// migration function (`sealLegacyFile` in script/lib/evidence.ts), which is the same
// function the repo's one-shot migration (`script/m61/seal-legacy.ts`) uses — it takes
// the M61.V2 directory lock, preserves every field, is idempotent, and refuses to
// touch an already-sealed file. What this script adds over the migration is *scope*:
// the migration walks every `validation/m*/results/` directory, which would also seal
// other lanes' records mid-flight; this one seals the paths it is given, so the write
// is exactly the set the operator can name and check.
//
// The discipline it keeps:
//   - it never rewrites content fields; a sealed file's canonical content is checked
//     against the pre-seal bytes by the library's own `readEvidence` round-trip;
//   - a file that already carries a seal is reported, not re-sealed;
//   - a file whose seal does not verify after the write is reported as failed.
//
// Usage: npx tsx script/merge/reseal-records.ts <path> [<path>...]
//   (shell globs are fine: validation/m12/results/*-differential.json)

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { SEAL_KEY, readEvidence, sealLegacyFile } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const argv = process.argv.slice(2).filter((a) => a !== "--")
if (argv.length === 0) {
  console.error("usage: npx tsx script/merge/reseal-records.ts <path> [<path>...]")
  process.exit(2)
}

let sealed = 0
let alreadySealed = 0
let failed = 0
const sealedPaths: string[] = []

for (const arg of argv) {
  const file = path.isAbsolute(arg) ? arg : path.join(ROOT, arg)
  const rel = path.relative(ROOT, file)
  if (!existsSync(file)) {
    console.error(`reseal: MISSING ${rel}`)
    failed++
    continue
  }
  const before = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  if (before[SEAL_KEY] !== undefined) {
    alreadySealed++
    continue
  }
  const contentBefore = JSON.stringify(before)
  const seal = sealLegacyFile(file)
  if (seal === null) {
    alreadySealed++
    continue
  }
  const back = readEvidence<Record<string, unknown>>(file)
  if (!back.ok) {
    console.error(`reseal: sealed but the trusted read refused ${rel} — ${back.reason}`)
    failed++
    continue
  }
  const after = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  const { [SEAL_KEY]: _seal, ...stripped } = after
  if (JSON.stringify(stripped) !== contentBefore) {
    console.error(`reseal: CONTENT CHANGED while sealing ${rel}`)
    failed++
    continue
  }
  sealed++
  sealedPaths.push(rel)
}

console.log(`reseal: ${sealed} sealed, ${alreadySealed} already sealed, ${failed} failed (of ${argv.length} given)`)
for (const p of sealedPaths) console.log(`  sealed ${p}`)
if (failed > 0) process.exitCode = 1
