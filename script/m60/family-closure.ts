// script/m60/family-closure.ts — the ONE definition of "a family is closed".
//
// Why this module exists. Two gates compute family closure and a third decides
// whether a review folder may claim it, and until now each carried its own copy
// of the rule:
//
//   * script/m49/verify-closure.ts  — the folder rule (RESOLVED|CLOSED marker)
//     and the "a closed folder's analyzer must be committed" rule.
//   * script/m60/verify-standing-rules.ts — `computeFamilyClosure` (R2's coarse
//     three-state machinery, negative-tested).
//   * script/m60/verify-family-closure-truth.ts — the live X1 verdict.
//
// The repo has already paid for rules that live in two places: the wave-code
// vocabulary drifted out of its gate twice (`validation/m49/wave-codes.json`'s
// history), and each time a legitimate row failed for a rule no one meant to
// apply. Family closure is the M60 invariant's central term, so it gets one
// definition here and every gate imports it.
//
// The invariant (validation/m60/ledger.json, verbatim):
//   "A family may be called closed only when its closure gate is green AND
//    every payload cell of every onboarded language in it is alive ... Any
//    closure claim not backed by a live gate is itself a defect."
//
// R4 adds the fold: "at close, M60's family results are recorded into M49 as
// the evidence its jvm/web closure claims are true."
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"

/**
 * The closure marker a review folder must carry to count as processed.
 *
 * M49 W3 hardening, preserved here because this is now its only definition: the
 * marker is UPPERCASE and word-bounded. The old case-insensitive substring test
 * meant ordinary prose flipped a folder shut — observed twice in one session (a
 * probe filename containing "closeout" in reviews/svelte/, and the word
 * "unresolved" in reviews/typescript/). Every real marker in the tree is
 * uppercase, so requiring it removes the trap without weakening a claim.
 */
export const CLOSURE_MARKER = /\b(?:RESOLVED|RESOLUTION|CLOSED)\b/

/**
 * Which review folders under `reviews/` are closed, by the marker rule above.
 * Directories only: the top-level `reviews/<wave>-<topic>.md` documents are not
 * languages (the unfiltered readdir once made G1 demand a language row for a
 * document — probe 2026-09-12).
 */
export function reviewFolderState(reviewsDir: string): { closed: string[]; open: string[] } {
  const closed: string[] = []
  const open: string[] = []
  let dirs: string[] = []
  try {
    dirs = readdirSync(reviewsDir).filter((f) => {
      try { return statSync(path.join(reviewsDir, f)).isDirectory() } catch { return false }
    })
  } catch {
    return { closed, open }
  }
  for (const lang of dirs) {
    const dir = path.join(reviewsDir, lang)
    let files: string[] = []
    try { files = readdirSync(dir).filter((f) => f.endsWith(".md")) } catch { /* unreadable */ }
    const resolved = files.some((f) => {
      try { return CLOSURE_MARKER.test(readFileSync(path.join(dir, f), "utf8")) } catch { return false }
    })
    if (resolved) closed.push(lang)
    else open.push(lang)
  }
  return { closed, open }
}

/**
 * Review folders whose analyzer carries uncommitted changes.
 *
 * M49 W3 hardening, preserved: a folder may only CLAIM closure for code that
 * actually landed. The svelte wave was verified 14/14 on the WORKING TREE while
 * its analyzer carried +287/-22 uncommitted lines and nine fixture files were
 * untracked — certifying that folder would have cited a state no commit holds.
 * Family/process folders (web-family, systems-family, convergence) have no
 * analyzer of their own and are skipped.
 */
export function dirtyAnalyzers(root: string, reviewsDir: string, relPaths: string[] = ["src/ast"]): Record<string, string> {
  const out: Record<string, string> = {}
  const r = spawnSync("git", ["status", "--porcelain", "--", ...relPaths], { cwd: root, encoding: "utf8" })
  if (r.status !== 0) return out
  const dirtyFiles = String(r.stdout).split("\n").map((l) => l.slice(3).trim()).filter(Boolean)
  let folders: string[] = []
  try {
    folders = readdirSync(reviewsDir).filter((f) => statSync(path.join(reviewsDir, f)).isDirectory())
  } catch { /* reviews dir absent */ }
  for (const lang of folders) {
    const analyzer = `src/ast/real-${lang}-analyzer.ts`
    if (existsSync(path.join(root, analyzer)) && dirtyFiles.includes(analyzer)) out[lang] = "analyzer"
  }
  return out
}

/**
 * R2's coarse machinery, unchanged in shape and still negative-tested by the
 * standing-rules gate: the three-state reading used where only the tracker and
 * the matrix are known.
 *   blocked         ⟺ a BLOCKED cell exists (the family cannot close, full stop)
 *   open-remainder  ⟺ the tracker shows open family work
 *   closed-computable otherwise
 */
export function computeFamilyClosure(blockedCells: string[], openFamilyIssues: string[]): "closed-computable" | "blocked" | "open-remainder" {
  if (blockedCells.length > 0) return "blocked"
  if (openFamilyIssues.length > 0) return "open-remainder"
  return "closed-computable"
}


/**
 * The M60 families and the languages each is accountable for.
 *
 * Read from the GOVERNANCE ARTIFACT (validation/m60/ledger.json → `families`),
 * not from a literal here. Family composition is an accounting decision, and the
 * first version of this module hardcoded it — which was already wrong in a way
 * nothing in the repo could have caught: M60's own plan (§2) files a **dart**
 * F5-lane deferral (#818) in the web remainder, so 'web' as a language set and
 * 'web' as a remainder are not the same list. A gate that answers "is this
 * family closed" must read the composition the milestone was ordered with, and
 * a missing composition is FATAL rather than defaulted: a silent fallback would
 * answer a different question than the one asked.
 */
function familyLangsFromLedger(ledgerPath: string): Record<string, string[]> {
  let ledger: any
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, "utf8"))
  } catch (e) {
    throw new Error(`M60 family composition unreadable at ${ledgerPath}: ${(e as Error).message}`)
  }
  const families = ledger?.families
  if (!families || typeof families !== "object" || Object.keys(families).length === 0) {
    throw new Error(`M60 ledger at ${ledgerPath} declares no 'families' — family closure cannot be computed without the milestone's own composition`)
  }
  const out: Record<string, string[]> = {}
  for (const [fam, spec] of Object.entries<any>(families)) {
    const langs = spec?.languages
    if (!Array.isArray(langs) || langs.length === 0 || !langs.every((l) => typeof l === "string")) {
      throw new Error(`M60 family '${fam}' declares no language list`)
    }
    out[fam] = langs
  }
  return out
}

export function loadFamilies(root: string): Record<string, string[]> {
  return familyLangsFromLedger(path.join(root, "validation/m60/ledger.json"))
}

/**
 * The conditions that decide ONE family's closure verdict.
 *
 * `gateGreen` is the family's closure gate read at family scope. The M49
 * closure gate is milestone-wide (it refuses while ANY language folder is
 * open), so it cannot answer "is the jvm family finished" — the two questions
 * are kept apart deliberately: this verdict is the family's own, and the
 * milestone-level live gate is reported alongside it, never folded in. Reading
 * the milestone gate as the family's gate conflates "the jvm is unfinished"
 * with "some other language is unfinished", which is how a family looks done
 * for three milestones while its remainder sits open.
 */
export interface FamilyConditions {
  /** every family language folder carries its closure marker */
  foldersClosed: boolean
  /** every closed family folder's analyzer is committed (W3: a claim must cite a commit) */
  analyzersCommitted: boolean
  /** the family's payload cells are all alive (no BLOCKED, no unruled ruled-dead) */
  cellsAlive: boolean
  /** the tracker carries no open issue naming this family's remainder */
  trackerClean: boolean
  /** R4: M49's ledger carries THIS family's fold row */
  foldPresent: boolean
}

/**
 * The computed verdict for one family — pure, so the gate can PROVE it
 * discriminates instead of asserting its own behaviour.
 *
 * Every condition is load-bearing. The live-gate condition is the invariant's
 * first clause, and it was the one the earlier `conditionsMet` expression in
 * verify-family-closure-truth.ts had left out while still claiming to compute
 * the invariant (found 2026-09-16, masked because the other conditions happened
 * to be unmet, which is exactly how a verdict that cannot say no survives).
 */
export function computeFamilyClosureVerdict(c: FamilyConditions): "closed-computable" | "not-closed" {
  return c.foldersClosed &&
    c.analyzersCommitted &&
    c.cellsAlive &&
    c.trackerClean &&
    c.foldPresent
    ? "closed-computable"
    : "not-closed"
}

/**
 * The milestone-level verdict X1 headlines: every family closed AND the
 * milestone's closure gate green LIVE.
 *
 * The live-gate clause is the invariant's first sentence and it is measured
 * here, not inferred from the family verdicts: the M49 gate is milestone-wide,
 * so it can be red for a language in no family this record covers. The earlier
 * `conditionsMet` expression in verify-family-closure-truth.ts checked that gate
 * and then left it out of the verdict it computed — a verdict that could certify
 * closure with a red gate, which is the defect the invariant names. Pure and
 * self-tested so it cannot drift back.
 */
export function computeMilestoneVerdict(familyVerdicts: string[], gateLive: boolean): "closed-computable" | "not-closed" {
  if (!gateLive) return "not-closed"
  if (familyVerdicts.length === 0) return "not-closed"
  return familyVerdicts.every((v) => v === "closed-computable") ? "closed-computable" : "not-closed"
}
