import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const mutation = process.argv
  .find((arg) => arg.startsWith("--mutate="))
  ?.split("=")[1];
if (mutation)
  Bun.plugin({
    name: "ts-site-control",
    setup(build) {
      build.onLoad(
        {
          filter:
            mutation === "identity"
              ? /parallel-indexer\.ts$/
              : mutation.startsWith("graph")
                ? /graph-engine\.ts$/
                : /real-typescript-analyzer\.ts$/,
        },
        ({ path }) => {
          const changes: Record<string, [string, string]> = {
            identity: [
              'const siteIdentity = callSite === null ? "" : `:site:${callSite}`',
              'const siteIdentity = ""',
            ],
            offset: [
              "callSiteStartIndex: n.startIndex",
              "callSiteStartIndex: n.startPosition.row",
            ],
            graphValues: [
              'typeof parsed.callSiteStartIndex === "number" && Number.isSafeInteger(parsed.callSiteStartIndex) && parsed.callSiteStartIndex >= 0',
              'typeof parsed.callSiteStartIndex === "number"',
            ],
            graphCallers: [
              'const siteKey = `${row.relType}|${row.symId ?? ""}|${row.matchedId ?? symbolId}|${row.srcFileRel ?? ""}|${row.lineNumber}|${edgeMetadata(row.meta)?.callSiteStartIndex ?? ""}`',
              'const siteKey = `${row.relType}|${row.symId ?? ""}|${row.matchedId ?? symbolId}|${row.srcFileRel ?? ""}|${row.lineNumber}`',
            ],
            graphCallees: [
              'const calleeKey = `${row.relType}|${row.matchedId ?? symbolId}|${row.symId ?? `ext:${row.extName ?? ""}`}|${row.srcFileRel ?? ""}|${row.lineNumber}|${edgeMetadata(row.meta)?.callSiteStartIndex ?? ""}`',
              'const calleeKey = `${row.relType}|${row.matchedId ?? symbolId}|${row.symId ?? `ext:${row.extName ?? ""}`}|${row.srcFileRel ?? ""}|${row.lineNumber}`',
            ],
          };
          const source = readFileSync(path, "utf8");
          assert.ok(mutation in changes);
          const [before, after] = changes[mutation];
          assert.ok(source.includes(before));
          console.log(`APPLIED site mutation: ${mutation}`);
          return { contents: source.replace(before, after), loader: "ts" };
        },
      );
    },
  });
const { ASTEngine } = await import("../../src/ast/engine");
const { storeResults, indexProjectParallel, reindexFilesParallel } =
  await import("../../src/ast/parallel-indexer");
const { BrainDatabase } = await import("../../src/brain/database");
const { handler: graph } = await import("../../src/mcp/tools/bb_graph/handler");
const root = mkdtempSync("/tmp/bb-ts-sites-");
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-ts-sites-data-");
const filePath = join(root, "sites.ts");
const source = `class Alpha { run() {} }
class Beta { run() {} }
function different(a: Alpha, b: Beta) { a.run(); b.run(); }
function repeated(a: Alpha) { a.run(); a.run(); }
function multiline(a: Alpha, b: Beta) {
 a.run(); b.run();
 b.run();
}
function unicode(a: Alpha, b: Beta) { const label = '🐈'; a.run(); b.run(); }
function nested(a: Alpha, b: Beta) { a.run(); function inside() { b.run(); } a.run(); }
`;
writeFileSync(filePath, source);
const program = ts.createProgram([filePath], {
  target: ts.ScriptTarget.ES2022,
  strict: true,
  noEmit: true,
  types: [],
});
assert.deepEqual(
  ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")),
  [],
);
const checker = program.getTypeChecker();
const expected: Array<{
  line: number;
  site: number;
  source: string;
  owner: string | null;
}> = [];
const unsupported = new Set<string>();
const visit = (node: ts.Node): void => {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "run"
  ) {
    let current: ts.Node | undefined = node.parent;
    while (current && !ts.isFunctionDeclaration(current))
      current = current.parent;
    assert.ok(current && ts.isFunctionDeclaration(current) && current.name);
    const declaration = checker.getSymbolAtLocation(node.expression.name)
      ?.valueDeclaration?.parent;
    expected.push({
      site: node.getStart(),
      line:
        node
          .getSourceFile()
          .getLineAndCharacterOfPosition(node.expression.name.getStart()).line +
        1,
      source: current.name.text,
      owner: unsupported.has(current.name.text)
        ? null
        : declaration && ts.isClassDeclaration(declaration)
          ? (declaration.name?.text ?? null)
          : null,
    });
  }
  ts.forEachChild(node, visit);
};
visit(program.getSourceFile(filePath)!);
const parsed = await ASTEngine.parseFile(filePath, source);
assert.deepEqual(parsed.errors, []);
assert.deepEqual(
  parsed.relationships
    .filter((r) => r.type === "calls" && r.target === "run")
    .map((r) => ({
      site: r.metadata?.callSiteStartIndex,
      line: r.line_number,
      source: r.source,
      owner: r.metadata?.owner ?? null,
    }))
    .sort((a, b) => Number(a.site) - Number(b.site)),
  expected,
);
const project = "ts-call-sites";
const logger = { log() {}, write() {} };
const worker = process.argv.includes("--require-worker");
if (worker) {
  const result = await indexProjectParallel(project, root, { logger });
  assert.equal(result.summary?.parseMode, "worker-pool");
  assert.equal(result.successFiles, 1);
} else {
  // Repeated delivery of one AST edge must remain idempotent, unlike distinct sites.
  parsed.relationships.push({
    ...parsed.relationships.find(
      (row) => row.type === "calls" && row.target === "run",
    )!,
  });
  const stat = statSync(filePath);
  assert.equal(
    (
      await storeResults(project, root, [
        {
          ...parsed,
          filePath,
          success: true,
          fileHash: createHash("sha256")
            .update(source)
            .digest("hex")
            .slice(0, 16),
          sizeBytes: stat.size,
          lastModified: stat.mtimeMs,
        },
      ])
    ).rolledBackFiles,
    0,
  );
}
const db = await BrainDatabase.getRawInstance(project);
const rows = () =>
  db
    .prepare(
      `SELECT json_extract(r.metadata,'$.callSiteStartIndex') AS site, r.line_number AS line, s.name AS source, owner.name AS owner FROM brain_relationship r
 JOIN brain_symbol s ON s.id=r.source_symbol_id LEFT JOIN brain_symbol t ON t.id=r.target_symbol_id
 LEFT JOIN brain_symbol owner ON owner.id=t.owner_symbol_id
 WHERE r.project_id=? AND r.relationship_type='calls' AND r.target_external='run' ORDER BY site`,
    )
    .all(project);
assert.deepEqual(rows(), expected);
for (const owner of ["Alpha", "Beta"]) {
  const response = await graph(
    {
      symbol: owner,
      file: "sites.ts",
      direction: "callers",
      maxDepth: 1,
      relationshipTypes: ["calls"],
      refresh: false,
    },
    { projectId: project, projectPath: root } as Parameters<typeof graph>[1],
  );
  assert.ok(!response.isError, JSON.stringify(response.content));
  const payload = JSON.parse((response.content[0] as { text: string }).text);
  assert.deepEqual(
    payload.data.callers
      .map((edge: any) => edge.callSiteStartIndex)
      .sort((a: number, b: number) => a - b),
    expected.filter((row) => row.owner === owner).map((row) => row.site),
  );
}
const outgoing = await graph(
  {
    symbol: "repeated",
    file: "sites.ts",
    direction: "callees",
    maxDepth: 1,
    relationshipTypes: ["calls"],
    refresh: false,
  },
  { projectId: project, projectPath: root } as Parameters<typeof graph>[1],
);
assert.ok(!outgoing.isError, JSON.stringify(outgoing.content));
assert.deepEqual(
  JSON.parse((outgoing.content[0] as { text: string }).text)
    .data.callees.map((edge: any) => edge.callSiteStartIndex)
    .sort((a: number, b: number) => a - b),
  expected.filter((row) => row.source === "repeated").map((row) => row.site),
);
// Corrupt or foreign metadata must not invent an exact offset on the tool surface.
const first = expected.find((row) => row.source === "different")!;
const stored = db
  .prepare(
    "SELECT id, metadata FROM brain_relationship WHERE project_id=? AND relationship_type='calls' AND json_extract(metadata,'$.callSiteStartIndex')=?",
  )
  .get(project, first.site) as { id: string; metadata: string };
try {
  for (const invalid of [
    -1,
    0.5,
    "12",
    null,
    {},
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    db.prepare("UPDATE brain_relationship SET metadata=? WHERE id=?").run(
      JSON.stringify({
        ...JSON.parse(stored.metadata),
        callSiteStartIndex: invalid,
      }),
      stored.id,
    );
    const result = await graph(
      {
        symbol: "different",
        file: "sites.ts",
        direction: "callees",
        maxDepth: 1,
        relationshipTypes: ["calls"],
        refresh: false,
      },
      { projectId: project, projectPath: root } as Parameters<typeof graph>[1],
    );
    assert.ok(!result.isError);
    const edges = JSON.parse((result.content[0] as { text: string }).text).data
      .callees;
    assert.equal(edges.length, 2);
    assert.deepEqual(
      edges
        .filter((edge: any) => edge.callSiteStartIndex !== undefined)
        .map((edge: any) => edge.callSiteStartIndex),
      expected
        .filter((row) => row.source === "different" && row.site !== first.site)
        .map((row) => row.site),
    );
  }
} finally {
  db.prepare("UPDATE brain_relationship SET metadata=? WHERE id=?").run(
    stored.metadata,
    stored.id,
  );
}
if (worker) {
  // A leading comment shifts every site without changing its semantic endpoints.
  const prefix = "// edit\n";
  writeFileSync(filePath, prefix + source);
  assert.equal(
    (
      await reindexFilesParallel(
        project,
        root,
        [{ path: filePath, type: "modified" }],
        { logger },
      )
    ).errors,
    0,
  );
  assert.deepEqual(
    rows(),
    expected.map((row) => ({
      ...row,
      site: row.site + prefix.length,
      line: row.line + 1,
    })),
  );
  writeFileSync(filePath, source);
  assert.equal(
    (
      await reindexFilesParallel(
        project,
        root,
        [{ path: filePath, type: "modified" }],
        { logger },
      )
    ).errors,
    0,
  );
  assert.deepEqual(rows(), expected);
}
console.log(
  JSON.stringify({
    passed: true,
    compiler: ts.version,
    sites: expected.length,
    unsupported: [...unsupported],
    worker,
  }),
);
process.exit(0);
