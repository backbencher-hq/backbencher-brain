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

/**
 * M59.A6 (#824) — the line, not just the file.
 *
 * This gate used to certify call-site behaviour with
 * `gammaEdge.callSite.file.length > 0`: it checked the FILE and never the LINE,
 * so it was green while a stored `line_number` of 0 reached the tool as 0.
 * The expectation below is derived from the FIXTURE'S OWN SOURCE (the M59
 * oracle's shape) — the last line that writes `callee()` is the call, since the
 * declaration comes first. A substituted caller-declaration line or a
 * fabricated 0 therefore cannot pass.
 */
function lineOfCall(source: string, callee: string): number {
  const lines = source.split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes(`${callee}()`)) return i + 1
  }
  return -1
}

// Purpose-built fixture with a clear call chain: alpha -> beta -> gamma, and a
// self-recursive cycle in loopFn. Each JVM call is written on a DIFFERENT line
// from its caller's declaration, so a substituted declaration line is a wrong
// answer rather than a coincidentally right one.
const TS_CHAIN =
  "export function gamma(): number { return 1 }\n" +
  "export function beta(): number {\n" +
  "  const t = 1\n" +
  "  return gamma() + t\n" +
  "}\n" +
  "export function alpha(): number {\n" +
  "  return beta() + 1\n" +
  "}\n" +
  "export function loopFn(n: number): number { return n <= 0 ? 0 : loopFn(n - 1) }\n"

// Distinct names per language, deliberately: all three fixtures share one
// indexed workspace, and a bare `beta` is ambiguous across them (the traversal
// then resolves to whichever symbol wins by name — measured, and it silently
// sent the JVM assertions to the TypeScript `beta`, whose edge carries no
// line yet).
const JAVA_CHAIN =
  "package p;\n" +
  "\n" +
  "public class Chain {\n" +
  "  static int gammaJ() { return 1; }\n" +
  "\n" +
  "  static int betaJ() {\n" +
  "    int t = 1;\n" +
  "    return gammaJ() + t;\n" +
  "  }\n" +
  "}\n"

const SCALA_CHAIN =
  "object Chain2 {\n" +
  "  def gammaS(): Int = 1\n" +
  "\n" +
  "  def betaS(): Int = {\n" +
  "    val t = 1\n" +
  "    gammaS() + t\n" +
  "  }\n" +
  "}\n"

const root = mkdtempSync(path.join(tmpdir(), "bb-graph-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "chain.ts"), TS_CHAIN)
writeFileSync(path.join(root, "src", "Chain.java"), JAVA_CHAIN)
writeFileSync(path.join(root, "src", "Chain2.scala"), SCALA_CHAIN)

const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})

  const betaGraph = await graphTraversal(projectId, "beta", { direction: "both", maxDepth: 3 })
  check("beta has callers (alpha)", betaGraph.callers.some((e) => betaGraph.nodes[e.from]?.name === "alpha"))
  check("beta has callees (gamma)", betaGraph.callees.some((e) => betaGraph.nodes[e.to]?.name === "gamma"))

  // Call-site correctness: a callee edge's call site file must be the SOURCE
  // file (where the call is written), i.e. beta's file — not gamma's.
  //
  // M59.A6: for TypeScript the LINE half is recorded, not asserted, because the
  // analyzer emits none of the 17 languages still at 0 lines per relationship
  // (#825) and the tool renders the absent value as the number 0 (#823 owns
  // making "unknown" a first-class state). Recording it here keeps the file
  // check from reading as line certification, and gives #823 a per-run witness.
  const gammaEdge = betaGraph.callees.find((e) => betaGraph.nodes[e.to]?.name === "gamma")
  check(
    "callee edge call site names the SOURCE file (this is NOT a line claim — see the recorded observation below)",
    !!gammaEdge && gammaEdge.callSite.file.length > 0,
  )
  check("callee edge preserves relationship type", !!gammaEdge && gammaEdge.relationshipType === "calls")
  check("callee edge preserves confidence", !!gammaEdge && typeof gammaEdge.confidence === "number")

  console.log(
    `  note (#823/#825): TypeScript's call site line is reported as ${JSON.stringify(gammaEdge?.callSite.line)} — its analyzer emits no line, and 0 is not the call's line (which is ${lineOfCall(TS_CHAIN, "gamma")})`,
  )

  // ── M59.A6: the LINE, exactly, over a real index, for the languages whose
  // analyzers emit one.
  for (const [fixture, source, caller, callee] of [
    ["java", JAVA_CHAIN, "betaJ", "gammaJ"],
    ["scala", SCALA_CHAIN, "betaS", "gammaS"],
  ] as const) {
    const expected = lineOfCall(source, callee)
    const g = await graphTraversal(projectId, caller, { direction: "callees", maxDepth: 3 })
    const edge = g.callees.find((e) => g.nodes[e.to]?.name === callee)
    check(
      `${fixture}: call site is the line the call is WRITTEN on (${callee} at ${expected}, ${caller} declared elsewhere)`,
      edge?.callSite.line === expected,
      `got ${JSON.stringify(edge?.callSite.line)}`,
    )
  }

  // ── M59.A6 negative control, on the REAL index: corrupt the stored line and
  // the gate must fail. A gate that cannot fail on corrupted data is not
  // evidence, and this one is checked against the same predicate as above.
  {
    const dbPath = BrainDatabase.getDbPath(projectId)
    const { Database } = await import("bun:sqlite")
    const db = new Database(dbPath)
    const expected = lineOfCall(JAVA_CHAIN, "gammaJ")
    const rowId = (
      db
        .query(
          "SELECT id FROM brain_relationship WHERE relationship_type = 'calls' AND line_number = ? LIMIT 1",
        )
        .get(expected) as { id: string } | undefined
    )?.id
    check("the java call row the control corrupts exists and stores the real line", typeof rowId === "string")

    if (rowId) {
      const traversalLine = async (): Promise<number | null | undefined> => {
        const g = await graphTraversal(projectId, "betaJ", { direction: "callees", maxDepth: 3 })
        return g.callees.find((e) => g.nodes[e.to]?.name === "gammaJ")?.callSite.line
      }

      // Control A — a WRONG number in the store must not pass.
      db.run("UPDATE brain_relationship SET line_number = 1 WHERE id = ?", [rowId])
      const wrongLine = await traversalLine()
      check(
        "control A: a corrupted stored line (1) is CAUGHT by the same predicate",
        wrongLine !== expected,
        `tool reported ${JSON.stringify(wrongLine)} for a call written on ${expected}`,
      )

      // Control B — an UNKNOWN line must not be turned into a plausible one.
      // MEASURED at this HEAD: with the stored line NULL the tool reports 0 —
      // neither the call's line nor a stated unknown. (#823's issue text names a
      // `row.lineNumber || node.line` substitution in graph-engine; the effect
      // observed here, on a real index, is 0, and the note above records it per
      // run. Either way the predicate rejects it, and #823 owns the fix.)
      db.run("UPDATE brain_relationship SET line_number = NULL WHERE id = ?", [rowId])
      const substituted = await traversalLine()
      console.log(
        `  note (#823): with the stored line NULL the tool reports ${JSON.stringify(substituted)} for a call written on ${expected} — the substitution this control refuses to accept`,
      )
      check(
        "control B: an absent line is not presented as the call site",
        substituted !== expected,
        `tool reported ${JSON.stringify(substituted)} for an unknown line`,
      )

      db.run("UPDATE brain_relationship SET line_number = ? WHERE id = ?", [expected, rowId])
      const restored = await traversalLine()
      check("control cleanup: restoring the real line makes the predicate pass again", restored === expected)
    }
    db.close()
  }

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
