import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const baseline = process.env.BB_TS_BASELINE_SOURCE;
const mutation = process.argv
  .find((arg) => arg.startsWith("--mutate="))
  ?.split("=")[1];
if (baseline || mutation)
  Bun.plugin({
    name: "ts-redeclared-control",
    setup(build) {
      build.onLoad({ filter: /real-typescript-analyzer\.ts$/ }, ({ path }) => {
        if (baseline)
          return { contents: readFileSync(baseline, "utf8"), loader: "ts" };
        const changes: Record<string, [string, string]> = {
          declarations: [
            "for (const declaration of aliasDeclarations.get(key) ?? [])",
            "for (const declaration of (aliasDeclarations.get(key) ?? []).slice(0, 1))",
          ],
          scope: [
            "const aliasKey = bindingKey(declarationScope(declaration), name)",
            "const aliasKey = name",
          ],
        };
        assert.ok(mutation && mutation in changes);
        const [before, after] = changes[mutation];
        const source = readFileSync(path, "utf8");
        assert.equal(
          source.split(before).length,
          2,
          `unique mutation anchor: ${mutation}`,
        );
        console.log(`APPLIED redeclared mutation: ${mutation}`);
        return { contents: source.replace(before, after), loader: "ts" };
      });
    },
  });
const { ASTEngine } = await import("../../src/ast/engine");
const { storeResults, indexProjectParallel, reindexFilesParallel } =
  await import("../../src/ast/parallel-indexer");
const { BrainDatabase } = await import("../../src/brain/database");
const { handler: graph } = await import("../../src/mcp/tools/bb_graph/handler");
const root = mkdtempSync("/tmp/bb-ts-redeclared-aliases-");
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-ts-redeclared-aliases-data-");
const filePath = join(root, "redeclared-aliases.ts");
const source = `class Alpha { run() {} }
class Beta { run() {} }
class First { item=new Alpha(); readFirst() { this.item.run(); } }
class Second { item=new Beta(); readSecond() { this.item.run(); } }
function redeclared(a:First,b:Second,input:any) { var alias:any=a; alias.item=input; var alias:any=b; alias.item=input; a.item.run(); b.item.run(); }
class BlockFirst { item=new Alpha(); readBlockFirst() { this.item.run(); } }
class BlockSecond { item=new Beta(); readBlockSecond() { this.item.run(); } }
function blockVar(a:BlockFirst,b:BlockSecond,input:any) { var alias:any=a; alias.item=input; { var alias:any=b; alias.item=input; } a.item.run(); b.item.run(); }
class Empty { item=new Alpha(); readEmpty() { this.item.run(); } }
function empty(holder:Empty,input:any) { var alias:any=holder; var alias:any; alias.item=input; holder.item.run(); }
class PatternFirst { item=new Alpha(); readPatternFirst() { this.item.run(); } }
class PatternSecond { item=new Beta(); readPatternSecond() { this.item.run(); } }
function patternVar(a:PatternFirst,b:PatternSecond,input:any) { var {held:alias}:{held:any}={held:a}; alias.item=input; var {held:alias}:{held:any}={held:b}; alias.item=input; a.item.run(); b.item.run(); }
class Safe { item=new Alpha(); readSafe() { this.item.run(); } }
class Other { item=new Beta(); readOther() { this.item.run(); } }
function lexicalSafe(a:Safe,b:Other,input:any) { const alias=a; { const alias=b; alias.item=input; } a.item.run(); b.item.run(); }
class Typed { item:Alpha=new Alpha(); readTyped() { this.item.run(); } }
function typed(holder:Typed,input:any) { var alias:any={}; var alias:any=holder; alias.item=input; holder.item.run(); }
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
const supported = new Set(["readSafe", "readTyped", "typed"]);
const unsupported = new Set([
  "readFirst",
  "readSecond",
  "redeclared",
  "readBlockFirst",
  "readBlockSecond",
  "blockVar",
  "readEmpty",
  "empty",
  "readPatternFirst",
  "readPatternSecond",
  "patternVar",
  "readOther",
]);
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
    assert.ok(
      supported.has(current.name.text) ||
        unsupported.has(current.name.text) ||
        current.name.text === "lexicalSafe",
    );
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
      owner:
        unsupported.has(current.name.text) ||
        (current.name.text === "lexicalSafe" &&
          node.expression.expression.getText() !== "a.item")
          ? null
          : declaration && ts.isClassDeclaration(declaration)
            ? (declaration.name?.text ?? null)
            : null,
    });
  }
  ts.forEachChild(node, visit);
};
visit(program.getSourceFile(filePath)!);
// Execute separate copies to distinguish static reference evidence from runtime dispatch.
const runtimePath = join(
  mkdtempSync("/tmp/bb-ts-inheritance-runtime-"),
  "runtime.mjs",
);
const executable =
  "export const trace: string[] = [];\n" +
  source
    .replace(
      "class Alpha { run() {} }",
      'class Alpha { run() { trace.push("Alpha"); } }',
    )
    .replace(
      "class Beta { run() {} }",
      'class Beta { run() { trace.push("Beta"); } }',
    )
    .replace(/^class /gm, "export class ")
    .replace(/^function /gm, "export function ");
writeFileSync(
  runtimePath,
  ts.transpileModule(executable, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText,
);
const runtime = await import(runtimePath);
const scenarios: Array<[string, () => void, string[]]> = [
  [
    "redeclarations",
    () =>
      runtime.redeclared(
        new runtime.First(),
        new runtime.Second(),
        new runtime.Beta(),
      ),
    ["Beta", "Beta"],
  ],
  [
    "block var",
    () =>
      runtime.blockVar(
        new runtime.BlockFirst(),
        new runtime.BlockSecond(),
        new runtime.Beta(),
      ),
    ["Beta", "Beta"],
  ],
  [
    "uninitialized var",
    () => runtime.empty(new runtime.Empty(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "pattern var",
    () =>
      runtime.patternVar(
        new runtime.PatternFirst(),
        new runtime.PatternSecond(),
        new runtime.Beta(),
      ),
    ["Beta", "Beta"],
  ],
  [
    "lexical shadow",
    () =>
      runtime.lexicalSafe(
        new runtime.Safe(),
        new runtime.Other(),
        new runtime.Alpha(),
      ),
    ["Alpha", "Alpha"],
  ],
  [
    "annotation",
    () => runtime.typed(new runtime.Typed(), new runtime.Beta()),
    ["Beta"],
  ],
];
for (const [name, run, trace] of scenarios) {
  runtime.trace.length = 0;
  run();
  assert.deepEqual(runtime.trace, trace, name);
}
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
const project = "ts-redeclared-aliases";
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
      file: "redeclared-aliases.ts",
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
if (worker) {
  // Redirecting the second declaration to First restores Second; then restore both origins.
  const edited = source.replace("var alias:any=b;", "var alias:any=a;");
  assert.equal(edited.length, source.length);
  writeFileSync(filePath, edited);
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
      row.source === "readSecond" ||
      (row.source === "redeclared" &&
        row.site ===
          expected.filter((edge) => edge.source === "redeclared")[1]!.site)
        ? { ...row, owner: "Beta" }
        : row,
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
    runtimeScenarios: scenarios.length,
    unsupported: [...unsupported],
    worker,
  }),
);
process.exit(0);
