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
  dirtyAnalyzers as dirtyAnalyzerMap, loadFamilies, familyRemaindersNamedBy,
  loadFamilyRemainderRegistry, foldOwed, type FamilyConditions, type FamilyRemainderRegistry,
  type IssueLike,
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

// (d) the family remainder = open issues that name the family's remainder. The
// rule itself is one definition in ./family-closure (an issue is this family's
// remainder when it IS the registered remainder issue, or carries a registered
// code, or names one of the family's registered languages as a WHOLE WORD) —
// this function only reads the tracker and hands it over.
//
// The previous implementation matched five literal legacy codes and, measured
// against the live tracker on 2026-09-16, detected zero of 115 open issues for
// either family while the jvm's own registered residual (#841 groovy) and two
// web issues (#868, #834) were open. See the module comment for the measurement.
function openFamilyIssues(registry: Record<string, FamilyRemainderRegistry>): Record<string, { number: number; title: string; why: string }[]> {
  const empty: Record<string, { number: number; title: string; why: string }[]> = {}
  for (const fam of Object.keys(registry)) empty[fam] = []
  const j = gh(["issue", "list", "--state", "open", "--limit", "400", "--json", "number,title"])
  if (j === null) return empty // caller treats gh-unavailability as unverifiable
  const issues = JSON.parse(j) as IssueLike[]
  return familyRemaindersNamedBy(issues, registry)
}

/**
 * Self-test for the classifier, in BOTH directions. A rule that cannot say no
 * is the defect this milestone was opened for, so the negatives are the point:
 * a title naming only another language must open nothing, and `java` must not
 * match inside `JavaScript` — the whole-word rule is what keeps the families
 * from contaminating each other.
 */
function classifierSelfTest(): { cases: number; failures: string[] } {
  const reg: Record<string, FamilyRemainderRegistry> = {
    jvm: { languages: ["java", "kotlin", "scala", "groovy"], codes: [/CONV-J-1/, /M60\.J1/], remainderIssue: 830 },
    web: { languages: ["typescript", "javascript", "vue", "svelte"], codes: [/CONV-(TS|JS)-/, /M60\.W1/], remainderIssue: 831 },
    // The oo family is in the self-test since 2026-09-21 so the cross-family
    // isolation is asserted WITH a third family present, not assumed.
    oo: { languages: ["csharp", "dart", "objc", "php", "python", "ruby", "swift"], codes: [/CONV-(CS|RB|PY|DART|PHP|SW|OC)-/] },
  }
  const f: string[] = []
  let cases = 0
  const named = (number: number, title: string) => familyRemaindersNamedBy([{ number, title }], reg)
  const expect = (label: string, ok: boolean) => { cases++; if (!ok) f.push(label) }

  expect("a family language named in a title is caught", named(1, "Groovy grammar residual parse failures").jvm.length === 1)
  expect("matching is case-insensitive", named(1, "KOTLIN emits no member uses").jvm.length === 1)
  expect("'JavaScript' does not match the jvm language 'java'", named(1, "javascript has no decorator-metadata layer").jvm.length === 0)
  expect("a web language opens the web family", named(1, "javascript has no decorator-metadata layer").web.length === 1)
  expect("a registered code is caught without a language name", named(1, "CONV-J-1 member reads are lost").jvm.length === 1)
  expect("the registered remainder issue is caught by number", named(830, "some unrelated title").jvm.length === 1)
  expect("an unrelated title opens no family", named(1, "M56.L1 Languages Substance on the Homepage").jvm.length === 0 && named(1, "M56.L1 Languages Substance on the Homepage").web.length === 0)
  expect("a language in NO family opens nothing", named(1, "rust RSD7 framework detection").jvm.length === 0 && named(1, "rust RSD7 framework detection").web.length === 0 && named(1, "rust RSD7 framework detection").oo.length === 0)
  // oo-specific positives and the isolation in the other direction: a lane the
  // oo family owns must NOT open jvm or web, and a lane it does not own must not
  // open oo. dart is the sharp case — it was web's `remainderLanes` in the
  // ledger, so a naive classifier would open web for a dart title.
  expect("a lane the oo family owns opens oo and only oo", named(1, "dart second review wave: DT2-A/B").oo.length === 1 && named(1, "dart second review wave: DT2-A/B").jvm.length === 0 && named(1, "dart second review wave: DT2-A/B").web.length === 0)
  expect("the `objective-c` spelling matches the `objc` registry name", named(1, "M49.OC1 ObjC first review wave").oo.length === 1)
  expect("an oo CONV code is caught without a language name", named(1, "M49-CONV: CONV-PY-1 framework detection is dead code").oo.length === 1)
  expect("a jvm language does not open oo", named(1, "groovy grammar residual").oo.length === 0)
  return { cases, failures: f }
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
function foldRows(familyNames: string[]): { present: Record<string, boolean>; detail: Record<string, string> } {
  const present: Record<string, boolean> = {}
  const detail: Record<string, string> = {}
  for (const fam of familyNames) { present[fam] = false; detail[fam] = "" }
  if (!existsSync(M49_LEDGER)) return { present, detail }
  let fold: Record<string, any> = {}
  try { fold = JSON.parse(readFileSync(M49_LEDGER, "utf8")).foldRecords ?? {} } catch { return { present, detail } }
  for (const fam of familyNames) {
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
  const FAMILY_LANGS = loadFamilies(ROOT)
  const st = selfTest()
  check(`verdict self-test discriminates (${st.cases} cases, every condition load-bearing)`, st.failures.length === 0, st.failures.join("; "))
  const cells = matrixCells()
  const remainderRegistry = loadFamilyRemainderRegistry(ROOT)
  const open = openFamilyIssues(remainderRegistry)
  const ghUnavailable = gh(["issue", "view", "1", "--json", "number"]) === null
  const cst = classifierSelfTest()
  check(`remainder classifier discriminates (${cst.cases} cases, both directions)`, cst.failures.length === 0, cst.failures.join("; "))
  const folders = reviewFolderState(REVIEWS)
  const dirty = dirtyAnalyzerMap(ROOT, REVIEWS)
  const fold = foldRows(Object.keys(FAMILY_LANGS))

  // (b) and (c) — the payload matrix, shared by both families.
  check("matrix has zero BLOCKED cells", cells.blocked.length === 0, cells.blocked.join(", ") || "(none)")
  check("every ruled-dead cell carries a recorded ruling", cells.rulingsMissing.length === 0, cells.rulingsMissing.join(", ") || "(none)")

  // (d) tracker truth
  if (ghUnavailable) check("tracker reachable (gh)", false, "gh unavailable — cannot verify the remainder")
  else {
    for (const fam of Object.keys(FAMILY_LANGS)) {
      check(`${fam} remainder fully closed on the tracker`, open[fam].length === 0,
        open[fam].map((o) => `#${o.number} [${o.why}] ${o.title}`.slice(0, 110)).join(" | ") || "(none)")
    }
  }

  // Per-family conditions, from the family's own languages.
  const families: Record<string, { verdict: string; conditions: FamilyConditions; openFolders: string[]; unmoored: string[] }> = {}
  for (const [fam, langs] of Object.entries(FAMILY_LANGS)) {
    const familyOpen = langs.filter((l) => folders.open.includes(l))
    // A family language with NO review folder appears in neither list, so the old
    // `familyOpen.length === 0` was vacuously TRUE for it — a false green on the
    // condition that certifies the family's review work exists at all. python is
    // the first family language to expose it (reviews/python does not exist), so
    // the condition now states what it means: every family language's review
    // folder must be CLOSED, not merely "none open".
    const familyMissing = langs.filter((l) => !folders.closed.includes(l) && !folders.open.includes(l))
    const familyUnmoored = langs.filter((l) => folders.closed.includes(l) && dirty[l] !== undefined)
    const conditions: FamilyConditions = {
      foldersClosed: langs.every((l) => folders.closed.includes(l)),
      analyzersCommitted: familyUnmoored.length === 0,
      cellsAlive: cells.blocked.length === 0 && cells.rulingsMissing.length === 0,
      trackerClean: !ghUnavailable && open[fam].length === 0,
      foldPresent: fold.present[fam],
    }
    families[fam] = {
      verdict: computeFamilyClosureVerdict(conditions),
      conditions,
      openFolders: familyOpen,
      missingFolders: familyMissing,
      unmoored: familyUnmoored,
    }
    const failing = (Object.keys(conditions) as (keyof FamilyConditions)[]).filter((k) => !conditions[k])
    check(`${fam} family: every condition green`, failing.length === 0,
      failing.length ? `open: ${failing.join(", ")}${familyOpen.length ? ` (folders: ${familyOpen.join(", ")})` : ""}${familyMissing.length ? ` (no folder: ${familyMissing.join(", ")})` : ""}${familyUnmoored.length ? ` (dirty: ${familyUnmoored.join(", ")})` : ""}` : "")
  }

  // (a) the M49 closure gate, live. Measured ONCE and carried into the verdict:
  // the check and the computation must read the same observation.
  const m49Live = m49ClosureGateLive()
  check("M49 closure gate passes live", m49Live, "milestone-level condition: the gate returns not-closed while any language folder is open")

  // Fold record (R4), per family. The owing condition is `foldOwed` — the ONE
  // definition of the accepted D1 decision, shared with G1's R4 rather than
  // restated here (see its header for why the trigger excludes the family's own
  // fold-present condition). Demanding a row unconditionally would read
  // identically for "this family has not been processed" and "this family is
  // ready and the fold is missing", and would pressure a family to land a fold
  // row before its waves are done.
  for (const fam of Object.keys(FAMILY_LANGS)) {
    const c = families[fam].conditions
    const owed = foldOwed(c, fold.present[fam])
    check(
      `R4 fold row present for ${fam}`,
      !owed,
      owed
        ? fold.detail[fam] || "no foldRecords row in validation/m49/ledger.json"
        : fold.present[fam]
          ? ""
          : `not yet owed — ${fam} is not otherwise ready: ${(Object.keys(c) as (keyof FamilyConditions)[]).filter((k) => k !== "foldPresent" && !c[k]).join(", ") || "(all other conditions green)"}`,
    )
  }

  const verdict = computeMilestoneVerdict(
    Object.keys(FAMILY_LANGS).map((f) => families[f].verdict),
    m49Live,
  )

  const result = {
    gate: "M60.X1",
    title: "Family closure as a computed boolean (jvm + web + oo), with the fold record",
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
    remainderClassifier: {
      contract: "an open issue names a family's remainder when it IS the registered remainder issue, or carries a registered code, or names one of the family's registered languages as a whole word",
      selfTest: { cases: cst.cases, failures: cst.failures },
    },
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
  for (const fam of Object.keys(FAMILY_LANGS)) {
    console.log(`  open ${fam} remainder: ${open[fam].length ? open[fam].map((o) => `#${o.number} (${o.why})`).join(", ") : "(none)"}`)
  }
  console.log(`  M49 closure gate live: ${m49Live}`)
  console.log(`G1-style tally: ${passed} passed, ${failed} failed`)
  for (const f of failures) console.log(`  FAIL: ${f}`)
  console.log(`  → validation/m60/results/{X1,J1,W1}.json`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
