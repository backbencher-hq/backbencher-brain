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
    sentinel.startsWith("R7:"), sentinel)

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

  // ---- R8 live: no analyzer publishes a framework capability it does not have ----
  const fwRegister = readJsonOrNull(FRAMEWORK_REGISTER)
  const fw = frameworkRegisterDetail(readJsonOrNull(FRAMEWORK_CENSUS), fwRegister)
  check("R8 live: every framework-surface site is registered, none added, none silently gone", fw.startsWith("R8:"), fw)

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
    },
  }
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n")
  console.log(`G1: ${passed} passed, ${failed} failed (${negatives} negatives) — ${result.verdict}`)
  for (const f of failures) console.log(`  FAIL: ${f}`)
  console.log(`  → ${path.relative(ROOT, OUT)}`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
