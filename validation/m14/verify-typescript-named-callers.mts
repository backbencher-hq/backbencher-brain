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
    name: "ts-caller-control",
    setup(build) {
      build.onLoad({ filter: /parallel-indexer\.ts$/ }, ({ path }) => {
        const source = readFileSync(path, "utf8");
        const before =
          "(GENERIC_SOURCE_NAMES.has(leafForCheck) && !declaredSource)";
        assert.ok(source.includes(before));
        console.log(`APPLIED caller mutation: ${mutation}`);
        return {
          contents: source.replace(
            before,
            mutation === "drop"
              ? "GENERIC_SOURCE_NAMES.has(leafForCheck)"
              : "false",
          ),
          loader: "ts",
        };
      });
    },
  });
const { ASTEngine } = await import("../../src/ast/engine");
const { storeResults, indexProjectParallel, reindexFilesParallel } =
  await import("../../src/ast/parallel-indexer");
const { BrainDatabase } = await import("../../src/brain/database");
const { handler: graph } = await import("../../src/mcp/tools/bb_graph/handler");
const root = mkdtempSync("/tmp/bb-ts-named-callers-");
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-ts-named-data-");
const filePath = join(root, "callers.ts");
const source = `class Alpha { run() {} }
class Beta { run() {} }
class Holder {
  item: Alpha = new Alpha();
  unknown() { this.item.run(); }
  normal() { this.item.run(); }
}
function unknown() { const value = new Beta(); value.run(); }
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
const expected: Array<{ line: number; source: string; owner: string | null }> =
  [];
const unsupported = new Set<string>();
const visit = (node: ts.Node): void => {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "run"
  ) {
    let current: ts.Node | undefined = node.parent;
    while (
      current &&
      !ts.isFunctionDeclaration(current) &&
      !ts.isMethodDeclaration(current)
    )
      current = current.parent;
    assert.ok(
      current &&
        (ts.isFunctionDeclaration(current) ||
          ts.isMethodDeclaration(current)) &&
        current.name &&
        ts.isIdentifier(current.name),
    );
    const declaration = checker.getSymbolAtLocation(node.expression.name)
      ?.valueDeclaration?.parent;
    expected.push({
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
      line: r.line_number,
      source: r.source,
      owner: r.metadata?.owner ?? null,
    }))
    .sort((a, b) => a.line! - b.line!),
  expected,
);
const project = "ts-named-callers";
const logger = { log() {}, write() {} };
const worker = process.argv.includes("--require-worker");
if (worker) {
  const result = await indexProjectParallel(project, root, { logger });
  assert.equal(result.summary?.parseMode, "worker-pool");
  assert.equal(result.successFiles, 1);
} else {
  const call = parsed.relationships.find((row) => row.type === "calls")!;
  for (const source of ["unknown", "block_7"]) {
    parsed.relationships.push({
      ...call,
      source,
      target: "__placeholder_only",
      line_number: 99,
      metadata: {},
    });
  }
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
      `SELECT r.line_number AS line, s.name AS source, owner.name AS owner FROM brain_relationship r
 JOIN brain_symbol s ON s.id=r.source_symbol_id LEFT JOIN brain_symbol t ON t.id=r.target_symbol_id
 LEFT JOIN brain_symbol owner ON owner.id=t.owner_symbol_id
 WHERE r.project_id=? AND r.relationship_type='calls' AND r.target_external='run' ORDER BY line`,
    )
    .all(project);
assert.deepEqual(rows(), expected);
assert.equal(
  db
    .prepare(
      "SELECT COUNT(*) AS n FROM brain_relationship WHERE target_external='__placeholder_only'",
    )
    .get().n,
  0,
);
const response = await graph(
  {
    symbol: "Beta",
    file: "callers.ts",
    direction: "callers",
    maxDepth: 1,
    relationshipTypes: ["calls"],
    refresh: false,
  },
  { projectId: project, projectPath: root } as Parameters<typeof graph>[1],
);
assert.ok(!response.isError, JSON.stringify(response.content));
assert.equal(
  JSON.parse((response.content[0] as { text: string }).text).data.callers
    .length,
  expected.filter((row) => row.owner === "Beta").length,
);
if (worker) {
  writeFileSync(
    filePath,
    source.replace("item: Alpha = new Alpha()", "item: Beta = new Beta()"),
  );
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
    expected.map((row) =>
      row.owner === "Alpha" ? { ...row, owner: "Beta" } : row,
    ),
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
