// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the design-spec gate for bb_doc: docs/BB_DOC.md must still
//   state the contract every implementation detail depends on — the seven modes,
//   the evidence classes, the citation/freshness rules, the payload-measured
//   budget, the declared refusals, the read-only boundary and the gate list.
// WHICH TOOL IT SERVES — bb_doc.
// WHY IT IS SHAPED THIS WAY — it asserts CONTRACT SENTENCES, not prose style: each
//   check names the sentence an implementation change would have to update, and a
//   check that removes a required sentence goes red.
// WHERE ITS EVIDENCE LIVES — it prints PASS/FAIL; the doc gates' JSON lives with the
//   suites this file supports (m13/m20).
// EDIT TOGETHER WHEN THIS CHANGES — docs/BB_DOC.md, docs/BB_DOC_REFERENCE.md,
//   docs/BB_DOC_EXAMPLES.md.
// CONTRACTS IT MUST NOT BREAK — a green run must mean the specification still
//   carries the contract, not that a previous revision of the prose exists.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs"

let failures = 0
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok: ${name}`)
  else { failures++; console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`) }
}

// Markdown line-wraps a sentence at ~100 columns, so every check compares the
// FLATTENED text; otherwise a contract sentence is only found when the author
// happens to wrap it the same way the check does.
const flat = (text: string): string => text.split(/\s+/).join(" ")
const specification = flat(readFileSync("docs/BB_DOC.md", "utf8"))
const reference = flat(readFileSync("docs/BB_DOC_REFERENCE.md", "utf8"))
const examples = flat(readFileSync("docs/BB_DOC_EXAMPLES.md", "utf8"))

// ── the seven modes and their targets ──────────────────────────────────────
for (const mode of ["symbol", "file", "module", "feature", "api", "project", "coverage"]) {
  check(`mode ${mode} documented`, specification.includes(`"${mode}"`), mode)
}
check("target requirement stated", /required for `symbol`, `file`, `module` and `feature`/.test(specification))
check("project target is metadata only", specification.includes("uses it as document metadata only") || specification.includes("metadata only"), "project scope statement")
check("module refusal stated", specification.includes("module") && specification.includes("refuses rather than falls back"), "module refusal")

// ── result contract ────────────────────────────────────────────────────────
check("classification vocabulary", ["extracted", "inferred", "generated", "unknown"].every((term) => specification.includes(`**${term}**`) || specification.includes(`"${term}"`)), "classes")
check("confidence is derived", specification.includes("Confidence is DERIVED"), "derived confidence")
check("citation ids deterministic", specification.includes("deterministic for the same project snapshot"), "determinism")
check("emitted-vs-collected counts", specification.includes("collectedStale") && specification.includes("count the citations the answer EMITS"), "reference counts")
check("bounds arithmetic stated", specification.includes("emitted + droppedForBudget === capped") || specification.includes("droppedByBudget"), "bounds identity")

// ── budget / freshness / refusals ─────────────────────────────────────────
check("payload budget stated", specification.includes("enforced on the payload") && specification.includes("1–16000"), "budget")
check("budget failure is declared, not hidden", specification.includes("budget.passed: false") && specification.includes("never met by dropping a required section"), "shortfall")
check("default limits stated", specification.includes("20 items per section") && specification.includes("8,000 tokens"), "defaults")
check("refusal table states ranges", specification.includes("limit") && specification.includes("1–100") && specification.includes("maxTokens"), "ranges")
check("includeTests modes stated", specification.includes("includeTests") && specification.includes("symbol/feature only"), "includeTests")
check("auto-refresh is declared", /auto-refresh/i.test(specification) && /within the shared\s+budget/i.test(specification) && specification.includes("declares the decision"), "refresh")
check("declined repair vocabulary", specification.includes("manual-only constants"), "decline wording")
check("read-only boundary", specification.includes("never writes a repository file") && specification.includes("one write is bounded"), "read-only")
check("snapshot identity", specification.includes("snapshotId") && specification.includes("canonicalPath") && specification.includes("slugs"), "website keys")
check("diagrams not fabricated", specification.includes("Diagrams are not emitted"), "diagrams")
check("examples not fabricated", specification.includes("Examples are not emitted"), "examples")
check("verification list present", specification.includes("verify-doc-design.ts") && specification.includes("verify-doc-truth.ts"), "gates named")

// ── the compact pages must agree with the specification ───────────────────
check("reference page lists the seven modes", ["symbol", "file", "module", "feature", "api", "project", "coverage"].every((mode) => reference.includes(mode)), "reference modes")
check("reference page states the ranges", reference.includes("1–100") && reference.includes("1–16000"), "reference ranges")
check("examples page carries real output", examples.includes("# symbol: total") && examples.includes('"quality"'), "examples real")
check("examples page carries the refusals", examples.includes("bb_doc limit must be a whole number between 1 and 100"), "refusal examples")

console.log(failures === 0 ? "\nDOC DESIGN: PASS" : `\nDOC DESIGN: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
