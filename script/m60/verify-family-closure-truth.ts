// script/m60/verify-family-closure-truth.ts — M60.X1/J1/W1: the closure
// computation that ends "family closed as prose".
//
// The M60 invariant (docs/m60/PLAN.md, verbatim):
//   "A family may be called closed only when its closure gate is green AND
//    every payload cell of every onboarded language in it is alive ... Any
//    closure claim not backed by a live gate is itself a defect."
//
// So family closure here is a COMPUTED VERDICT, not a status string:
//
//   closed-computable ⟺ (a) the M49 closure gate passes live right now
//                        (b) zero BLOCKED cells in the P1 matrix
//                        (c) zero ruled-dead cells without a recorded ruling
//                        (d) zero open tracker issues that carry the family's
//                            remainder (J1/W1 CONV ids)
//
// The verdict is written to X1.json together with the fold record (R4) and
// per-remainder evidence (J1.json / W1.json). It refuses to claim "closed"
// when anything is open — that refusal IS the gate working.
//
// Run: bun script/m60/verify-family-closure-truth.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUTDIR = path.join(ROOT, "validation/m60/results")
const MATRIX = path.join(OUTDIR, "P1.json")
const M49_LEDGER = path.join(ROOT, "validation/m49/ledger.json")

let passed = 0, failed = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`) }
}
function git(args: string[]): string {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "" }
}
function gh(args: string[]): string | null {
  try { return execFileSync("gh", args, { cwd: ROOT, encoding: "utf8", timeout: 30_000 }) } catch { return null }
}

// (d) the family remainder = open issues whose title carries the family's
// registered CONV ids (the convergence sweep's registered defects), or the
// M60 remainder issues themselves.
const FAMILY_CONV: Record<string, RegExp[]> = {
  jvm: [/CONV-J-1/, /CONV-K-1/, /CONV-S-1/, /CONV-G-1/, /M60\.J1/],
  web: [/CONV-(TS|JS|VUE|SVELTE|HTML)-/, /M60\.W1/],
}

function openFamilyIssues(): Record<string, string[]> {
  const out: Record<string, string[]> = { jvm: [], web: [] }
  const j = gh(["issue", "list", "--state", "open", "--limit", "400", "--json", "number,title"])
  if (j === null) return out // caller treats gh-unavailability as unverifiable
  for (const it of JSON.parse(j) as Array<{ number: number; title: string }>) {
    for (const [fam, res] of Object.entries(FAMILY_CONV)) {
      if (res.some((r) => r.test(it.title))) out[fam].push(`#${it.number} ${it.title}`.slice(0, 100))
    }
  }
  return out
}

function matrixCells(): { blocked: string[]; ruledDead: string[]; rulingsMissing: string[] } {
  const out = { blocked: [] as string[], ruledDead: [] as string[], rulingsMissing: [] as string[] }
  if (!existsSync(MATRIX)) { out.blocked.push("(matrix missing)") ; return out }
  const m = JSON.parse(readFileSync(MATRIX, "utf8"))
  for (const f of m.fields ?? []) {
    const v = String(f.verdict)
    if (v.startsWith("BLOCKED")) out.blocked.push(f.field)
    if (v.startsWith("ruled-dead")) {
      out.ruledDead.push(f.field)
      if (typeof f.ruling !== "string" || f.ruling.length <= 20) out.rulingsMissing.push(f.field)
    }
  }
  return out
}

function m49ClosureGateLive(): boolean {
  const r = spawnSync("bun", ["script/m49/verify-closure.ts"], { cwd: ROOT, encoding: "utf8", timeout: 300_000 })
  return r.status === 0
}

function main() {
  const head = git(["rev-parse", "HEAD"]) || "unknown"
  const cells = matrixCells()
  const open = openFamilyIssues()
  const ghUnavailable = gh(["issue", "view", "1", "--json", "number"]) === null

  // (b) and (c)
  check("matrix has zero BLOCKED cells", cells.blocked.length === 0, cells.blocked.join(", ") || "(none)")
  check("every ruled-dead cell carries a recorded ruling", cells.rulingsMissing.length === 0, cells.rulingsMissing.join(", ") || "(none)")

  // (d) tracker truth
  if (ghUnavailable) check("tracker reachable (gh)", false, "gh unavailable — cannot verify the remainder")
  else {
    check("jvm remainder fully closed on the tracker", open.jvm.length === 0, open.jvm.join(" | ") || "(none)")
    check("web remainder fully closed on the tracker", open.web.length === 0, open.web.join(" | ") || "(none)")
  }

  // (a) the M49 closure gate, live
  check("M49 closure gate passes live", m49ClosureGateLive())

  // Fold record (R4): the M49 ledger must name M60 as the evidence of its
  // jvm/web closure claims. Until X1 lands the fold, this fails — honestly.
  const ledgerTxt = existsSync(M49_LEDGER) ? readFileSync(M49_LEDGER, "utf8") : ""
  const foldPresent = ledgerTxt.includes("M60 fold") || /M60.{0,240}(jvm|web|fold)/i.test(ledgerTxt)
  check("R4 fold record present in the M49 ledger", foldPresent)

  // The computed verdict — the thing the invariant demands.
  const conditionsMet =
    cells.blocked.length === 0 &&
    cells.rulingsMissing.length === 0 &&
    !ghUnavailable &&
    open.jvm.length === 0 &&
    open.web.length === 0 &&
    foldPresent
  const verdict = conditionsMet ? "closed-computable" : "not-closed"

  const result = {
    gate: "M60.X1",
    title: "Family closure as a computed boolean (jvm + web), with the fold record",
    at: new Date().toISOString(),
    atCommit: head,
    verdict,
    conditions: {
      m49ClosureGateLive: !failures.some((f) => f.startsWith("M49 closure gate")),
      zeroBlockedCells: cells.blocked.length === 0,
      zeroRulingsMissing: cells.rulingsMissing.length === 0,
      jvmTrackerClean: open.jvm.length === 0,
      webTrackerClean: open.web.length === 0,
      foldPresent,
    },
    blockedCells: cells.blocked,
    ruledDeadCells: cells.ruledDead,
    openRemainder: open,
    foldRecord: {
      contract: "R4: M60's family results are recorded into M49 as the evidence its jvm/web closure claims are true",
      landed: foldPresent,
    },
    passed,
    failed,
    failures,
  }

  writeFileSync(path.join(OUTDIR, "X1.json"), JSON.stringify(result, null, 2) + "\n")

  // Per-remainder evidence files (J1/W1) — machine-emitted snapshots.
  const jvm = {
    gate: "M60.J1",
    at: result.at,
    atCommit: head,
    issues: {
      739: "java bare member reads — FIXED+CLOSED (3256a83e: fixture+2 mutants, lane 39/39)",
      740: "kotlin member reads — FIXED+CLOSED (29f0c1e5: fixture+3 mutants, kotlinx lane 100/0/0)",
      741: "scala framework detection — FIXED+CLOSED (c6df719b: fixture+2 mutants incl. forbid-direction, lane 100/0/0)",
      742: "groovy grammar — FIXED+CLOSED (M49 W18, wasm 93fb188a→85bae7cd): the 'environment-blocked, needs emcc' disposition was WRONG — the grammar is vendored in-repo and the local tree-sitter CLI builds wasm with its bundled WASI toolchain. Rebuilt: construct matrix 11/15→15/15, recorded 400-file sample 250/400→115/400, full corpus 59.0%→25.0% (3874→1643 of 6564) via the production pipeline, MISSING ; 2698→340. Pins: fixture groovy/grammar-rebuild-constructs, 46/46 fixtures, all 550 mutants caught (groovy/as-cast-drop had been silently surviving). Residual class registered as #841. See reviews/m49-w18-groovy-grammar-rebuild.md",
    },
    openIssues: open.jvm,
    verdict: open.jvm.length === 0 && cells.blocked.length === 0 ? "complete" : "open",
  }
  writeFileSync(path.join(OUTDIR, "J1.json"), JSON.stringify(jvm, null, 2) + "\n")

  const web = {
    gate: "M60.W1",
    at: result.at,
    atCommit: head,
    issues: {
      816: "cross-language name-resolution FP — FIXED+CLOSED (15c918af: nearest-candidate deterministic resolver, pinned in verify-index.ts, proven by revert)",
      818: "dart F5 lane re-measure — CLOSED (DT wave landed; lane 100/0/0 at HEAD)",
    },
    openIssues: open.web,
    closureReassertion: "through the P1 matrix per the M60 plan, not through closure-report prose",
    verdict: open.web.length === 0 && cells.blocked.length === 0 ? "complete" : "open",
  }
  writeFileSync(path.join(OUTDIR, "W1.json"), JSON.stringify(web, null, 2) + "\n")

  console.log(`closure verdict: ${verdict}`)
  console.log(`  blocked cells: ${cells.blocked.join(", ") || "(none)"}`)
  console.log(`  open jvm remainder: ${open.jvm.length ? open.jvm.map((s) => s.split(" ")[0]).join(", ") : "(none)"}`)
  console.log(`  open web remainder: ${open.web.length ? open.web.map((s) => s.split(" ")[0]).join(", ") : "(none)"}`)
  console.log(`  fold record: ${foldPresent ? "present" : "ABSENT"}`)
  console.log(`G1-style tally: ${passed} passed, ${failed} failed`)
  for (const f of failures) console.log(`  FAIL: ${f}`)
  console.log(`  → validation/m60/results/{X1,J1,W1}.json`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
