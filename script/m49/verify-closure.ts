// script/m49/verify-closure.ts — M49.X1: closure gate (live re-runs).
//
// Refuses milestone close unless R1 and R2 pass LIVE right now, the ledger is
// conformant, and every review folder on the board is either fully processed
// or carries an explicit open-claims marker that X1 lists honestly.
//
// Run: bun script/m49/verify-closure.ts
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"

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

function main() {
  // Ledger must be governance-clean.
  const gov = runGate("script/m49/verify-governance.ts")
  check("governance passes live", gov)

  // R1 + R2 must pass live right now (never trusted from stored evidence).
  check("R1 intake gate passes live", runGate("script/m49/verify-r1-intake.ts"))
  check("R2 regex gate passes live", runGate("script/m49/verify-r2-regex.ts"))

  // Every tracked language folder must be fully processed before closure:
  // a folder counts as closed only when its review explicitly states RESOLVED
  // or closeout (with a commit hash — R1 enforces that). Open folders REFUSE
  // closure; X1 flips to verified in the ledger only when this gate passes.
  const openFolders: string[] = []
  for (const lang of readdirSync(REVIEWS).filter((f) => {
    const p = path.join(REVIEWS, f)
    return statSync(p).isDirectory()
  })) {
    const dir = path.join(REVIEWS, lang)
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"))
    const resolved = files.some((f) => /RESOLVED|closeout/i.test(readFileSync(path.join(dir, f), "utf8")))
    if (!resolved) openFolders.push(lang)
  }
  check("closure: no open review folders", openFolders.length === 0,
    openFolders.length ? `open: ${openFolders.join(", ")} — process the waves or mark resolutions` : "")

  console.log(`M49.X1: ${passed}/${checks} checks passed${failed ? " — CLOSURE REFUSED" : " — closure admissible"}`)
  if (failed > 0) process.exitCode = 1
}

main()
