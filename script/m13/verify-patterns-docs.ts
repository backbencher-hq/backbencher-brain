// script/m13/verify-patterns-docs.ts — M13.39 (P5).
//
// Docs + evidence + release gate for bb_patterns.
//
// 1. DOCS ACCURACY: docs/tools/bb_patterns.md must be byte-identical to a
//    fresh render from the executable registry (real generator verify mode)
//    and its Contract section must match the registry field-by-field.
// 2. EVIDENCE COMMITTED: p1..p4.json must all exist, validate, and claim
//    verified.
// 3. RELEASE GATE: the gate must block a non-passing suite from claiming
//    verified — proven adversarially against the REAL validateEvidence.
// 4. HONESTY: no stubs remain in source; description matches actual
//    capability (index-backed rules, not stubs); planned modes are clearly
//    labeled as planned.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { Harness } from "./harness"
import { validateEvidence } from "./verify-evidence"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const harness = new Harness({
  issue: "M13.39",
  code: "P5",
  tool: "bb_patterns",
  title: "bb_patterns: honesty + docs + release gate",
  layers: ["unit", "e2e"],
  decisions: {
    docsAuthority: "src/mcp/tool-registry.ts + script/verify-tool-docs.ts (curated doc) are the single source; docs/tools/bb_patterns.md is a generated artifact",
    releaseGate: "verify-quality-gate.ts (P1-P4 verifiers wired) + verify-evidence.ts B3 invariant; proven by tamper test",
    evidenceInputs: "validation/m13/results/p1..p4.json must all exist, validate, and claim verified for bb_patterns to be release-eligible",
    noStubs: "framework_pattern_stub / anti_pattern_stub were removed in P2; source must contain zero references to them",
    plannedHonesty: "quality + architecture are planned (not executable); the registry + docs must both label them as planned",
  },
  limitations: [
    "Docs byte-freshness is proven by the generator's own verify mode, not by a duplicated render.",
    "This gate covers bb_patterns only; other tools have their own issues in M13.",
  ],
})

// `import.meta.dir` is BUN-ONLY. Under Node it is undefined, so this gate died
// with `TypeError: The "paths[0]" argument must be of type string` before running
// a single check — it had never executed outside Bun. The `?? "."` fallback is
// NOT enough: the scripts are invoked from the repo ROOT, so "." plus "../.."
// climbs one level too far and the failure becomes ENOENT on a sibling path
// instead, which reads as a missing file rather than a wrong root.
//
// `fileURLToPath(import.meta.url)` is the repo's existing portable idiom
// (script/m62/verify-docs.ts, verify-consumers.ts, verify-arrival.ts and others
// already use exactly this). It is also the only form safe on a path containing
// a space — this repository lives under "/Users/…/Default Project/…", and
// `new URL(import.meta.url).pathname` percent-encodes that, so the naive
// form would break here while working everywhere else.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const RESULTS = path.join(root, "validation", "m13", "results")

// ── 1. Docs accuracy ───────────────────────────────────────────────────────
const registry = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_patterns")
const docPath = path.join(root, "docs", "tools", "bb_patterns.md")
let doc = ""
try { doc = readFileSync(docPath, "utf8") } catch {}

harness.check("docs: bb_patterns.md exists", doc.length > 0, doc ? "" : "missing file")

if (registry) {
  const category = registry.documentation.category
  const defaults = JSON.stringify(registry.documentation.defaults)
  harness.check("docs: category matches registry", doc.includes(`- Category: \`${category}\``), `registry=${category}`)
  harness.check("docs: mutability matches registry", doc.includes(`- Mutability: \`${registry.mutability}\``), `registry=${registry.mutability}`)
  harness.check("docs: requiresIndex matches registry", doc.includes(`- Requires index: \`${registry.requiresIndex}\``), `registry=${registry.requiresIndex}`)
  harness.check("docs: modes match registry (orphaned, all)", doc.includes("- Modes: `orphaned`, `all`"), `registry modes=${JSON.stringify(registry.modes)}`)
  harness.check("docs: planned modes labeled as not executable", doc.includes("Planned modes (roadmap, not executable): `quality`, `architecture`"), "planned modes correctly labeled")
  harness.check("docs: defaults match registry", doc.includes(`- Defaults: \`${defaults}\``), `registry=${defaults}`)
  const props = Object.keys((registry.inputSchema as any).properties ?? {})
  const missing = props.filter((p) => !doc.includes(`"${p}"`))
  harness.check("docs: every input property is documented", missing.length === 0, missing.length ? `missing: ${missing.join(",")}` : `${props.length} props`)
  harness.check("docs: source marked as read-only", doc.includes("Source is read-only"))

  // P2 honesty: description no longer claims framework/anti-pattern "detection"
  // as a general capability without qualification. The real description says
  // "Architecture and code-quality analysis are planned, not yet executable."
  // The doc's first line is a markdown heading. The description text is on line 3.
  const docLines = doc.split("\n")
  const descLine = docLines.length > 2 ? docLines[2] : ""
  harness.check("docs: description matches registry (planned honesty)", descLine === registry.description, `desc mismatch: "${descLine.slice(0, 80)}" vs "${registry.description.slice(0, 80)}"`)
}

// Generator verify mode: the tool-docs generator must validate bb_patterns.md
// is byte-fresh from the registry.
const gen = spawnSync("bun", ["run", "script/verify-tool-docs.ts"], { cwd: root, encoding: "utf8", timeout: 120_000 })
harness.check("docs: generator verify mode passes (bb_patterns.md byte-fresh)", gen.status === 0, gen.status === 0 ? "" : (gen.stderr || gen.stdout || "").slice(0, 200))

// ── 2. Honesty: no stubs, planned modes honest ─────────────────────────────
const toolsSrc = readFileSync(path.join(root, "src", "ast", "tools.ts"), "utf8")
const rulesSrc = readFileSync(path.join(root, "src", "intelligence", "patterns", "rules.ts"), "utf8")
harness.negative("honesty: no framework_pattern_stub anywhere in source", !toolsSrc.includes("framework_pattern_stub") && !rulesSrc.includes("framework_pattern_stub"), "stub present")
harness.negative("honesty: no anti_pattern_stub anywhere in source", !toolsSrc.includes("anti_pattern_stub") && !rulesSrc.includes("anti_pattern_stub"), "stub present")

// Registry must label quality/architecture as planned (not executable modes).
harness.check("honesty: plannedModes includes quality + architecture", (registry?.plannedModes ?? []).includes("quality") && (registry?.plannedModes ?? []).includes("architecture"), `plannedModes=${JSON.stringify(registry?.plannedModes)}`)
harness.negative("honesty: quality/architecture are NOT in the executable modes list", !(registry?.modes ?? []).includes("quality") && !(registry?.modes ?? []).includes("architecture"), `modes=${JSON.stringify(registry?.modes)}`)

// Handler: modes are only "orphaned" and "all" (no quality/architecture path).
const handlerSrc = readFileSync(path.join(root, "src", "mcp", "tool-handlers.ts"), "utf8")
const bbPatternsSection = handlerSrc.slice(handlerSrc.indexOf("bb_patterns:"), handlerSrc.indexOf("bb_security:"))
harness.check("honesty: handler only routes orphaned + all (no quality/architecture)", bbPatternsSection.includes('scope === "orphaned"') && bbPatternsSection.includes("PatternBrainTools.detectPatterns") && !bbPatternsSection.includes('"quality"') && !bbPatternsSection.includes('"architecture"'), "handler routes")

// ── 3. Evidence committed and passing (p1..p4) ────────────────────────────
const P_FILES = ["p1", "p2", "p3", "p4"]
const evDocs: any[] = []
for (const code of P_FILES) {
  let doc2: any = null
  try { doc2 = JSON.parse(readFileSync(path.join(RESULTS, `${code}.json`), "utf8")) } catch {}
  const exists = !!doc2
  const valid = exists && validateEvidence(doc2).length === 0
  const verified = valid && doc2.verifiedState === "verified"
  harness.check(`evidence: ${code}.json exists, validates, verified`, exists && valid && verified, !exists ? "missing" : !valid ? validateEvidence(doc2).join("; ").slice(0, 120) : doc2.verifiedState)
  if (doc2) evDocs.push(doc2)
}
harness.check("evidence: all 4 P-issues claim verified with negatives", evDocs.length === 4 && evDocs.every((d) => d.negativeCases >= 1), evDocs.map((d) => `${d.code}:${d.negativeCases}neg`).join(" "))

// ── 4. Release gate blocks 'verified' unless P1-P4 all pass ────────────────
const gateSrc = readFileSync(path.join(root, "script", "verify-quality-gate.ts"), "utf8")
const verifyScript = (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as any).scripts.verify ?? ""
const P_VERIFIERS = ["verify-patterns-contract", "verify-patterns-rules", "verify-patterns-orphans", "verify-patterns-e2e-corpus"]
for (const v of P_VERIFIERS) {
  harness.check(`gate: ${v}.ts wired into quality gate`, gateSrc.includes(`m13/${v}.ts`))
  harness.check(`gate: ${v}.ts wired into npm run verify`, verifyScript.includes(`script/m13/${v}.ts`))
}
harness.check("gate: evidence validator (B3) is part of the gate", gateSrc.includes("m13/verify-evidence.ts") && verifyScript.includes("script/m13/verify-evidence.ts"))

// ── 5. Adversarial tamper test: a doc with failures + no negatives ─────────
if (evDocs.length > 0) {
  const tampered = JSON.parse(JSON.stringify(evDocs[0]))
  tampered.verifiedState = "verified"
  tampered.negativeCases = 0
  tampered.summary.failed = 5
  const tamperErrors = validateEvidence(tampered)
  harness.negative("gate: tampered doc (failed>0, no negatives) cannot claim verified", tamperErrors.length > 0, tamperErrors.join("; ").slice(0, 160))
}

// Removing any single P-verifier from the gate source must change the source.
// If any verifier is NOT in the source, replace() is a no-op → d === gateSrc → fail.
const dropped = P_VERIFIERS.map((v) => gateSrc.replace(`m13/${v}.ts`, `m13/${v}-REMOVED.ts`))
harness.negative("gate: all P-verifiers are physically present in the gate source", dropped.every((d) => d !== gateSrc), dropped.some((d) => d === gateSrc) ? `missing: ${P_VERIFIERS.filter((_v, i) => dropped[i] === gateSrc).join(",")}` : "all present")

harness.emit()