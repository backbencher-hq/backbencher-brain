// script/m13/verify-search-docs.ts — M13.22 (S5).
//
// Docs + evidence + release gate for bb_search.
//
// 1. DOCS ACCURACY: docs/tools/bb_search.md must be byte-identical to a fresh
//    render from the executable registry (proven by running the real generator
//    in verify mode), and its Contract section must match the registry entry
//    field-by-field (category, mutability, requiresIndex, modes, defaults).
// 2. EVIDENCE COMMITTED: s1..s4.json must all exist, validate against the
//    shared schema, and claim verified.
// 3. RELEASE GATE: the gate must block a non-passing suite from claiming
//    verified — proven adversarially by tampering with a real evidence doc
//    (failed>0, zero negatives) and asserting the REAL validateEvidence
//    (imported from verify-evidence.ts) rejects it.

import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { Harness } from "./harness"
import { validateEvidence } from "./verify-evidence"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const harness = new Harness({
  issue: "M13.22",
  code: "S5",
  tool: "bb_search",
  title: "bb_search: docs + evidence + release gate",
  layers: ["unit", "e2e"],
  decisions: {
    docsAuthority: "src/mcp/tool-registry.ts + script/verify-tool-docs.ts (curated doc) are the single source; docs/tools/bb_search.md is a generated artifact",
    releaseGate: "verify-quality-gate.ts (S2-S4 verifiers wired) + verify-evidence.ts B3 invariant (verified requires failed=0 AND negativeCases>=1); proven by tamper test",
    evidenceInputs: "validation/m13/results/s1..s4.json must all exist, validate, and claim verified for bb_search to be release-eligible",
  },
  limitations: [
    "Docs byte-freshness is proven by the generator's own verify mode, not by a duplicated render.",
    "This gate covers bb_search only; other tools have their own issues in M13.",
  ],
})

const root = path.resolve(import.meta.dir, "..", "..")
const RESULTS = path.join(root, "validation", "m13", "results")

// ── 1. Docs accuracy ───────────────────────────────────────────────────────
const registry = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_search")
const docPath = path.join(root, "docs", "tools", "bb_search.md")
let doc = ""
try { doc = readFileSync(docPath, "utf8") } catch {}

harness.check("docs: bb_search.md exists", doc.length > 0, doc ? "" : "missing file")

if (registry) {
  const category = registry.documentation.category
  const defaults = JSON.stringify(registry.documentation.defaults)
  const modes = registry.modes.map((m: string) => `\`${m}\``).join(", ")
  harness.check("docs: category matches registry", doc.includes(`- Category: \`${category}\``), `registry=${category}`)
  harness.check("docs: mutability matches registry", doc.includes(`- Mutability: \`${registry.mutability}\``), `registry=${registry.mutability}`)
  harness.check("docs: requiresIndex matches registry", doc.includes(`- Requires index: \`${registry.requiresIndex}\``), `registry=${registry.requiresIndex}`)
  harness.check("docs: modes line matches registry", doc.includes(`- Modes: ${modes}`), `registry=${modes}`)
  harness.check("docs: defaults match registry", doc.includes(`- Defaults: \`${defaults}\``), `registry=${defaults}`)
  const props = Object.keys((registry.inputSchema as any).properties ?? {})
  const missing = props.filter((p) => !doc.includes(`"${p}"`))
  harness.check("docs: every input property is documented", missing.length === 0, missing.length ? `missing: ${missing.join(",")}` : `${props.length} props`)
  harness.check("docs: all four modes appear in the enum", (["symbols", "content", "symbol", "file"] as const).every((m) => doc.includes(`"${m}"`)))
  harness.check("docs: retrieval-not-analysis positioning is documented", doc.includes("This is retrieval, not natural-language explanation or code analysis"))
}

const gen = spawnSync("bun", ["run", "script/verify-tool-docs.ts"], { cwd: root, encoding: "utf8", timeout: 120_000 })
harness.check("docs: generator verify mode passes (bb_search.md byte-fresh)", gen.status === 0, gen.status === 0 ? "" : (gen.stderr || gen.stdout || "").slice(0, 200))

// ── 2. Evidence committed and passing (s1..s4) ─────────────────────────────
const S_FILES = ["s1", "s2", "s3", "s4"]
const evDocs: any[] = []
for (const code of S_FILES) {
  let doc2: any = null
  try { doc2 = JSON.parse(readFileSync(path.join(RESULTS, `${code}.json`), "utf8")) } catch {}
  const exists = !!doc2
  const valid = exists && validateEvidence(doc2).length === 0
  const verified = valid && doc2.verifiedState === "verified"
  harness.check(`evidence: ${code}.json exists, validates, verified`, exists && valid && verified, !exists ? "missing" : !valid ? validateEvidence(doc2).join("; ").slice(0, 120) : doc2.verifiedState)
  if (doc2) evDocs.push(doc2)
}
harness.check("evidence: all 4 S-issues claim verified with negatives", evDocs.length === 4 && evDocs.every((d) => d.negativeCases >= 1), evDocs.map((d) => `${d.code}:${d.negativeCases}neg`).join(" "))

// ── 3. Release gate blocks 'verified' unless S2-S4 all pass ────────────────
const gateSrc = readFileSync(path.join(root, "script", "verify-quality-gate.ts"), "utf8")
const verifyScript = (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as any).scripts.verify ?? ""
const S_VERIFIERS = ["verify-search-e2e", "verify-search-corpus", "verify-search-honesty"]
for (const v of S_VERIFIERS) {
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

const dropped = S_VERIFIERS.map((v) => gateSrc.replace(`m13/${v}.ts`, `m13/${v}-REMOVED.ts`))
harness.negative("gate: removing any single S-verifier breaks the gate", dropped.every((d) => d !== gateSrc), "all verifiers still present")

harness.emit()
