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
/**
 * Analyzers whose file is NOT `real-<lang>-analyzer.ts`.
 *
 * Found 2026-09-21 while adding the `oo` family: objc's analyzer is
 * `src/ast/real-objective-c-analyzer.ts`, so the convention lookup in
 * `dirtyAnalyzers` reported "no analyzer" for it — and then the rule "a closed
 * folder's analyzer must be committed" had nothing to check on the one lane whose
 * file is spelled differently. A rule that cannot see the file cannot fail, which
 * is the false-green shape this module exists to remove.
 */
export const ANALYZER_FILE_ALIAS: Record<string, string> = {
  objc: "real-objective-c-analyzer.ts",
}

/** The repo-relative analyzer path for a language, alias-aware. */
export function analyzerFileFor(lang: string): string {
  return `src/ast/${ANALYZER_FILE_ALIAS[lang] ?? `real-${lang}-analyzer.ts`}`
}

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
    const analyzer = analyzerFileFor(lang)
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

// ============================================================================
// The tracker half of `trackerClean`: WHICH OPEN ISSUES NAME A FAMILY'S
// REMAINDER. One definition, in the module the gates already import.
//
// Why this lives here, and why it was rewritten (2026-09-16). The condition's
// own contract is "the tracker carries no open issue naming this family's
// remainder", but the implementation matched only five literal legacy codes
// (`CONV-J-1`, `CONV-K-1`, `CONV-S-1`, `CONV-G-1`, `M60.J1` for jvm). Measured
// against the live tracker: that classifier detected **zero** of the 115 open
// issues for either family, while a groovy grammar defect (#841 — the
// registered residual of the jvm remainder's own #742) and two web issues
// (#868 javascript, #834 javascript/typescript) were open. A false green on the
// one condition that reads the outside world is the failure mode M60 exists to
// kill, so the rule is now the registry's own: an issue names a family's
// remainder when it is the family's registered remainder issue, or carries one
// of the family's registered codes, or **names one of the family's registered
// languages as a whole word**. The language list is NOT a literal here — it is
// the milestone's own composition (`validation/m60/ledger.json` → `families`),
// read by `loadFamilyRemainderRegistry`.
//
// Direction of error, chosen deliberately: this classifier errs toward
// OPEN. An issue that names a family's language but is really cross-cutting
// keeps the family open (the honest cost of a conservative reading), whereas a
// false "clean" is the sin the milestone was opened for. Whole-word matching is
// what makes that safe: `\bjava\b` does not match `JavaScript`, so a web defect
// does not close or open the jvm.
// ============================================================================

/** Escape a literal so it can be interpolated into a RegExp safely. */
export function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** An open issue, as the classifier needs it (title is the tracked surface). */
export interface IssueLike { number: number; title: string }

/** What makes an issue a family's remainder, and which rule matched. */
export interface RemainderMatch { number: number; title: string; why: string }

/**
 * A family's registered remainder surface: the languages the milestone's own
 * ledger holds it accountable for, the historical code vocabulary that names
 * its converged defects, and (when registered) its remainder issue itself.
 */
export interface FamilyRemainderRegistry {
  languages: string[]
  codes: RegExp[]
  remainderIssue?: number
}

/**
 * The M49 convergence sweep's registered code vocabulary, retained per family so
 * a historical title that carries a code but no language name is still caught.
 * The language-name rule below is now the primary one; these are a superset
 * guard, not the mechanism.
 */
export const FAMILY_REMAINDER_CODES: Record<string, RegExp[]> = {
  jvm: [/CONV-J-1/, /CONV-K-1/, /CONV-S-1/, /CONV-G-1/, /M60\.J1/],
  web: [/CONV-(TS|JS|VUE|SVELTE|HTML)-/, /M60\.W1/],
  // The M49-CONV vocabulary that actually names OO defects: CONV-PY-1, CONV-RB-1,
  // CONV-DART-2, CONV-CS-1/2. A historical title carrying a code but no language
  // name is still this family's remainder; the language-name rule in
  // `remainderReason` is the primary one and covers the rest.
  oo: [/CONV-(CS|RB|PY|DART|PHP|SW|OC)-/],
}

/**
 * Read the family remainder registry from the milestone's OWN governance
 * artifact — languages and `remainderIssue` come from `validation/m60/ledger.json`
 * (a missing composition throws, exactly as `loadFamilies` does, because
 * defaulting would silently answer a different question), and the code
 * vocabulary comes from `FAMILY_REMAINDER_CODES`.
 */
export function loadFamilyRemainderRegistry(root: string): Record<string, FamilyRemainderRegistry> {
  const ledgerPath = path.join(root, "validation/m60/ledger.json")
  let ledger: any
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, "utf8"))
  } catch (e) {
    throw new Error(`M60 family composition unreadable at ${ledgerPath}: ${(e as Error).message}`)
  }
  const families = ledger?.families
  if (!families || typeof families !== "object" || Object.keys(families).length === 0) {
    throw new Error(`M60 ledger at ${ledgerPath} declares no 'families' — the family remainder cannot be classified without the milestone's own composition`)
  }
  const out: Record<string, FamilyRemainderRegistry> = {}
  for (const [fam, spec] of Object.entries<any>(families)) {
    const langs = spec?.languages
    if (!Array.isArray(langs) || langs.length === 0 || !langs.every((l) => typeof l === "string")) {
      throw new Error(`M60 family '${fam}' declares no language list — its remainder is unclassifiable`)
    }
    out[fam] = {
      languages: langs as string[],
      codes: FAMILY_REMAINDER_CODES[fam] ?? [],
      remainderIssue: typeof spec?.remainderIssue === "number" ? spec.remainderIssue : undefined,
    }
  }
  return out
}

/**
 * Classify open issues into per-family remainders. Pure, so the gate can prove
 * it discriminates in BOTH directions (a title naming a family language must be
 * caught; a title naming only another family's language must not be) instead of
 * asserting its own behaviour — the discipline every other verdict here follows.
 */
export function familyRemaindersNamedBy(
  issues: IssueLike[],
  registry: Record<string, FamilyRemainderRegistry>,
): Record<string, RemainderMatch[]> {
  const out: Record<string, RemainderMatch[]> = {}
  for (const fam of Object.keys(registry)) out[fam] = []
  for (const it of issues) {
    for (const [fam, reg] of Object.entries(registry)) {
      const why = remainderReason(it, reg)
      if (why) out[fam].push({ number: it.number, title: it.title, why })
    }
  }
  return out
}

/** The first rule that matches, named — so the record can say WHY it is open. */
export function remainderReason(it: IssueLike, reg: FamilyRemainderRegistry): string | null {
  if (reg.remainderIssue !== undefined && it.number === reg.remainderIssue) {
    return `registered remainder issue #${reg.remainderIssue}`
  }
  for (const code of reg.codes) {
    if (code.test(it.title)) return `registered code ${String(code)}`
  }
  for (const lang of reg.languages) {
    if (new RegExp(`\\b${escapeRegExp(lang)}\\b`, "i").test(it.title)) return `language:${lang}`
  }
  return null
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
 * WHEN the M49 fold row is owed (owner decision 2026-09-21, recorded in
 * reviews/m60-oo-family-plan.md §3): exactly when the family's OTHER closure
 * conditions are all true, because that is when a closure CLAIM exists for the
 * fold to evidence.
 *
 * The trigger deliberately EXCLUDES `foldPresent` — the condition the fold itself
 * satisfies. Including it would be circular: a deleted fold row would read as
 * "work remaining", the rule would require nothing, and the gate could never fail
 * on the case it exists for. Excluding it is strictly stronger than "a row per
 * family": deleting jvm's or web's row still fails, because both are
 * otherwise-ready. The rule it replaces — a fold row required for every family —
 * is red for the whole OO program, where it is indistinguishable from a
 * regression, and its only green shape was a placeholder row, i.e. a false
 * closure claim written to satisfy a gate.
 *
 * It lives HERE, once, because it is enforced in two places (M60.X1's per-family
 * check and M60.G1's R4) and two copies of one rule drift — the failure mode this
 * repo has paid for repeatedly (a duplicated regex gave ruby's analyzer and its
 * differential oracle different junk targets).
 */
export function foldOwed(conditions: Partial<FamilyConditions>, foldLanded: boolean): boolean {
  const otherwiseReady =
    conditions.foldersClosed === true &&
    conditions.analyzersCommitted === true &&
    conditions.cellsAlive === true &&
    conditions.trackerClean === true
  return otherwiseReady && !foldLanded
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
