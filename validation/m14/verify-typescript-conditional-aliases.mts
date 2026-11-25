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
    name: "ts-conditional-control",
    setup(build) {
      build.onLoad({ filter: /real-typescript-analyzer\.ts$/ }, ({ path }) => {
        if (baseline)
          return { contents: readFileSync(baseline, "utf8"), loader: "ts" };
        const changes: Record<string, [string, string]> = {
          ternary: [
            'if (value.type === "ternary_expression") {',
            "if (false) {",
          ],
          condition: [
            'visitOrigin(value.childForFieldName("consequence"), path)',
            'visitOrigin(value.childForFieldName("condition"), path)',
          ],
          logical: [
            'value.type === "binary_expression" && ["&&", "||", "??"].includes',
            'value.type === "binary_expression" && [].includes',
          ],
          assignment: [
            '              (write.type === "augmented_assignment_expression" && ["&&=", "||=", "??="].includes(write.childForFieldName("operator")?.text ?? ""))',
            "              false",
          ],
          sequence: [
            "visitOrigin(value.namedChild(value.namedChildCount - 1), path)",
            "for (const child of value.namedChildren) visitOrigin(child, path)",
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
        console.log(`APPLIED conditional mutation: ${mutation}`);
        return { contents: source.replace(before, after), loader: "ts" };
      });
    },
  });
const { ASTEngine } = await import("../../src/ast/engine");
const { storeResults, indexProjectParallel, reindexFilesParallel } =
  await import("../../src/ast/parallel-indexer");
const { BrainDatabase } = await import("../../src/brain/database");
const { handler: graph } = await import("../../src/mcp/tools/bb_graph/handler");
const root = mkdtempSync("/tmp/bb-ts-conditional-aliases-");
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-ts-conditional-aliases-data-");
const filePath = join(root, "conditional-aliases.ts");
const source = `class Alpha { run() {} }
class Beta { run() {} }
class ChoiceA { item = new Alpha(); readA() { this.item.run(); } }
class ChoiceB { item = new Beta(); readB() { this.item.run(); } }
function choose(a:ChoiceA,b:ChoiceB,flag:boolean,input:any) { const alias=flag?a:b; alias.item=input; a.item.run(); b.item.run(); }
class Or { item = new Alpha(); readOr() { this.item.run(); } }
function orWrite(holder:Or,other:any,input:any) { const alias=other||holder; alias.item=input; holder.item.run(); }
class And { item = new Alpha(); readAnd() { this.item.run(); } }
function andWrite(holder:And,flag:any,input:any) { const alias=flag&&holder; alias.item=input; holder.item.run(); }
class Nullish { item = new Alpha(); readNullish() { this.item.run(); } }
function nullishWrite(holder:Nullish,other:any,input:any) { const alias=other??holder; alias.item=input; holder.item.run(); }
class OrAssign { item = new Alpha(); readOrAssign() { this.item.run(); } }
function orAssign(holder:OrAssign,input:any) { let alias:any; alias ||= holder; alias.item=input; holder.item.run(); }
class AndAssign { item = new Alpha(); readAndAssign() { this.item.run(); } }
function andAssign(holder:AndAssign,input:any) { let alias:any={}; alias &&= holder; alias.item=input; holder.item.run(); }
class NullAssign { item = new Alpha(); readNullAssign() { this.item.run(); } }
function nullAssign(holder:NullAssign,input:any) { let alias:any; alias ??= holder; alias.item=input; holder.item.run(); }
class ConditionSafe { item = new Alpha(); readCondition() { this.item.run(); } }
function conditionSafe(holder:ConditionSafe,input:any) { const alias=holder?{item:input}:{item:input}; alias.item=input; holder.item.run(); }
class SequenceSafe { item = new Alpha(); readSequenceSafe() { this.item.run(); } }
class SequenceTarget { item = new Beta(); readSequenceTarget() { this.item.run(); } }
function sequenceWrite(safe:SequenceSafe,holder:SequenceTarget,input:any) { const alias=(safe=safe,holder); alias.item=input; safe.item.run(); holder.item.run(); }
class ArithmeticSafe { item = new Alpha(); readArithmetic() { this.item.run(); } }
function arithmeticSafe(holder:ArithmeticSafe,input:any) { const alias=(holder as any)+1; alias.item=input; holder.item.run(); }
class Wrapped { item = new Alpha(); readWrapped() { this.item.run(); } }
function wrappedWrite(holder:Wrapped,flag:boolean,input:any) { let alias:any; alias=flag?(holder as any):{}; alias.item=input; holder.item.run(); }
class Typed { item: Alpha = new Alpha(); readTyped() { this.item.run(); } }
function typedWrite(holder:Typed,input:any) { let alias:any; alias ||= holder; alias.item=input; holder.item.run(); }
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
const supported = new Set([
  "readCondition",
  "conditionSafe",
  "readSequenceSafe",
  "readArithmetic",
  "arithmeticSafe",
  "readTyped",
  "typedWrite",
]);
const unsupported = new Set([
  "readA",
  "readB",
  "choose",
  "readOr",
  "orWrite",
  "readAnd",
  "andWrite",
  "readNullish",
  "nullishWrite",
  "readOrAssign",
  "orAssign",
  "readAndAssign",
  "andAssign",
  "readNullAssign",
  "nullAssign",
  "readSequenceTarget",
  "readWrapped",
  "wrappedWrite",
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
        current.name.text === "sequenceWrite",
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
        (current.name.text === "sequenceWrite" &&
          node.expression.expression.getText() !== "safe.item")
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
  mkdtempSync("/tmp/bb-ts-conditional-runtime-"),
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
    "ternary true",
    () =>
      runtime.choose(
        new runtime.ChoiceA(),
        new runtime.ChoiceB(),
        true,
        new runtime.Beta(),
      ),
    ["Beta", "Beta"],
  ],
  [
    "ternary false",
    () =>
      runtime.choose(
        new runtime.ChoiceA(),
        new runtime.ChoiceB(),
        false,
        new runtime.Alpha(),
      ),
    ["Alpha", "Alpha"],
  ],
  [
    "or",
    () => runtime.orWrite(new runtime.Or(), null, new runtime.Beta()),
    ["Beta"],
  ],
  [
    "and",
    () => runtime.andWrite(new runtime.And(), true, new runtime.Beta()),
    ["Beta"],
  ],
  [
    "nullish",
    () => runtime.nullishWrite(new runtime.Nullish(), null, new runtime.Beta()),
    ["Beta"],
  ],
  [
    "or assignment",
    () => runtime.orAssign(new runtime.OrAssign(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "and assignment",
    () => runtime.andAssign(new runtime.AndAssign(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "null assignment",
    () => runtime.nullAssign(new runtime.NullAssign(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "condition control",
    () =>
      runtime.conditionSafe(new runtime.ConditionSafe(), new runtime.Beta()),
    ["Alpha"],
  ],
  [
    "sequence",
    () =>
      runtime.sequenceWrite(
        new runtime.SequenceSafe(),
        new runtime.SequenceTarget(),
        new runtime.Alpha(),
      ),
    ["Alpha", "Alpha"],
  ],
  [
    "wrapped assignment",
    () => runtime.wrappedWrite(new runtime.Wrapped(), true, new runtime.Beta()),
    ["Beta"],
  ],
  [
    "annotation",
    () => runtime.typedWrite(new runtime.Typed(), new runtime.Beta()),
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
const project = "ts-conditional-aliases";
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
      file: "conditional-aliases.ts",
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
  // Removing the alias write restores the initializer evidence, then the write is restored.
  const edited = source.replace(
    "alias.item=input; holder.item.run();",
    "/* removed */     holder.item.run();",
  );
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
      ["readOr", "orWrite"].includes(row.source)
        ? { ...row, owner: "Alpha" }
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
