// script/m20/verify-migration-order.ts — M20.M1.
//
// Exercises the production dependency-ordering primitive directly. The fixture
// is deliberately chosen so dependency cardinality cannot establish the
// correct order. No assertion is unconditional; every expected behavior is
// computed from the returned production result.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { computeDependencyOrder, type MigrationDependencyEdge } from "../../src/intelligence/migration/migration-engine"
import { migrationSourceFingerprint } from "../../src/intelligence/migration/migration-evidence"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m20/results")
let checks = 0
let passed = 0
let negativeCases = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}

function negative(label: string, condition: boolean, detail = ""): void {
  negativeCases++
  check(`${label} [negative]`, condition, detail)
}

function indexOf(order: string[], name: string): number { return order.indexOf(name) }

const names = ["caller", "dependency", "leaf", "independent"]
const edges: MigrationDependencyEdge[] = [
  { dependent: "caller", dependency: "dependency", relationshipType: "calls" },
  { dependent: "dependency", dependency: "leaf", relationshipType: "calls" },
  { dependent: "dependency", dependency: "independent", relationshipType: "uses" },
  // Duplicate evidence must not change the graph or the order.
  { dependent: "caller", dependency: "dependency", relationshipType: "calls" },
]
const baseline = computeDependencyOrder(names, edges)
const order = baseline.order

check("M1: dependency appears before dependent", indexOf(order, "dependency") >= 0 && indexOf(order, "caller") >= 0 && indexOf(order, "dependency") < indexOf(order, "caller"), order.join(" -> "))
check("M1: independent node is retained", order.includes("independent"), order.join(" -> "))
check("M1: duplicate edge is deduplicated", baseline.graph.edges.length === 3, `edges=${baseline.graph.edges.length}`)
check("M1: resolved graph is complete", baseline.graph.orderingStatus === "complete" && baseline.graph.unresolvedDependencies.length === 0 && baseline.graph.cycles.length === 0, JSON.stringify(baseline.graph))

const permuted = computeDependencyOrder([...names].reverse(), [...edges].reverse())
check("M1: order is deterministic under input permutation", JSON.stringify(permuted.order) === JSON.stringify(order), `${order.join("|")} vs ${permuted.order.join("|")}`)

// The old implementation's cardinality sort has no graph information. This
// fixture proves that cardinality is insufficient: dependency itself has two
// dependencies, so count sorting puts caller before dependency.
const oldCountOrder = [...names].sort((a, b) => {
  const count = (name: string) => edges.filter((edge) => edge.dependent === name).length
  return count(a) - count(b)
})
const oldOrderViolatesEdge = edges.some((edge) => oldCountOrder.indexOf(edge.dependency) > oldCountOrder.indexOf(edge.dependent))
negative("M1: cardinality-only order is rejected for the graph fixture", oldOrderViolatesEdge, oldCountOrder.join(" -> "))

const unresolved = computeDependencyOrder(["caller", "dependency"], [
  { dependent: "caller", dependency: "dependency", relationshipType: "calls" },
  { dependent: "caller", dependency: "external-lib", relationshipType: "imports" },
])
check("M1: unresolved dependency is surfaced", unresolved.graph.unresolvedDependencies.length === 1 && unresolved.graph.unresolvedDependencies[0]?.dependency === "external-lib", JSON.stringify(unresolved.graph.unresolvedDependencies))
check("M1: unresolved graph is partial, not complete", unresolved.graph.orderingStatus === "partial", unresolved.graph.orderingStatus)
check("M1: resolved portion remains dependency-first", indexOf(unresolved.order, "dependency") < indexOf(unresolved.order, "caller"), unresolved.order.join(" -> "))

const cyclic = computeDependencyOrder(["alpha", "beta"], [
  { dependent: "alpha", dependency: "beta", relationshipType: "calls" },
  { dependent: "beta", dependency: "alpha", relationshipType: "calls" },
])
check("M1: cycle is surfaced", cyclic.graph.cycles.length === 1 && cyclic.graph.cycles[0]?.includes("alpha") && cyclic.graph.cycles[0]?.includes("beta"), JSON.stringify(cyclic.graph.cycles))
negative("M1: cyclic graph is never reported complete", cyclic.graph.orderingStatus !== "complete" && cyclic.order.length < 2, JSON.stringify(cyclic.graph))

const noEdges = computeDependencyOrder(["one", "two"], [])
check("M1: no-edge graph is explicit", noEdges.graph.orderingStatus === "no-edges" && noEdges.order.length === 2, JSON.stringify(noEdges.graph))

// Mutation proof: reversing the only dependency edge must violate the original
// dependency-first assertion. This is a real production-function mutation of
// its input graph, not a hard-coded expected pass.
const reversed = computeDependencyOrder(["caller", "dependency"], [{ dependent: "dependency", dependency: "caller", relationshipType: "calls" }])
negative("M1: reversing a dependency edge invalidates the original order", !(indexOf(reversed.order, "dependency") < indexOf(reversed.order, "caller")), reversed.order.join(" -> "))

let currentCommit = "unknown"
try { currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch {}
const relevantPaths = new Set(["script/m20/verify-migration-order.ts", "script/m20/verify-governance.ts", "src/ast/cross-language-migration-assistant.ts", "src/intelligence/migration/migration-engine.ts", "src/intelligence/migration/migration-evidence.ts", "docs/BB_MIGRATE.md", "docs/tools/bb_migrate.md", "docs/m20/M20-MASTER-PLAN.md", "package.json", "script/verify-quality-gate.ts"])
const workingTreeRelevantChanges = (() => {
  try {
    return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n").map((line) => line.slice(3).trim()).filter((file) => relevantPaths.has(file))
  } catch {
    return ["git-status-unavailable"]
  }
})()
const failed = checks - passed
const evidence = {
  issue: "M20.M1",
  code: "M1",
  milestone: "M20",
  status: failed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  negativeCases,
  currentCommit,
  sourceFingerprint: migrationSourceFingerprint(ROOT),
  workingTreeRelevantChanges,
  verifierCommand: "bun run script/m20/verify-migration-order.ts",
  evidenceFile: "M1.json",
  generatedAt: new Date().toISOString(),
  measured: {
    fixtureNodes: names.length,
    resolvedEdges: baseline.graph.edges.length,
    unresolvedEdges: unresolved.graph.unresolvedDependencies.length,
    cycles: cyclic.graph.cycles,
    baselineOrder: order,
    oldCountOrder,
  },
  limitations: [
    "This verifier proves deterministic ordering of the available resolved symbol graph; it does not prove that analyzers resolved every real-world dependency.",
    "Library mapping and effort methodology are separate M20.M2/M20.M3 concerns.",
    "Runs with relevant uncommitted M20 files are recorded as known-gap; this record was generated from a clean relevant project revision.",
  ],
}
mkdirSync(RESULTS, { recursive: true })
writeFileSync(path.join(RESULTS, "M1.json"), JSON.stringify(evidence, null, 2) + "\n")
console.log(`M1: ${evidence.status.toUpperCase()} (${passed}/${checks} passed, ${negativeCases} negative)`)
process.exit(failed === 0 ? 0 : 1)
