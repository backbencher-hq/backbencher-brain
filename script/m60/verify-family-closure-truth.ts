// script/m60/verify-family-closure-truth.ts — M60.X1/J1/W1: the closure
// computation that ends "family closed as prose".
//
// The M60 invariant (docs/m60/PLAN.md, verbatim):
//   "A family may be called closed only when its closure gate is green AND
//    every payload cell of every onboarded language in it is alive ... Any
//    closure claim not backed by a live gate is itself a defect."
//
// So family closure here is a COMPUTED VERDICT, not a status string, and it is
// computed PER FAMILY — the invariant's own unit of accounting. Two questions
// live in this file and are never merged:
//
//   family verdict   (jvm, web) — that family's own conditions: its review
//                     folders closed, its analyzers committed, its payload cells
//                     alive, its tracker remainder clean, its R4 fold row landed.
//   milestone verdict X1's headline: both families closed AND the M49 closure
//                     gate green live. The milestone gate returns not-closed
//                     while ANY language folder is open, so reading it as a
//                     family's gate answers the wrong question — "the jvm is
//                     unfinished" and "dart is unfinished" are different facts
//                     and reporting them as one is how a family looks done for
//                     three milestones while its remainder sits open.
//
// Neither verdict can pass silently: every condition is load-bearing, proven by
// the self-test below rather than by reading the expression.
//
// Run: bun script/m60/verify-family-closure-truth.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"
import path from "node:path"
import {
  computeFamilyClosureVerdict, computeMilestoneVerdict, reviewFolderState,
  dirtyAnalyzers as dirtyAnalyzerMap, FAMILY_LANGS, type FamilyConditions,
} from "./family-closure"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUTDIR = path.join(ROOT, "validation/m60/results")
const REVIEWS = path.join(ROOT, "reviews")
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
  if (!existsSync(MATRIX)) { out.blocked.push("(matrix missing)"); return out }
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

/**
 * R4's fold rows, read structurally per family: `foldRecords[family]` in the M49
 * ledger, with a real summary and an evidence file that exists. A family with no
 * row has not folded, and the row is not inferable from prose.
 */
function foldRows(): { present: Record<string, boolean>; detail: Record<string, string> } {
  const present: Record<string, boolean> = { jvm: false, web: false }
  const detail: Record<string, string> = { jvm: "", web: "" }
  if (!existsSync(M49_LEDGER)) return { present, detail }
  let fold: Record<string, any> = {}
  try { fold = JSON.parse(readFileSync(M49_LEDGER, "utf8")).foldRecords ?? {} } catch { return { present, detail } }
  for (const fam of Object.keys(FAMILY_LANGS)) {
    const row = fold[fam]
    if (row && typeof row.summary === "string" && row.summary.trim().length >= 20) {
      const ev = typeof row.evidence === "string" ? row.evidence : ""
      if (ev && !existsSync(path.join(ROOT, ev))) {
        detail[fam] = `row names missing evidence ${ev}`
        continue
      }
      present[fam] = true
      detail[fam] = String(row.summary).slice(0, 140)
    }
  }
  return { present, detail }
}

const ALL_FAMILY_TRUE: FamilyConditions = {
  foldersClosed: true,
  analyzersCommitted: true,
  cellsAlive: true,
  trackerClean: true,
  foldPresent: true,
}

/**
 * The verdicts must be able to say NO — and each condition must be the reason.
 * One all-true case (it can say yes) and one single-condition-false case per
 * condition (each can be the reason it says no). Without the second family the
 * function could `return "closed-computable"` and every other check would still
 * pass, which is how the omitted live-gate condition survived in the expression
 * this file used to carry.
 */
function selfTest(): { cases: number; failures: string[] } {
  const failures: string[] = []
  const keys = Object.keys(ALL_FAMILY_TRUE) as (keyof FamilyConditions)[]
  if (computeFamilyClosureVerdict(ALL_FAMILY_TRUE) !== "closed-computable") {
    failures.push("all family conditions met must yield closed-computable")
  }
  for (const k of keys) {
    const v = computeFamilyClosureVerdict({ ...ALL_FAMILY_TRUE, [k]: false })
    if (v !== "not-closed") failures.push(`a false ${k} must refuse family closure (got ${v})`)
  }
  const both = computeMilestoneVerdict(["closed-computable", "closed-computable"], true)
  if (both !== "closed-computable") failures.push("two closed families with a live gate must yield closed-computable")
  const noGate = computeMilestoneVerdict(["closed-computable", "closed-computable"], false)
  if (noGate !== "not-closed") failures.push("a red milestone gate must refuse closure even with both families closed")
  const oneOpen = computeMilestoneVerdict(["closed-computable", "not-closed"], true)
  if (oneOpen !== "not-closed") failures.push("one open family must refuse the milestone verdict")
  return { cases: keys.length + 4, failures }
}

function main() {
  const head = git(["rev-parse", "HEAD"]) || "unknown"
  const st = selfTest()
  check(`verdict self-test discriminates (${st.cases} cases, every condition load-bearing)`, st.failures.length === 0, st.failures.join("; "))
  const cells = matrixCells()
  const open = openFamilyIssues()
  const ghUnavailable = gh(["issue", "view", "1", "--json", "number"]) === null
  const folders = reviewFolderState(REVIEWS)
  const dirty = dirtyAnalyzerMap(ROOT, REVIEWS)
  const fold = foldRows()

  // (b) and (c) — the payload matrix, shared by both families.
  check("matrix has zero BLOCKED cells", cells.blocked.length === 0, cells.blocked.join(", ") || "(none)")
  check("every ruled-dead cell carries a recorded ruling", cells.rulingsMissing.length === 0, cells.rulingsMissing.join(", ") || "(none)")

  // (d) tracker truth
  if (ghUnavailable) check("tracker reachable (gh)", false, "gh unavailable — cannot verify the remainder")
  else {
    for (const fam of Object.keys(FAMILY_LANGS)) {
      check(`${fam} remainder fully closed on the tracker`, open[fam].length === 0, open[fam].join(" | ") || "(none)")
    }
  }

  // Per-family conditions, from the family's own languages.
  const families: Record<string, { verdict: string; conditions: FamilyConditions; openFolders: string[]; unmoored: string[] }> = {}
  for (const [fam, langs] of Object.entries(FAMILY_LANGS)) {
    const familyOpen = langs.filter((l) => folders.open.includes(l))
    const familyUnmoored = langs.filter((l) => folders.closed.includes(l) && dirty[l] !== undefined)
    const conditions: FamilyConditions = {
      foldersClosed: familyOpen.length === 0,
      analyzersCommitted: familyUnmoored.length === 0,
      cellsAlive: cells.blocked.length === 0 && cells.rulingsMissing.length === 0,
      trackerClean: !ghUnavailable && open[fam].length === 0,
      foldPresent: fold.present[fam],
    }
    families[fam] = {
      verdict: computeFamilyClosureVerdict(conditions),
      conditions,
      openFolders: familyOpen,
      unmoored: familyUnmoored,
    }
    const failing = (Object.keys(conditions) as (keyof FamilyConditions)[]).filter((k) => !conditions[k])
    check(`${fam} family: every condition green`, failing.length === 0,
      failing.length ? `open: ${failing.join(", ")}${familyOpen.length ? ` (folders: ${familyOpen.join(", ")})` : ""}${familyUnmoored.length ? ` (dirty: ${familyUnmoored.join(", ")})` : ""}` : "")
  }

  // (a) the M49 closure gate, live. Measured ONCE and carried into the verdict:
  // the check and the computation must read the same observation.
  const m49Live = m49ClosureGateLive()
  check("M49 closure gate passes live", m49Live, "milestone-level condition: the gate returns not-closed while any language folder is open")

  // Fold record (R4), per family.
  for (const fam of Object.keys(FAMILY_LANGS)) {
    check(`R4 fold row present for ${fam}`, fold.present[fam], fold.detail[fam] || "no foldRecords row in validation/m49/ledger.json")
  }

  const verdict = computeMilestoneVerdict(
    Object.keys(FAMILY_LANGS).map((f) => families[f].verdict),
    m49Live,
  )

  const result = {
    gate: "M60.X1",
    title: "Family closure as a computed boolean (jvm + web), with the fold record",
    at: new Date().toISOString(),
    atCommit: head,
    verdict,
    // The milestone verdict's inputs, named so the record cannot describe a
    // different computation than the one that ran.
    milestoneConditions: {
      familiesClosed: Object.keys(FAMILY_LANGS).filter((f) => families[f].verdict === "closed-computable"),
      familiesOpen: Object.keys(FAMILY_LANGS).filter((f) => families[f].verdict !== "closed-computable"),
      m49ClosureGateLive: m49Live,
    },
    families,
    selfTest: { cases: st.cases, failures: st.failures },
    blockedCells: cells.blocked,
    ruledDeadCells: cells.ruledDead,
    openRemainder: open,
    foldRecord: {
      contract: "R4: M60's family results are recorded into M49 as the evidence its jvm/web closure claims are true",
      rows: fold.present,
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
    familyVerdict: families.jvm?.verdict ?? "unknown",
    familyConditions: families.jvm?.conditions ?? {},
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
    familyVerdict: families.web?.verdict ?? "unknown",
    familyConditions: families.web?.conditions ?? {},
    openIssues: open.web,
    closureReassertion: "through the P1 matrix per the M60 plan, not through closure-report prose",
    verdict: open.web.length === 0 && cells.blocked.length === 0 ? "complete" : "open",
  }
  writeFileSync(path.join(OUTDIR, "W1.json"), JSON.stringify(web, null, 2) + "\n")

  console.log(`closure verdict: ${verdict}`)
  for (const fam of Object.keys(FAMILY_LANGS)) {
    console.log(`  ${fam} family: ${families[fam].verdict}${fold.present[fam] ? " (folded)" : " (no fold row)"}`)
  }
  console.log(`  blocked cells: ${cells.blocked.join(", ") || "(none)"}`)
  console.log(`  open jvm remainder: ${open.jvm.length ? open.jvm.map((s) => s.split(" ")[0]).join(", ") : "(none)"}`)
  console.log(`  open web remainder: ${open.web.length ? open.web.map((s) => s.split(" ")[0]).join(", ") : "(none)"}`)
  console.log(`  M49 closure gate live: ${m49Live}`)
  console.log(`G1-style tally: ${passed} passed, ${failed} failed`)
  for (const f of failures) console.log(`  FAIL: ${f}`)
  console.log(`  → validation/m60/results/{X1,J1,W1}.json`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
