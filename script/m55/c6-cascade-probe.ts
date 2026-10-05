// script/m55/c6-cascade-probe.ts — the C6 DIAGNOSIS, measured.
//
// WHY THIS FILE EXISTS. `script/m55/verify-call-hierarchy.ts` gates C6 red with
// the reason "a `contains`/`uses` row folded onto the traced symbol by the
// engine's owner cascade produces a call-site RANGE on a relation that is not a
// call at all (§15.3)". The gate names the cause; it does not MEASURE which
// stored row produces which rendered range, and it does not measure whether the
// obvious fix (this surface asks the engine for CALL rows only) would also fix —
// or break — the sibling checks that pass today. Asserting a fix without
// measuring its blast radius is the habit this file exists to break, so the
// disposition written into the evidence was chosen from THIS output, not from
// the shape of the check.
//
// WHAT IT MEASURES, on the REAL index of the REAL fixture (t2-fixture.ts):
//   1. The stored rows the engine returns for `Store.get` with direction
//      `callers` — relationship type, the id the cascade matched, and the
//      `targetMatch` verdict — so the claim "the cascade folded a `contains`
//      row and a `uses` row" is a measured fact and not a comment.
//   2. `expandCalls` run twice over the SAME index and the SAME component:
//        (A) exactly as shipped (the engine's default projection), and
//        (B) with the ONE proposed change — `relationshipTypes: ["calls"]`.
//      For each: the rendered calls, their relationship type, their ranges, the
//      drop list, and the declared absence.
//   3. The four predicates that decide the disposition, evaluated on BOTH runs:
//        P-selfedge   the receiver-qualified `get -> get` artifact is still
//                     dropped AND declared with its reason (the C1 law — the
//                     fix must not silence it),
//        P-nocallrow  no rendered entry comes from a non-`calls` row (C6),
//        P-zerocallers `get` is never called in the fixture, so a `calls`-only
//                     filter answers zero callers (the W1 law),
//        P-honestabs  the declared absence does NOT claim the store holds no
//                     stored row when it does (§11.7 — a fix that empties the
//                     list by filtering must not also assert a falsehood).
//
// The probe is falsifiable by construction: the same predicate is evaluated on
// two real behaviours of the same component, and P-nocallrow/P-zerocallers are
// FALSE on (A). A predicate that cannot distinguish them would pass on both.
//
// Run: npx tsx script/m55/c6-cascade-probe.ts
// Evidence: printed as JSON on stdout; T2.json records the disposition it
// supports. This probe writes NO evidence file — it is a measurement, and the
// gate that consumes its finding is the one that must be sealed.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { T2_ROOT, T2_EXPECT, writeT2Fixture } from "./t2-fixture.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const BB = path.join(ROOT, "bin/bb");

// --- fixture + real index (isolated data dir) --------------------------------
writeT2Fixture();
const dataDir = mkdtempSync(path.join(tmpdir(), "m55-c6-data-"));
const env = { ...process.env, BB_DATA_DIR: dataDir };
// The IN-PROCESS database must read the same isolated store the indexer wrote.
// Without this the probe's `getRawInstance` opened the DEFAULT data dir, found
// no brain_file for the fixture path, and reported "no indexed get" — a failure
// of the probe's own plumbing that reads exactly like a real absence.
process.env.BB_DATA_DIR = dataDir;

function buildIfNeeded(): void {
  const SERVER = path.join(ROOT, "dist/lsp/server.js");
  if (existsSync(SERVER)) return;
  execFileSync("npx", ["tsup"], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], timeout: 420_000 });
}
buildIfNeeded();

const idxOut = execFileSync(BB, ["index", T2_ROOT, "--no-setup"], {
  cwd: ROOT,
  env,
  encoding: "utf8",
  timeout: 300_000,
  stdio: ["ignore", "pipe", "inherit"],
});

const { BrainDatabase } = await import(pathToFileURL(path.join(ROOT, "src/brain/database.ts")).href);
const { getProjectId } = await import(pathToFileURL(path.join(ROOT, "src/util/project-id.ts")).href);
const ch = await import(pathToFileURL(path.join(ROOT, "src/lsp/call_hierarchy.ts")).href);
const engine = await import(pathToFileURL(path.join(ROOT, "src/intelligence/graph/graph-engine.ts")).href);

const projectId = getProjectId(T2_ROOT);
const raw = await BrainDatabase.getRawInstance(projectId);
try {
  const storePath = path.join(T2_ROOT, T2_EXPECT.store.rel);
  // The item is built from the INDEX ROW, not from a position probe: `expandCalls`
  // re-resolves the root from the index and reads only `item.data`, so a probe
  // that had to guess the editor's column would add a failure mode the C6
  // question does not need.
  const fileRows = raw
    .prepare(`SELECT id, path, relative_path FROM brain_file WHERE path = ? OR relative_path = ?`)
    .all(storePath, T2_EXPECT.store.rel) as Array<{ id: string; path: string; relative_path: string }>;
  const getRow = fileRows.length === 0
    ? undefined
    : (raw
        .prepare(
          `SELECT s.id, s.name, s.symbol_type FROM brain_symbol s
           WHERE s.file_id = ? AND s.name = 'get'`,
        )
        .get(fileRows[0]!.id) as { id: string; name: string; symbol_type: string } | undefined);
  if (getRow === undefined) {
    const names = raw
      .prepare(`SELECT name FROM brain_symbol WHERE file_id = ?`)
      .all(fileRows[0]?.id ?? "") as Array<{ name: string }>;
    throw new Error(
      `C6 probe: no indexed \`get\` in ${storePath} — files=${JSON.stringify(fileRows)} symbols=${JSON.stringify(names.map((n) => n.name))}`,
    );
  }
  const symbolId = getRow.id;
  const item = {
    name: getRow.name,
    kind: ch.symbolKindFor(getRow.symbol_type),
    uri: `file://${storePath}`,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    detail: "",
    positionBasis: "source_resolved" as const,
    data: { symbolId, isExternal: false },
  };
  const storedRows = raw
    .prepare(
      `SELECT r.id AS rowId, r.relationship_type AS relType, r.line_number AS lineNumber,
              r.source_symbol_id AS srcId, ss.name AS srcName,
              r.target_symbol_id AS tgtId, ts.name AS tgtName, ts.owner_symbol_id AS tgtOwner
       FROM brain_relationship r
       LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
       LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
       WHERE r.source_symbol_id = ? OR r.target_symbol_id = ?
       ORDER BY r.relationship_type, r.id`,
    )
    .all(symbolId, symbolId) as Array<Record<string, unknown>>;

  const rootRow = raw
    .prepare(
      `SELECT s.id, s.name, s.symbol_type AS symbolType, COALESCE(s.line_start,0) AS line,
              COALESCE(s.line_end,0) AS lineEnd, COALESCE(f.relative_path,'') AS relativePath,
              COALESCE(f.path,'') AS filePath, COALESCE(f.language,'unknown') AS language,
              COALESCE(s.complexity,0) AS complexity
       FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.id = ?`,
    )
    .get(symbolId) as any;

  /** Run the engine as shipped, and once with the ONE proposed change. */
  const asShipped = (pid: any, root: any, options: any) => engine.traverseGraph(pid, root, options);
  const callsOnly = (pid: any, root: any, options: any) =>
    engine.traverseGraph(pid, root, { ...options, relationshipTypes: ["calls"] });

  // The ENGINE's own answer, verbatim: which stored rows it hands the surface,
  // with its `targetMatch` verdict. The gate's C6 comment attributes the defect
  // to the owner cascade, so that attribution has to be measured rather than
  // repeated — a wrong cause in a gate comment misleads the next fixer.
  const engineDump = await engine.traverseGraph(projectId, rootRow, {
    direction: "callers",
    maxDepth: 5,
    callerBudget: 50,
    calleeBudget: 50,
  });
  const engineCallerEdges = engineDump.callers.map((e: any) => ({
    rowId: e.rowId,
    relationshipType: e.relationshipType,
    from: `${e.from}`,
    to: `${e.to}`,
    depth: e.depth,
    targetMatch: e.targetMatch ?? null,
    matchedMember: e.matchedMember ?? null,
    storedCallSite: e.callSite ?? null,
    renderedSourceName: engineDump.nodes[e.from]?.name ?? "(unknown)",
    namesTheTracedSymbol: e.from === symbolId || e.to === symbolId,
  }));

  const detailParts = (detail: unknown): string[] => String(detail ?? "").split(" · ");
  const relTypeOf = (detail: unknown): string => detailParts(detail)[1] ?? "";

  async function run(label: string, traverse: any): Promise<Record<string, unknown>> {
    const answer = await ch.expandCalls(raw, projectId, { item: item as any, direction: "incoming" }, traverse);
    const rendered = answer.calls.map((c: any) => ({
      name: c.from?.name,
      relationshipType: relTypeOf(c.from?.detail),
      detail: c.from?.detail,
      ranges: c.fromRanges,
    }));
    return {
      label,
      renderedCalls: rendered,
      renderedNonCallRows: rendered.filter((r) => r.relationshipType !== "calls"),
      droppedEdges: answer.droppedEdges,
      declaredAbsentNodes: answer.declaredAbsentNodes,
      absence: answer.absence,
      callSitesResolved: answer.callSitesResolved,
      callSitesApproximate: answer.callSitesApproximate,
      addressCrossCheck: answer.addressCrossCheck,
      // The filter the surface ASKED for. Absent today: the engine's default is
      // a ten-kind superset and nothing on the response says so (§15.1).
      declaredRelationshipFilter: (answer as any).relationshipTypes ?? null,
      crossCheckEdgesSeenByEngine: answer.addressCrossCheck.edges,
    };
  }

  const shipped = await run("A: as shipped (engine default — all ten relationship kinds)", asShipped);
  const filtered = await run("B: relationshipTypes: [calls] (the proposed change)", callsOnly);

  const selfEdgeDropped = (run: Record<string, unknown>) =>
    ((run.droppedEdges as any[]) ?? []).some(
      (d) => String(d.reason).includes("receiver-qualified") && String(d.reason).includes("this.items.get"),
    );

  const predicates = {
    shipped: {
      P_selfedgeStillDroppedAndDeclared: selfEdgeDropped(shipped),
      P_noRenderedNonCallRow: (shipped.renderedNonCallRows as any[]).length === 0,
      P_zeroCallers: (shipped.renderedCalls as any[]).length === 0,
      P_absenceDoesNotClaimNoStoredRow:
        String((shipped.absence as any)?.message ?? "").includes("the engine returned no stored caller edge") === false,
      P_declaresItsFilter: (shipped.declaredRelationshipFilter as any) !== null,
    },
    filtered: {
      P_selfedgeStillDroppedAndDeclared: selfEdgeDropped(filtered),
      P_noRenderedNonCallRow: (filtered.renderedNonCallRows as any[]).length === 0,
      P_zeroCallers: (filtered.renderedCalls as any[]).length === 0,
      P_absenceDoesNotClaimNoStoredRow:
        String((filtered.absence as any)?.message ?? "").includes("the engine returned no stored caller edge") === false,
      P_declaresItsFilter: (filtered.declaredRelationshipFilter as any) !== null,
    },
  };

  // Can-fail proof: at least one predicate must DISCRIMINATE the two runs, or
  // this probe has measured nothing and the disposition it supports is unfounded.
  const discriminating = Object.keys(predicates.shipped).filter(
    (k) => predicates.shipped[k as keyof typeof predicates.shipped] !== predicates.filtered[k as keyof typeof predicates.filtered],
  );

  const report = {
    probe: "M55.T2 C6 — owner-cascade fromRange for a non-call row",
    currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    indexer: (idxOut.split("\n").find((l) => l.includes("indexed")) ?? "").trim(),
    fixtureRoot: T2_ROOT,
    symbol: { id: symbolId, name: getRow.name, symbolType: getRow.symbol_type, file: T2_EXPECT.store.rel, line1: T2_EXPECT.store.getLine1 },
    /** The stored rows behind the answer — the evidence for "the cascade folded
     *  non-call rows onto the member". `targetMatchOwnerCascade` is computed
     *  here from the OWNER's rule (the stored target is a MEMBER of the traced
     *  symbol, not the symbol itself), not copied from the engine. */
    storedRows: storedRows.map((r) => ({
      rowId: r.rowId,
      relationshipType: r.relType,
      storedCallSiteLine1: r.lineNumber,
      source: `${String(r.srcName)} (${String(r.srcId)})`,
      target: `${String(r.tgtName)} (${String(r.tgtId)})`,
      targetIsAMemberOfTheTracedSymbol: r.tgtId !== symbolId && r.tgtOwner !== null && r.tgtOwner !== undefined,
    })),
    engineRoot: { id: rootRow.id, name: rootRow.name, symbolType: rootRow.symbolType },
    /** The engine's own caller edges for this root, verbatim. `targetMatch` is
     *  the engine's own verdict on how each row came to be an edge of the traced
     *  symbol, so "the cascade folded it" is a MEASURED field here and not a
     *  comment's guess. */
    engineCallerEdges,
    engineSummary: {
      exact: engineCallerEdges.filter((e) => e.targetMatch === "exact").length,
      cascaded: engineCallerEdges.filter((e) => e.targetMatch === "owner-cascade").length,
      nonCallKinds: [...new Set(engineCallerEdges.filter((e) => e.relationshipType !== "calls").map((e) => e.relationshipType))].sort(),
      nonCallRowsThatAreExact: engineCallerEdges
        .filter((e) => e.relationshipType !== "calls" && e.targetMatch === "exact")
        .map((e) => ({ relationshipType: e.relationshipType, from: e.renderedSourceName, depth: e.depth })),
    },
    runs: { shipped, filtered },
    predicates,
    discriminatingPredicates: discriminating,
    canFail: discriminating.length > 0,
    read: "each predicate is evaluated against TWO real behaviours of the SAME component over the SAME index; a predicate that is true on both runs discriminates nothing",
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}