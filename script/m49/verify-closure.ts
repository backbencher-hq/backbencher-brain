// script/m49/verify-closure.ts — M49.X1: closure gate (live re-runs).
//
// Refuses milestone close unless R1 and R2 pass LIVE right now, the ledger is
// conformant, and every review folder on the board is either fully processed
// or carries an explicit open-claims marker that X1 lists honestly.
//
// Run: bun script/m49/verify-closure.ts
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
// The folder rule and the dirty-analyzer rule have ONE definition, shared with
// M60's family-closure computation (script/m60/family-closure.ts). This gate
// used to carry its own copies; two definitions of "a family is closed" is how
// the wave-code vocabulary drifted out of its gate twice.
import { reviewFolderState, dirtyAnalyzers as dirtyAnalyzerMap } from "../m60/family-closure"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const REVIEWS = path.join(ROOT, "reviews")

let checks = 0, passed = 0, failed = 0
function check(name: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`) }
}

function runGate(script: string): boolean {
  const r = spawnSync("bun", [script], { cwd: ROOT, encoding: "utf8", timeout: 300_000 })
  return r.status === 0
}

// Map a review folder to its analyzer file and report the ones with uncommitted
// changes. Family/process folders (web-family, systems-family, convergence) have
// no analyzer of their own and are skipped. Defined in script/m60/family-closure.ts.
const dirtyAnalyzers = () => dirtyAnalyzerMap(ROOT, REVIEWS)

function main() {
  // Ledger must be governance-clean.
  const gov = runGate("script/m49/verify-governance.ts")
  check("governance passes live", gov)

  // R1 + R2 must pass live right now (never trusted from stored evidence).
  check("R1 intake gate passes live", runGate("script/m49/verify-r1-intake.ts"))
  check("R2 regex gate passes live", runGate("script/m49/verify-r2-regex.ts"))
  // G6: the census must be anchored to committed blobs, not to a dirty tree.
  // Without this, R2 can pass on a census that describes a tree no commit
  // ever contained (verified: the census committed at HEAD was dirty-derived).
  check("G6 census-lineage gate passes live", runGate("script/m49/verify-census-lineage.ts"))
  // G8: every evidence identity has exactly one producer, and every id the
  // honesty gate requires is produced by a gate that runs in the battery. An
  // unwired producer's artifact is overwritten by whoever runs next — which is
  // how three strengthened gates silently lost their evidence (W8).
  check("G8 evidence-identity gate passes live", runGate("script/m49/verify-evidence-identity.ts"))

  // Every tracked language folder must be fully processed before closure:
  // a folder counts as closed only when its review explicitly states RESOLVED
  // or CLOSED (with a commit hash — R1 enforces that). Open folders REFUSE
  // closure; X1 flips to verified in the ledger only when this gate passes.
  //
  // The marker rule (UPPERCASE, word-bounded — M49 W3 hardening) lives in
  // script/m60/family-closure.ts, together with the family split that reads it
  // at family scope. One definition, two gates.
  const { closed: closedFolders, open: openFolders } = reviewFolderState(REVIEWS)
  check("closure: no open review folders", openFolders.length === 0,
    openFolders.length ? `open: ${openFolders.join(", ")} — process the waves or mark resolutions` : "")

  // M49 W3 hardening: a folder may only CLAIM closure for code that actually
  // landed. The svelte wave was verified 14/14 on the WORKING TREE while its
  // analyzer carried +287/-22 uncommitted lines and nine fixture files were
  // untracked — certifying that folder would have cited a state no commit holds.
  // A closure claim is therefore refused while the language's analyzer is dirty.
  const dirty = dirtyAnalyzers()
  const unmoored = closedFolders.filter((l) => dirty[l] !== undefined)
  check("closure: every closed folder's analyzer is committed", unmoored.length === 0,
    unmoored.length ? unmoored.map((l) => `${l} (${dirty[l]} uncommitted)`).join(", ") + " — land the wave, then certify" : "")

  console.log(`M49.X1: ${passed}/${checks} checks passed${failed ? " — CLOSURE REFUSED" : " — closure admissible"}`)
  if (failed > 0) process.exitCode = 1
}

main()
