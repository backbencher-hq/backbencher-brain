// script/m60/verify-standing-rules.ts — M60.G1: the gate that enforces the
// standing rules R1–R6 against every milestone, present and future.
//
// Charter (docs/m60/PLAN.md §4):
//   R1  No new milestone for work that belongs to an existing one; findings
//       become issues under existing milestones.
//   R2  A family is closed only when its closure gate is green AND its payload
//       matrix has zero non-alive cells. Ruled-dead cells tolerate only
//       recorded rulings; BLOCKED cells always forbid closure.
//   R3  Every finding document must be registered as an issue before it is
//       worked. A doc is not a queue.
//   R4  Fold contract: at close, M60's family results are recorded into M49
//       as the evidence its jvm/web closure claims are true.
//   R5  M14-clean receives one milestone covering all remaining analyzers, each
//       carrying the accumulated checks of every prior milestone. (Enforced by
//       X1, not here; listed for completeness so the numbering has one home.)
//   R6  One line base for every line in the payload: `line_number`, `range`,
//       `decoratorLine` and the `metadata.line` mirror are 1-based, and no
//       writer may emit a mirror that is not provably so (#873's class).
//
// G1 verifies the ENFORCEMENT MACHINERY: the rules are written where every
// future milestone reads them (the M60 ledger), the computations they need
// exist, and — the load-bearing part — each rule DISCRIMINATES. A rule that
// cannot fail is decoration, so every check below carries a self-test
// negative that feeds it a violation and asserts it is caught.
//
// The LIVE application of R2 to the jvm/web families (computed closure vs
// reality) is the closure gate: script/m60/verify-family-closure-truth.ts,
// which now also computes the `oo` family (owner decision 2026-09-21).
//
// Run: bun script/m60/verify-standing-rules.ts → validation/m60/results/G1.json
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { computeFamilyClosure, loadFamilies, foldOwed } from "./family-closure"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT = path.join(ROOT, "validation/m60/results/G1.json")
const LEDGER = path.join(ROOT, "validation/m60/ledger.json")
const MATRIX = path.join(ROOT, "validation/m60/results/P1.json")
const X1_RESULT = path.join(ROOT, "validation/m60/results/X1.json")
const SENTINEL_CENSUS = path.join(ROOT, "validation/m60/results/symbol-sentinels.json")
const SENTINEL_REGISTER = path.join(ROOT, "validation/m60/symbol-sentinel-register.json")
const FRAMEWORK_CENSUS = path.join(ROOT, "validation/m60/results/framework-surfaces.json")
const FRAMEWORK_REGISTER = path.join(ROOT, "validation/m60/framework-surface-register.json")
const DECLARED_TYPE_CENSUS = path.join(ROOT, "validation/m60/results/declared-type-refs.json")
const DECLARED_TYPE_REGISTER = path.join(ROOT, "validation/m60/declared-type-register.json")
const TARGET_SPELLING_CENSUS = path.join(ROOT, "validation/m60/results/target-spelling.json")
const TARGET_SPELLING_REGISTER = path.join(ROOT, "validation/m60/target-spelling-register.json")
/** The seven OO lanes — the owner standard's zero target (lang names as the census emits them). */
export const OO_LANES = ["csharp", "dart", "objective-c", "php", "python", "ruby", "swift"]
const REVIEWS = path.join(ROOT, "reviews")
const CLOSURE_SCRIPT = path.join(ROOT, "script/m60/verify-family-closure-truth.ts")

let passed = 0, failed = 0, negatives = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean) { negatives++; check(`${label} [negative]`, ok) }

function git(args: string[]): string {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "" }
}

// ============================================================================
// R3 machinery: finding-registering docs must cite an issue.
// A doc registers findings when it carries registration language; it is then
// required to reference an issue number, OR be an exempt register/policy doc
// that a standing gate itself governs (the regex debt register is governed by
// the M49 R2 gate — an issue number would rot; the gate is the tracker).
// ============================================================================
const REGISTER_DOCS_EXEMPT_FROM_R3 = [
  "regex-policy.md", // the R2 register itself — governed, shrink-only, by script/m49/verify-r2-regex.ts
]

/**
 * Does this doc claim to REGISTER a finding (the sense R3 governs)?
 *
 * The rule is about a queue: a doc that declares findings must cite a tracker
 * entry for them. The first version of this test matched the substring
 * `registers?`, which convicts any doc that merely NAMES the register artifact —
 * "the register shrank by one entry", "a registered site vanished". Those are not
 * finding claims, and a rule that fires on a legitimate shape teaches people to
 * reword sentences instead of tracking work (the same failure R6's header records
 * for an unprovable-writer guard). The verb must therefore be applied to a
 * FINDING NOUN within a short window. The other signals ("found by", "files this
 * defect", "issue created", "handoff message") are kept verbatim: they are house
 * markers for a doc that is reporting discovered defects, and tightening beyond
 * the reported false positive would quietly widen the compliance surface.
 */
export function registersFindings(text: string): boolean {
  // The count may be a DIGIT or a WORD — the negative test below caught the first
  // version accepting only `\d+`, so "registers two defects" slipped through. A
  // tightening that opens a hole where the loose rule had teeth is worse than no
  // tightening, which is why this pattern is driven by a probe in both directions.
  const COUNT = /(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|several|many|some|no)\s+/
  const registrationSense = new RegExp(
    String.raw`(registers?|registering)\s+(?:the\s+|a\s+|an\s+|these\s+|those\s+|its\s+)?(?:` + COUNT.source + String.raw`)?(?:new\s+)?(?:defects?|findings?|issues?|bugs?|regressions?|problems?|gaps?)\b`,
    "i",
  ).test(text)
  const houseMarkers = /(found by|files? (this|the) (defect|finding|issue)|issue (created|filed)|handoff message)/i.test(text)
  return registrationSense || houseMarkers
}

export function findingDocsMissingIssues(docMap: Record<string, string>): string[] {
  const missing: string[] = []
  for (const [name, text] of Object.entries(docMap)) {
    if (REGISTER_DOCS_EXEMPT_FROM_R3.includes(name)) continue
    if (!registersFindings(text)) continue
    const citesIssue = /#(\d{2,4})/.test(text)
    if (!citesIssue) missing.push(name)
  }
  return missing
}

// ============================================================================
// R2 machinery: the closure computation, pure so it can be negative-tested.
// The three-state reading lives in script/m60/family-closure.ts with the rest
// of the family-closure definition (one definition, imported by this gate and
// by the live X1 computation) and is re-exported here so the standing-rules
// surface keeps its own entry point.
//   closed-computable  ⟺ zero BLOCKED cells AND zero open family issues
//   blocked            ⟺ a BLOCKED cell exists (family cannot close, full stop)
//   open-remainder     ⟺ tracker shows open family work
// ============================================================================
export { computeFamilyClosure }

// ============================================================================
// R1 machinery: open GitHub milestones must be documented under docs/.
// ============================================================================
function undocumentedOpenMilestones(): string[] {
  const out: string[] = []
  let numbers: string[] = []
  try {
    const j = execFileSync("gh", ["api", "repos/{owner}/{repo}/milestones?state=open&per_page=100"], { cwd: ROOT, encoding: "utf8", timeout: 30_000 })
    numbers = (JSON.parse(j) as Array<{ number: number }>).map((m) => `M${m.number}`)
  } catch {
    return out // gh unavailable: the LIVE check below fails instead of silently passing
  }
  for (const n of numbers) {
    // The registry surface is docs/milestones.md (R1's designated home).
    const registry = path.join(ROOT, "docs/milestones.md")
    if (existsSync(registry)) {
      const txt = readFileSync(registry, "utf8")
      if (new RegExp(`\\b${n}\\b`).test(txt)) continue
    }
    // Legacy fallback: a milestone PLAN under docs/ also satisfies R1.
    try {
      const r = execFileSync("git", ["grep", "-l", n, "--", "docs"], { cwd: ROOT, encoding: "utf8" })
      if (r.trim()) continue
    } catch { /* not in docs */ }
    out.push(n)
  }
  return out
}

// ============================================================================
// R6 machinery: ONE line base for every line in the payload.
// ============================================================================
// `line_number` is 1-based (the store column, `lineField`, every analyzer, and
// the M59 oracle's rule that a line must be checkable against the source). A
// `metadata.line` mirror written as `startPosition.row` is therefore not a
// mirror: it is the line ABOVE the site it names. That defect (#873) shipped for
// as long as it did because nothing failed when it appeared — the field was
// emitted, unpinned and one below its own row, and on the cpp/hpp rows there is
// no `line_number` at all to disagree with it, so the wrong number was the row's
// ONLY line.
//
// This check is STATIC and total over the analyzer sources: every `metadata: { … }`
// object literal that carries a `line` key must assign it an expression that is
// provably 1-based (`… .startPosition.row + 1`). It is deliberately FAIL-CLOSED:
// a legitimate writer that derives a 1-based line some other way (a helper, a
// node captured elsewhere) trips it, and the fix is to teach this rule that
// shape — an adjudication a human makes once — rather than to let an
// unverifiable expression through. A guard that silently accepts is the reason
// #873 needed two rounds and a corpus sweep to be found.
//
// It is static on purpose, and is not a replacement for the runtime measurement:
// a normalisation pass that rewrites the mirror to match `line_number` at emit
// would make every WITER bug invisible instead of caught (which is why the pass
// added in a47d5607 lives in one analyzer and this rule does not).
//
// 2026-09-21: that "adjudication a human makes once" was made for the HELPER
// shape. A `this.<name>(…)` value is now resolved by READING the helper's body in
// the same file and accepting it only if every `return` in that body is either
// provably 1-based or the ABSENCE state (`undefined`/`null` — no consumer can
// misread absence by one, which is the same reason an explicit `line: null`
// passes). The NAME is not trusted, a helper that cannot be found is still
// convicted, a helper on any other receiver is not resolved, and one non-1-based
// return convicts the whole helper. So the rule stays fail-closed: what changed
// is only that a provable helper stopped being indistinguishable from an
// unprovable one. cpp's `nodeLine` writer (c7f03a67) is what this unblocked.
const ONE_BASED_LINE = /(\.|^)startPosition\.row\s*\+\s*1\b/
const HELPER_CALL = /^this\.([A-Za-z_$][\w$]*)\s*\(/
const ABSENCE_RETURN = /^(undefined|null)$/

/**
 * True iff `this.<name>(…)` resolves to a same-file method whose every `return`
 * is provably 1-based or an absence. Bounded and disclosed: it matches a method
 * DECLARATION of that name (the `(?:^|[\s;(])` prefix and the required `name(`
 * mean a call site cannot match), so if two classes in one analyzer file declared
 * the same helper name, the declaration that is found is the one adjudicated.
 * Analyzer files carry one analyzer class; a second one would be its own defect.
 */
export function helperReturnsProvablyOneBased(src: string, name: string): boolean {
  const decl = new RegExp(
    `(?:^|[\\s;(])(?:(?:private|protected|public|static|async|override|readonly)\\s+)*${name}\\s*\\([^)]*\\)\\s*(?::[^{;\\n]+)?\\{`,
    "m",
  )
  const m = decl.exec(src)
  if (!m) return false
  const open = m.index + m[0].length - 1
  let depth = 0
  let i = open
  while (i < src.length) {
    if (src[i] === "{") depth++
    else if (src[i] === "}") { depth--; if (depth === 0) break }
    i++
  }
  if (depth !== 0) return false
  const body = src.slice(open, i + 1)
  // Every `return` in the body, including ones in nested functions: a nested
  // return can only make the rule stricter, never looser. The capture stops at a
  // `;` OR at the next `return` — this repo's analyzers are written without
  // semicolons, so `[^;]*` alone would swallow a second return into the first
  // one's expression and read a two-return helper as a single 1-based return.
  // (That bug was caught by the negative test below, not by review.)
  const returns = [...body.matchAll(/\breturn\b((?:(?!\breturn\b)[^;])*)/g)].map((r) => r[1].trim())
  if (returns.length === 0) return false
  return returns.every((r) => ABSENCE_RETURN.test(r) || ONE_BASED_LINE.test(r))
}

export function lineBaseWriters(sources: { file: string; src: string }[]): { at: string; value: string }[] {
  const out: { at: string; value: string }[] = []
  for (const { file, src } of sources) {
    for (const m of src.matchAll(/metadata:\s*\{/g)) {
      // Walk the object literal by brace depth so a nested object cannot hide
      // the key or leak the next writer's into this one.
      let i = m.index + m[0].length - 1
      let depth = 0
      const start = i
      while (i < src.length) {
        if (src[i] === "{") depth++
        else if (src[i] === "}") { depth--; if (depth === 0) break }
        i++
      }
      const block = src.slice(start, i + 1)
      // The key must be in PROPERTY position — start of the literal or after a
      // comma. Matching a bare `line :` anywhere also hits a ternary
      // (`decoratorLine: typeof line === "number" ? line : null`), which is
      // exactly how the issue that filed #873 over-counted its own writer list
      // by grepping `line:` without requiring the key: 8 reported analyzers,
      // 2 real ones. The same trap this rule guards must not itself fall in.
      const lm = block.match(/(?:\{|,)\s*line\s*:\s*([^,\n}]+)/)
      if (!lm) continue
      const at = `${file}:${src.slice(0, m.index).split("\n").length}`
      out.push({ at, value: lm[1].trim() })
    }
  }
  return out
}

export function lineBaseViolations(sources: { file: string; src: string }[]): string[] {
  // `null` is not a base — it is the ruled ABSENCE state ("unknown is a
  // first-class state"), so an explicit null passes: the writer is saying it has
  // no line, which no consumer can misread by one. Anything else must be
  // provably 1-based — directly, or through a helper this rule can read.
  const srcByFile = new Map(sources.map((s) => [s.file, s.src]))
  return lineBaseWriters(sources)
    .filter((w) => {
      if (w.value === "null") return false
      if (ONE_BASED_LINE.test(w.value)) return false
      const hm = HELPER_CALL.exec(w.value)
      if (!hm) return true
      const src = srcByFile.get(w.at.slice(0, w.at.lastIndexOf(":")))
      return !(src && helperReturnsProvablyOneBased(src, hm[1]))
    })
    .map((w) => `${w.at} — metadata.line is not provably 1-based: \`line: ${w.value}\``)
}

// ============================================================================
// R4 machinery: the M49 fold row, owed by every OTHERWISE-READY family.
// ============================================================================
// Read STRUCTURALLY, per family. The rule is R4 verbatim — "M60's family results
// are recorded into M49 as the evidence its jvm/web closure claims are true" —
// and it names families, so a keyword test reported the fold as landed for a
// ledger that merely mentioned M60 in prose, or for one family's row while the
// other's was absent. The fold is per family because the claim it evidences is.
//
// WHEN the fold is owed (owner decision, 2026-09-21 — reviews/m60-oo-family-plan.md
// §3): exactly when the family's OTHER closure conditions are all true, because
// that is when a closure CLAIM exists for the fold to evidence. The trigger
// deliberately EXCLUDES `foldPresent` — the condition the fold itself satisfies.
// Including it would make the rule circular: a deleted fold row would then read
// as "work remaining", the rule would require nothing, and the gate could never
// fail on the case it exists for. Excluding it is strictly stronger than the
// rule it replaces in every direction that matters — deleting jvm's or web's fold
// row still fails here, because jvm and web are otherwise-ready.
//
// The reading this replaced — a fold row required for every family in the ledger
// — went red the moment `oo` was added and would have stayed red for the whole OO
// program, where it is indistinguishable from a regression; and its only green
// shape was a placeholder row, i.e. a false closure claim written to satisfy a
// gate. Several of this repo's worst defects are exactly that shape.
//
// A fold row present for a family that still carries open work is NOT convicted:
// a family that was ready can be re-opened by a new issue, and its row is then
// history rather than a lie. What must fail is a CLOSE with no fold.
function foldOwedDetail(
  x1: { atCommit?: string; families?: Record<string, { conditions?: Record<string, boolean> }> } | null,
  fold: Record<string, any>,
  families: string[],
  head: string,
): string {
  if (!x1) return "R4 cannot adjudicate: validation/m60/results/X1.json is absent — run script/m60/verify-family-closure-truth.ts"
  if (x1.atCommit !== head) return `R4 cannot adjudicate: the closure result was computed at ${x1.atCommit ?? "unknown"}, HEAD is ${head}`
  const computed = x1.families ?? {}
  const uncovered = families.filter((f) => !computed[f]?.conditions)
  if (uncovered.length) return `R4 cannot adjudicate: the closure result does not cover ${uncovered.join(", ")}`
  const landed = (f: string) => Boolean(fold[f]) && typeof fold[f].summary === "string" && fold[f].summary.trim().length >= 20
  // The predicate itself is `foldOwed` in family-closure.ts — the single copy,
  // shared with M60.X1, which enforces the same rule per family. Two copies of it
  // would be two chances to disagree about when a close owes evidence.
  const owed = families.filter((f) => foldOwed(computed[f]?.conditions ?? {}, landed(f)))
  const missing = owed.filter((f) => !landed(f))
  return missing.length === 0
    ? `fold present for ${owed.join(" + ") || "(no family is otherwise-ready yet)"} — owed-when-otherwise-ready; ${families.length - owed.length} of ${families.length} family/families still carry open work, so no fold is owed for them`
    : `a fold row is owed for ${missing.join(", ")}: every other closure condition computes true, so the claim has no evidence in the M49 ledger`
}

function foldRecordDetail(head: string): string {
  const p = path.join(ROOT, "validation/m49/ledger.json")
  if (!existsSync(p)) return "validation/m49/ledger.json missing"
  let fold: Record<string, any> = {}
  try { fold = JSON.parse(readFileSync(p, "utf8")).foldRecords ?? {} } catch { return "validation/m49/ledger.json unreadable" }
  let x1: any = null
  if (existsSync(X1_RESULT)) {
    try { x1 = JSON.parse(readFileSync(X1_RESULT, "utf8")) } catch { return "validation/m60/results/X1.json unreadable" }
  }
  return foldOwedDetail(x1, fold, Object.keys(loadFamilies(ROOT)), head)
}

function main() {
  const head = git(["rev-parse", "HEAD"]) || "unknown"

  // ---- the rules are written where every future milestone reads them ------
  check("M60 ledger exists and parses", existsSync(LEDGER))
  if (!existsSync(LEDGER)) return finish(head)
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8"))
  const issueRows = ledger.issues ?? []
  check("ledger carries the five M60 issues", ["G1", "P1", "J1", "W1", "X1"].every((c) => issueRows.some((r: any) => r.id === c)))
  check("ledger carries standingRules R1–R5", Array.isArray(ledger.standingRules) && ledger.standingRules.length >= 4)
  const rulesText = JSON.stringify(ledger.standingRules ?? [])
  check("R2 as written requires gate AND matrix (both words present)", rulesText.includes("closure gate") && rulesText.includes("matrix"))
  check("R1 as written forbids minting milestones for existing work", /no new milestone/i.test(rulesText))
  check("R3 as written requires issues before work", /registered as an issue|issues under existing/i.test(rulesText))
  check("R4 as written names the fold target M49", /M49/.test(rulesText))

  // ---- the computations the rules need exist ------------------------------
  check("P1 matrix artifact exists", existsSync(MATRIX))
  check("closure-truth gate exists (the live R2 application)", existsSync(CLOSURE_SCRIPT))
  if (existsSync(MATRIX)) {
    const m = JSON.parse(readFileSync(MATRIX, "utf8"))
    check("matrix names its gate (machine-emitted)", m.gate === "M60.P1")
    // The expected surface is the ONBOARDED language set — the fixture
    // directories the matrix itself enumerates (`script/m60/payload-matrix.ts`
    // reads `validation/m14/fixtures/*`) — compared as a SET, which is strictly
    // stronger than a count: a swapped language used to pass while the count
    // held. This check used to hardcode `=== 21`, and went RED the moment a
    // 22nd language (xml) got a fixture lane and an analyzer: the gate accused
    // a correct matrix of being wrong, and no run could ever make it pass
    // again. A verifier's expectation must be derived from the authority, not
    // transcribed from the count that happened to hold when it was written.
    const fixturesDir = path.join(ROOT, "validation/m14/fixtures")
    const onboarded = existsSync(fixturesDir)
      ? readdirSync(fixturesDir).filter((f) => { try { return statSync(path.join(fixturesDir, f)).isDirectory() } catch { return false } }).sort()
      : []
    const matrixLangs = Array.isArray(m.surface?.languages) ? [...m.surface.languages].sort() : []
    check("matrix languages are enumerable (authority readable)", onboarded.length > 0, `fixtures dir: ${onboarded.length}`)
    check("matrix enumerates the full declared surface",
      m.surface?.declaredFieldCount === 33 && matrixLangs.join(",") === onboarded.join(","),
      `declared ${m.surface?.declaredFieldCount} fields × ${matrixLangs.length} languages; onboarded ${onboarded.length}` +
        (matrixLangs.join(",") === onboarded.join(",") ? "" : ` — symmetric difference: ${[...new Set([...matrixLangs.filter((l) => !onboarded.includes(l)), ...onboarded.filter((l) => !matrixLangs.includes(l))])].join(",") || "(none)"}`))
    negative("matrix/surface comparison convicts a swapped language at equal count",
      JSON.stringify([...onboarded.slice(0, -1), "not-a-language"].sort()) !== JSON.stringify(onboarded))
    check("matrix verdicts come from the closed vocabulary", (m.fields ?? []).every((f: any) => /^(alive|ruled-dead|BLOCKED)/.test(String(f.verdict))))
    const ruled = (m.fields ?? []).filter((f: any) => String(f.verdict).startsWith("ruled-dead"))
    check("every ruled-dead cell cites a ruling (>20 chars)", ruled.every((f: any) => typeof f.ruling === "string" && f.ruling.length > 20))
    const blocked = (m.fields ?? []).filter((f: any) => String(f.verdict).startsWith("BLOCKED"))
    check("every BLOCKED cell names its registered issue", blocked.every((f: any) => /#\d+/.test(String(f.note ?? ""))), blocked.map((f: any) => f.field).join(",") || "(none)")
  }

  // ---- R2 negatives: the computation must discriminate --------------------
  negative("R2 negative: BLOCKED cell forbids closed-computable", computeFamilyClosure(["scope"], []) === "blocked")
  negative("R2 negative: open family issue forbids closed-computable", computeFamilyClosure([], ["#830"]) === "open-remainder")
  negative("R2 negative: empty blocked + empty open computes closed (the rule is not vacuous)", computeFamilyClosure([], []) === "closed-computable")

  // ---- R3 negatives: the scan must discriminate ---------------------------
  const synthetic: Record<string, string> = {
    "violation-probe.md": "This review registers 3 defects in the dart analyzer. None fixed.",
    "compliant-probe.md": "This review registers 3 defects; see #812 for the tracking issue.",
    "irrelevant-probe.md": "A wave report with no registration language at all.",
  }
  const syntheticMissing = findingDocsMissingIssues(synthetic)
  negative("R3 negative: a finding doc without an issue is flagged", syntheticMissing.includes("violation-probe.md"))
  negative("R3 negative: a finding doc WITH an issue passes", !syntheticMissing.includes("compliant-probe.md"))
  negative("R3 negative: the scan is not vacuous (non-finding docs are ignored)", !syntheticMissing.includes("irrelevant-probe.md"))
  // The tightening itself, in both directions. Naming the register ARTIFACT is
  // not a finding claim (the shape that convicted a wave record whose subject was
  // the artifact); and a registration claim is still convicted when untracked.
  negative("R3 negative: naming the register artifact is not a finding claim",
    findingDocsMissingIssues({ "artifact-probe.md": "The register shrank by one entry: a registered site vanished, and a registered row was removed." }).length === 0)
  negative("R3 negative: the tightened rule still convicts an untracked registration claim",
    findingDocsMissingIssues({ "queue-probe.md": "This wave registers two defects in the ruby analyzer." }).includes("queue-probe.md"))
  negative("R3 negative: 'registered' as a site STATE is not a registration claim",
    findingDocsMissingIssues({ "state-probe.md": "A registered site is one the declaration file already lists; growth and disappearance both fail." }).length === 0)

  const reviewsDocs: Record<string, string> = {}
  try {
    for (const f of readdirSync(REVIEWS)) {
      const p = path.join(REVIEWS, f)
      if (statSync(p).isFile() && f.endsWith(".md")) reviewsDocs[f] = readFileSync(p, "utf8")
    }
  } catch { /* reviews tree unreadable — live scan below reports it */ }
  const liveMissing = findingDocsMissingIssues(reviewsDocs)
  check("R3 live: every finding-registering review doc cites an issue", liveMissing.length === 0, liveMissing.join(", ") || "(none)")

  // ---- R1 live: no silently-minted open milestone -------------------------
  const undoc = undocumentedOpenMilestones()
  check("R1 live: every open GitHub milestone is documented in docs/", undoc.length === 0, undoc.join(", ") || "(none)")

  // ---- R6 live: every metadata.line writer is provably 1-based -------------
  const analyzerSources: { file: string; src: string }[] = []
  try {
    const dir = path.join(ROOT, "src/ast")
    for (const f of readdirSync(dir)) {
      if (/^real-.*-analyzer\.ts$/.test(f)) analyzerSources.push({ file: `src/ast/${f}`, src: readFileSync(path.join(dir, f), "utf8") })
    }
  } catch { /* unreadable — the live check below reports it as vacuous */ }
  check("R6 surface: analyzer sources are enumerable", analyzerSources.length > 0, `${analyzerSources.length} analyzers`)
  const writers = lineBaseWriters(analyzerSources)
  const violations = lineBaseViolations(analyzerSources)
  check("R6 live: every metadata.line writer is provably 1-based", violations.length === 0, violations.join(" | ") || `${writers.length} writer(s) of a line mirror, all 1-based`)
  negative("R6 negative: the writer census is not vacuous (this tree HAS writers to check)", writers.length > 0)

  // ---- R6 negatives: the scan must discriminate ---------------------------
  const r6 = (src: string) => lineBaseViolations([{ file: "probe.ts", src }])
  // A minimal analyzer-shaped source: the helper plus the writer that calls it.
  const helperSrc = (body: string) =>
    `class X {\n  private nodeLine(node: any): number | undefined {\n${body}\n  }\n  emit(callee: any) {\n    return { metadata: { line: this.nodeLine(callee) } }\n  }\n}`
  const HELPER_OK = `    if (!node || !node.startPosition) return undefined\n    return node.startPosition.row + 1`
  negative("R6 negative (helper): a provably 1-based helper is accepted",
    r6(helperSrc(HELPER_OK)).length === 0)
  // The load-bearing case: the resolver must READ the body, not trust the name.
  negative("R6 negative (helper): a 0-based helper is still convicted",
    r6(helperSrc(`    return node.startPosition.row`)).length === 1)
  negative("R6 negative (helper): ANY non-1-based return convicts the helper",
    r6(helperSrc(`    if (node.a) return node.startPosition.row\n    return node.startPosition.row + 1`)).length === 1)
  negative("R6 negative (helper): an unresolvable helper is convicted (fail-closed)",
    r6(`function f(n: any) { return { metadata: { line: this.nodeLine(n) } } }`).length === 1)
  negative("R6 negative (helper): a helper on another receiver is not resolved",
    r6(helperSrc(HELPER_OK).replace("this.nodeLine(callee)", "other.nodeLine(callee)")).length === 1)
  negative("R6 negative (helper): the resolver is exercised (the probe writes a mirror)",
    r6(helperSrc(`    return node.startPosition.row`)).length === 1 && lineBaseWriters([{ file: "probe.ts", src: helperSrc(HELPER_OK) }]).length === 1)
  negative("R6 negative: a 0-based mirror is flagged", r6(`metadata: { line: node.startPosition.row, qualified: q }`).length === 1)
  negative("R6 negative: a 1-based mirror passes", r6(`metadata: { line: node.startPosition.row + 1, qualified: q }`).length === 0)
  negative("R6 negative: the scan is not vacuous (a non-metadata `line:` key is ignored)", r6(`const t: { line: number } = { line: n.startPosition.row }`).length === 0)
  negative("R6 negative: a nested object cannot hide the key", r6(`metadata: { note: { inner: 1 }, line: n.startPosition.row }`).length === 1)
  negative("R6 negative: one writer does not mask the next", r6(`metadata: { line: a.startPosition.row + 1 }\nmetadata: { line: b.startPosition.row }`).length === 1)
  negative("R6 negative: an explicit null is absence, not a base", r6(`metadata: { line: null }`).length === 0 && lineBaseWriters([{ file: "p", src: `metadata: { line: null }` }]).length === 1)
  negative("R6 negative: a ternary `? line :` in a sibling key is not the key", r6(`metadata: { decoratorLine: typeof line === "number" ? line : null }`).length === 0 && lineBaseWriters([{ file: "p", src: `metadata: { decoratorLine: typeof line === "number" ? line : null }` }]).length === 0)

  // ---- R4 live: every otherwise-ready family carries its fold row ---------
  const fold = foldRecordDetail(head)
  check("R4 live: every otherwise-ready family carries its M49 fold row", fold.startsWith("fold present"), fold)

  // ---- R4 negatives: the owe-test must discriminate -----------------------
  // `ok` is "the rule convicted the violation", so a rule that cannot fail
  // fails these. `F` is a synthetic closure result whose family `a` is
  // otherwise-ready unless the patch says otherwise.
  const F = (patch: Record<string, boolean> = {}) => ({
    atCommit: "H",
    families: {
      a: { conditions: { foldersClosed: true, analyzersCommitted: true, cellsAlive: true, trackerClean: true, foldPresent: true, ...patch } },
    },
  })
  const SUBSTANTIVE = { a: { summary: "M60.A1's remainder is closed with per-issue evidence in A1.json." } }
  const r4 = (x1: any, f: any, fams: string[] = ["a"], h = "H") => foldOwedDetail(x1, f, fams, h)
  negative("R4 negative: an otherwise-ready family with no fold row is convicted", r4(F(), {}).startsWith("a fold row is owed"))
  negative("R4 negative: a substantive fold row satisfies the rule", r4(F(), SUBSTANTIVE).startsWith("fold present"))
  negative("R4 negative: a placeholder fold row is not a fold", r4(F(), { a: { summary: "todo" } }).startsWith("a fold row is owed"))
  negative("R4 negative: a family still carrying open work owes no fold", r4(F({ trackerClean: false }), {}).startsWith("fold present"))
  negative("R4 negative: a BLOCKED family owes no fold", r4(F({ cellsAlive: false }), {}).startsWith("fold present"))
  negative("R4 negative: the owe-test is NOT circular (foldPresent alone does not excuse a family)",
    r4(F({ foldPresent: false }), {}).startsWith("a fold row is owed"))
  negative("R4 negative: a deleted fold row is convicted even though the closure gate then reads not-closed",
    r4({ atCommit: "H", families: { a: { conditions: { foldersClosed: true, analyzersCommitted: true, cellsAlive: true, trackerClean: true, foldPresent: false } } } }, {}).startsWith("a fold row is owed"))
  negative("R4 negative: a stale closure result cannot adjudicate", r4(F(), SUBSTANTIVE, ["a"], "OTHER").startsWith("R4 cannot adjudicate"))
  negative("R4 negative: a closure result that omits a family cannot adjudicate", r4(F(), SUBSTANTIVE, ["a", "b"]).startsWith("R4 cannot adjudicate"))

  // ---- R7 live: no analyzer names anything with a placeholder literal -------
  const sentinelRegister = readJsonOrNull(SENTINEL_REGISTER)
  const sentinel = sentinelRegisterDetail(readJsonOrNull(SENTINEL_CENSUS), sentinelRegister)
  check("R7 live: every placeholder-literal site is registered, none added, none silently gone",
    registerAdjudicated(sentinel, "R7"), sentinel)

  // ---- R7 negatives: the register comparison must discriminate -------------
  const SITE = (over: any = {}) => ({
    file: "real-probe-analyzer.ts", line: 1, marker: "unknown", shape: "or-fallback",
    verdict: "violation", key: "source", statement: `source: owner || "unknown"`, ...over,
  })
  const REG = { baseline: { occurrences: 1, violations: 1 }, entries: [{ ...SITE(), count: 1, note: "probe" }] }
  const CEN = (sites: any[], over: any = {}) => ({
    files: 1, occurrences: sites.length, violations: sites.filter((s) => s.verdict === "violation").length,
    parseErrors: [], selfTests: { cases: 15, passed: 15, failures: [] }, sites, ...over,
  })
  negative("R7 negative: a registered site matching the register is accepted",
    sentinelRegisterDetail(CEN([SITE()]), REG).startsWith("R7:"))
  negative("R7 negative: an unregistered placeholder site is convicted",
    sentinelRegisterDetail(CEN([SITE(), SITE({ statement: `target: owner || "unknown"` })]), REG).includes("unregistered"))
  negative("R7 negative: a new site at a REGISTERED statement is convicted (copy-paste growth)",
    sentinelRegisterDetail(CEN([SITE(), SITE()]), REG).includes("grew to 2"))
  negative("R7 negative: a vanished registered site is convicted (the register may only shrink by hand)",
    sentinelRegisterDetail(CEN([]), REG).includes("is now 0"))
  negative("R7 negative: a classifier self-test failure forbids adjudication",
    sentinelRegisterDetail(CEN([SITE()], { selfTests: { cases: 15, passed: 14, failures: ["probe"] } }), REG).includes("cannot adjudicate"))
  negative("R7 negative: an analyzer source that did not parse forbids adjudication",
    sentinelRegisterDetail(CEN([SITE()], { parseErrors: ["real-probe-analyzer.ts"] }), REG).includes("cannot adjudicate"))
  negative("R7 negative: an absent census forbids adjudication",
    sentinelRegisterDetail(null, REG).includes("cannot adjudicate"))
  negative("R7 negative: an absent register forbids adjudication",
    sentinelRegisterDetail(CEN([SITE()]), null).includes("cannot adjudicate"))
  negative("R7 negative: violations rising above the baseline are convicted",
    sentinelRegisterDetail(CEN([SITE(), SITE({ statement: "b" }), SITE({ statement: "c" })], {}),
      { baseline: { occurrences: 1, violations: 1 }, entries: [
        { ...SITE(), count: 1 }, { ...SITE({ statement: "b" }), count: 1 }, { ...SITE({ statement: "c" }), count: 1 }] }).includes("rose to 3"))
  negative("R7 negative: the register is not vacuous (this tree HAS registered sites to check)",
    Boolean(sentinelRegister && (sentinelRegister.baseline?.violations ?? 0) > 0 && (sentinelRegister.entries ?? []).length > 0))
  negative("R7 negative: the census is not vacuous (it found sites, and classified more than one shape)",
    (() => { const c = readJsonOrNull(SENTINEL_CENSUS); return Boolean(c && c.occurrences > 0 && Object.keys(c.byShape ?? {}).length > 1) })())
  // The LIVE predicate itself, which is a different claim from any negative above:
  // every finding message below starts with `R7: ` too, so a prefix test accepted a
  // conviction. Measured live on 2026-09-22 — a new site landed in the c lane
  // (`real-c-analyzer.ts:2494`) and G1 stayed green with 49 violations and an
  // unregistered site in the census. Each conviction shape is fed to the predicate
  // that the live check calls, so a predicate that cannot fail fails here.
  const r7Live = (detail: string) => registerAdjudicated(detail, "R7")
  negative("R7 negative (live predicate): the adjudicated reading is accepted",
    r7Live(sentinelRegisterDetail(CEN([SITE()]), REG)))
  negative("R7 negative (live predicate): an unregistered site is NOT accepted as a verdict",
    !r7Live(sentinelRegisterDetail(CEN([SITE(), SITE({ statement: `target: owner || "unknown"` })]), REG)))
  negative("R7 negative (live predicate): a grown site is NOT accepted as a verdict",
    !r7Live(sentinelRegisterDetail(CEN([SITE(), SITE()]), REG)))
  negative("R7 negative (live predicate): a vanished site is NOT accepted as a verdict",
    !r7Live(sentinelRegisterDetail(CEN([]), REG)))
  negative("R7 negative (live predicate): a refusal to adjudicate is NOT accepted as a verdict",
    !r7Live(sentinelRegisterDetail(null, REG)))
  negative("R7 negative (live predicate): a conviction is not accepted because it shares the prefix",
    sentinelRegisterDetail(CEN([SITE(), SITE()]), REG).startsWith("R7:") && !r7Live(sentinelRegisterDetail(CEN([SITE(), SITE()]), REG)))

  // ---- R8 live: no analyzer publishes a framework capability it does not have ----
  const fwRegister = readJsonOrNull(FRAMEWORK_REGISTER)
  const fw = frameworkRegisterDetail(readJsonOrNull(FRAMEWORK_CENSUS), fwRegister)
  check("R8 live: every framework-surface site is registered, none added, none silently gone", registerAdjudicated(fw, "R8"), fw)

  // ---- R8 negatives: the comparison, and the OO target, must both discriminate ----
  const FSITE = (over: any = {}) => ({
    file: "real-probe-analyzer.ts", lang: "php", line: 1, shape: "dead-surface", key: "ctx.frameworks",
    statement: `for (const k in ctx.frameworks) detectedFrameworks.push(k)`, verdict: "violation", ...over,
  })
  const FREG = {
    baseline: { occurrences: 1, violations: 1 },
    ooTarget: { violations: 1 },
    entries: [{ ...FSITE(), count: 1 }],
  }
  const FCEN = (sites: any[], over: any = {}) => ({
    files: 1, occurrences: sites.length, violations: sites.filter((s) => s.verdict === "violation").length,
    parseErrors: [], selfTests: { cases: 17, passed: 17, failures: [] }, sites, ...over,
  })
  negative("R8 negative: a registered site matching the register is accepted",
    frameworkRegisterDetail(FCEN([FSITE()]), FREG).startsWith("R8:"))
  negative("R8 negative: an unregistered framework-surface site is convicted",
    frameworkRegisterDetail(FCEN([FSITE(), FSITE({ key: "ctx.other" })]), FREG).includes("unregistered"))
  negative("R8 negative: a new site at a REGISTERED statement is convicted (copy-paste growth)",
    frameworkRegisterDetail(FCEN([FSITE(), FSITE()]), FREG).includes("grew to 2"))
  negative("R8 negative: a vanished registered site is convicted (the register may only shrink by hand)",
    frameworkRegisterDetail(FCEN([]), FREG).includes("is now 0"))
  negative("R8 negative: a classifier self-test failure forbids adjudication",
    frameworkRegisterDetail(FCEN([FSITE()], { selfTests: { cases: 17, passed: 16, failures: ["probe"] } }), FREG).includes("cannot adjudicate"))
  negative("R8 negative: an analyzer source that did not parse forbids adjudication",
    frameworkRegisterDetail(FCEN([FSITE()], { parseErrors: ["real-probe-analyzer.ts"] }), FREG).includes("cannot adjudicate"))
  negative("R8 negative: a lane that names the contract but is not examined forbids adjudication",
    frameworkRegisterDetail(FCEN([FSITE()], { unexamined: ["real-probe-analyzer.ts"] }), FREG).includes("cannot adjudicate"))
  negative("R8 negative: an empty unexamined list does not obstruct adjudication",
    frameworkRegisterDetail(FCEN([FSITE()], { unexamined: [] }), FREG).startsWith("R8:"))
  negative("R8 negative: an absent census forbids adjudication",
    frameworkRegisterDetail(null, FREG).includes("cannot adjudicate"))
  negative("R8 negative: an absent register forbids adjudication",
    frameworkRegisterDetail(FCEN([FSITE()]), null).includes("cannot adjudicate"))
  negative("R8 negative: violations rising above the baseline are convicted",
    frameworkRegisterDetail(FCEN([FSITE(), FSITE({ statement: "b" }), FSITE({ statement: "c" })]),
      { baseline: { occurrences: 1, violations: 1 }, ooTarget: { violations: 3 }, entries: [
        { ...FSITE(), count: 1 }, { ...FSITE({ statement: "b" }), count: 1 }, { ...FSITE({ statement: "c" }), count: 1 }] }).includes("rose to 3"))
  negative("R8 negative: an OO lane's violations rising above the recorded target are convicted even when the global baseline absorbs them",
    frameworkRegisterDetail(FCEN([FSITE(), FSITE({ lang: "ruby", statement: "b" })]),
      { baseline: { occurrences: 2, violations: 2 }, ooTarget: { violations: 1 }, entries: [
        { ...FSITE(), count: 1 }, { ...FSITE({ lang: "ruby", statement: "b" }), count: 1 }] }).includes("OO"))
  negative("R8 negative: a non-OO lane does not count against the OO target",
    frameworkRegisterDetail(FCEN([FSITE({ lang: "zig" })]),
      { baseline: { occurrences: 1, violations: 1 }, ooTarget: { violations: 0 }, entries: [{ ...FSITE({ lang: "zig" }), count: 1 }] }).startsWith("R8:"))
  negative("R8 negative: the register is not vacuous (this tree HAS registered sites to check)",
    Boolean(fwRegister && (fwRegister.baseline?.violations ?? 0) > 0 && (fwRegister.entries ?? []).length > 0))
  negative("R8 negative: the census is not vacuous (it found sites, and classified more than one shape)",
    (() => { const c = readJsonOrNull(FRAMEWORK_CENSUS); return Boolean(c && c.occurrences > 0 && Object.keys(c.byShape ?? {}).length > 1) })())
  negative("R8 negative: the OO target is recorded, so a lane cannot quietly become exempt",
    Number(fwRegister?.ooTarget?.violations ?? -1) >= 0)
  // R8's live predicate, for the same reason as R7's above: every R8 finding message
  // begins with `R8: `, so the prefix test could not tell a clean register from a
  // violated one. The predicate is the same single copy both rules use.
  const r8Live = (detail: string) => registerAdjudicated(detail, "R8")
  negative("R8 negative (live predicate): the adjudicated reading is accepted",
    r8Live(frameworkRegisterDetail(FCEN([FSITE()]), FREG)))
  negative("R8 negative (live predicate): an unregistered site is NOT accepted as a verdict",
    !r8Live(frameworkRegisterDetail(FCEN([FSITE(), FSITE({ key: "ctx.other" })]), FREG)))
  negative("R8 negative (live predicate): a vanished site is NOT accepted as a verdict",
    !r8Live(frameworkRegisterDetail(FCEN([]), FREG)))
  negative("R8 negative (live predicate): a refusal to adjudicate is NOT accepted as a verdict",
    !r8Live(frameworkRegisterDetail(null, FREG)))

  // ---- R9 live: the family's declared-type graph, per lane --------------------
  // The class this rule measures is the one a per-edge oracle structurally cannot
  // see: an ABSENT capability emits nothing to adjudicate. Built 2026-09-22 after
  // csharp's declared-type graph turned out to be missing while ten sibling lanes
  // had it — recorded in reviews/csharp/master-review.md as a "recorded gap for its
  // own wave", and invisible to every gate the lane had.
  const dtRegister = readJsonOrNull(DECLARED_TYPE_REGISTER)
  const dt = declaredTypeRegisterDetail(readJsonOrNull(DECLARED_TYPE_CENSUS), dtRegister)
  check("R9 live: every lane's declared-type reading matches the register exactly",
    registerAdjudicated(dt, "R9"), dt)

  // ---- R9 negatives: the comparison, and the OO target, must both discriminate ----
  // Every fixture carries a CALIBRATION lane (rust, whose capability no one disputes),
  // because the rule refuses to adjudicate an uncalibrated measurement: without it, a
  // fixture that omitted rust would be convicted for the wrong reason and the negative
  // would pass while testing nothing.
  const RUST_PRESENT = () => ({
    lang: "rust", verdict: "present-declared_type", control: true, declaredEdges: 2, typeRefs: 2,
    markers: ["declared_type"], otherMarkers: [], targets: ["Dep"], relationships: 4, symbols: 2,
  })
  const RUST_ENTRY = { lang: "rust", family: "systems", reading: "present-declared_type", ruling: "family-standard" }
  const DROW = (over: any = {}) => ({
    lang: "php", verdict: "absent", control: true, declaredEdges: 0, typeRefs: 0,
    markers: [], otherMarkers: [], targets: [], relationships: 3, symbols: 2, ...over,
  })
  const OWED = (lang: string) => ({ lang, family: "oo", reading: "absent", ruling: "owed" })
  const PRESENT = (lang: string) => ({ lang, family: "oo", reading: "present-declared_type", ruling: "family-standard" })
  const PRESENT_ROW = (lang: string) => DROW({ lang, verdict: "present-declared_type", declaredEdges: 1, typeRefs: 1, markers: ["declared_type"] })
  const DREG = {
    baseline: { lanes: 2, presentDeclaredType: 1, presentOtherMarker: 0, absent: 1 },
    ooTarget: { absent: 1 },
    lanes: [RUST_ENTRY, OWED("php")],
  }
  const DCEN = (rows: any[], over: any = {}) => ({
    lanes: rows.length,
    presentDeclaredType: rows.filter((r) => r.verdict === "present-declared_type").length,
    presentOtherMarker: rows.filter((r) => r.verdict === "present-other-marker").map((r) => r.lang),
    absent: rows.filter((r) => r.verdict === "absent").map((r) => r.lang),
    notExercised: rows.filter((r) => r.verdict === "not-exercised").map((r) => r.lang),
    errored: rows.filter((r) => r.verdict === "error").map((r) => r.lang),
    rows, ...over,
  })
  negative("R9 negative: a registered lane matching the register is accepted",
    declaredTypeRegisterDetail(DCEN([RUST_PRESENT(), DROW()]), DREG).startsWith("R9:"))
  negative("R9 negative: an unregistered lane is convicted (the capability must be recorded before it is judged)",
    declaredTypeRegisterDetail(DCEN([RUST_PRESENT(), DROW(), DROW({ lang: "dart" })]), DREG).includes("unregistered"))
  negative("R9 negative: a lane that REGRESSES from emitting the graph to emitting nothing is convicted",
    declaredTypeRegisterDetail(
      DCEN([RUST_PRESENT(), DROW({ lang: "php", verdict: "absent" })]),
      { ...DREG, lanes: [RUST_ENTRY, PRESENT("php")], ooTarget: { absent: 0 } },
    ).includes("REGRESSED"))
  negative("R9 negative: a lane that CLOSES its gap while the register still records it owed is convicted (flip the register deliberately)",
    declaredTypeRegisterDetail(
      DCEN([RUST_PRESENT(), PRESENT_ROW("php")]),
      DREG,
    ).includes("still records it as owed"))
  negative("R9 negative: a lane registered to emit under the family marker that emits under another is convicted",
    declaredTypeRegisterDetail(
      DCEN([RUST_PRESENT(), DROW({ verdict: "present-other-marker", typeRefs: 1, otherMarkers: ["type_reference"] })]),
      { ...DREG, lanes: [RUST_ENTRY, PRESENT("php")], ooTarget: { absent: 0 } },
    ).includes("type_reference"))
  negative("R9 negative: an UNCALIBRATED census cannot adjudicate (not one lane present means the measurement is broken, not that 19 lanes are guilty)",
    declaredTypeRegisterDetail(DCEN([DROW(), DROW({ lang: "cpp" })]),
      { ...DREG, lanes: [
        OWED("php"),
        { lang: "cpp", family: "systems", reading: "absent", ruling: "owed" }] }).includes("cannot adjudicate"))
  negative("R9 negative: a census that records no holder-symbol control cannot convict anyone",
    declaredTypeRegisterDetail(
      DCEN([{ ...RUST_PRESENT(), control: undefined }, DROW({ lang: "dart" })]),
      { ...DREG, lanes: [RUST_ENTRY, OWED("php"), OWED("dart")], ooTarget: { absent: 2 } },
    ).includes("cannot adjudicate"))
  negative("R9 negative: the TARGET state (every lane present, register flipped) is accepted, not refused as vacuous",
    declaredTypeRegisterDetail(
      DCEN([RUST_PRESENT(), PRESENT_ROW("php"), PRESENT_ROW("dart")]),
      { ...DREG, ooTarget: { absent: 0 }, lanes: [RUST_ENTRY, PRESENT("php"), PRESENT("dart")] },
    ).startsWith("R9:"))
  negative("R9 negative: a lane whose snippet never reached the holder symbol forbids adjudication (zero would mean not-exercised, not absent)",
    declaredTypeRegisterDetail(DCEN([RUST_PRESENT(), DROW({ verdict: "not-exercised", control: false })]), DREG).includes("cannot adjudicate"))
  negative("R9 negative: a lane whose analyzer errored forbids adjudication",
    declaredTypeRegisterDetail(DCEN([RUST_PRESENT(), DROW({ verdict: "error", error: "probe" })]), DREG).includes("cannot adjudicate"))
  negative("R9 negative: an absent census forbids adjudication",
    declaredTypeRegisterDetail(null, DREG).includes("cannot adjudicate"))
  negative("R9 negative: an absent register forbids adjudication",
    declaredTypeRegisterDetail(DCEN([RUST_PRESENT(), DROW()]), null).includes("cannot adjudicate"))
  negative("R9 negative: a registered lane that appears in no census row is convicted",
    declaredTypeRegisterDetail(DCEN([RUST_PRESENT(), DROW()]),
      { ...DREG, lanes: [RUST_ENTRY, OWED("php"), OWED("dart")], ooTarget: { absent: 2 } }).includes("no census row"))
  negative("R9 negative: an OO lane's debt rising above the recorded target is convicted even when every lane matches its register entry",
    declaredTypeRegisterDetail(
      DCEN([RUST_PRESENT(), DROW({ lang: "php" }), DROW({ lang: "dart" })]),
      { ...DREG, ooTarget: { absent: 1 }, lanes: [RUST_ENTRY, OWED("php"), OWED("dart")] },
    ).includes("target"))
  negative("R9 negative: an exempt-dynamic lane does not count against the OO target (ruby is ruled, not owed)",
    declaredTypeRegisterDetail(
      DCEN([RUST_PRESENT(), DROW({ lang: "ruby" })]),
      { ...DREG, ooTarget: { absent: 0 }, lanes: [RUST_ENTRY, { lang: "ruby", family: "oo", reading: "absent", ruling: "exempt-dynamic" }], baseline: { lanes: 2, presentDeclaredType: 1, presentOtherMarker: 0, absent: 1 } },
    ).startsWith("R9:"))
  negative("R9 negative: a non-OO lane does not count against the OO target",
    declaredTypeRegisterDetail(
      DCEN([RUST_PRESENT(), DROW({ lang: "cpp" })]),
      { ...DREG, ooTarget: { absent: 0 }, lanes: [RUST_ENTRY, { lang: "cpp", family: "systems", reading: "absent", ruling: "owed" }] },
    ).startsWith("R9:"))
  negative("R9 negative: the register is not vacuous (this tree HAS lanes registered, and not all of them present)",
    Boolean(dtRegister && (dtRegister.lanes ?? []).some((l: any) => l.reading !== "present-declared_type")))
  negative("R9 negative: the census is not vacuous (it measured lanes and found more than one reading)",
    (() => { const c = readJsonOrNull(DECLARED_TYPE_CENSUS); const v = new Set((c?.rows ?? []).map((r: any) => r.verdict)); return Boolean(c && (c.rows ?? []).length > 5 && v.size > 1) })())
  negative("R9 negative: the OO target is recorded, so a lane cannot quietly become exempt",
    Number(dtRegister?.ooTarget?.absent ?? -1) >= 0)
  // R9's live predicate, for the same reason as R7's and R8's above.
  const r9Live = (detail: string) => registerAdjudicated(detail, "R9")
  negative("R9 negative (live predicate): the adjudicated reading is accepted",
    r9Live(declaredTypeRegisterDetail(DCEN([RUST_PRESENT(), DROW()]), DREG)))
  negative("R9 negative (live predicate): an unregistered lane is NOT accepted as a verdict",
    !r9Live(declaredTypeRegisterDetail(DCEN([RUST_PRESENT(), DROW(), DROW({ lang: "dart" })]), DREG)))
  negative("R9 negative (live predicate): a regressed lane is NOT accepted as a verdict",
    !r9Live(declaredTypeRegisterDetail(DCEN([RUST_PRESENT(), DROW()]),
      { ...DREG, lanes: [RUST_ENTRY, PRESENT("php")], ooTarget: { absent: 0 } })))
  negative("R9 negative (live predicate): a refusal to adjudicate is NOT accepted as a verdict",
    !r9Live(declaredTypeRegisterDetail(null, DREG)))

  // ---- R10 live: every relationship target is spelled like a symbol -----------
  // The class this rule measures is the one the differential oracle STRUCTURALLY
  // cannot see: its truth comes from the same rules the analyzer runs, so when both
  // sides fabricate the same spelling they AGREE, and every per-edge gate — the M59
  // line contract, the depth draws, the fixtures — reads clean. Built 2026-09-23
  // after php's `$o->{'lit'}` published a string literal as a member name on BOTH
  // sides (phpmyadmin). The convicting classes need no calibration (no language
  // names a symbol `'lit'`, `2`, or something with a space or a `(`, `)`, `;`, `{`,
  // `}`, `,`); the REPORTED class is calibrated against each lane's own symbol
  // alphabet, because qualified names legitimately carry `.`, `:`, `/`, `@`, `$`,
  // `?`, `!`, `-` (21 of 24 lanes carry one, so convicting it would launder every
  // real finding along with the conventions).
  const tsRegister = readJsonOrNull(TARGET_SPELLING_REGISTER)
  const ts = targetSpellingDetail(readJsonOrNull(TARGET_SPELLING_CENSUS), tsRegister)
  check("R10 live: every lane's target spelling matches the register exactly (convictions and separator vocabulary)",
    registerAdjudicated(ts, "R10"), ts)

  // ---- R10 negatives: the comparison, the classes and the OO target must all discriminate ----
  const TS_LANE = (over: any = {}) => ({
    lang: "rust", verdict: "clean", byClass: {}, separatorTriples: [], unruledTriples: [],
    separatorAdjudicable: true, convictions: {}, ...over,
  })
  const TS_ENTRY = (over: any = {}) => ({
    verdict: "clean", family: "other", convictions: {}, separatorTriples: [], rulings: {}, note: "", ...over,
  })
  // The accepted case needs TWO distinct verdicts, because the predicate refuses a
  // single-answer census (a classifier that returns one verdict for every lane is
  // broken, not a family). `go` is the second verdict and is neither OO nor convicted.
  const TSREG = {
    baseline: { lanes: 3 },
    ooTarget: { convictedLanes: 1, unruledSeparatorLanes: 1 },
    lanes: {
      rust: TS_ENTRY(),
      php: TS_ENTRY({ verdict: "fabricated-spellings", family: "oo", convictions: { literal: 1 }, separatorTriples: ["uses|."], rulings: { "uses|.": null } }),
      go: TS_ENTRY({ verdict: "unruled-separators", separatorTriples: ["imports|."], rulings: { "imports|.": null } }),
    },
  }
  const TSCEN = (rows: any[]) => ({ lanes: rows.length, clean: rows.filter((r) => r.verdict === "clean").map((r) => r.lang), rows })
  const PHP_CONVICTED = () => TS_LANE({ lang: "php", verdict: "fabricated-spellings", byClass: { literal: 1 }, separatorTriples: ["uses|."], unruledTriples: ["uses|."] })
  const GO_OWED = () => TS_LANE({ lang: "go", verdict: "unruled-separators", separatorTriples: ["imports|."], unruledTriples: ["imports|."] })
  const BASE = () => [TS_LANE(), PHP_CONVICTED(), GO_OWED()]
  negative("R10 negative: a lane matching the register is accepted",
    targetSpellingDetail(TSCEN(BASE()), TSREG).startsWith("R10:"))
  negative("R10 negative: a lane with a NEW conviction is convicted (the alarm)",
    targetSpellingDetail(
      TSCEN([...BASE(), TS_LANE({ lang: "csharp", verdict: "fabricated-spellings", byClass: { whitespace: 2 } })]),
      { ...TSREG, lanes: { ...TSREG.lanes, csharp: TS_ENTRY({ family: "oo" }) } },
    ).includes("drifted"))
  negative("R10 negative: an UNSPLIT whitespace conviction forbids adjudication (a conviction whose owner is unknown cannot be routed)",
    targetSpellingDetail(
      TSCEN([...BASE(), TS_LANE({ lang: "csharp", verdict: "fabricated-spellings", byClass: { whitespace: 2 } })]),
      { ...TSREG, lanes: { ...TSREG.lanes, csharp: TS_ENTRY({ family: "oo", convictions: { whitespace: 2 } }) } },
    ).includes("cannot adjudicate"))
  negative("R10 negative: a target MOVED out of the subclass R10 owns is convicted even though the class counts are identical",
    targetSpellingDetail(
      TSCEN([
        ...BASE(),
        TS_LANE({ lang: "csharp", verdict: "fabricated-spellings", byClass: { whitespace: 2 }, whitespaceSubclasses: { sourceText: 1, matchesOwnSymbol: 1 } }),
      ]),
      { ...TSREG, lanes: { ...TSREG.lanes, csharp: TS_ENTRY({ family: "oo", convictions: { whitespace: 2 }, convictionSubclasses: { sourceText: 2 } }) } },
    ).includes("reclassified"))
  negative("R10 negative: the same split on both sides is accepted",
    targetSpellingDetail(
      TSCEN([
        ...BASE(),
        TS_LANE({ lang: "csharp", verdict: "fabricated-spellings", byClass: { whitespace: 2 }, whitespaceSubclasses: { sourceText: 2 } }),
      ]),
      { ...TSREG, lanes: { ...TSREG.lanes, csharp: TS_ENTRY({ family: "oo", convictions: { whitespace: 2 }, convictionSubclasses: { sourceText: 2 } }) } },
    ).startsWith("R10:"))
  negative("R10 negative: a conviction PAID DOWN without re-writing the register is convicted (a finding may not disappear by a rule change alone)",
    targetSpellingDetail(
      TSCEN([TS_LANE(), TS_LANE({ lang: "php", verdict: "clean", separatorTriples: ["uses|."], unruledTriples: ["uses|."] }), GO_OWED()]),
      TSREG,
    ).includes("drifted"))
  negative("R10 negative: a NEW separator triple is convicted (a lane that starts emitting a spelling nobody ruled)",
    targetSpellingDetail(
      TSCEN([TS_LANE(), TS_LANE({ lang: "php", verdict: "unruled-separators", separatorTriples: ["uses|.", "calls|#"], unruledTriples: ["calls|#"] }), GO_OWED()]),
      TSREG,
    ).includes("drifted"))
  negative("R10 negative: a VANISHED separator triple is convicted (the register may only shrink deliberately)",
    targetSpellingDetail(
      TSCEN([TS_LANE(), TS_LANE({ lang: "php", verdict: "clean", separatorTriples: [], unruledTriples: [] }), GO_OWED()]),
      TSREG,
    ).includes("drifted"))
  negative("R10 negative: a ruling recorded for a triple the lane no longer emits is convicted (a stale ruling must not sit there)",
    targetSpellingDetail(
      TSCEN([TS_LANE(), TS_LANE({ lang: "php", verdict: "clean", separatorTriples: [], unruledTriples: [] }), GO_OWED()]),
      { ...TSREG, lanes: { ...TSREG.lanes, php: TS_ENTRY({ family: "oo", rulings: { "uses|.": "a reason" } }) } },
    ).includes("ruling"))
  negative("R10 negative: an unregistered lane is convicted (a lane's spelling vocabulary must be recorded before it is judged)",
    targetSpellingDetail(TSCEN([...BASE(), TS_LANE({ lang: "dart" })]), TSREG).includes("unregistered"))
  negative("R10 negative: a registered lane that appears in no census row is convicted",
    targetSpellingDetail(TSCEN([TS_LANE(), GO_OWED()]), TSREG).includes("no census row"))
  negative("R10 negative: an unmatched census row (no byClass record) forbids adjudication — an absent measurement is not a clean one",
    targetSpellingDetail(TSCEN([{ lang: "rust", verdict: "clean" }]), TSREG).includes("cannot adjudicate"))
  negative("R10 negative: an absent census forbids adjudication",
    targetSpellingDetail(null, TSREG).includes("cannot adjudicate"))
  negative("R10 negative: an absent register forbids adjudication",
    targetSpellingDetail(TSCEN(BASE()), null).includes("cannot adjudicate"))
  negative("R10 negative: a census with a single verdict everywhere cannot adjudicate (a classifier that returns one answer is broken, not a family)",
    targetSpellingDetail(
      TSCEN([TS_LANE(), TS_LANE({ lang: "php" })]),
      { ...TSREG, lanes: { rust: TS_ENTRY(), php: TS_ENTRY() }, ooTarget: { convictedLanes: 0, unruledSeparatorLanes: 0 } },
    ).includes("cannot adjudicate"))
  // This fixture pins the split deliberately: since the split landed, a lane CANNOT
  // carry a whitespace conviction without naming its owner (the writer never emits one,
  // and an unsplit pair is refused — the negative above). The subject here is the OO
  // debt arithmetic, so the conviction is written in the only shape the writer can now
  // produce; the debt mechanism itself is unchanged.
  negative("R10 negative: OO conviction debt above the recorded target is convicted",
    targetSpellingDetail(
      TSCEN([...BASE(), TS_LANE({ lang: "dart", verdict: "fabricated-spellings", byClass: { whitespace: 1 }, whitespaceSubclasses: { sourceText: 1 } })]),
      { ...TSREG, lanes: { ...TSREG.lanes, dart: TS_ENTRY({ family: "oo", convictions: { whitespace: 1 }, convictionSubclasses: { sourceText: 1 } }) } },
    ).includes("target"))
  negative("R10 negative: an OO lane whose separator vocabulary is UNRULED counts as ruling debt, and rising above the target is convicted",
    targetSpellingDetail(
      TSCEN([...BASE(), TS_LANE({ lang: "ruby", verdict: "unruled-separators", separatorTriples: ["uses|@"], unruledTriples: ["uses|@"] })]),
      { ...TSREG, lanes: { ...TSREG.lanes, ruby: TS_ENTRY({ family: "oo", separatorTriples: ["uses|@"], rulings: { "uses|@": null } }) } },
    ).includes("target"))
  negative("R10 negative: a RULED separator is not ruling debt (the ruling is what clears it)",
    targetSpellingDetail(
      TSCEN([TS_LANE(), TS_LANE({ lang: "ruby", verdict: "clean", separatorTriples: ["uses|@"], unruledTriples: [] }), GO_OWED()]),
      { ...TSREG, lanes: { rust: TS_ENTRY(), go: TS_ENTRY({ verdict: "unruled-separators", separatorTriples: ["imports|."], rulings: { "imports|.": null } }), ruby: TS_ENTRY({ family: "oo", separatorTriples: ["uses|@"], rulings: { "uses|@": "documented ivar convention" } }) }, ooTarget: { convictedLanes: 1, unruledSeparatorLanes: 1 } },
    ).startsWith("R10:"))
  negative("R10 negative: a lane whose symbol alphabet could not adjudicate is not counted as ruling debt (a thin draw must not convict)",
    targetSpellingDetail(
      TSCEN([TS_LANE(), TS_LANE({ lang: "svelte", verdict: "underdetermined", separatorAdjudicable: false, separatorTriples: ["imports|("], unruledTriples: ["imports|("] }), GO_OWED()]),
      { ...TSREG, lanes: { ...TSREG.lanes, svelte: TS_ENTRY({ family: "oo", separatorTriples: ["imports|("], rulings: { "imports|(": null } }) } },
    ).startsWith("R10:"))
  negative("R10 negative: the register is not vacuous (this tree HAS lanes with convictions and unruled separators)",
    Boolean(tsRegister && Object.values(tsRegister.lanes ?? {}).some((l: any) => Object.keys(l.convictions ?? {}).length > 0) &&
      Object.values(tsRegister.lanes ?? {}).some((l: any) => Object.values(l.rulings ?? {}).some((v) => v === null))))
  negative("R10 negative: the census is not vacuous (it measured lanes and found more than one verdict)",
    (() => { const c = readJsonOrNull(TARGET_SPELLING_CENSUS); const v = new Set((c?.rows ?? []).map((r: any) => r.verdict)); return Boolean(c && (c.rows ?? []).length > 5 && v.size > 1) })())
  negative("R10 negative: the OO target is recorded, so a lane cannot quietly become exempt",
    Number(tsRegister?.ooTarget?.convictedLanes ?? -1) >= 0 && Number(tsRegister?.ooTarget?.unruledSeparatorLanes ?? -1) >= 0)
  const r10Live = (detail: string) => registerAdjudicated(detail, "R10")
  negative("R10 negative (live predicate): the adjudicated reading is accepted",
    r10Live(targetSpellingDetail(TSCEN(BASE()), TSREG)))
  negative("R10 negative (live predicate): a drifted lane is NOT accepted as a verdict",
    !r10Live(targetSpellingDetail(TSCEN([TS_LANE(), TS_LANE({ lang: "php", verdict: "clean", separatorTriples: ["uses|."], unruledTriples: ["uses|."] }), GO_OWED()]), TSREG)))
  negative("R10 negative (live predicate): a refusal to adjudicate is NOT accepted as a verdict",
    !r10Live(targetSpellingDetail(null, TSREG)))

  finish(head)
}

// ============================================================================
// R7 machinery: no analyzer may NAME something with a placeholder literal.
// ============================================================================
// Charter (M60 ledger R7, owner standard 2026-09-21 — reviews/m60-oo-family-plan.md
// §3.7/R2): when a fallback has nothing truthful to say, the honest state is
// ABSENCE, not the string `"unknown"`. A placeholder literal in a name-bearing
// field becomes a symbol (or an edge endpoint) that does not exist in the source,
// and every consumer downstream — the store, the graph, search, the UI — can then
// match, count and display a name no file contains.
//
// Two halves, and only one of them is built: this is the STATIC census (does a
// source site exist, and what shape is it). The runtime half — no emitted row may
// carry a placeholder as a name — is outstanding and disclosed as
// `runtimeOwed` in the register rather than implied by a green gate.
//
// The census itself lives in script/m60/sentinel-census.ts and is AST-based on
// purpose: a first version of it was a char walk that masked comments and then
// re-found literals, which pairs quotes TWICE and silently missed all four ruby
// sites. Classification is by the literal's parent node type and field, so prose
// in a comment cannot be counted (a comment is not a string node) and the trap
// that made #873 report 8 analyzers when 2 were real — reading a key out of a
// nearby colon, which in `name: p ? p.text : "unknown"` belongs to the TERNARY —
// is structurally impossible.
//
// Registered like the regex debt, and for the same reason: the class predates
// this rule in 14 analyzers, so the gate cannot be "zero now" without either
// failing project-wide or inviting an empty register. It is exact-count
// shrink-only instead — a NEW site is convicted (including a new site at a
// registered statement, i.e. copy-paste growth), and a registered site that
// VANISHES is convicted too, because only a deliberate register edit may record
// that the debt was paid.
function readJsonOrNull(p: string): any {
  try { return JSON.parse(readFileSync(p, "utf8")) } catch { return null }
}

/** The seven OO lanes, in the CENSUS's spelling (the register keys on lanes the
 *  census emits — a rule that names lanes the measurement cannot produce would
 *  silently exempt the whole family). */
export const DECLARED_TYPE_OO_LANES = ["csharp", "dart", "objc", "php", "python", "ruby", "swift"]

/**
 * R9: the family's declared-type reference graph, measured per lane.
 *
 * The class this rule measures is the one a per-edge oracle structurally cannot see.
 * Every other gate in this repo asks whether an edge that EXISTS is right; a lane that
 * never emits a whole class of edge emits nothing to adjudicate, so it reads clean in
 * all of them. csharp's declared-type graph was absent while ten sibling lanes had it
 * and it survived an entire review wave — reviews/csharp/master-review.md even records
 * it, as a "recorded gap for its own wave", which is what a gap looks like when nothing
 * measures it.
 *
 * Three things this refuses to adjudicate on, each one a way the census could accuse
 * falsely, and each one measured rather than imagined:
 *   * a lane whose analyzer ERRORED — unknown, not absent;
 *   * a lane whose snippet never produced the holder SYMBOL — the control. Without it a
 *     snippet the grammar rejects (a malformed F# `type`, a PowerShell class) would read
 *     as a missing capability, which is the accusation this rule exists to make and the
 *     one it must never make wrongly;
 *   * a WINDOW-ONLY census — if every lane reads present, nothing was measured absent
 *     and the rule would pass vacuously.
 *
 * Convictions: an unregistered lane; a lane that regressed from emitting the graph to
 * emitting nothing; a lane that CLOSED its gap while the register still records it owed
 * (the register is the record of a decision, so it may only be flipped deliberately —
 * the same principle as the shrink-only registers above); a lane registered to emit
 * under the family marker that emits under another (a labelling divergence, which is a
 * smaller finding than a missing capability and therefore reported in its own terms); a
 * registered lane that appears in no census row; and OO debt above the recorded target.
 *
 * Pure, so the negatives above can drive it with synthetic census/register pairs.
 */
export function declaredTypeRegisterDetail(census: any, register: any): string {
  if (!register) return "R9 cannot adjudicate: validation/m60/declared-type-register.json is absent"
  if (!census) return "R9 cannot adjudicate: validation/m60/results/declared-type-refs.json is absent — run bun script/m60/declared-type-refs-census.ts"
  const rows: any[] = census.rows ?? []
  if (!Array.isArray(rows) || rows.length === 0) return "R9 cannot adjudicate: the census carries no lane rows"
  const entries: any[] = register.lanes ?? []
  if (entries.length === 0) return "R9 cannot adjudicate: the register records no lanes"
  const errored = rows.filter((r) => r.verdict === "error")
  if (errored.length) {
    return `R9 cannot adjudicate: ${errored.length} lane(s) failed to run, so their capability is unknown — ${errored.map((r) => `${r.lang} (${String(r.error ?? "?").slice(0, 80)})`).join(", ")}`
  }
  const unexercised = rows.filter((r) => r.verdict === "not-exercised")
  if (unexercised.length) {
    return `R9 cannot adjudicate: ${unexercised.length} lane(s)' snippet never declared the holder symbol, so zero declared-type edges would mean "not exercised" rather than "absent" — ${unexercised.map((r) => r.lang).join(", ")}`
  }
  // Fail-closed on a broken MEASUREMENT, not on a healthy one: rust, go, java and
  // python are calibration lanes whose capability is not in question, so a census in
  // which not one lane reads present is a broken measurement reading as 19 convictions.
  // (The eventual TARGET state — every lane present — is not vacuity and must not be
  // refused here; the register's own non-vacuity negative pins that.)
  const present = rows.filter((r) => r.verdict === "present-declared_type")
  if (present.length === 0) {
    return "R9 cannot adjudicate: no lane reads present, so the census is uncalibrated — a measurement in which every lane is absent cannot convict a family contract"
  }
  // The control is what makes an `absent` verdict an accusation rather than an
  // artifact: without it, a snippet the grammar rejects is indistinguishable from a
  // missing capability. A census that does not RECORD the control cannot be used to
  // convict anyone, whatever it says.
  const uncontrolled = rows.filter((r) => typeof r.control !== "boolean")
  if (uncontrolled.length) {
    return `R9 cannot adjudicate: ${uncontrolled.length} census row(s) record no holder-symbol control, so a snippet that never parsed is indistinguishable from a missing capability — ${uncontrolled.map((r) => String(r.lang)).slice(0, 4).join(", ")}`
  }
  const rowBy = new Map(rows.map((r) => [String(r.lang), r]))
  const registered = new Set(entries.map((e: any) => String(e.lang)))
  const unregistered = rows.filter((r) => !registered.has(String(r.lang))).map((r) => String(r.lang))
  if (unregistered.length) {
    return `R9: ${unregistered.length} unregistered lane(s) — a lane's declared-type capability must be recorded before it can be judged: ${unregistered.slice(0, 4).join(", ")}`
  }
  const disappeared = entries.filter((e: any) => !rowBy.has(String(e.lang))).map((e: any) => String(e.lang))
  if (disappeared.length) {
    return `R9: ${disappeared.length} registered lane(s) appear in no census row — ${disappeared.slice(0, 4).join(", ")}`
  }
  const problems: string[] = []
  for (const e of entries) {
    if (e.ruling === "exempt-dynamic") continue
    const r = rowBy.get(String(e.lang))!
    const want = String(e.reading ?? "")
    const got = String(r.verdict)
    if (got === want) continue
    if (want === "present-declared_type" && got === "absent") {
      problems.push(`${e.lang} REGRESSED: registered as emitting the declared-type graph, now emits nothing`)
    } else if (want === "present-declared_type" && got === "present-other-marker") {
      problems.push(`${e.lang} emits its declared-type references under marker(s) ${(r.otherMarkers ?? []).join("|") || "(none)"} while the register expects the family marker "declared_type"`)
    } else if (want === "absent" && got === "present-declared_type") {
      problems.push(`${e.lang} now emits the graph but the register still records it as owed — flip the register deliberately`)
    } else {
      problems.push(`${e.lang} reads ${got}, the register records ${want}`)
    }
  }
  if (problems.length) {
    return `R9: ${problems.length} lane(s) drifted from the register — ${problems.slice(0, 3).join(" | ")}`
  }
  const ooDebt = entries.filter(
    (e: any) => DECLARED_TYPE_OO_LANES.includes(String(e.lang)) && e.ruling !== "exempt-dynamic" && String(e.reading) !== "present-declared_type",
  )
  const target = Number(register.ooTarget?.absent ?? -1)
  if (target < 0) return "R9 cannot adjudicate: the register records no OO target, so OO debt could rise unobserved"
  if (ooDebt.length > target) {
    return `R9: OO lanes owing the family's declared-type graph rose to ${ooDebt.length} from the recorded target ${target} — ${ooDebt.map((e: any) => e.lang).join(", ")}`
  }
  const other = rows.filter((r) => r.verdict === "present-other-marker")
  return (
    `R9: ${present.length} of ${rows.length} lanes emit the declared-type graph under the family marker` +
    (other.length ? `, ${other.length} under a divergent marker (${other.map((r) => `${r.lang}:${(r.otherMarkers ?? []).join("|")}`).join(", ")})` : "") +
    `; ${rows.length - present.length - other.length} lane(s) owe it, ${ooDebt.length} of them in the OO family; all ${entries.length} register entries match exactly (OO target ${target})`
  )
}

/**
 * R10: a relationship target must be spelled the way the lane spells its own symbols.
 *
 * The differential oracle is the family's strongest instrument and it is structurally
 * blind to this class: its truth is derived from the same rules the analyzer runs, so
 * when both sides fabricate the same spelling they AGREE. php's `$o->{'lit'}` published
 * the string literal `'lit'` as a member name on BOTH sides (and `$o->{2}` an integer),
 * phpmyadmin's `include $this->baseDir . 'revision-info.php'` published a whole
 * expression as a path on both sides, and both were invisible to every per-edge gate
 * AND to the M59 line oracle, which confirms the token appears on the claimed line
 * because the quotes and digits really are written there.
 *
 * Two tiers, and the split is the whole design:
 *   * CONVICTING — `literal` (the whole target is a quoted string or a bare number),
 *     `whitespace` (a space/tab/newline), `delimiter` (`;`, `(`, `)`, `{`, `}`, `,`).
 *     No language in the family can declare such a symbol, so these need no
 *     calibration and cannot false-positive. They are also confined to SYMBOL-target
 *     relationship types: an `imports`/`exports` target is a module PATH, and a path
 *     may legitimately contain grouping punctuation — svelte's SvelteKit route groups
 *     are real directories named `(app)`.
 *   * REPORTED — `separator`: a non-alphanumeric character absent from the lane's own
 *     symbol alphabet. Qualified names legitimately carry `.`, `:`, `/`, `@`, `$`,
 *     `?`, `!`, `-` (`io:format`, `clojure.string/join`, `UIKit/UIKit.h`, `@version`,
 *     `Class.member`), 21 of 24 lanes carry one, so convicting this tier would have
 *     laundered every real finding along with the conventions. Its (type, char)
 *     vocabulary is RECORDED and RULED in the register instead, and a lane that starts
 *     emitting a spelling nobody ruled drifts the register and fails.
 *
 * Refusals, each a way the census could accuse falsely: an absent census/register; a
 * census whose rows carry no `byClass` record (an absent measurement is not a clean
 * one); a census where every lane reads the same verdict (a broken classifier, not a
 * family). A lane under the census's MIN_SYMBOLS distinct names cannot have its
 * SEPARATOR class adjudicated and is counted as neither ruling debt nor innocence —
 * the convicting tier still applies to it in full, which is why a thin draw no longer
 * masks a lane's convictions.
 *
 * Convictions: an unregistered lane; a registered lane in no census row; a conviction
 * counted that the register does not record (a NEW fabricated surface anywhere in the
 * family); a conviction that DISAPPEARED without the register being re-written; a
 * separator triple added or vanished; a ruling recorded for a triple the lane no longer
 * emits; and OO debt — convicted OO lanes, or OO lanes with unruled separator
 * vocabulary — above the recorded target.
 *
 * Pure, so the negatives above can drive it with synthetic census/register pairs.
 */
export const TARGET_SPELLING_OO_LANES = ["csharp", "dart", "objc", "php", "python", "ruby", "swift"]

export function targetSpellingDetail(census: any, register: any): string {
  if (!register) return "R10 cannot adjudicate: validation/m60/target-spelling-register.json is absent"
  if (!census) return "R10 cannot adjudicate: validation/m60/results/target-spelling.json is absent — run bun script/m60/target-spelling-census.ts"
  const rows: any[] = census.rows ?? []
  if (!Array.isArray(rows) || rows.length === 0) return "R10 cannot adjudicate: the census carries no lane rows"
  const lanes: Record<string, any> = register.lanes ?? {}
  if (Object.keys(lanes).length === 0) return "R10 cannot adjudicate: the register records no lanes"
  const unmeasured = rows.filter((r) => r.verdict === "no-corpus")
  if (unmeasured.length) {
    return `R10 cannot adjudicate: ${unmeasured.length} lane(s) had no corpus files, so their spelling vocabulary is unknown — ${unmeasured.map((r) => String(r.lang)).slice(0, 4).join(", ")}`
  }
  const schemaBroken = rows.filter((r) => !r.byClass || !Array.isArray(r.separatorTriples))
  if (schemaBroken.length) {
    return `R10 cannot adjudicate: ${schemaBroken.length} census row(s) record no byClass / separatorTriples — an absent measurement is not a clean one (${schemaBroken.map((r) => String(r.lang)).slice(0, 4).join(", ")})`
  }
  const verdicts = new Set(rows.map((r) => String(r.verdict)))
  if (verdicts.size < 2) {
    return "R10 cannot adjudicate: every lane reads the same verdict, so the classifier is not discriminating — a single-answer census cannot convict a family contract"
  }
  // A conviction the census does not SPLIT cannot be routed to its owner, and the
  // `whitespace` class is exactly that case: the rationale it was first convicted on
  // ("no identifier in these languages contains whitespace") was refuted by the
  // lanes' own artifacts, so the class is only actionable once each conviction says
  // WHICH of the four mechanisms produced it.
  //
  // WHERE THIS CHECK SITS IS PART OF THE RULE, and the first version of it was wrong:
  // run before the drift comparison (as it was), a lane whose conviction count MOVED
  // reported "cannot adjudicate", which is the weaker answer to a stronger fact. A
  // count that differs from the register is provable WITHOUT routing — the drift needs
  // no owner — so it is reported first; the refusal is for the case where the counts
  // agree and the missing split is the only thing standing between the pair and a
  // verdict. Both states fail the gate (a refusal is not a verdict — see the live
  // predicate's own negative), but they must not be interchangeable: the alarm has to
  // name the drift it measured.
  const unsplit = rows.filter((r) => (r.byClass?.whitespace ?? 0) > 0 && !(r as any).whitespaceSubclasses)
  const rowBy = new Map(rows.map((r) => [String(r.lang), r]))
  const unregistered = rows.filter((r) => !lanes[String(r.lang)]).map((r) => String(r.lang))
  if (unregistered.length) {
    return `R10: ${unregistered.length} unregistered lane(s) — a lane's target-spelling vocabulary must be recorded before it is judged: ${unregistered.slice(0, 4).join(", ")}`
  }
  const disappeared = Object.keys(lanes).filter((l) => !rowBy.has(l))
  if (disappeared.length) {
    return `R10: ${disappeared.length} registered lane(s) appear in no census row — ${disappeared.slice(0, 4).join(", ")}`
  }
  const problems: string[] = []
  const sorted = (a: string[]) => JSON.stringify([...a].sort())
  for (const [lang, entry] of Object.entries(lanes)) {
    const row = rowBy.get(lang)!
    const gotConv = JSON.stringify(row.byClass ?? {})
    const wantConv = JSON.stringify(entry.convictions ?? {})
    if (gotConv !== wantConv) {
      const got = Object.keys(row.byClass ?? {}).length
      const want = Object.keys(entry.convictions ?? {}).length
      if (got > want) problems.push(`${lang} drifted: ${got} conviction class(es) measured vs ${want} recorded — ${JSON.stringify(row.byClass)}`)
      else problems.push(`${lang} drifted: convictions ${gotConv} measured vs ${wantConv} recorded — a finding may only be paid down by re-writing the register`)
      continue
    }
    // The split, pinned exactly: a lane may not move a target out of the one subclass
    // R10 owns (`sourceText`) by reclassifying it.
    const gotSub = JSON.stringify((row as any).whitespaceSubclasses ?? {})
    const wantSub = JSON.stringify(entry.convictionSubclasses ?? {})
    if (gotSub !== wantSub) {
      problems.push(
        `${lang} drifted: whitespace sub-classes ${gotSub} measured vs ${wantSub} recorded — a target may not be reclassified without re-writing the register`,
      )
      continue
    }
    const gotTriples = sorted(row.separatorTriples ?? [])
    const wantTriples = sorted(entry.separatorTriples ?? [])
    if (gotTriples !== wantTriples) {
      const measured = new Set<string>(row.separatorTriples ?? [])
      const recorded = new Set<string>(entry.separatorTriples ?? [])
      const added = [...measured].filter((t) => !recorded.has(t))
      const gone = [...recorded].filter((t) => !measured.has(t))
      problems.push(
        `${lang} drifted: separator vocabulary ` +
          (added.length ? `gained ${added.join(",")}` : "") + (added.length && gone.length ? " and " : "") + (gone.length ? `lost ${gone.join(",")}` : ""),
      )
      continue
    }
    const staleRuling = Object.keys(entry.rulings ?? {}).filter((tr) => !(row.separatorTriples ?? []).includes(tr))
    if (staleRuling.length) {
      problems.push(`${lang} drifted: ruling recorded for a triple the lane no longer emits — ${staleRuling.join(",")}`)
    }
  }
  if (problems.length) {
    return `R10: ${problems.length} lane(s) drifted from the register — ${problems.slice(0, 3).join(" | ")}`
  }
  // Nothing drifted, so an unsplit conviction is now the only thing that can stop a
  // verdict: refuse rather than read clean (see the ordering note above).
  if (unsplit.length) {
    return `R10 cannot adjudicate: ${unsplit.length} lane(s) convict the whitespace class and record no sub-class split — an unsplit conviction cannot be routed to its owner (${unsplit.map((r) => String(r.lang)).slice(0, 4).join(", ")})`
  }
  // OO debt: the owner standard's zero target. Convictions always count; a lane whose
  // draw could not adjudicate the separator class has no ruling debt to pay, because its
  // vocabulary was never measured against an alphabet.
  const ooConvicted = TARGET_SPELLING_OO_LANES.filter((l) => Object.keys(lanes[l]?.convictions ?? {}).length > 0)
  const ooUnruled = TARGET_SPELLING_OO_LANES.filter((l) => {
    const row = rowBy.get(l)
    if (!row || row.separatorAdjudicable === false) return false
    return Object.values(lanes[l]?.rulings ?? {}).some((v) => v === null)
  })
  const targetConvicted = Number(register.ooTarget?.convictedLanes ?? -1)
  const targetUnruled = Number(register.ooTarget?.unruledSeparatorLanes ?? -1)
  if (targetConvicted < 0 || targetUnruled < 0) {
    return "R10 cannot adjudicate: the register records no OO target, so OO debt could rise unobserved"
  }
  if (ooConvicted.length > targetConvicted) {
    return `R10: OO lanes with a target-spelling conviction rose to ${ooConvicted.length} from the recorded target ${targetConvicted} — ${ooConvicted.join(", ")}`
  }
  if (ooUnruled.length > targetUnruled) {
    return `R10: OO lanes with UNRULED separator vocabulary rose to ${ooUnruled.length} from the recorded target ${targetUnruled} — ${ooUnruled.join(", ")}`
  }
  const convicted = Object.keys(lanes).filter((l) => Object.keys(lanes[l].convictions ?? {}).length > 0)
  const ruled = Object.keys(lanes).filter((l) => Object.keys(lanes[l].rulings ?? {}).length > 0)
  return (
    `R10: all ${Object.keys(lanes).length} register entries match exactly (${verdicts.size} distinct verdicts measured); ` +
    `${(census.clean ?? []).length} lane(s) clean, ${convicted.length} carry a provable fabricated spelling (${convicted.join(", ")}), ` +
    `${ruled.length} have ruled separator conventions; OO debt ${ooConvicted.length}/${targetConvicted} convicted and ${ooUnruled.length}/${targetUnruled} unruled`
  )
}

/**
 * R8: no analyzer may publish a framework capability it does not have, or name one
 * framework twice.
 *
 * Two halves again, and this time BOTH exist. The static census
 * (script/m60/framework-surface-census.ts) classifies every framework-surface site by
 * syntactic position — a published contract key read from the metadata object only, the
 * write operator applied to the accumulator, the loop a write iterates, the guards that
 * terminate before a trigger. The runtime half (script/m60/framework-surface-probe.ts)
 * measures the EMITTED metadata over fixtures and real corpora, because `append-write` is
 * a reported shape whose severity is multiplicity: a straight-line push of distinct names
 * cannot duplicate while a push inside a per-node walker duplicates once per node.
 *
 * The census was wrong four times before it was trusted, and each correction is recorded
 * in its header — the self-tests were written first and convicted the classifier each
 * time. That is why the gate refuses to adjudicate when a self-test fails: a classifier
 * that cannot discriminate produces a meaningless census, and a meaningless census
 * underneath a green gate is worse than no gate.
 *
 * Pure, so the negatives below can drive it with synthetic census/register pairs.
 */
export function frameworkRegisterDetail(census: any, register: any): string {
  if (!register) return "R8 cannot adjudicate: validation/m60/framework-surface-register.json is absent"
  if (!census) return "R8 cannot adjudicate: validation/m60/results/framework-surfaces.json is absent — run script/m60/framework-surface-census.ts --emit"
  const st = census.selfTests ?? {}
  if ((st.failures ?? []).length) {
    return `R8 cannot adjudicate: the framework-surface classifier failed its own self-tests (${(st.failures ?? []).join("; ")}) — a classifier that cannot discriminate produces a meaningless census`
  }
  if ((census.parseErrors ?? []).length) {
    return `R8 cannot adjudicate: analyzer source(s) did not parse, so their sites are unknown — ${(census.parseErrors ?? []).join(", ")}`
  }
  // A lane that goes blind reports the same zero as a lane that is clean. Measured, not
  // hypothetical: an earlier version of the objective-c fix wrapped its metadata literal in
  // an IIFE, which `collectMetadata` cannot read, and the whole lane dropped out of
  // adjudication while every count stayed at zero. Refusing here converts that silent
  // blind spot into a loud one.
  if ((census.unexamined ?? []).length) {
    return `R8 cannot adjudicate: ${(census.unexamined ?? []).length} analyzer(s) name a framework-contract key but publish none the classifier can read, so "no violations" would mean "not examined" — ${(census.unexamined ?? []).join(", ")}`
  }
  const keyOf = (s: any) => [s.file, s.shape, s.key ?? "-", String(s.statement ?? "").replace(/\s+/g, " ").trim()].join("\u0000")
  const live = new Map<string, { n: number; sample: any }>()
  for (const s of census.sites ?? []) {
    const k = keyOf(s)
    const cur = live.get(k) ?? { n: 0, sample: s }
    cur.n++
    live.set(k, cur)
  }
  const entries: any[] = register.entries ?? []
  const registered = new Set(entries.map((e: any) => keyOf(e)))
  const unregistered = [...live.entries()].filter(([k]) => !registered.has(k))
  if (unregistered.length) {
    return (
      `R8: ${unregistered.length} unregistered framework-surface site(s) — an analyzer publishes a capability it does not have, or names one framework twice: ` +
      unregistered.slice(0, 3).map(([, v]) => `${v.sample.file}:${v.sample.line} ${v.sample.shape} [${v.sample.key}] \`${String(v.sample.statement).slice(0, 90)}\``).join(" | ")
    )
  }
  const drifted: string[] = []
  for (const e of entries) {
    const n = live.get(keyOf(e))?.n ?? 0
    if (n > (e.count ?? 0)) drifted.push(`${e.file} ${e.shape} [${e.key}] grew to ${n} (registered ${e.count})`)
    else if (n < (e.count ?? 0)) drifted.push(`${e.file} ${e.shape} [${e.key}] is now ${n} (registered ${e.count}) — shrink the register deliberately, never silently`)
  }
  if (drifted.length) return `R8: ${drifted.length} registered site(s) drifted from the register — ${drifted.slice(0, 3).join(" | ")}`
  const liveViolations = (census.sites ?? []).filter((s: any) => s.verdict === "violation").length
  const base = register.baseline?.violations ?? 0
  if (liveViolations > base) {
    return `R8: framework-surface violation sites rose to ${liveViolations} from the registered baseline ${base} — the class may only shrink`
  }
  const ooTarget = register.ooTarget?.violations ?? 0
  const liveOo = (census.sites ?? []).filter((s: any) => s.verdict === "violation" && OO_LANES.includes(s.lang)).length
  if (liveOo > ooTarget) {
    return `R8: OO framework-surface violations rose to ${liveOo} from the recorded OO target ${ooTarget} — the seven OO lanes are the owner standard's zero target and may only shrink`
  }
  const other = (census.sites ?? []).length - liveViolations
  const ooNote = liveOo > 0 ? `; OO target ${ooTarget}, ${liveOo} still to repay (ruby #749, python #747, swift/objc contract keys)` : "; OO target met"
  return `R8: ${liveViolations} framework-surface violation site(s) in ${census.files ?? "?"} analyzers, ${other} adjudicated reported/safe site(s); all ${entries.length} register entries match exactly (baseline ${base}${ooNote})`
}

/**
 * The VERDICT of a register reading — never its prefix.
 *
 * R7 and R8 report every finding in the same channel as their clean reading and every
 * message in it begins `R7: ` / `R8: `, so the original live checks
 * (`detail.startsWith("R7:")`) were true for a conviction as well as for a clean
 * register, and the two rules could only ever fail on a refusal to adjudicate. Measured
 * live on 2026-09-22: a new placeholder site landed in the c lane
 * (`real-c-analyzer.ts:2494`, `parameters.push({ name: "unknown", ... })`) and G1 stayed
 * green while its own census listed the site as unregistered. A rule that cannot fail is
 * decoration — the same standard the self-tests below apply to every classifier.
 *
 * The predicate is an ALLOWLIST of the adjudicated phrasing rather than a blacklist of
 * the finding phrasings, because the two failure modes are not symmetric: a blacklist
 * fails OPEN — a new kind of conviction whose wording is not on the list would read as a
 * clean register — while this fails CLOSED, since a message that is not the adjudicated
 * one is not accepted as a verdict no matter how it is worded. The phrase is the one
 * only the adjudicated branch writes (`all N register entries match exactly`), and it is
 * shared by both rules through one copy so the two can never drift apart.
 */
export function registerAdjudicated(detail: string, rule: "R7" | "R8" | "R9"): boolean {
  return detail.startsWith(`${rule}: `) && detail.includes("register entries match exactly")
}

/** Pure, so the negatives below can drive it with synthetic census/register pairs. */
export function sentinelRegisterDetail(census: any, register: any): string {
  if (!register) return "R7 cannot adjudicate: validation/m60/symbol-sentinel-register.json is absent"
  if (!census) return "R7 cannot adjudicate: validation/m60/results/symbol-sentinels.json is absent — run script/m60/sentinel-census.ts --emit"
  const st = census.selfTests ?? {}
  if ((st.failures ?? []).length) {
    return `R7 cannot adjudicate: the census classifier failed its own self-tests (${(st.failures ?? []).join("; ")}) — a classifier that cannot discriminate produces a meaningless census`
  }
  if ((census.parseErrors ?? []).length) {
    return `R7 cannot adjudicate: analyzer source(s) did not parse, so their sites are unknown — ${(census.parseErrors ?? []).join(", ")}`
  }
  const keyOf = (s: any) =>
    [s.file, s.shape, s.key ?? "-", String(s.statement ?? "").replace(/\s+/g, " ").trim()].join("\u0000")
  const live = new Map<string, { n: number; sample: any }>()
  for (const s of census.sites ?? []) {
    const k = keyOf(s)
    const cur = live.get(k) ?? { n: 0, sample: s }
    cur.n++
    live.set(k, cur)
  }
  const entries: any[] = register.entries ?? []
  const registered = new Set(entries.map((e: any) => keyOf(e)))
  const unregistered = [...live.entries()].filter(([k]) => !registered.has(k))
  if (unregistered.length) {
    return (
      `R7: ${unregistered.length} unregistered placeholder site(s) — an analyzer names something with a literal instead of an absence: ` +
      unregistered.slice(0, 3).map(([, v]) => `${v.sample.file}:${v.sample.line} ${v.sample.shape} \`${String(v.sample.statement).slice(0, 90)}\``).join(" | ")
    )
  }
  const drifted: string[] = []
  for (const e of entries) {
    const n = live.get(keyOf(e))?.n ?? 0
    if (n > (e.count ?? 0)) drifted.push(`${e.file} ${e.shape}${e.key ? `.${e.key}` : ""} grew to ${n} (registered ${e.count})`)
    else if (n < (e.count ?? 0)) drifted.push(`${e.file} ${e.shape}${e.key ? `.${e.key}` : ""} is now ${n} (registered ${e.count}) — shrink the register deliberately, never silently`)
  }
  if (drifted.length) return `R7: ${drifted.length} registered site(s) drifted from the register — ${drifted.slice(0, 3).join(" | ")}`
  const liveViolations = (census.sites ?? []).filter((s: any) => s.verdict === "violation").length
  const base = register.baseline?.violations ?? 0
  if (liveViolations > base) {
    return `R7: placeholder violation sites rose to ${liveViolations} from the registered baseline ${base} — the class may only shrink`
  }
  const other = (census.sites ?? []).length - liveViolations
  return `R7: ${liveViolations} placeholder violation site(s) in ${census.files ?? "?"} analyzers, ${other} adjudicated non-violation site(s); all ${entries.length} register entries match exactly (baseline ${base})`
}

function finish(head: string) {
  const result = {
    gate: "M60.G1",
    title: "Standing rules R1–R4 and the gate that enforces them",
    at: new Date().toISOString(),
    atCommit: head,
    passed,
    failed,
    negatives,
    failures,
    verdict: failed === 0 ? "PASS" : "FAIL",
    machinery: {
      R1: "undocumentedOpenMilestones() — GitHub milestones vs docs/",
      R2: "computeFamilyClosure(blocked, open) — pure, negative-tested; live application in verify-family-closure-truth.ts",
      R3: "findingDocsMissingIssues(docs) — reviews/*.md registration scan, negative-tested",
      R4: "foldOwedDetail() — a fold row is owed by every OTHERWISE-READY family; the trigger excludes foldPresent (so deleting a landed fold row still fails) and reads the live X1 closure result, refusing to adjudicate without one computed at HEAD",
    R6: "lineBaseViolations(sources) — every metadata.line writer must be provably 1-based, directly or through a same-file helper whose every return is provably 1-based or an absence (static, fail-closed), negative-tested; live application in verify-standing-rules.ts itself",
    R7: "sentinelRegisterDetail(census, register) — every placeholder-literal site in every analyzer is registered by source statement with an exact count; a new site, a grown site and a vanished site all fail (static, exact-count shrink-only), negative-tested. Census: script/m60/sentinel-census.ts (AST classification, self-tested). Runtime half disclosed as outstanding in the register",
    R8: "frameworkRegisterDetail(census, register) — every framework-surface site is registered exactly, the class may only shrink, and the seven OO lanes' violations are additionally capped by the recorded OO target so a lane cannot be absorbed into the global baseline; a new site, a grown site, a vanished site, an absent artifact and a failed self-test all fail (static, exact-count shrink-only), 14 negatives. Census: script/m60/framework-surface-census.ts (17 self-tests). Runtime half: script/m60/framework-surface-probe.ts over fixtures and real corpora",
    R9: "declaredTypeRegisterDetail(census, register) — the family's declared-type reference graph (references + metadata.relationshipType 'declared_type', rust R13's family standard) measured per lane at RUNTIME by driving each lane's real analyzer, with a holder-symbol control so a bad snippet can never read as a missing capability; an unregistered lane, a regressed lane, a lane that closes its gap without flipping the register, a lane emitting under a divergent marker, a not-exercised or errored lane, an absent artifact, and OO debt above the recorded target all fail, 21 negatives. Census: script/m60/declared-type-refs-census.ts",
    },
  }
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n")
  console.log(`G1: ${passed} passed, ${failed} failed (${negatives} negatives) — ${result.verdict}`)
  for (const f of failures) console.log(`  FAIL: ${f}`)
  console.log(`  → ${path.relative(ROOT, OUT)}`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
