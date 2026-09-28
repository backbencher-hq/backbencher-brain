// script/m61/verify-claims.ts — M61.V5 verifier + mutation suite (issue #846).
//
// Proves the claim pins (script/m61/claim_pins.ts) hold over the real docs, and
// that the suite CAN FAIL.
//
//   C0 registry:  the claims registry is well-formed (unique ids; every claim
//                 has a doc that exists, a template, and a derivation with a
//                 kind and a source).
//   C1 derivable: every claim's numbers come from the evidence it cites. A
//                 missing source is BLOCKED with its reason — never OK, and
//                 never silently zero.
//   C2 pinned:    every claim's rendered row appears verbatim in its doc. This
//                 is where prose drift dies: the published number must equal
//                 the ledger's number.
//   C3 coverage:  the declared audit set is README + website + docs (#846). A
//                 doc declared out-of-scope that publishes a lane count fails,
//                 and a pinned doc with no pins fails — so "we only audited one
//                 file" cannot pass as coverage.
//
// Mutants (source-level copies) prove the suite CAN FAIL:
//   M1 pin-blind:      a drifted doc reports as pinned.
//   M2 blocked-as-ok:  a missing source reports as pinned.
//   M3 render-blind:   the template is not filled, so the pin is disconnected
//                      from the derivation.
//   M4 registry-blind: well-formedness problems are not reported.
//   M5 scan-blind:     the doc scan never finds the rendered row (so a fully
//                      correct doc would be reported as drifted — proving the
//                      comparison is live rather than vacuous).
//   M6 coverage-blind: an out-of-scope doc publishing a lane count stops
//                      failing — the coverage law is disconnected.
//   M7 unpinned-blind: a pinned doc with no pins stops failing.
//
// Run: npx tsx script/m61/verify-claims.ts
// Evidence: validation/m61/results/V5.json (sealed)

import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { writeSealed } from "../lib/evidence.ts"
import {
  ROOT,
  claimAnchor,
  classify,
  derive,
  coverageCensus,
  coverageFindings,
  loadClaims,
  pinClaims,
  registryProblems,
  render,
  type Claim,
  type ClaimResult,
} from "./claim_pins.ts"

const RESULTS = path.join(ROOT, "validation/m61/results")

let passed = 0
let failed = 0
const failures: string[] = []
const checks: string[] = []
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed++
  else {
    failed++
    failures.push(detail ? `${name} — ${detail}` : name)
  }
  checks.push(`${ok ? "ok" : "FAIL"}: ${name}${detail && !ok ? ` — ${detail}` : ""}`)
}

const src = readFileSync(path.join(ROOT, "script/m61/claim_pins.ts"), "utf8")
const registry = loadClaims()
const results = pinClaims(registry)

// --- C0: the registry ------------------------------------------------------------
console.log("C0: the claims registry is well-formed")
const problems = registryProblems(registry)
check("C0: no registry problems", problems.length === 0, problems.slice(0, 3).join(" | "))
check("C0: the registry pins a non-trivial number of claims", registry.claims.length >= 8, `${registry.claims.length} claims`)
const docs = new Set(registry.claims.map((c) => c.doc))
check("C0: the registry covers at least one published doc", docs.size >= 1, [...docs].join(", "))
const kinds = new Set(registry.claims.map((c) => c.derive.kind))
check("C0: more than one derivation kind is exercised", kinds.size >= 2, [...kinds].join(", "))

// --- C1: derivable ---------------------------------------------------------------
console.log("\nC1: every claim derives from the evidence it cites")
const blocked = results.filter((r) => r.outcome === "blocked")
check("C1: no claim is blocked (every cited source resolves)", blocked.length === 0, blocked.map((b) => `${b.id}: ${b.reason}`).slice(0, 3).join(" | "))
const derivedOk = registry.claims.filter((c) => !derive(c).blocked)
check("C1: every claim's derivation yields numbers", derivedOk.length === registry.claims.length, `${derivedOk.length}/${registry.claims.length}`)

// --- C2: pinned ------------------------------------------------------------------
console.log("\nC2: every published number equals its ledger")
const drifted = results.filter((r) => r.outcome === "drifted")
check("C2: no published claim has drifted from its ledger", drifted.length === 0, drifted.map((d) => `${d.id}: published ${d.published} row(s), expected "${d.rendered}"`).slice(0, 4).join(" | "))
check("C2: the pins are live (at least one row was found for every claim)", results.every((r) => r.outcome !== "pinned" || r.published >= 1))

// --- C3: coverage of the audit set (README + website + docs) ----------------------
console.log("\nC3: the declared audit set publishes no unpinned lane count")
const covFindings = coverageFindings(registry)
check("C3: every declared doc exists and honors its coverage status", covFindings.length === 0, covFindings.slice(0, 4).join(" | "))
const census = coverageCensus(registry)
check(
  "C3: the audit set covers README, the website and the docs end to end",
  census.some((c) => c.doc === "README.md") && census.some((c) => c.doc.startsWith("website/")) && census.some((c) => c.doc.startsWith("docs/")),
  census.map((c) => c.doc).join(", "),
)
const pinnedDoc = census.find((c) => c.status === "pinned")
check("C3: the pinned doc really publishes lane counts (the scan is live, not vacuous)", !!pinnedDoc && pinnedDoc.published > 0, JSON.stringify(pinnedDoc ?? null))
check(
  "C3: the coverage set declares a pinned doc and at least one enforced exclusion",
  census.some((c) => c.status === "pinned") && census.some((c) => c.status === "out-of-scope"),
  `${census.length} declared docs`,
)

// --- pure cores on known inputs ---------------------------------------------------
console.log("\ncores: known inputs")
check("core: render substitutes every declared key", render("a {n} b {m}", { n: 3, m: 4 }) === "a 3 b 4")
check("core: render leaves an unknown key literal", render("a {n} {zz}", { n: 3 }) === "a 3 {zz}")
check("core: classify — a blocked derivation is blocked, whatever else is true", classify("source missing", "x/y", 5) === "blocked")
check("core: classify — an unfilled template is blocked, never compared", classify(undefined, "{a}/{b}", 5) === "blocked")
check("core: classify — a found row is pinned", classify(undefined, "x/y", 1) === "pinned")
check("core: classify — no found row is drift", classify(undefined, "x/y", 0) === "drifted")
check("core: classify — a stale row beside a correct one is drift", classify(undefined, "x/y", 1, 1) === "drifted")
check(
  "core: claimAnchor — the longest literal segment no other claim shares",
  claimAnchor("{mutants} mutants caught across {suites} suites | [m26 ledger]", [
    "{mutants} mutants caught across {suites} suites | [m27 ledger]",
  ]) === " suites | [m26 ledger]",
  `anchor="${claimAnchor("{mutants} mutants caught across {suites} suites | [m26 ledger]", ["{mutants} mutants caught across {suites} suites | [m27 ledger]"])}"`,
)
check(
  "core: claimAnchor — a segment shared with another claim is never the anchor",
  !claimAnchor("{mutants} mutants caught across {suites} suites | [m26 ledger]", [
    "{mutants} mutants caught across {suites} suites | [m27 ledger]",
  ]).includes("mutants caught across"),
)
check("core: claimAnchor — an all-placeholder template has no anchor", claimAnchor("{a}/{b}") === "")
check("core: claimAnchor — no unique segment means no anchor", claimAnchor("{a}/{b}", ["{a}/{b}"]) === "")
check(
  "core: claimAnchor — short segments are never anchors",
  claimAnchor("{a} x {b}", [], ["x {a} x", "x {b} x"]) === "",
  `anchor="${claimAnchor("{a} x {b}", [], ["x {a} x", "x {b} x"])}"`,
)
check(
  "core: claimAnchor — the most specific candidate wins over the longest",
  claimAnchor("{n} mutants caught across {s} suites | [m26 ledger]", [], [
    "a mutants caught across b suites | [m26 ledger]",
    "17 mutants caught across 5 suites | [m27 ledger]",
  ]) === " suites | [m26 ledger]",
)

// --- mutants: the suite CAN FAIL --------------------------------------------------
console.log("\nmutants: the suite can fail (source-level copies)")
for (const f of readdirSync(path.join(ROOT, "script/m61"))) {
  if (f.startsWith(".mutant-claims-")) rmSync(path.join(ROOT, "script/m61", f), { force: true })
}

async function runMutant(name: string, from: string, to: string, probe: (mod: Record<string, unknown>) => boolean): Promise<void> {
  if (!src.includes(from)) {
    check(`M: ${name} (mutation anchor exists)`, false, "anchor not found — the mutant is stale")
    return
  }
  const mutantPath = path.join(ROOT, "script/m61", `.mutant-claims-${name}.ts`)
  writeFileSync(mutantPath, src.replace(from, to))
  try {
    const mod = (await import(pathToFileURL(mutantPath).href)) as Record<string, unknown>
    check(`M: ${name}`, probe(mod) === true, "the mutant did NOT manifest the defect — the suite could not fail")
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? ""
    const cannotLoad = code.startsWith("ERR_MODULE") || code === "ERR_UNKNOWN_FILE_EXTENSION" || e instanceof SyntaxError
    if (cannotLoad) check(`M: ${name}`, false, `the mutant could not load (${code || (e as Error).name}) — the can-fail proof is disarmed`)
    else check(`M: ${name}`, true, `(mutant crashed at runtime — still caught: ${(e as Error).message})`)
  } finally {
    rmSync(mutantPath, { force: true })
  }
}

const patchedDoc = (doc: string, from: string, to: string): Record<string, string> => ({
  [doc]: readFileSync(path.join(ROOT, doc), "utf8").replace(from, to),
})

// M1: a doc whose number was edited away from the ledger must be caught. The
// doctored row is DERIVED from the claim's own rendered row (never a number
// typed into the fixture — a hardcoded one went stale the moment the ledger
// moved, and the mutant silently disarmed). Only the numbers move; the anchor
// (the ledger link) stays, so the line still states the claim.
const pinOf = (results: ClaimResult[]): ClaimResult => results.find((x) => x.id === "m26-mutants")!
const m26Live = pinOf(pinClaims(registry))
const m26Template = (): string => registry.claims.find((c) => c.id === "m26-mutants")!.template
/** The same anchor the pin rule resolves — the fixture must doctor the line the
 *  rule actually watches, or the mutant would prove nothing. */
const m26Anchor = (lines: string[]): string =>
  claimAnchor(
    m26Template(),
    registry.claims.filter((c) => c.id !== "m26-mutants").map((c) => c.template),
    lines,
  )
const staleRow = (rendered: string, lines: string[]): string => {
  const anchor = m26Anchor(lines)
  const head = rendered.slice(0, rendered.indexOf(anchor))
  return head.replace(/\d+/g, (n) => `${Number(n) + 1000}`) + anchor
}
/** `gone`: the claim is no longer stated at all (the counting rule alone must
 *  catch it). `twice`: a stale row beside a correct one — the case where
 *  counting matching rows alone is blind. */
const doctoredDoc = (mode: "gone" | "twice"): Record<string, string> => {
  const text = readFileSync(path.join(ROOT, m26Live.doc), "utf8")
  const stale = staleRow(m26Live.rendered, text.split("\n"))
  const replacement = mode === "gone" ? "(this row was removed)" : `${stale}\n${m26Live.rendered}`
  return { [m26Live.doc]: text.replace(m26Live.rendered, replacement) }
}
{
  const r = pinOf(pinClaims(registry, doctoredDoc("gone")))
  check("M: pin-blind (a doc that no longer states the claim reports as drifted)", r.outcome === "drifted", `outcome=${r.outcome}`)
  const t = pinOf(pinClaims(registry, doctoredDoc("twice")))
  check(
    "M: stale-row (a stale row beside a correct one is drift, not a passing pin)",
    t.outcome === "drifted" && t.mismatched === 1 && t.published === 1,
    `outcome=${t.outcome} published=${t.published} mismatched=${t.mismatched}`,
  )
}
await runMutant("pin-blind", '  return published > 0 ? "pinned" : "drifted"', '  return "pinned"', (mod) => {
  const rs = (mod.pinClaims as typeof pinClaims)(registry, doctoredDoc("gone"))
  return pinOf(rs).outcome === "pinned"
})
// The strengthened half must be able to fail on its own: with the stale-row rule
// suppressed, a twice-stated claim keeps passing on the strength of its one
// correct row.
await runMutant("stale-row-blind", '  if (mismatched > 0) return "drifted"', '  if (false) return "drifted"', (mod) => {
  const rs = (mod.pinClaims as typeof pinClaims)(registry, doctoredDoc("twice"))
  return pinOf(rs).outcome === "pinned"
})

// The blocked path must be able to fail: if a blocked derivation stopped
// short-circuiting, a claim whose source is missing would be compared against
// prose it could never derive — a missing source laundered into a verdict.
await runMutant("blocked-as-ok", '  if (blocked) return "blocked"\n  if (/\\{\\w+\\}/.test(rendered)) return "blocked"', '  if (/\\{\\w+\\}/.test(rendered)) return "blocked"', (mod) => {
  const g = (mod.classify as typeof classify)("source missing", "x/y", 5)
  return g === "pinned"
})
await runMutant("unfilled-as-ok", '  if (/\\{\\w+\\}/.test(rendered)) return "blocked"', '  if (false) return "blocked"', (mod) => {
  const g = (mod.classify as typeof classify)(undefined, "{a}/{b}", 3)
  return g === "pinned"
})

await runMutant("render-blind", "export function render(template: string, values: Record<string, number | string>): string {\n  return template.replace", "export function render(template: string, values: Record<string, number | string>): string {\n  return template\n  return template.replace", (mod) => {
  const rendered = (mod.render as typeof render)("x {a}/y {b}", { a: 1, b: 2 })
  return rendered.includes("{a}")
})

await runMutant("registry-blind", "  const problems: string[] = []", "  return []\n  const problems: string[] = []", (mod) => {
  const bad = { schemaVersion: 1, claims: [{ id: "", doc: "nope.md", template: "", derive: { kind: "issue-counts", source: "" } } as Claim] }
  return (mod.registryProblems as typeof registryProblems)(bad as never).length === 0
})

await runMutant("scan-blind", "    const published = lines.filter((l) => l.includes(rendered)).length", "    const published = 0", (mod) => {
  const rs = (mod.pinClaims as typeof pinClaims)(registry)
  return rs.every((x) => x.outcome !== "pinned")
})

// M6/M7 (issue #846 acceptance: README/website/docs covered): the coverage law
// itself must be able to fail. These plant the two defects that would let an
// unpinned lane count live in a published doc.
await runMutant(
  "coverage-blind",
  "      for (const h of claims) out.push(`coverage: ${c.doc}:${h.line} publishes a lane count",
  "      for (const h of []) out.push(`coverage: ${c.doc}:${h.line} publishes a lane count",
  (mod) => {
    const reg = JSON.parse(JSON.stringify(loadClaims())) as ReturnType<typeof loadClaims>
    reg.coverage = [{ doc: "README.md", status: "out-of-scope", reason: "probe" }]
    const docs1 = { "README.md": "M44 · 48/48 gates verified in-editor\n" }
    return (mod.coverageFindings as typeof coverageFindings)(reg, docs1).length === 0
  },
)
await runMutant(
  "unpinned-blind",
  "    } else if (registry.claims.filter((x) => x.doc === c.doc).length === 0) {",
  "    } else if (false) {",
  (mod) => {
    const reg = JSON.parse(JSON.stringify(loadClaims())) as ReturnType<typeof loadClaims>
    reg.claims = []
    reg.coverage = [{ doc: "docs/IDE-PROGRAM-STATUS.md", status: "pinned" }]
    return (mod.coverageFindings as typeof coverageFindings)(reg).length === 0
  },
)

// --- evidence --------------------------------------------------------------------
function gitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

const buildEvidence = () => ({
  issue: "M61.V5 claim pins (issue #846)",
  code: "V5",
  milestone: "M61",
  status: failed === 0 ? "verified" : "known-gap",
  checks: checks.length,
  passed,
  failed,
  realFailed: failed,
  failures,
  checksList: checks,
  currentCommit: gitHead(),
  verifierCommand: "npx tsx script/m61/verify-claims.ts",
  evidenceFile: "V5.json",
  generatedAt: new Date().toISOString(),
  claims: results.map((r) => ({ id: r.id, doc: r.doc, outcome: r.outcome, rendered: r.rendered, published: r.published, reason: r.reason })),
  coverage: census,
  limitations: [
    "The tool pins the claims DECLARED in script/m61/claims.json, and coverage (#846's audit set: README + website + docs) is enforced by the scan — an out-of-scope doc that publishes a lane count fails. The residue on the pinned doc is reported as the `coverage` census rather than hidden: a count-claim line not covered by a pin is visible in the record and is the registry's next extension.",
    "Byte-gated REGENERATION is the D1 pattern already owned by the generated docs (docs/m26/GRAPH.md via verify-graph-docs, docs/m29/* via verify-m29-docs). The claims doc pinned here is hand-written, so it is PINNED rather than regenerated: the pin fails the moment the prose and the ledger disagree, which is the same protection without rewriting the doc body.",
    "Derivations read the records' own fields; a claim whose source stops exposing a field BLOCKS (loudly) rather than comparing against a silent zero.",
  ],
})
writeSealed(path.join(RESULTS, "V5.json"), buildEvidence())
check("R: this verifier's own evidence is a sealed record", readFileSync(path.join(RESULTS, "V5.json"), "utf8").includes("bbSeal"))
writeSealed(path.join(RESULTS, "V5.json"), buildEvidence())

console.log(`\nM61.V5: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks.length})`)
console.log(`Evidence (sealed): ${path.join(RESULTS, "V5.json")}`)
if (failures.length > 0) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
}
process.exitCode = failed === 0 ? 0 : 1
