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
// reality) is the closure gate: script/m60/verify-family-closure-truth.ts.
//
// Run: bun script/m60/verify-standing-rules.ts → validation/m60/results/G1.json
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { computeFamilyClosure, loadFamilies } from "./family-closure"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT = path.join(ROOT, "validation/m60/results/G1.json")
const LEDGER = path.join(ROOT, "validation/m60/ledger.json")
const MATRIX = path.join(ROOT, "validation/m60/results/P1.json")
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

export function findingDocsMissingIssues(docMap: Record<string, string>): string[] {
  const missing: string[] = []
  for (const [name, text] of Object.entries(docMap)) {
    if (REGISTER_DOCS_EXEMPT_FROM_R3.includes(name)) continue
    const registersFindings = /(registers?|found by|files? (this|the) (defect|finding|issue)|issue (created|filed)|handoff message)/i.test(text)
    if (!registersFindings) continue
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
const ONE_BASED_LINE = /(\.|^)startPosition\.row\s*\+\s*1\b/

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
  // provably 1-based.
  return lineBaseWriters(sources)
    .filter((w) => w.value !== "null" && !ONE_BASED_LINE.test(w.value))
    .map((w) => `${w.at} — metadata.line is not provably 1-based: \`line: ${w.value}\``)
}

// ============================================================================
// R4 machinery: the M49 ledger must carry the fold record.
// ============================================================================
// Read STRUCTURALLY, per family. The rule is R4 verbatim — "M60's family results
// are recorded into M49 as the evidence its jvm/web closure claims are true" —
// and it names two families, so a keyword test reported the fold as landed for a
// ledger that merely mentioned M60 in prose, or for one family's row while the
// other's was absent. The fold is per family because the claim it evidences is.
function foldRecordDetail(): string {
  const p = path.join(ROOT, "validation/m49/ledger.json")
  if (!existsSync(p)) return "validation/m49/ledger.json missing"
  let fold: Record<string, any> = {}
  try { fold = JSON.parse(readFileSync(p, "utf8")).foldRecords ?? {} } catch { return "validation/m49/ledger.json unreadable" }
  const families = Object.keys(loadFamilies(ROOT))
  const landed = families.filter((f) => fold[f] && typeof fold[f].summary === "string" && fold[f].summary.trim().length >= 20)
  const missing = families.filter((f) => !landed.includes(f))
  return missing.length === 0
    ? `fold present for ${landed.join(" + ")}: ${String(fold[landed[0]].summary).slice(0, 100)}`
    : `M49 ledger carries no M60 fold row for ${missing.join(", ")} (the fold happens at that family's close)`
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
  negative("R6 negative: a 0-based mirror is flagged", r6(`metadata: { line: node.startPosition.row, qualified: q }`).length === 1)
  negative("R6 negative: a 1-based mirror passes", r6(`metadata: { line: node.startPosition.row + 1, qualified: q }`).length === 0)
  negative("R6 negative: the scan is not vacuous (a non-metadata `line:` key is ignored)", r6(`const t: { line: number } = { line: n.startPosition.row }`).length === 0)
  negative("R6 negative: a nested object cannot hide the key", r6(`metadata: { note: { inner: 1 }, line: n.startPosition.row }`).length === 1)
  negative("R6 negative: one writer does not mask the next", r6(`metadata: { line: a.startPosition.row + 1 }\nmetadata: { line: b.startPosition.row }`).length === 1)
  negative("R6 negative: an explicit null is absence, not a base", r6(`metadata: { line: null }`).length === 0 && lineBaseWriters([{ file: "p", src: `metadata: { line: null }` }]).length === 1)
  negative("R6 negative: a ternary `? line :` in a sibling key is not the key", r6(`metadata: { decoratorLine: typeof line === "number" ? line : null }`).length === 0 && lineBaseWriters([{ file: "p", src: `metadata: { decoratorLine: typeof line === "number" ? line : null }` }]).length === 0)

  // ---- R4 live: fold record (fails until X1 lands the fold) ---------------
  const fold = foldRecordDetail()
  check("R4 live: M49 ledger carries the M60 fold record", fold.startsWith("fold present"), fold)

  finish(head)
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
      R4: "foldRecordDetail() — M49 ledger fold record",
    R6: "lineBaseViolations(sources) — every metadata.line writer must be provably 1-based (static, fail-closed), negative-tested; live application in verify-standing-rules.ts itself",
    },
  }
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n")
  console.log(`G1: ${passed} passed, ${failed} failed (${negatives} negatives) — ${result.verdict}`)
  for (const f of failures) console.log(`  FAIL: ${f}`)
  console.log(`  → ${path.relative(ROOT, OUT)}`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
