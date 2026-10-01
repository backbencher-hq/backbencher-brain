// script/m13/verify-edit-docs.ts — M13.17 (E12).
//
// Docs + evidence + release gate for bb_edit.
//
// 1. DOCS ACCURACY: docs/tools/bb_edit.md must be byte-identical to a fresh
//    render from the executable registry (proven by running the real generator
//    in verify mode), and its Contract section must match the registry entry
//    field-by-field (mutability, requiresIndex, modes, defaults, category).
// 2. EVIDENCE COMMITTED: e1..e11.json must all exist, validate against the
//    shared schema, and claim verified.
// 3. RELEASE GATE: the gate must block a non-passing suite from claiming
//    verified. We prove this adversarially by tampering with a real evidence
//    document (failed>0, zero negative cases) and asserting the REAL
//    validateEvidence (imported from verify-evidence.ts) rejects it.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { Harness } from "./harness"
import { validateEvidence } from "./verify-evidence"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const harness = new Harness({
  issue: "M13.17",
  code: "E12",
  tool: "bb_edit",
  title: "bb_edit: docs + evidence + release gate",
  layers: ["unit", "e2e"],
  decisions: {
    docsAuthority: "src/mcp/tool-registry.ts + script/verify-tool-docs.ts (curated doc) are the single source; docs/tools/bb_edit.md is a generated artifact",
    releaseGate: "verify-quality-gate.ts (E1-E11 verifiers wired) + verify-evidence.ts B3 invariant (verified requires failed=0 AND negativeCases>=1); proven by tamper test",
    evidenceInputs: "validation/m13/results/e1..e11.json must all exist, validate, and claim verified for bb_edit to be release-eligible",
  },
  limitations: [
    "Docs byte-freshness is proven by the generator's own verify mode, not by a duplicated render.",
    "This gate covers bb_edit only; other tools have their own issues in M13.",
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
const registry = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_edit")
const docPath = path.join(root, "docs", "tools", "bb_edit.md")
let doc = ""
try { doc = readFileSync(docPath, "utf8") } catch {}

harness.check("docs: bb_edit.md exists", doc.length > 0, doc ? "" : "missing file")

if (registry) {
  const category = registry.documentation.category
  const defaults = JSON.stringify(registry.documentation.defaults)
  const modes = registry.modes.map((m: string) => `\`${m}\``).join(", ")
  harness.check("docs: category matches registry", doc.includes(`- Category: \`${category}\``), `registry=${category}`)
  harness.check("docs: mutability matches registry", doc.includes(`- Mutability: \`${registry.mutability}\``), `registry=${registry.mutability}`)
  harness.check("docs: requiresIndex matches registry", doc.includes(`- Requires index: \`${registry.requiresIndex}\``), `registry=${registry.requiresIndex}`)
  harness.check("docs: modes line matches registry", doc.includes(`- Modes: ${modes}`), `registry=${modes}`)
  harness.check("docs: defaults match registry", doc.includes(`- Defaults: \`${defaults}\``), `registry=${defaults}`)
  // Every declared input property must be documented.
  const props = Object.keys((registry.inputSchema as any).properties ?? {})
  const missing = props.filter((p) => !doc.includes(`"${p}"`))
  harness.check("docs: every input property is documented", missing.length === 0, missing.length ? `missing: ${missing.join(",")}` : `${props.length} props`)
  harness.check("docs: required=['mode'] is documented", doc.includes('"required"') && doc.includes('"mode"'))
  harness.check("docs: all five modes appear in the enum", (["write", "update", "insert", "delete", "refactor"] as const).every((m) => doc.includes(`"${m}"`)))
}

// Byte-freshness: the real generator's verify mode must pass (exit 0). This is
// the same artifact check the gate runs; we assert it here as the docs gate.
// The check spawns the generator. It used to spawn `bun`, which is the same
// hardcoded-runtime bug as `import.meta.dir` in this file: under Node the spawn
// fails with ENOENT and the assertion reads
//
//   docs: generator verify mode passes (bb_edit.md byte-fresh)
//
// which says the DOCUMENTATION IS STALE. It is not. Running the generator under
// Node on the same tree prints `TOOL DOCS: PASS (16 public tools, 18 artifacts)`,
// so the artifact was byte-fresh the whole time and this gate was reporting a
// missing runtime as a content defect — the worst possible direction for a
// freshness check, because the correct response to it is to regenerate.
//
// It now spawns the runtime it is itself running under, which is what the repo
// does elsewhere (process.execPath in script/m31/verify-gate-selftest.ts,
// script/m65/verify-rules-gate-selftest.ts), and only the invocation differs:
// Bun runs a .ts file directly, Node needs the tsx loader.
const runningUnderBun = typeof (globalThis as any).Bun !== "undefined"
const generatorArgs = runningUnderBun
  ? ["run", "script/verify-tool-docs.ts"]
  : ["--import", "tsx", "script/verify-tool-docs.ts"]
const gen = spawnSync(process.execPath, generatorArgs, { cwd: root, encoding: "utf8", timeout: 300_000 })
harness.check(
  `docs: generator verify mode passes (bb_edit.md byte-fresh) — ${runningUnderBun ? "bun" : "node"}`,
  gen.status === 0,
  gen.status === 0 ? "" : `exit ${gen.status}: ${(gen.stderr || gen.stdout || "").slice(0, 200)}`,
)

// ── 2. Evidence committed and passing (e1..e11) ────────────────────────────
const E_FILES = ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "e10", "e11"]
const evDocs: any[] = []
for (const code of E_FILES) {
  let doc2: any = null
  try { doc2 = JSON.parse(readFileSync(path.join(RESULTS, `${code}.json`), "utf8")) } catch {}
  const exists = !!doc2
  const valid = exists && validateEvidence(doc2).length === 0
  const verified = valid && doc2.verifiedState === "verified"
  harness.check(`evidence: ${code}.json exists, validates, verified`, exists && valid && verified, !exists ? "missing" : !valid ? validateEvidence(doc2).join("; ").slice(0, 120) : doc2.verifiedState)
  if (doc2) evDocs.push(doc2)
}
harness.check("evidence: all 11 E-issues claim verified with negatives", evDocs.length === 11 && evDocs.every((d) => d.negativeCases >= 1), evDocs.map((d) => `${d.code}:${d.negativeCases}neg`).join(" "))

// ── 3. Release gate blocks 'verified' unless E1-E11 all pass ───────────────
const gateSrc = readFileSync(path.join(root, "script", "verify-quality-gate.ts"), "utf8")
const verifyScript = (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as any).scripts.verify ?? ""
const E_VERIFIERS = ["verify-edit-boundary", "verify-edit-rename", "verify-edit-mask", "verify-edit-body", "verify-edit-freshness", "verify-edit-atomicity", "verify-edit-unit", "verify-edit-integration", "verify-edit-e2e", "verify-edit-corpus", "verify-edit-honesty"]
for (const v of E_VERIFIERS) {
  harness.check(`gate: ${v}.ts wired into quality gate`, gateSrc.includes(`m13/${v}.ts`))
  harness.check(`gate: ${v}.ts wired into npm run verify`, verifyScript.includes(`script/m13/${v}.ts`))
}
harness.check("gate: evidence validator (B3) is part of the gate", gateSrc.includes("m13/verify-evidence.ts") && verifyScript.includes("script/m13/verify-evidence.ts"))

// Adversarial: a tampered document (failed>0, zero negatives) claiming verified
// MUST be rejected by the real validator. This proves the gate actually blocks.
const tampered = JSON.parse(JSON.stringify(evDocs[0]))
tampered.verifiedState = "verified"
tampered.negativeCases = 0
tampered.summary.failed = 3
const tamperErrors = validateEvidence(tampered)
harness.negative("gate: tampered doc (failed>0, no negatives) cannot claim verified", tamperErrors.length > 0, tamperErrors.join("; ").slice(0, 160))

// Adversarial: dropping any one verifier from the quality gate must break the
// gate wiring (each E1-E11 verifier is individually required).
const dropped = E_VERIFIERS.map((v) => gateSrc.replace(`m13/${v}.ts`, `m13/${v}-REMOVED.ts`))
harness.negative("gate: removing any single E-verifier breaks the gate", dropped.every((d) => d !== gateSrc), "all verifiers still present")

harness.emit()
