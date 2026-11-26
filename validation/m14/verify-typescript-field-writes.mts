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
    name: "ts-field-write-control",
    setup(build) {
      build.onLoad({ filter: /real-typescript-analyzer\.ts$/ }, ({ path }) => {
        if (baseline)
          return { contents: readFileSync(baseline, "utf8"), loader: "ts" };
        const changes: Record<string, [string, string]> = {
          // 2026-11-25 (2nd): semi:false restored; anchored without semicolons.
          thisField: ["classFields.delete(field.key)", "void field.key"],
          externalField: [
            "if (field.owner && !field.isStatic)\n            typeMembers.get(field.owner)?.delete(field.name)",
            "void field.name",
          ],
          owner: [
            "`${declaringField(thisOwner, field.name) ?? thisOwner}:${field.name}`",
            "true",
          ],
          // 2026-11-25: reflowed by the formatter; re-anchored to CURRENT text.
          pattern: [
            'for (const target of fieldWriteTargets(\n        write.childForFieldName("left") ?? write.childForFieldName("argument"),',
            'for (const target of fieldWriteTargets(\n        write.childForFieldName("left")?.type === "member_expression" ? write.childForFieldName("left") : null,',
          ],
          static: [
            'const staticOwner =\n          receiver.type === "identifier" &&\n          hint === undefined',
            "const staticOwner =\n          false &&\n          hint === undefined",
          ],
        };
        assert.ok(mutation && mutation in changes);
        const [before, after] = changes[mutation];
        const source = readFileSync(path, "utf8");
        assert.ok(source.includes(before));
        console.log(`APPLIED field-write mutation: ${mutation}`);
        return { contents: source.replace(before, after), loader: "ts" };
      });
    },
  });
const { ASTEngine } = await import("../../src/ast/engine");
const { storeResults, indexProjectParallel, reindexFilesParallel } =
  await import("../../src/ast/parallel-indexer");
const { BrainDatabase } = await import("../../src/brain/database");
const { handler: graph } = await import("../../src/mcp/tools/bb_graph/handler");
const root = mkdtempSync("/tmp/bb-ts-field-writes-");
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-ts-field-writes-data-");
const filePath = join(root, "field-writes.ts");
const source = `class Alpha { kind: 'a' = 'a'; run() {} }
class Beta { kind: 'b' = 'b'; run() {} }
class Stable { item = new Alpha(); stable() { this.item.run(); } }
class StableBeta { item = new Beta(); stableBeta() { this.item.run(); } }
class Written { item = new Alpha(); write(input: any) { this.item = input; } readWritten() { this.item.run(); } }
class Typed { item: Alpha = new Alpha(); writeTyped(input: any) { this.item = input; } readTyped() { this.item.run(); } }
class Pattern { item = new Alpha(); writePattern(input: any) { ({item:this.item}=input); } readPattern() { this.item.run(); } }
class Private { #item = new Alpha(); writePrivate(input: any) { this.#item = input; } readPrivate() { this.#item.run(); } }
class Computed { item = new Alpha(); writeComputed(input: any) { this['item'] = input; } readComputed() { this.item.run(); } }
class Logical { item = new Alpha(); writeLogical(input: any) { this.item &&= input; } readLogical() { this.item.run(); } }
class Looped { item = new Alpha(); writeLoop(input: any) { for(this.item of input) {} } readLoop() { this.item.run(); } }
class Arrow { item = new Alpha(); writeArrow(input: any) { const set=()=>{this.item=input;}; set(); } readArrow() { this.item.run(); } }
class Sides { static item = new Beta(); item = new Alpha(); writeStatic(input:any) { Sides.item=input; } readInstance() { this.item.run(); } static readStatic() { this.item.run(); } }
function externalWrite(holder: Written, input:any) { holder.item=input; holder.item.run(); }
function externalStable(holder: Stable) { holder.item.run(); }
class Outside { item = new Alpha(); readOutside() { this.item.run(); } }
function outsideWrite(input:any) { const holder=new Outside(); holder.item=input; holder.item.run(); }
class Dynamic { item = new Alpha(); other = new Beta(); writeDynamic(key:'item'|'other', input:any) { this[key]=input; } readDynamic() { this.item.run(); this.other.run(); } }
class Late { item = new Alpha(); readLate() { this.item.run(); } }
function lateOwner(input:any) { let holder; holder=new Late(); holder.item=input; holder.item.run(); }
class Iterated { item = new Alpha(); readIterated() { this.item.run(); } }
function loopOwner(holders: Iterated[],input:any) { for(const holder of holders) { holder.item=input; holder.item.run(); } }
class Rebound { item = new Alpha(); writeRebound(input:any) { function set(this:{item:any}) { this.item=input; } set.call({item:new Beta()}); } readRebound() { this.item.run(); } }
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
  "readWritten",
  "readPattern",
  "readPrivate",
  "readComputed",
  "readLogical",
  "readLoop",
  "readArrow",
  "readStatic",
  "externalWrite",
  "readOutside",
  "outsideWrite",
  "readDynamic",
  "readLate",
  "lateOwner",
  "readIterated",
  "loopOwner",
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
  mkdtempSync("/tmp/bb-ts-field-write-runtime-"),
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
const scenarios: Array<[string, () => void, string[]]> = [
  ["stable", () => new runtime.Stable().stable(), ["a"]],
  [
    "written",
    () => {
      const o = new runtime.Written();
      o.write(new runtime.Beta());
      o.readWritten();
    },
    ["b"],
  ],
  [
    "typed",
    () => {
      const o = new runtime.Typed();
      o.writeTyped(new runtime.Beta());
      o.readTyped();
    },
    ["b"],
  ],
  [
    "pattern",
    () => {
      const o = new runtime.Pattern();
      o.writePattern({ item: new runtime.Beta() });
      o.readPattern();
    },
    ["b"],
  ],
  [
    "private",
    () => {
      const o = new runtime.Private();
      o.writePrivate(new runtime.Beta());
      o.readPrivate();
    },
    ["b"],
  ],
  [
    "computed",
    () => {
      const o = new runtime.Computed();
      o.writeComputed(new runtime.Beta());
      o.readComputed();
    },
    ["b"],
  ],
  [
    "logical",
    () => {
      const o = new runtime.Logical();
      o.writeLogical(new runtime.Beta());
      o.readLogical();
    },
    ["b"],
  ],
  [
    "loop",
    () => {
      const o = new runtime.Looped();
      o.writeLoop([new runtime.Beta()]);
      o.readLoop();
    },
    ["b"],
  ],
  [
    "arrow",
    () => {
      const o = new runtime.Arrow();
      o.writeArrow(new runtime.Beta());
      o.readArrow();
    },
    ["b"],
  ],
  [
    "static",
    () => {
      const o = new runtime.Sides();
      o.writeStatic(new runtime.Alpha());
      runtime.Sides.readStatic();
      o.readInstance();
    },
    ["a", "a"],
  ],
  ["outside", () => runtime.outsideWrite(new runtime.Beta()), ["b"]],
  [
    "dynamic",
    () => {
      const o = new runtime.Dynamic();
      o.writeDynamic("item", new runtime.Beta());
      o.readDynamic();
    },
    ["b", "b"],
  ],
  [
    "rebound",
    () => {
      const o = new runtime.Rebound();
      o.writeRebound(new runtime.Beta());
      o.readRebound();
    },
    ["a"],
  ],
  ["late", () => runtime.lateOwner(new runtime.Beta()), ["b"]],
  [
    "iterated",
    () => runtime.loopOwner([new runtime.Iterated()], new runtime.Beta()),
    ["b"],
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
const project = "ts-field-writes";
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
      file: "field-writes.ts",
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
