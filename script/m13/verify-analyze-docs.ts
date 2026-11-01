// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the docs-truth gate for bb_analyze: the generated page,
//   the curated text and the descriptor must carry the measured contract, and
//   the page must not promise verification that cannot be run.
// WHICH TOOL IT SERVES — bb_analyze (read, requiresIndex, 11 modes).
// WHY IT IS SHAPED THIS WAY — the previous version (a) crashed under the
//   documented `npx tsx` runner because it used Bun-only `import.meta.dir`,
//   (b) checked `doc.includes(JSON.stringify(defaults))`, which pinned the page
//   to a descriptor value that was itself wrong (a single `limit: 20` default
//   no mode used), and (c) never looked at the claims that had gone stale — a
//   citation of `fixtures/analyze/latency-gate.sh`, a path that exists nowhere
//   on this machine (checked: ./fixtures and $HOME/fixtures/analyze both absent;
//   $HOME/fixtures/repositories exists and is a corpus, not a test directory).
//   A docs gate must fail when a page cites a command that cannot run.
// WHERE ITS EVIDENCE LIVES — validation/m13/results/an4.json.
// EDIT TOGETHER WHEN THIS FILE CHANGES — script/tool-docs/curation/bb_analyze.ts,
//   src/mcp/tools/bb_analyze/descriptor.ts, docs/tools/bb_analyze.md.
// CONTRACTS IT MUST NOT BREAK — a green run must mean: the page matches the
//   descriptor, names only registrable tests, and documents the declared bounds.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { Harness } from "./harness"
import { validateEvidence } from "./verify-evidence"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const harness = new Harness({
  issue: "M13.54",
  code: "An4",
  tool: "bb_analyze",
  title: "bb_analyze: docs truth, generated-page parity, and no unrunnable verification claims",
  layers: ["unit"],
  decisions: { docsAuthority: "registry + curation + verify-tool-docs", evidenceInputs: "an1, an2, an3 verified" },
  limitations: ["Covers bb_analyze only."],
})

// `import.meta.dirname` works under Bun only; the documented runner is npx tsx,
// so the root is derived from import.meta.url (portable in both runtimes).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const RESULTS = path.join(root, "validation", "m13", "results")

const registry = PUBLIC_TOOL_DESCRIPTORS.find((tool) => tool.name === "bb_analyze")
const docPath = path.join(root, "docs", "tools", "bb_analyze.md")
const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : ""
const curationPath = path.join(root, "script", "tool-docs", "curation", "bb_analyze.ts")
const curation = existsSync(curationPath) ? readFileSync(curationPath, "utf8") : ""

harness.check("generated page exists", doc.length > 500, `len=${doc.length}`)
harness.check("generated page carries the author header", doc.startsWith("<!--") && doc.includes("Author: Muhammad Ishaq Khan"), doc.slice(0, 60))
if (registry) {
  harness.check("page description matches the descriptor", doc.includes(registry.description.slice(0, 40)), doc.split("\n").find((line) => line.startsWith("Unified"))?.slice(0, 60) ?? "missing")
  harness.check("page lists all 11 modes", ["callers", "callees", "trace", "dependencies", "stats", "complexity", "impact", "test_mapping", "test_gaps", "test_impact", "test_quality"].every((mode) => doc.includes(mode)), "missing mode")
  const defaults: any = registry.documentation.defaults
  harness.check("page carries the real per-mode limit defaults", typeof defaults?.limit === "string" && doc.includes("25 edges per direction") && doc.includes("test_quality") && doc.includes("50"), JSON.stringify(defaults).slice(0, 140))
}

// A page that cites a test command must cite one that exists in THIS repo.
const citationHits = doc.match(/fixtures\//g) ?? []
harness.negative("page cites no unrunnable fixtures path", citationHits.length === 0, citationHits.join(","))
harness.negative("curation cites no unrunnable fixtures path", (curation.match(/fixtures\//g) ?? []).length === 0, (curation.match(/fixtures\/[^\s"`]*/g) ?? []).join(","))
harness.check("page documents the test_impact declared bound", /test_impact/.test(doc) && /timeBudget/.test(doc), "")
harness.check("page documents that test_quality limit bounds rows", /test_quality/.test(doc) && /returned/.test(doc), "")
harness.check("page documents the complexity breakdown bound", /breakdownReturned|breakdownTruncated/.test(doc), "")
harness.check("page documents the missing-file stale rule", /missing/.test(doc) && /stale/.test(doc), "")
harness.negative("page names no phantom tool (bb_test_quality/bb_test_suggestions)", !/bb_test_quality|bb_test_suggestions/.test(doc), "")

// The generator must agree with the committed page, for THIS tool only: the
// shared artifacts are mid-campaign and are checked at integration.
const gen = spawnSync("npx", ["tsx", "script/verify-tool-docs.ts", "--only", "bb_analyze"], { cwd: root, encoding: "utf8", timeout: 180_000 })
harness.check("docs: single-tool generator check passes", gen.status === 0, ((gen.stdout ?? "") + (gen.stderr ?? "")).slice(0, 240))

for (const code of ["an1", "an2", "an3"]) {
  let d: any = null
  try { d = JSON.parse(readFileSync(path.join(RESULTS, code + ".json"), "utf8")) } catch {}
  harness.check("evidence: " + code + ".json verified", !!d && validateEvidence(d).length === 0 && d.verifiedState === "verified", !d ? "missing" : d.verifiedState)
}

harness.negative("gate: B3 evidence is wired into the quality gate", (() => {
  const p = path.join(root, "script", "verify-quality-gate.ts")
  return existsSync(p) && readFileSync(p, "utf8").includes("m13/verify-evidence.ts")
})(), "self-check")

harness.emit()
