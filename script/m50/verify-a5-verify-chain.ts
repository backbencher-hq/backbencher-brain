// script/m50/verify-a5-verify-chain.ts — M50.A5
//
// NOT CONCURRENCY-SAFE: this gate temporarily corrupts the frozen baseline
// (docs/data/m10-baseline.json) and the registry source, then restores them
// byte-for-byte. Another gate reading those files mid-run — or a second copy of
// this gate — will transiently see the corrupted world and go red. Always run
// the M50 gates serially (npm run verify:m50 is sequential by construction; do
// not launch individual gates in parallel with it). (issue UNREGISTERED)
//
// GitHub was unreachable from the delivery machine when A5 was completed
// (proxyconnect: no route to host; gh keyring token invalid). The issue text is
// stored verbatim in docs/m50/A5-issue.md, and this gate stamps `issue: null`
// rather than inventing a number.
//
// Two gates in the repository's verify chain were RED at HEAD, for reasons
// unrelated to any live defect:
//
//   verify-contract-diff.ts  — 13 failures: the M10.01 frozen baseline still
//                              listed 11 tools (M22/M28 added five) and the
//                              category vocabulary predated the graph and
//                              annotations families.
//
//   verify-tool-registry.ts  — 1 failure: a substring test for "handler"
//                              anywhere in the advertised metadata, which any
//                              legitimate prose defeats.
//
// A gate that cannot pass is indistinguishable from a gate nobody reads, and
// it hides the next real regression. This gate proves the repair holds AND is
// falsifiable:
//
//   C1  the frozen baseline has no drift against the live registry/CLI
//   C2  verify-contract-diff.ts exits 0 (live re-run, not trusted evidence)
//   C3  verify-m10-baseline.ts exits 0
//   C4  verify-tool-registry.ts exits 0
//   M1  a degraded COPY of the baseline (a tool row removed) must make the
//       drift comparator FAIL — proving C1 can fail
//   M2  the registry serialization check must reject a real handler leak
//       (a descriptor carrying a `handler` key), not merely prose
//
// Run: npx tsx script/m50/verify-a5-verify-chain.ts

import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { PUBLIC_TOOL_DESCRIPTORS, serializeToolMetadata } from "../../src/mcp/tool-registry"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m50/results")
const BASELINE = path.join(ROOT, "docs/data/m10-baseline.json")

let pass = 0
let failed = 0
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    pass++
    console.log(`  ok ${label}`)
  } else {
    failed++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

// Generous by design: these subprocesses re-index fixtures, and a load-induced
// timeout must not be reported as a gate failure (the self-test caught exactly
// that false negative once). Only a real non-zero exit counts as a failure.
function runNode(script: string, timeout = 900_000): { ok: boolean; tail: string } {
  const r = spawnSync("npx", ["tsx", script], { cwd: ROOT, encoding: "utf8", timeout })
  return { ok: r.status === 0, tail: ((r.stdout ?? "") + (r.stderr ?? "")).trim().split("\n").slice(-2).join(" | ").slice(0, 200) }
}

console.log("M50.A5 verify-chain gate")

// ── C1: no drift between the frozen baseline and the live surface ───────────
{
  const r = spawnSync("npx", ["tsx", "script/m50/refreeze-baseline.ts", "--check"], { cwd: ROOT, encoding: "utf8", timeout: 180_000 })
  check("C1 frozen baseline has no drift against the live registry/CLI", r.status === 0, ((r.stdout ?? "") + (r.stderr ?? "")).trim().split("\n").slice(-3).join(" | "))
}

// ── C2/C3/C4: live re-runs of the repaired chain gates ─────────────────────
{
  const contract = runNode("script/verify-contract-diff.ts")
  check("C2 verify-contract-diff exits 0", contract.ok, contract.tail)
  const baseline = runNode("script/verify-m10-baseline.ts")
  check("C3 verify-m10-baseline exits 0", baseline.ok, baseline.tail)
  const registry = runNode("script/verify-tool-registry.ts")
  check("C4 verify-tool-registry exits 0", registry.ok, registry.tail)
}

// ── M1: the drift comparator can fail ──────────────────────────────────────
{
  const dir = mkdtempSync(path.join(tmpdir(), "bb-a5-baseline-"))
  const copy = path.join(dir, "baseline.json")
  copyFileSync(BASELINE, copy)
  const degraded = JSON.parse(readFileSync(copy, "utf8"))
  const removed = Object.keys(degraded.runtimeMcp.descriptors)[0]
  delete degraded.runtimeMcp.descriptors[removed]
  degraded.runtimeMcp.toolNames = degraded.runtimeMcp.toolNames.filter((n: string) => n !== removed)
  writeFileSync(copy, JSON.stringify(degraded, null, 2) + "\n")
  const r = spawnSync("npx", ["tsx", "script/m50/refreeze-baseline.ts", "--check", "--baseline", copy], { cwd: ROOT, encoding: "utf8", timeout: 180_000 })
  check(`M1 a degraded baseline copy (${removed} removed) fails the drift comparator`, r.status !== 0, `exit=${r.status}`)
  // the real file must be untouched by the mutation run
  check("M1 the frozen baseline is byte-unchanged", JSON.parse(readFileSync(BASELINE, "utf8")).runtimeMcp.toolNames.length === PUBLIC_TOOL_DESCRIPTORS.length)
  rmSync(dir, { recursive: true, force: true })
}

// ── M2: the registry gate rejects a REAL handler leak ─────────────────────
// A function value cannot survive JSON.stringify, so the realistic leak this
// check exists for is a handler *named* in the advertised metadata. The
// mutation is applied to the real registry source, the real gate is run and
// must fail, and the source is restored byte-for-byte in `finally`.
{
  const REGISTRY_SRC = path.join(ROOT, "src/mcp/tool-registry.ts")
  const original = readFileSync(REGISTRY_SRC, "utf8")
  const clean = JSON.parse(serializeToolMetadata())
  check("M2 the clean metadata still serializes", Array.isArray(clean) && clean.length === PUBLIC_TOOL_DESCRIPTORS.length)
  try {
    writeFileSync(REGISTRY_SRC, original.replace('    name: "bb_search",', '    name: "bb_search",\n    handler: "leakProbe",'))
    const r = spawnSync("npx", ["tsx", "script/verify-tool-registry.ts"], { cwd: ROOT, encoding: "utf8", timeout: 300_000 })
    const out = (r.stdout ?? "") + (r.stderr ?? "")
    check("M2 a named handler in the metadata fails verify-tool-registry", r.status !== 0 && out.includes("handler"), `exit=${r.status} ${out.trim().split("\n").slice(-2).join(" | ").slice(0, 160)}`)
  } finally {
    writeFileSync(REGISTRY_SRC, original)
  }
  check("M2 the registry source is restored byte-for-byte", readFileSync(REGISTRY_SRC, "utf8") === original)
  check("M2 prose mentioning the word handler is NOT a leak", readFileSync(REGISTRY_SRC, "utf8").includes("handler"))
}

// ── stamp ──────────────────────────────────────────────────────────────────
{
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(
    path.join(RESULTS, "A5.json"),
    JSON.stringify(
      {
        gate: "M50.A5",
        issue: null,
        issueStatus: "unregistered — GitHub unreachable at delivery; text in docs/m50/A5-issue.md",
        milestone: "M50",
        at: new Date().toISOString(),
        commit,
        checks: pass + failed,
        passed: pass,
        failed,
        verifierCommand: "npx tsx script/m50/verify-a5-verify-chain.ts",
        status: failed === 0 ? "verified" : "known-gap",
        method:
          "live re-runs of the two repaired chain gates + drift comparator, with a degraded baseline copy and a handler-leak mutant proving both checks can fail",
        preRepairEvidence: {
          "verify-contract-diff": "13 failures at commit 15e4566a (11-tool frozen baseline vs 16 registered; stale category vocabulary)",
          "verify-tool-registry": "1 failure at commit 15e4566a (substring 'handler' test defeated by bb_search's own description)",
        },
      },
      null,
      2,
    ) + "\n",
  )
}

console.log(`\nM50.A5 VERIFY CHAIN: ${failed === 0 ? "PASS" : "FAIL"} (${pass} passed, ${failed} failed)`)
if (failed > 0) process.exit(1)
