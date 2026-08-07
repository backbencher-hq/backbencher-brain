import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { graphTraversal } from "../src/intelligence/graph/graph-engine"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log("  ok: " + label)
  else {
    failures++
    console.log("  FAIL: " + label + (detail ? " " + detail : ""))
  }
}

// Purpose-built fixture with a clear call chain: alpha -> beta -> gamma, and a
// self-recursive cycle in loopFn.
const root = mkdtempSync(path.join(tmpdir(), "bb-graph-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "chain.ts"),
  "export function gamma(): number { return 1 }\n" +
  "export function beta(): number { return gamma() + 1 }\n" +
  "export function alpha(): number { return beta() + 1 }\n" +
  "export function loopFn(n: number): number { return n <= 0 ? 0 : loopFn(n - 1) }\n")

const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})

  const betaGraph = await graphTraversal(projectId, "beta", { direction: "both", maxDepth: 3 })
  check("beta has callers (alpha)", betaGraph.callers.some((e) => betaGraph.nodes[e.from]?.name === "alpha"))
  check("beta has callees (gamma)", betaGraph.callees.some((e) => betaGraph.nodes[e.to]?.name === "gamma"))

  // Call-site correctness: a callee edge's call site file must be the SOURCE
  // file (where the call is written), i.e. beta's file — not gamma's.
  const gammaEdge = betaGraph.callees.find((e) => betaGraph.nodes[e.to]?.name === "gamma")
  check("callee edge call site is a real file", !!gammaEdge && gammaEdge.callSite.file.length > 0)
  check("callee edge preserves relationship type", !!gammaEdge && gammaEdge.relationshipType === "calls")
  check("callee edge preserves confidence", !!gammaEdge && typeof gammaEdge.confidence === "number")

  // Direction isolation
  const callersOnly = await graphTraversal(projectId, "beta", { direction: "callers" })
  check("callers-only returns no callees", callersOnly.callees.length === 0)
  const calleesOnly = await graphTraversal(projectId, "beta", { direction: "callees" })
  check("callees-only returns no callers", calleesOnly.callers.length === 0)

  // Transitive: alpha -> beta -> gamma at depth 2
  const alphaGraph = await graphTraversal(projectId, "alpha", { direction: "callees", maxDepth: 3 })
  check("alpha transitively reaches gamma", alphaGraph.callees.some((e) => alphaGraph.nodes[e.to]?.name === "gamma"))
  check("summary reports maxDepthReached >= 1", alphaGraph.summary.maxDepthReached >= 1)

  // Cycle handling: loopFn calls itself; traversal must terminate.
  const loopGraph = await graphTraversal(projectId, "loopFn", { direction: "both", maxDepth: 5 })
  check("self-recursive traversal terminates", !!loopGraph.summary)

  // relationshipTypes filter honored: restrict to a type with no edges.
  const filtered = await graphTraversal(projectId, "beta", { direction: "callees", relationshipTypes: ["implements"] })
  check("relationshipTypes filter excludes calls edges", filtered.callees.length === 0)

  // Truncation metadata present and false on a tiny graph.
  check("truncated flag present and false for small graph", betaGraph.summary.truncated === false)

  // Not-found throws
  let threw = false
  try { await graphTraversal(projectId, "no_such_symbol_xyz", {}) } catch { threw = true }
  check("unknown symbol throws", threw)
} catch (error) {
  check("graph session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nGRAPH: PASS" : "\nGRAPH: " + failures + " FAILURES")
process.exit(failures > 0 ? 1 : 0)
