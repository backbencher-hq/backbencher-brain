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
    name: "ts-write-control",
    setup(build) {
      build.onLoad({ filter: /real-typescript-analyzer\.ts$/ }, ({ path }) => {
        const changes: Record<string, [string, string]> = {
          invalidate: [
            "if (!declaredBindings.has(key)) invalidatedBindings.add(key)",
            "if (false) invalidatedBindings.add(key)",
          ],
          patterns: [
            "for (const name of declarationBindingNames(left)) {",
            'for (const name of left?.type === "identifier" ? [left.text] : []) {',
          ],
          scopes: [
            "if (localsByScope.get(scope)?.has(name)) return scope",
            "if (localsByScope.get(scope)?.has(name)) return 0",
          ],
          annotation: [
            "if (this.typeAnnotationNode(n)) {\n          if (annotated)",
            "if (annotated) {\n          if (annotated)",
          ],
          collection: [
            "if (elementType && !invalidatedBindings.has(bindingKey(declarationScope(n), nameNode.text)))",
            "if (elementType)",
          ],
          callable: ["returnTypes.get(scope)?.delete(name)", "void name"],
          conditional: [
            '!["statement_block", "program"].includes(statement.parent?.type ?? "")',
            "false",
          ],
          nonnull: [
            '"as_expression", "non_null_expression"].includes(root.type)',
            '"as_expression"].includes(root.type)',
          ],
        };
        assert.ok(mutation in changes);
        const source = readFileSync(path, "utf8");
        const [before, after] = changes[mutation];
        assert.ok(source.includes(before));
        console.log(`APPLIED write mutation: ${mutation}`);
        return { contents: source.replace(before, after), loader: "ts" };
      });
    },
  });
const { ASTEngine } = await import("../../src/ast/engine");
const { storeResults, indexProjectParallel, reindexFilesParallel } =
  await import("../../src/ast/parallel-indexer");
const { BrainDatabase } = await import("../../src/brain/database");
const { handler: graph } = await import("../../src/mcp/tools/bb_graph/handler");
const root = mkdtempSync("/tmp/bb-ts-writes-");
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-ts-write-data-");
const filePath = join(root, "writes.ts");
const source = `class Alpha { kind: 'a' = 'a'; run() {} }
class Beta { kind: 'b' = 'b'; run() {} }
class Config { worker: Alpha = new Alpha(); }
function stable() { const value = new Alpha(); value.run(); }
function inferredWrite(input: any) { let value = new Alpha(); value = input; value.run(); }
function typedWrite(input: any) { let value: Alpha = new Alpha(); value = input; value.run(); }
function anyAnnotation() { const value: any = new Alpha(); value.run(); }
function unionWrite() { let value: Alpha | Beta = new Alpha(); value = new Beta(); value.run(); }
function destructuredWrite(input: any) { let value = new Alpha(); ({ value } = input); value.run(); }
function arrayWrite(input: any) { let value = new Alpha(); [value] = input; value.run(); }
function defaultWrite(input: any) { let value = new Alpha(); [value = new Alpha()] = input; value.run(); }
function logicalWrite(input: any) { let value = new Alpha(); value ||= input; value.run(); }
function loopWrite(input: any) { let value = new Alpha(); for (value of input) {} value.run(); }
function closureWrite(input: any) { let value = new Alpha(); function mutate() { value = input; } mutate(); value.run(); }
function shadowWrite(input: any) { const value = new Alpha(); { let value = new Beta(); value = input; } value.run(); }
function lateAlpha() { let value; value = new Alpha(); value.run(); }
function lateBeta() { let value; value = new Beta(); value.run(); }
function lateConditional(flag: boolean) { let value; if (flag) value = new Alpha(); value?.run(); }
function lateRepeated() { let value; value = new Alpha(); value = new Beta(); value.run(); }
function collectionWrite(input: any) { let values = new Array<Alpha>(); values = input; values[0].run(); }
function typedCollection(input: any) { let values: Alpha[] = []; values = input; values[0].run(); }
function inheritedDestructure(input: any) { let cfg = new Config(); cfg = input; const {worker} = cfg; worker.run(); }
function destructuredBinding(input: any, cfg: Config) { let {worker} = cfg; worker = input; worker.run(); }
function callablePattern(input: any) { let make = (): Alpha => new Alpha(); [make] = input; const value = make(); value.run(); }
function callableLoop(input: any) { let make = (): Alpha => new Alpha(); for (make of input) {} const value = make(); value.run(); }
function renamedWrite(input: any) { let value = new Alpha(); ({worker: value} = input); value.run(); }
function restWrite(input: any) { let values = new Array<Alpha>(); [...values] = input; values[0].run(); }
function objectDefault(input: any) { let value = new Alpha(); ({value = new Alpha()} = input); value.run(); }
function nullishWrite(input: any) { let value = new Alpha(); value ??= input; value.run(); }
function andWrite(input: any) { let value = new Alpha(); value &&= input; value.run(); }
function callableLogical(input: any) { let make = (): Alpha => new Alpha(); make &&= input; const value = make(); value.run(); }
function typedParameterWrite(value: Alpha, input: any) { value = input; value.run(); }
function typedDestructure(input: any) { let {worker}: Config = new Config(); worker = input; worker.run(); }
function lateUnknown() { let value: unknown; value = new Alpha(); (value as Alpha).run(); }
function lateNested(flag: boolean) { let value; { value = new Alpha(); } value.run(); }
function lateEarly() { let value; (value as any)?.run(); value = new Alpha(); value.run(); }
function stableAfterShadow(input: any) { let value; value = new Alpha(); { let value = input; value = new Beta(); } value.run(); }
function forVar(input: any) { for(var value of [new Alpha()]) {} value = input; value!.run(); }

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
const unsupported = new Set([
  "inferredWrite",
  "unionWrite",
  "destructuredWrite",
  "arrayWrite",
  "defaultWrite",
  "logicalWrite",
  "loopWrite",
  "closureWrite",
  "lateConditional",
  "lateRepeated",
  "collectionWrite",
  "inheritedDestructure",
  "destructuredBinding",
  "callablePattern",
  "callableLoop",
  "renamedWrite",
  "restWrite",
  "objectDefault",
  "nullishWrite",
  "andWrite",
  "callableLogical",
  "lateNested",
  "forVar",
  "lateUnknown",
]);
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
const runtimePath = join(
  mkdtempSync("/tmp/bb-ts-write-runtime-"),
  "runtime.mjs",
);
const executable =
  "export const trace: string[] = [];\n" +
  source
    .replaceAll("run() {}", "run() { trace.push(this.kind); }")
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
const scenarios: Array<[string, () => unknown[], string[]]> = [
  ["stable", () => [], ["a"]],
  ["inferredWrite", () => [new runtime.Beta()], ["b"]],
  ["typedWrite", () => [new runtime.Beta()], ["b"]],
  ["unionWrite", () => [], ["b"]],
  ["destructuredWrite", () => [{ value: new runtime.Beta() }], ["b"]],
  ["arrayWrite", () => [[new runtime.Beta()]], ["b"]],
  ["defaultWrite", () => [[new runtime.Beta()]], ["b"]],
  ["andWrite", () => [new runtime.Beta()], ["b"]],
  ["loopWrite", () => [[new runtime.Beta()]], ["b"]],
  ["closureWrite", () => [new runtime.Beta()], ["b"]],
  ["lateAlpha", () => [], ["a"]],
  ["lateBeta", () => [], ["b"]],
  ["shadowWrite", () => [new runtime.Beta()], ["a"]],
  ["lateRepeated", () => [], ["b"]],
  ["collectionWrite", () => [[new runtime.Beta()]], ["b"]],
  ["inheritedDestructure", () => [{ worker: new runtime.Beta() }], ["b"]],
  [
    "destructuredBinding",
    () => [new runtime.Beta(), new runtime.Config()],
    ["b"],
  ],
  ["callablePattern", () => [[() => new runtime.Beta()]], ["b"]],
  ["callableLoop", () => [[() => new runtime.Beta()]], ["b"]],
  ["callableLogical", () => [() => new runtime.Beta()], ["b"]],
  ["renamedWrite", () => [{ worker: new runtime.Beta() }], ["b"]],
  ["restWrite", () => [[new runtime.Beta()]], ["b"]],
];
for (const [name, args, trace] of scenarios) {
  runtime.trace.length = 0;
  runtime[name](...args());
  assert.deepEqual(runtime.trace, trace, `runtime dispatch: ${name}`);
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
const project = "ts-receiver-writes";
const logger = { log() {}, write() {} };
const worker = process.argv.includes("--require-worker");
if (worker) {
  const result = await indexProjectParallel(project, root, { logger });
  assert.equal(result.summary?.parseMode, "worker-pool");
  assert.equal(result.successFiles, 1);
} else {
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
const response = await graph(
  {
    symbol: "Beta",
    file: "writes.ts",
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
    source.replace(
      "function stable() { const value = new Alpha();",
      "function stable() { const value = new Beta ();",
    ),
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
      row.source === "stable" ? { ...row, owner: "Beta" } : row,
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
    runtimeScenarios: scenarios.length,
    unsupported: [...unsupported],
    worker,
  }),
);
process.exit(0);
