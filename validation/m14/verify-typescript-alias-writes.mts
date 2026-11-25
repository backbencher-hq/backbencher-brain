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
    name: "ts-alias-control",
    setup(build) {
      build.onLoad({ filter: /real-typescript-analyzer\.ts$/ }, ({ path }) => {
        if (baseline)
          return { contents: readFileSync(baseline, "utf8"), loader: "ts" };
        const changes: Record<string, [string, string]> = {
          aliases: [
            "const aliases = aliasFieldOwners(receiver)",
            "const aliases = new Set<string>()",
          ],
          chain: [
            'visitOrigin(declaration?.childForFieldName("value") ?? null)',
            'if (declaration?.childForFieldName("value")?.type !== "identifier") visitOrigin(declaration?.childForFieldName("value") ?? null)',
          ],
          assignments: [
            "for (const write of writeSites.get(key) ?? [])",
            "for (const write of [] as Node[])",
          ],
          thisAlias: ['if (value.type === "this") {', "if (false) {"],
          shadow: [
            "for (const declaration of aliasDeclarations.get(key) ?? [])",
            'for (const declaration of [...aliasDeclarations.values()].flat().filter(n => n.childForFieldName("name")?.text === value.text))',
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
        console.log(`APPLIED alias mutation: ${mutation}`);
        return { contents: source.replace(before, after), loader: "ts" };
      });
    },
  });
const { ASTEngine } = await import("../../src/ast/engine");
const { storeResults, indexProjectParallel, reindexFilesParallel } =
  await import("../../src/ast/parallel-indexer");
const { BrainDatabase } = await import("../../src/brain/database");
const { handler: graph } = await import("../../src/mcp/tools/bb_graph/handler");
const root = mkdtempSync("/tmp/bb-ts-alias-writes-");
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-ts-alias-writes-data-");
const filePath = join(root, "alias-writes.ts");
const source = `class Alpha { run() {} }
class Beta { run() {} }
class Basic { item = new Alpha(); readBasic() { this.item.run(); } }
function basicWrite(holder: Basic, input:any) { const alias=holder; alias.item=input; holder.item.run(); }
class Chain { item = new Alpha(); readChain() { this.item.run(); } }
function chainWrite(holder: Chain, input:any) { const first=holder; const second=first; second.item=input; holder.item.run(); }
class Captured { item = new Alpha(); readCaptured() { this.item.run(); } }
function captureWrite(holder: Captured, input:any) { const alias=holder; function write() { alias.item=input; } write(); holder.item.run(); }
class Self { item = new Alpha(); selfWrite(input:any) { const alias=this; alias.item=input; } readSelf() { this.item.run(); } }
class Assigned { item = new Alpha(); readAssigned() { this.item.run(); } }
function assignedWrite(holder: Assigned, input:any) { let alias; alias=holder; alias.item=input; holder.item.run(); }
class Reassigned { item = new Alpha(); readReassigned() { this.item.run(); } }
function reassignWrite(holder: Reassigned, input:any) { let alias:any={item:input}; alias=holder; alias.item=input; holder.item.run(); }
class Rebound { item = new Alpha(); readRebound() { this.item.run(); } }
function reboundWrite(input:any) { let holder:any=new Rebound(); const alias=holder; holder={item:input}; alias.item=input; return alias; }
class ShadowSafe { item = new Alpha(); readSafe() { this.item.run(); } }
function shadowSafe(holder: ShadowSafe, input:any) { const alias=holder; { const alias={item:input}; alias.item=input; } holder.item.run(); }
class SiblingSafe { item = new Alpha(); readSibling() { this.item.run(); } }
function siblingSafe(holder: SiblingSafe) { const alias=holder; holder.item.run(); }
function siblingOther(input:any) { const alias={item:input}; alias.item=input; }
class StaticAlias { static item = new Alpha(); item = new Beta(); static readStatic() { this.item.run(); } readInstance() { this.item.run(); } }
function staticWrite(input:any) { const cls=StaticAlias; cls.item=input; }
class Typed { item: Alpha = new Alpha(); readTyped() { this.item.run(); } }
function typedWrite(holder:Typed,input:any) { const alias=holder; alias.item=input; holder.item.run(); }
class Parent { item = new Alpha(); readParent() { this.item.run(); } }
class Child extends Parent { readChild() { this.item.run(); } }
function childWrite(holder:Child,input:any) { const alias=holder; alias.item=input; holder.item.run(); }
class Wrapped { item = new Alpha(); readWrapped() { this.item.run(); } }
function wrappedWrite(holder:Wrapped,input:any) { const alias=(holder as any); alias.item=input; holder.item.run(); }
class ArrowSelf { item = new Alpha(); write(input:any) { const set=()=>{const alias=this;alias.item=input;};set(); } readArrow() { this.item.run(); } }
class FunctionSafe { item = new Alpha(); write(input:any) { function set(this:{item:any}) {const alias=this;alias.item=input;} set.call({item:input}); } readFunctionSafe() { this.item.run(); } }
class PatternAlias { item = new Alpha(); readPattern() { this.item.run(); } }
function patternWrite(holder:PatternAlias,input:any) { const alias=holder; ({item:alias.item}=input); holder.item.run(); }
class NewAlias { item = new Alpha(); readNew() { this.item.run(); } }
function newWrite(input:any) { const holder=new NewAlias(); const alias=holder; alias.item=input; holder.item.run(); }
class Cycle { item = new Alpha(); readCycle() { this.item.run(); } }
function cycleWrite(holder:Cycle,input:any) { let first:any=holder; let second=first; first=second; second.item=input; holder.item.run(); }
class ManyA { item = new Alpha(); readManyA() { this.item.run(); } }
class ManyB { item = new Beta(); readManyB() { this.item.run(); } }
function manyWrite(a:ManyA,b:ManyB,input:any) { let alias:any=a; alias=b; (alias as any).item=input; a.item.run(); b.item.run(); }
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
  "readSafe",
  "shadowSafe",
  "readSibling",
  "siblingSafe",
  "readInstance",
  "readTyped",
  "typedWrite",
  "readFunctionSafe",
]);
const unsupported = new Set([
  "readBasic",
  "basicWrite",
  "readChain",
  "chainWrite",
  "readCaptured",
  "captureWrite",
  "readSelf",
  "readAssigned",
  "assignedWrite",
  "readReassigned",
  "reassignWrite",
  "readRebound",
  "readStatic",
  "readParent",
  "readChild",
  "childWrite",
  "readWrapped",
  "wrappedWrite",
  "readArrow",
  "readPattern",
  "patternWrite",
  "readNew",
  "newWrite",
  "readCycle",
  "cycleWrite",
  "readManyA",
  "readManyB",
  "manyWrite",
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
      supported.has(current.name.text) || unsupported.has(current.name.text),
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
    "direct alias",
    () => runtime.basicWrite(new runtime.Basic(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "alias chain",
    () => runtime.chainWrite(new runtime.Chain(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "captured alias",
    () => runtime.captureWrite(new runtime.Captured(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "this alias",
    () => {
      const o = new runtime.Self();
      o.selfWrite(new runtime.Beta());
      o.readSelf();
    },
    ["Beta"],
  ],
  [
    "late alias",
    () => runtime.assignedWrite(new runtime.Assigned(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "reassigned alias",
    () => runtime.reassignWrite(new runtime.Reassigned(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "captured before rebinding",
    () => runtime.reboundWrite(new runtime.Beta()).readRebound(),
    ["Beta"],
  ],
  [
    "shadow control",
    () => runtime.shadowSafe(new runtime.ShadowSafe(), new runtime.Beta()),
    ["Alpha"],
  ],
  [
    "sibling control",
    () => {
      runtime.siblingOther(new runtime.Beta());
      runtime.siblingSafe(new runtime.SiblingSafe());
    },
    ["Alpha"],
  ],
  [
    "static alias",
    () => {
      runtime.staticWrite(new runtime.Beta());
      runtime.StaticAlias.readStatic();
      new runtime.StaticAlias().readInstance();
    },
    ["Beta", "Beta"],
  ],
  [
    "annotation evidence",
    () => runtime.typedWrite(new runtime.Typed(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "inherited alias",
    () => runtime.childWrite(new runtime.Child(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "wrapped alias",
    () => runtime.wrappedWrite(new runtime.Wrapped(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "arrow this",
    () => {
      const o = new runtime.ArrowSelf();
      o.write(new runtime.Beta());
      o.readArrow();
    },
    ["Beta"],
  ],
  [
    "rebound this control",
    () => {
      const o = new runtime.FunctionSafe();
      o.write(new runtime.Beta());
      o.readFunctionSafe();
    },
    ["Alpha"],
  ],
  [
    "pattern alias",
    () =>
      runtime.patternWrite(new runtime.PatternAlias(), {
        item: new runtime.Beta(),
      }),
    ["Beta"],
  ],
  [
    "cyclic bindings",
    () => runtime.cycleWrite(new runtime.Cycle(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "multiple origins",
    () =>
      runtime.manyWrite(
        new runtime.ManyA(),
        new runtime.ManyB(),
        new runtime.Alpha(),
      ),
    ["Alpha", "Alpha"],
  ],
  ["new alias", () => runtime.newWrite(new runtime.Beta()), ["Beta"]],
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
const project = "ts-alias-writes";
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
      file: "alias-writes.ts",
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
      ["readBasic", "basicWrite"].includes(row.source)
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
