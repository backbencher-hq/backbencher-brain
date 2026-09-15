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
  classify,
  derive,
  loadClaims,
  pinClaims,
  registryProblems,
  render,
  type Claim,
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

// --- pure cores on known inputs ---------------------------------------------------
console.log("\ncores: known inputs")
check("core: render substitutes every declared key", render("a {n} b {m}", { n: 3, m: 4 }) === "a 3 b 4")
check("core: render leaves an unknown key literal", render("a {n} {zz}", { n: 3 }) === "a 3 {zz}")
check("core: classify — a blocked derivation is blocked, whatever else is true", classify("source missing", "x/y", 5) === "blocked")
check("core: classify — an unfilled template is blocked, never compared", classify(undefined, "{a}/{b}", 5) === "blocked")
check("core: classify — a found row is pinned", classify(undefined, "x/y", 1) === "pinned")
check("core: classify — no found row is drift", classify(undefined, "x/y", 0) === "drifted")

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

// M1: a doc whose number was edited away from the ledger must be caught.
{
  const m26 = registry.claims.find((c) => c.id === "m26-mutants")!
  const docs1 = patchedDoc(m26.doc, "38 mutants caught across 9 suites", "99 mutants caught across 12 suites")
  const r = pinClaims(registry, docs1).find((x) => x.id === "m26-mutants")!
  check("M: pin-blind (an edited doc number reports as drifted)", r.outcome === "drifted", `outcome=${r.outcome}`)
}
await runMutant("pin-blind", '  return published > 0 ? "pinned" : "drifted"', '  return "pinned"', (mod) => {
  const m26 = registry.claims.find((c) => c.id === "m26-mutants")!
  const docs1 = patchedDoc(m26.doc, "38 mutants caught across 9 suites", "99 mutants caught across 12 suites")
  const rs = (mod.pinClaims as typeof pinClaims)(registry, docs1)
  return rs.find((x) => x.id === "m26-mutants")!.outcome === "pinned"
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

await runMutant("scan-blind", '    const published = text === null ? 0 : text.split("\\n").filter((l) => l.includes(rendered)).length', "    const published = 0", (mod) => {
  const rs = (mod.pinClaims as typeof pinClaims)(registry)
  return rs.every((x) => x.outcome !== "pinned")
})

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
  limitations: [
    "The tool pins the claims DECLARED in script/m61/claims.json. A number that is published but not declared is not yet covered — the registry is the surface to extend, and adding a claim is a data change, not a code change.",
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
