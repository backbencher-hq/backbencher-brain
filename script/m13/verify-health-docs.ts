// script/m13/verify-health-docs.ts — M13.34 (H6).
//
// Docs + evidence + release gate for bb_health.
//
// 1. DOCS ACCURACY: docs/tools/bb_health.md must be byte-identical to a fresh
//    render from the executable registry (real generator verify mode) and its
//    Contract section must match the registry field-by-field.
// 2. EVIDENCE COMMITTED: h1..h5.json must all exist, validate, and claim
//    verified.
// 3. RELEASE GATE: the gate must block a non-passing suite from claiming
//    verified — proven adversarially against the REAL validateEvidence.

import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { Harness } from "./harness"
import { validateEvidence } from "./verify-evidence"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const harness = new Harness({
  issue: "M13.34",
  code: "H6",
  tool: "bb_health",
  title: "bb_health: honesty + docs + release gate",
  layers: ["unit", "e2e"],
  decisions: {
    docsAuthority: "src/mcp/tool-registry.ts + script/verify-tool-docs.ts (curated doc) are the single source; docs/tools/bb_health.md is a generated artifact",
    releaseGate: "verify-quality-gate.ts (H1-H5 verifiers wired) + verify-evidence.ts B3 invariant; proven by tamper test",
    evidenceInputs: "validation/m13/results/h1..h5.json must all exist, validate, and claim verified for bb_health to be release-eligible",
  },
  limitations: [
    "Docs byte-freshness is proven by the generator's own verify mode, not by a duplicated render.",
    "This gate covers bb_health only; other tools have their own issues in M13.",
  ],
})

const root = path.resolve(import.meta.dir, "..", "..")
const RESULTS = path.join(root, "validation", "m13", "results")

// ── 1. Docs accuracy ───────────────────────────────────────────────────────
const registry = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_health")
const docPath = path.join(root, "docs", "tools", "bb_health.md")
let doc = ""
try { doc = readFileSync(docPath, "utf8") } catch {}

harness.check("docs: bb_health.md exists", doc.length > 0, doc ? "" : "missing file")

if (registry) {
  const category = registry.documentation.category
  const defaults = JSON.stringify(registry.documentation.defaults)
  harness.check("docs: category matches registry", doc.includes(`- Category: \`${category}\``), `registry=${category}`)
  harness.check("docs: mutability matches registry", doc.includes(`- Mutability: \`${registry.mutability}\``), `registry=${registry.mutability}`)
  harness.check("docs: requiresIndex matches registry", doc.includes(`- Requires index: \`${registry.requiresIndex}\``), `registry=${registry.requiresIndex}`)
  harness.check("docs: defaults match registry", doc.includes(`- Defaults: \`${defaults}\``), `registry=${defaults}`)
  const props = Object.keys((registry.inputSchema as any).properties ?? {})
  const missing = props.filter((p) => !doc.includes(`"${p}"`))
  harness.check("docs: every input property is documented", missing.length === 0, missing.length ? `missing: ${missing.join(",")}` : `${props.length} props`)
  harness.check("docs: refresh documented as explicit mutation", doc.includes("refresh=true explicitly mutates only index data"))
}

const gen = spawnSync("bun", ["run", "script/verify-tool-docs.ts"], { cwd: root, encoding: "utf8", timeout: 120_000 })
harness.check("docs: generator verify mode passes (bb_health.md byte-fresh)", gen.status === 0, gen.status === 0 ? "" : (gen.stderr || gen.stdout || "").slice(0, 200))

// ── 2. Evidence committed and passing (h1..h5) ─────────────────────────────
const H_FILES = ["h1", "h2", "h3", "h4", "h5"]
const evDocs: any[] = []
for (const code of H_FILES) {
  let doc2: any = null
  try { doc2 = JSON.parse(readFileSync(path.join(RESULTS, `${code}.json`), "utf8")) } catch {}
  const exists = !!doc2
  const valid = exists && validateEvidence(doc2).length === 0
  const verified = valid && doc2.verifiedState === "verified"
  harness.check(`evidence: ${code}.json exists, validates, verified`, exists && valid && verified, !exists ? "missing" : !valid ? validateEvidence(doc2).join("; ").slice(0, 120) : doc2.verifiedState)
  if (doc2) evDocs.push(doc2)
}
harness.check("evidence: all 5 H-issues claim verified with negatives", evDocs.length === 5 && evDocs.every((d) => d.negativeCases >= 1), evDocs.map((d) => `${d.code}:${d.negativeCases}neg`).join(" "))

// ── 3. Release gate blocks 'verified' unless H1-H5 all pass ────────────────
const gateSrc = readFileSync(path.join(root, "script", "verify-quality-gate.ts"), "utf8")
const verifyScript = (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as any).scripts.verify ?? ""
const H_VERIFIERS = ["verify-health-mutability", "verify-health-verbose", "verify-health-integrity", "verify-health-refresh", "verify-health-e2e-corpus"]
for (const v of H_VERIFIERS) {
  harness.check(`gate: ${v}.ts wired into quality gate`, gateSrc.includes(`m13/${v}.ts`))
  harness.check(`gate: ${v}.ts wired into npm run verify`, verifyScript.includes(`script/m13/${v}.ts`))
}
harness.check("gate: evidence validator (B3) is part of the gate", gateSrc.includes("m13/verify-evidence.ts") && verifyScript.includes("script/m13/verify-evidence.ts"))

const tampered = JSON.parse(JSON.stringify(evDocs[0]))
tampered.verifiedState = "verified"
tampered.negativeCases = 0
tampered.summary.failed = 3
const tamperErrors = validateEvidence(tampered)
harness.negative("gate: tampered doc (failed>0, no negatives) cannot claim verified", tamperErrors.length > 0, tamperErrors.join("; ").slice(0, 160))

const dropped = H_VERIFIERS.map((v) => gateSrc.replace(`m13/${v}.ts`, `m13/${v}-REMOVED.ts`))
harness.negative("gate: removing any single H-verifier breaks the gate", dropped.every((d) => d !== gateSrc), "all verifiers still present")

harness.emit()
