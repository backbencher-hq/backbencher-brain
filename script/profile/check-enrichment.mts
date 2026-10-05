// script/profile/check-enrichment.mts — is the enrichment phase's failure caused
// by the profiler's DB proxy, or is it real?
//
// The full post-pass run recorded `enrichment=2ms(failed)` with an error that
// serialised to `{}`. A phase that fails in 2ms has run none of its work, so its
// cost is UNMEASURED — and a measurement of "2ms" for a phase that walks every
// relationship would be a serious misreport. This script runs the real
// `enrichRelationships` twice on the same corpus: once through the profiler's
// proxy and once through a plain handle, so the cause is attributed rather than
// guessed.

import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { ROOT, newProfile, instrument } from "./lib.ts"

const argv = process.argv.slice(2)
const argOf = (k: string, d: string) => {
  const i = argv.indexOf(k)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const DATA_DIR = argOf("--data", "")
const PID = "818db37d8f54173ad1357ab24627373da2e9418c"

async function main() {
  if (!DATA_DIR) {
    console.log("usage: check-enrichment.mts --data <BB_DATA_DIR from profile-post --keep>")
    process.exitCode = 1
    return
  }
  process.env.BB_DATA_DIR = DATA_DIR

  // Control 1: plain handle, no proxy at all.
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const { enrichRelationships } = await import(path.join(ROOT, "src/brain/brain-relationship-enrichment.ts"))

  console.log("=== control A: plain handle (no profiler) ===")
  let a: any
  try {
    const t = Date.now()
    a = await enrichRelationships(PID as any)
    console.log(`  OK in ${Date.now() - t}ms: ${JSON.stringify({
      enriched: a.enriched, considered: a.considered, unchanged: a.unchanged,
      patternsFound: a.patternsFound, failedPages: a.failedPages, firstError: a.firstError,
    })}`)
  } catch (e: any) {
    console.log(`  THREW after ${Date.now()}ms`)
    console.log(`    constructor : ${e?.constructor?.name}`)
    console.log(`    message     : ${String(e?.message ?? e).slice(0, 400)}`)
    console.log(`    code        : ${String((e as any)?.code ?? "")}`)
    console.log(`    stack head  : ${String(e?.stack ?? "").split("\n").slice(0, 4).join("\n                  ")}`)
  }

  // Control 2: the same call through the profiler's proxy, to see whether the
  // proxy is what breaks it.
  console.log("\n=== control B: through the profiler's proxy ===")
  const acc = newProfile()
  const real = BrainDatabase.getRawInstance.bind(BrainDatabase)
  BrainDatabase.getRawInstance = (async (p: any) => {
    const raw = await real(p)
    return instrument(raw, acc).db
  }) as any
  try {
    const t = Date.now()
    const b = await enrichRelationships(PID as any)
    console.log(`  OK in ${Date.now() - t}ms: ${JSON.stringify({ enriched: b.enriched, considered: b.considered, failedPages: b.failedPages })}`)
  } catch (e: any) {
    console.log(`  THREW after ${Date.now()}ms`)
    console.log(`    constructor : ${e?.constructor?.name}`)
    console.log(`    message     : ${String(e?.message ?? e).slice(0, 400)}`)
    console.log(`    code        : ${String((e as any)?.code ?? "")}`)
  }

  // And what the DB itself says, read outside both.
  console.log("\n=== control C: raw counts, no product code ===")
  const db = new DatabaseSync(path.join(DATA_DIR, "projects", PID, "brain.db"), { readOnly: true })
  const one = (s: string) => Number((db.prepare(s).get() as any)?.c ?? 0)
  console.log(`  relationships                 ${one("SELECT COUNT(*) c FROM brain_relationship").toLocaleString()}`)
  console.log(`  with metadata                 ${one("SELECT COUNT(*) c FROM brain_relationship WHERE metadata IS NOT NULL").toLocaleString()}`)
  console.log(`  metadata with inferredAt      ${one("SELECT COUNT(*) c FROM brain_relationship WHERE metadata LIKE '%inferredAt%'").toLocaleString()}`)
  console.log(`  source symbol joinable        ${one("SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id").toLocaleString()}`)
  db.close()
}

main().catch((e) => {
  console.error("check-enrichment failed:", e)
  process.exitCode = 1
})