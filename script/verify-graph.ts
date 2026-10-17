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
  // M59.A6: for TypeScript the LINE half is recorded, not asserted — the check
  // above is about the FILE. Recording it keeps the file check from reading as
  // line certification.
  //
  // THE NOTE USED TO LIE ABOUT THE TOOL (bb_graph review D9). It read "its
  // analyzer emits no line, and 0 is not the call's line" — measured at HEAD on
  // 2026-10-14, the reported line IS the call's line (4 on this fixture), so the
  // analyzer emits it and no 0 is involved. A note that contradicts the same
  // run's own measurement is the class of stale prose this review was written
  // about, so the note now states the measured value and whether it equals the
  // call's line instead of carrying a story that a later lane made false.
  const gammaEdge = betaGraph.callees.find((e) => betaGraph.nodes[e.to]?.name === "gamma")
  check(
    "callee edge call site names the SOURCE file (this is NOT a line claim — see the recorded observation below)",
    !!gammaEdge && gammaEdge.callSite.file.length > 0,
  )
  check("callee edge preserves relationship type", !!gammaEdge && gammaEdge.relationshipType === "calls")
  check("callee edge preserves confidence", !!gammaEdge && typeof gammaEdge.confidence === "number")

  {
    const tsCallLine = lineOfCall(TS_CHAIN, "gamma")
    const reported = gammaEdge?.callSite.line
    console.log(
      `  note (M59.A6): TypeScript's call site line is reported as ${JSON.stringify(reported)} (${gammaEdge?.callSite.kind ?? "no address"}); the call is written on ${tsCallLine}` +
        (reported === tsCallLine
          ? " — equal, so this analyzer's stored line is exact here"
          : " — NOT equal; see the language lane's line coverage"),
    )
  }

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

      // Control B — with the stored line NULL the tool must not present a
      // substitute AS the call site.
      //
      // MEASURED at HEAD (2026-10-14): the value is the calling symbol's own
      // DECLARATION line, delivered as a labelled `declaration` address
      // (src/intelligence/graph/line-address.ts) — not the 0 that this note used
      // to report, and not the call's line. The predicate below is the same one
      // for both worlds: whatever the tool says must not equal the call line, so
      // the control is about the CLAIM, not about which substitute is chosen.
      db.run("UPDATE brain_relationship SET line_number = NULL WHERE id = ?", [rowId])
      const substituted = await traversalLine()
      console.log(
        `  note (M59.A6): with the stored line NULL the tool reports ${JSON.stringify(substituted)} for a call written on ${expected} — a LABELLED substitute (the caller's own declaration) or an explicit unknown, never the call line; this control refuses a substitute presented AS the call site`,
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

  // ── D5 (bb_graph review) — a FILTER is not a BOUND.
  //
  // `relationshipTypes` is a subset the CALLER asked for, so it must not set
  // `truncated`: that boolean has to keep answering "did a declared bound stop
  // the walk?". The gate above cannot see the difference — 0 edges passes for
  // an empty store and for a filter that matched nothing — so these checks
  // require the two channels to say which one happened, and the negative control
  // below proves they are not both hardcoded true.
  check(
    "D5: a type-narrowed traversal is NOT reported as truncated",
    filtered.summary.truncated === false && !filtered.summary.truncationReason,
    `truncated=${filtered.summary.truncated} reason=${JSON.stringify(filtered.summary.truncationReason)}`,
  )
  check(
    "D5: the filter declares itself in its OWN channel (filterNarrowed + filterReason)",
    filtered.summary.filterNarrowed === true && String(filtered.summary.filterReason ?? "").includes("relationshipTypes:implements"),
    `filterNarrowed=${filtered.summary.filterNarrowed} filterReason=${filtered.summary.filterReason}`,
  )
  check(
    "D5 negative control: an un-narrowed traversal claims no filter",
    betaGraph.summary.filterNarrowed === false && betaGraph.summary.filterReason === null,
    `filterNarrowed=${betaGraph.summary.filterNarrowed} filterReason=${betaGraph.summary.filterReason}`,
  )

  // ── D6 (bb_graph review) — `maxEdges` below `edgeLimit` is honored.
  const squeezed = await graphTraversal(projectId, "alpha", { direction: "callees", maxDepth: 3, maxEdges: 1 })
  const squeezedEdges = squeezed.callers.length + squeezed.callees.length
  check(
    "D6: maxEdges below edgeLimit bounds the answer (1 requested, 1 returned)",
    squeezedEdges === 1 && squeezed.summary.maxEdges === 1,
    `edges=${squeezedEdges} maxEdges=${squeezed.summary.maxEdges} edgeLimit=${squeezed.summary.edgeLimit}`,
  )
  check(
    "D6: honoring that bound is DECLARED as a bound (not silent)",
    squeezed.summary.totalEdgeLimitReached === true && String(squeezed.summary.truncationReason ?? "").includes("total-edge-limit"),
    `reached=${squeezed.summary.totalEdgeLimitReached} reason=${squeezed.summary.truncationReason}`,
  )
  check(
    "D6: the un-asked-for case is unchanged (no maxEdges -> the default, not 1)",
    betaGraph.summary.maxEdges === 1000 && betaGraph.summary.totalEdgeLimitReached === false,
    `maxEdges=${betaGraph.summary.maxEdges} reached=${betaGraph.summary.totalEdgeLimitReached}`,
  )

  // ── D10 — the reasons as data, not only as a joined string.
  check(
    "D10: truncationReasons is a list whose join is exactly truncationReason",
    Array.isArray(squeezed.summary.truncationReasons) &&
      squeezed.summary.truncationReasons.join("+") === String(squeezed.summary.truncationReason),
    `reasons=${JSON.stringify(squeezed.summary.truncationReasons)} joined=${JSON.stringify(squeezed.summary.truncationReason)}`,
  )
  check(
    "D10: an unbounded answer reports an EMPTY list, never a placeholder reason",
    Array.isArray(betaGraph.summary.truncationReasons) && betaGraph.summary.truncationReasons.length === 0,
    `reasons=${JSON.stringify(betaGraph.summary.truncationReasons)}`,
  )

  // ── D7 (bb_graph review) — the default answer is a function of the DATA.
  //
  // The review's finding was not that a clock bound existed; it was that the
  // DEFAULT asked for one, so two identical questions could get 200 edges and
  // 509 edges (measured on this repository's own index: four of five identical
  // default calls of `push` at depth 3 answered 200 edges in 2,489-16,635 ms
  // while the unbounded walk answered 509 in 2,854-4,755 ms with byte-identical
  // shapes) — and a paragraph in the docs is not a bound. These checks make the
  // policy load-bearing, and each one FAILS if the default is put back:
  //  · a default call publishes `timeBudgetMs: 0` (the applied bound is what the
  //    answer reports, so this reads the engine's decision, not a comment);
  //  · two identical default calls agree edge for edge, and agree with the same
  //    question asked explicitly unbounded;
  //  · a ceiling the CALLER sets is published as asked, and when it fires the
  //    answer declares a sample rather than a complete set;
  //  · a sampled answer is never LARGER than the complete one (the negative
  //    control that keeps the first checks from passing on a truncated answer).
  const edgeKeys = (r: Awaited<ReturnType<typeof graphTraversal>>): string[] =>
    [...r.callers, ...r.callees]
      // The edge no longer carries a bare `lineNumber`: M62.A1 moved every published
      // position into the address owner, so the key compares the ADDRESS. Reading the
      // removed field yielded `undefined` for every edge, which made this key blind to
      // exactly the difference (two rows on different call sites) it exists to see.
      .map((e) => `${e.relationshipType}|${e.from}->${e.to}|${e.callSite.kind}:${e.callSite.line ?? "null"}|${e.rowId ?? ""}`)
      .sort()
  const defaultA = await graphTraversal(projectId, "beta", { direction: "both", maxDepth: 3 })
  const defaultB = await graphTraversal(projectId, "beta", { direction: "both", maxDepth: 3 })
  const unbounded = await graphTraversal(projectId, "beta", { direction: "both", maxDepth: 3, timeBudgetMs: 0 })
  check(
    "D7: the DEFAULT asks for no clock bound (the applied budget is 0)",
    defaultA.summary.timeBudgetMs === 0 && defaultA.summary.timeBudgetExhausted === false,
    `summary.timeBudgetMs=${defaultA.summary.timeBudgetMs} exhausted=${defaultA.summary.timeBudgetExhausted}`,
  )
  check(
    "D7: two identical default calls agree edge for edge (reproducible without asking)",
    JSON.stringify(edgeKeys(defaultA)) === JSON.stringify(edgeKeys(defaultB)),
    `${edgeKeys(defaultA).length} vs ${edgeKeys(defaultB).length} edge(s)`,
  )
  check(
    "D7 negative control: the default is the SAME answer as asking for no bound explicitly",
    JSON.stringify(edgeKeys(defaultA)) === JSON.stringify(edgeKeys(unbounded)),
    `${edgeKeys(defaultA).length} vs ${edgeKeys(unbounded).length} edge(s)`,
  )
  const capped = await graphTraversal(projectId, "beta", { direction: "both", maxDepth: 3, timeBudgetMs: 1 })
  const cappedReasons = capped.summary.truncationReasons ?? []
  check(
    "D7: a ceiling the caller sets is published as asked, not silently raised",
    capped.summary.timeBudgetMs === 1,
    `requested 1 -> summary.timeBudgetMs=${capped.summary.timeBudgetMs}`,
  )
  check(
    "D7: a walk that hits its ceiling DECLARES a sample (truncated + the reason)",
    capped.summary.timeBudgetExhausted !== true ||
      (capped.summary.truncated === true && cappedReasons.includes("walk-time-budget-exhausted")),
    `fired=${capped.summary.timeBudgetExhausted} truncated=${capped.summary.truncated} reasons=${JSON.stringify(cappedReasons)} edges=${capped.callers.length + capped.callees.length}`,
  )
  check(
    "D7: a sampled answer is a SUBSET, never larger than the unbounded one",
    capped.callers.length + capped.callees.length <= unbounded.callers.length + unbounded.callees.length,
    `capped=${capped.callers.length + capped.callees.length} unbounded=${unbounded.callers.length + unbounded.callees.length}`,
  )

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
