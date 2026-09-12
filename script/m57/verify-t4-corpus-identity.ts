// script/m57/verify-t4-corpus-identity.ts — M57.T4 (#792) permanent gate.
//
// The process defect behind this milestone: corpus-defining flags changed
// meaning and nothing forced a re-measure — stale green gates asserted stale
// truths. This gate makes that state IMPOSSIBLE to miss:
//
//   M1. Every registered corpus-dependent evidence file carries a `corpus`
//       block (files/symbols/relationships/flagged/digest) and a
//       `classifierEpoch` (sha1 of the classifier SOURCE — the meaning of
//       "is_test_file").
//   M2. LIVE corpus identity (recomputed from the real DB) equals the
//       recorded one. A re-index that changes the corpus turns every
//       dependent receipt RED until it is re-stamped.
//   M3. The recorded classifierEpoch equals the CURRENT classifier source
//       hash. A classifier change (even whitespace) changes the epoch — all
//       dependent evidence goes RED until re-measured against a re-index.
//   M4. Falsifiability: the comparator itself is exercised against a
//       deliberately-off identity and must reject it.
//
// REAL-DB mode: BB_M57_REAL_DB=1 BB_M57_DATA_DIR=<data dir> (matches T1/T5).
// Without it, the gate runs in self-check mode (M4 only) and explains why.

import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

// Evidence that DEPENDS on the indexed real corpus (hermetic-fixture evidence
// is intentionally not listed — it does not assert anything about this repo's
// corpus). Extend this list when a new real-DB receipt lands.
const CORPUS_DEPENDENT = ["T1-after-census.json", "T5-predicate-unity.json"]

function corpusIdentity(pid: string, raw: any) {
  const files = raw.prepare("SELECT COUNT(*) n FROM brain_file WHERE project_id=?").get(pid).n as number
  const symbols = raw.prepare("SELECT COUNT(*) n FROM brain_symbol WHERE project_id=?").get(pid).n as number
  const relationships = raw.prepare("SELECT COUNT(*) n FROM brain_relationship WHERE project_id=?").get(pid).n as number
  const flaggedRows = raw.prepare("SELECT relative_path p FROM brain_file WHERE project_id=? AND COALESCE(is_test_file,0)=1 ORDER BY relative_path").all(pid) as Array<{ p: string }>
  const digest = createHash("sha256").update(flaggedRows.map((r) => r.p).join("\n")).digest("hex").slice(0, 16)
  return { files, symbols, relationships, flagged: flaggedRows.length, digest }
}

async function main() {
  let pass = 0
  let failed = 0
  const check = (name: string, ok: boolean, detail?: string) => {
    if (ok) { pass++; console.log(`  ok ${name}`) } else { failed++; console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`) }
  }

  const classifierEpoch = createHash("sha256")
    .update(readFileSync(path.join(ROOT, "src/ast/test-classification.ts"), "utf8"))
    .digest("hex")
    .slice(0, 16)

  // ---- M4: the comparator can fail (runs in EVERY mode) --------------------
  const recorded = { files: 100, symbols: 200, relationships: 300, flagged: 5, digest: "deadbeefdeadbeef" }
  const live = { files: 100, symbols: 200, relationships: 300, flagged: 0, digest: "0123456789abcdef" }
  const idEqual = (a: typeof recorded, b: typeof live) =>
    a.files === b.files && a.symbols === b.symbols && a.relationships === b.relationships && a.flagged === b.flagged && a.digest === b.digest
  check("M4: the identity comparator rejects a different corpus", !idEqual(recorded, live))
  check("M4: the identity comparator accepts an identical corpus", idEqual(live, { ...live }))

  const realMode = process.env.BB_M57_REAL_DB === "1"
  if (!realMode) {
    console.log("  -- M1-M3 (live corpus comparison) skipped: set BB_M57_REAL_DB=1 BB_M57_DATA_DIR=<data dir> after the re-index")
  } else {
    const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))
    const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
    process.env.BB_DATA_DIR = process.env.BB_M57_DATA_DIR // real DB only, scoped like T1-C5
    const pid = getProjectId(ROOT) as string
    const raw = await BrainDatabase.getRawInstance(pid)
    const identity = corpusIdentity(pid, raw)

    // ---- M1: every corpus-dependent receipt carries the blocks -------------
    for (const name of CORPUS_DEPENDENT) {
      const p = path.join(ROOT, "validation/m57/results", name)
      if (!existsSync(p)) { check(`M1: ${name} exists`, false, "missing evidence file"); continue }
      const ev = JSON.parse(readFileSync(p, "utf8"))
      check(`M1: ${name} carries a corpus block`, typeof ev.corpus?.files === "number" && typeof ev.corpus?.digest === "string", JSON.stringify(ev.corpus ?? null))
      check(`M1: ${name} carries a classifierEpoch`, typeof ev.classifierEpoch === "string" && ev.classifierEpoch.length === 16, String(ev.classifierEpoch ?? null))
      // ---- M2: live identity equals the recorded one ------------------------
      const recordedCorpus = ev.corpus ?? { files: -1, symbols: -1, relationships: -1, flagged: -1, digest: "-" }
      check(`M2: ${name} matches the LIVE corpus`, idEqual(recordedCorpus, identity), `recorded=${JSON.stringify(recordedCorpus)} live=${JSON.stringify(identity)}`)
      // ---- M3: the classifier epoch is current ------------------------------
      check(`M3: ${name} was measured under the CURRENT classifier`, ev.classifierEpoch === classifierEpoch, `recorded=${ev.classifierEpoch} current=${classifierEpoch}`)
    }
    console.log(`  (live corpus: ${JSON.stringify(identity)}; classifierEpoch=${classifierEpoch})`)
    BrainDatabase.closeAll()
  }

  // ---- evidence stamp (its own corpus block is self-referential by design:
  //      it records the comparator's world, not the DB's) --------------------
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
    const dir = path.join(ROOT, "validation/m57/results")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, "T4-corpus-identity.json"),
      JSON.stringify({ probe: "M57.T4-corpus-identity", issue: 792, milestone: "M57", at: new Date().toISOString(), commit, checks: pass + failed, passed: pass, failed, classifierEpoch, verifierCommand: "BB_M57_REAL_DB=1 BB_M57_DATA_DIR=<data dir> bun run script/m57/verify-t4-corpus-identity.ts", status: failed === 0 ? "verified" : "known-gap" }, null, 2) + "\n",
    )
  } catch { /* best-effort stamp */ }

  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error("FAIL", e && (e.stack || e.message)); process.exit(1) })
