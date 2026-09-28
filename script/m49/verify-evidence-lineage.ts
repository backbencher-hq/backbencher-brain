// script/m49/verify-evidence-lineage.ts — M49 #761 process gate (half 2 of 2).
//
// Half 1 (in evidence-harness.ts): evidence writes are ATOMIC (tmp+rename) and
// every freshly emitted artifact carries regeneratedAtCommit + regeneratedAt.
//
// Half 2 (this file): every evidence file on disk CARRIES the lineage —
// an artifact written before the gate (or hand-truncated by a crashed
// parallel run, the exact #761 incident) fails loudly instead of silently
// standing in as current truth. Parse failures are failures too: a JSON file
// that cannot be read is not evidence.
//
// Allowance: __LEGACY__ lineage means "emitted before the #761 gate existed".
// Legacy entries are counted and reported so the backlog is visible, but only
// FAIL the gate when the evidence file's own commit claim no longer exists in
// this repository's history (provably unmoored). Regenerating is always the
// fix: `bun run script/m14/mutate-analyzer.ts` / the gate that owns the file.
//
// Run: bun run script/m49/verify-evidence-lineage.ts
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m14/results")

let passed = 0, failed = 0, legacy = 0
const failures: string[] = []

function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

function commitExists(hash: string): boolean {
  try {
    execFileSync("git", ["cat-file", "-e", `${hash}^{commit}`], { cwd: ROOT, stdio: "pipe" })
    return true
  } catch { return false }
}

function main() {
  if (!existsSync(RESULTS)) {
    check("results dir exists", false, RESULTS)
    return finish()
  }
  const files = readdirSync(RESULTS).filter((f) => f.startsWith("M14.") && f.endsWith(".json")).sort()
  check("evidence files present", files.length > 0, `${files.length} files`)
  for (const f of files) {
    const p = path.join(RESULTS, f)
    let parsedOk = false
    let ev: any
    try {
      ev = JSON.parse(readFileSync(p, "utf8"))
      parsedOk = true
    } catch {
      parsedOk = false
    }
    check(`${f} parses`, parsedOk, parsedOk ? "" : "unparseable JSON — truncated or corrupted evidence (#761 incident class)")
    if (!parsedOk) continue
    const lineage = ev.regeneratedAtCommit
    if (lineage === "__LEGACY__") {
      legacy++
      const c = ev.commit
      const moored = !(typeof c === "string" && /^[0-9a-f]{40}$/.test(c) && !commitExists(c))
      check(`${f} legacy but moored`, moored, moored ? "" : `commit ${String(c).slice(0, 10)} absent from history — regenerate`)
      continue
    }
    const hasCommit = typeof lineage === "string" && /^[0-9a-f]{40}$/.test(lineage)
    check(`${f} carries regeneratedAtCommit`, hasCommit, hasCommit ? "" : `got: ${JSON.stringify(lineage)}`)
    const hasTime = typeof ev.regeneratedAt === "string" && !Number.isNaN(Date.parse(ev.regeneratedAt))
    check(`${f} carries regeneratedAt`, hasTime, hasTime ? "" : `got: ${JSON.stringify(ev.regeneratedAt)}`)
  }
  if (legacy > 0) console.log(`note: ${legacy} legacy (pre-#761) evidence file(s) — regenerate at next full-sweep refresh to clear`)
  finish()
}

function finish() {
  console.log(`M49 #761 evidence-lineage: ${passed} passed, ${failed} failed, ${legacy} legacy @ ${currentCommit().slice(0, 10)}`)
  if (failed > 0) {
    console.error(`evidence-lineage FAILED:\n  ${failures.join("\n  ")}`)
    process.exitCode = 1
  }
}

function currentCommit(): string {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" }
}

main()
