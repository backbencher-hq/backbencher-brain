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
    name: "ts-iterated-control",
    setup(build) {
      build.onLoad({ filter: /real-typescript-analyzer\.ts$/ }, ({ path }) => {
        if (baseline)
          return { contents: readFileSync(baseline, "utf8"), loader: "ts" };
        const changes: Record<string, [string, string]> = {
          loops: [
            "for (const loop of aliasLoops.get(key) ?? [])",
            "for (const loop of [] as Node[])",
          ],
          // 2026-11-25: BOTH anchors were stale — the formatter added the parameter
          // parentheses, the semicolon, and split the spread branch across lines, so neither
          // injected and the gate failed on a MISSING "APPLIED" rather than on the analyzer.
          // Re-anchored to the CURRENT text.
          forIn: [
            'if (!loop.children.some((child) => child?.type === "of")) continue;',
            "if (false) continue;",
          ],
          // The replacement must remain VALID JavaScript: `from` stops at the visitOrigin
          // call, so `to` keeps the branch open and leaves the following `continue;` and `}`
          // intact. A `to` that truncated the block made the injected file a syntax error,
          // which the gate reported as a missing "APPLIED" rather than as the mutation it is.
          // TWO spread sites exist and only ONE is this mutation's target. The object-literal
          // walker (`{...a}`) and the ITERATED-ELEMENT walker (`[...values]`) both contain
          // `member.type === "spread_element"`; mutating the first left this gate PASSING,
          // because the aliases this fixture exercises come through the second. Anchored on
          // the `if (path[0] === iteratedElement)` branch, which is the one the scenario uses.
          spread: [
            'if (member.type === "spread_element")\n                visitOrigin(member.namedChild(0), path);',
            'if (member.type === "spread_element") void member;',
          ],
          index: [
            "path[index] === iteratedElement && isArrayIndex(part)",
            "path[index] === iteratedElement",
          ],
          writes: [
            "path[index] === iteratedElement && isArrayIndex(part)",
            "false",
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
        console.log(`APPLIED iterated mutation: ${mutation}`);
        return { contents: source.replace(before, after), loader: "ts" };
      });
    },
  });
const { ASTEngine } = await import("../../src/ast/engine");
const { storeResults, indexProjectParallel, reindexFilesParallel } =
  await import("../../src/ast/parallel-indexer");
const { BrainDatabase } = await import("../../src/brain/database");
const { handler: graph } = await import("../../src/mcp/tools/bb_graph/handler");
const root = mkdtempSync("/tmp/bb-ts-iterated-aliases-");
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-ts-iterated-aliases-data-");
const filePath = join(root, "iterated-aliases.ts");
const source = `class Alpha { run() {} }
class Beta { run() {} }
class Literal { item=new Alpha(); readLiteral() { this.item.run(); } }
function literalWrite(holder:Literal,input:any) { for(const alias of [holder]) { alias.item=input; } holder.item.run(); }
class Existing { item=new Alpha(); readExisting() { this.item.run(); } }
function existingWrite(holder:Existing,input:any) { let alias:any; for(alias of [holder]) { alias.item=input; } holder.item.run(); }
class Var { item=new Alpha(); readVar() { this.item.run(); } }
function varWrite(holder:Var,input:any) { var alias:any={}; for(var alias of [holder] as any[]) {} alias.item=input; holder.item.run(); }
class Pattern { item=new Alpha(); readPattern() { this.item.run(); } }
function patternWrite(holder:Pattern,input:any) { for(const {held:alias} of [{held:holder}]) { alias.item=input; } holder.item.run(); }
class ArrayPattern { item=new Alpha(); readArrayPattern() { this.item.run(); } }
function arrayPatternWrite(holder:ArrayPattern,input:any) { for(const [alias] of [[holder]]) { alias.item=input; } holder.item.run(); }
class Stored { item=new Alpha(); readStored() { this.item.run(); } }
function storedWrite(holder:Stored,input:any) { const values=[holder]; const items=values; for(const alias of items) { alias.item=input; } holder.item.run(); }
class Written { item=new Alpha(); readWritten() { this.item.run(); } }
function writtenWrite(holder:Written,input:any) { const items:any[]=[]; items[0]=holder; for(const alias of items) { alias.item=input; } holder.item.run(); }
class Spread { item=new Alpha(); readSpread() { this.item.run(); } }
function spreadWrite(holder:Spread,input:any) { const values=[holder]; for(const alias of [...values]) { alias.item=input; } holder.item.run(); }
class Conditional { item=new Alpha(); readConditional() { this.item.run(); } }
function conditionalWrite(holder:Conditional,input:any,flag:boolean) { for(const alias of flag?[holder]:[]) { alias.item=input; } holder.item.run(); }
class Typed { item=new Alpha(); readTyped() { this.item.run(); } }
function typedWrite(items:Typed[],input:any) { for(const alias of items) { alias.item=input; } items[0].item.run(); }
class SafeForIn { item=new Alpha(); readForInSafe() { this.item.run(); } }
function forInSafe(holder:SafeForIn,input:any) { for(const key in [holder]) { if(false) (key as any).item=input; } holder.item.run(); }
class SafeShadow { item=new Alpha(); readShadowSafe() { this.item.run(); } }
function shadowSafe(holder:SafeShadow,input:any) { const alias=holder; for(const alias of [{item:input}]) { alias.item=input; } holder.item.run(); }
class Annotated { item:Alpha=new Alpha(); readAnnotated() { this.item.run(); } }
function annotatedWrite(holder:Annotated,input:any) { for(const alias of [holder]) { alias.item=input; } holder.item.run(); }
class TwiceA { item=new Alpha(); readTwiceA() { this.item.run(); } }
class TwiceB { item=new Beta(); readTwiceB() { this.item.run(); } }
function twiceWrite(a:TwiceA,b:TwiceB,input:any) { for(var alias of [a] as any[]) {} for(var alias of [b] as any[]) {} alias.item=input; a.item.run(); b.item.run(); }
class AssignedPattern { item=new Alpha(); readAssignedPattern() { this.item.run(); } }
function assignedPatternWrite(holder:AssignedPattern,input:any) { let alias:any; for({held:alias} of [{held:holder}]) { alias.item=input; } holder.item.run(); }
class NamedSafe { item=new Alpha(); readNamedSafe() { this.item.run(); } }
function namedSafe(holder:NamedSafe,input:any) { const items:any[]=[]; items['held' as any]=holder; for(const alias of items) { alias.item=input; } holder.item.run(); }
class PaddedSafe { item=new Alpha(); readPaddedSafe() { this.item.run(); } }
function paddedSafe(holder:PaddedSafe,input:any) { const items:any[]=[]; items['01' as any]=holder; for(const alias of items) { alias.item=input; } holder.item.run(); }
class LimitSafe { item=new Alpha(); readLimitSafe() { this.item.run(); } }
function limitSafe(holder:LimitSafe,input:any) { const items:any[]=[]; items[4294967295]=holder; for(const alias of items) { alias.item=input; } holder.item.run(); }
class ExplicitProperty { item=new Alpha(); readExplicitProperty() { this.item.run(); } }
function explicitPropertyWrite(holder:ExplicitProperty,input:any) { const items:any[]=[]; items['01' as any]=holder; const alias=items['01' as any]; alias.item=input; holder.item.run(); }
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
  "readForInSafe",
  "forInSafe",
  "readShadowSafe",
  "shadowSafe",
  "readAnnotated",
  "annotatedWrite",
  "readNamedSafe",
  "namedSafe",
  "readPaddedSafe",
  "paddedSafe",
  "readLimitSafe",
  "limitSafe",
]);
const unsupported = new Set([
  "readLiteral",
  "literalWrite",
  "readExisting",
  "existingWrite",
  "readVar",
  "varWrite",
  "readPattern",
  "patternWrite",
  "readArrayPattern",
  "arrayPatternWrite",
  "readStored",
  "storedWrite",
  "readWritten",
  "writtenWrite",
  "readSpread",
  "spreadWrite",
  "readConditional",
  "conditionalWrite",
  "readTyped",
  "typedWrite",
  "readTwiceA",
  "readTwiceB",
  "twiceWrite",
  "readAssignedPattern",
  "assignedPatternWrite",
  "readExplicitProperty",
  "explicitPropertyWrite",
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
    "literal array",
    () => runtime.literalWrite(new runtime.Literal(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "existing binding",
    () => runtime.existingWrite(new runtime.Existing(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "var binding",
    () => runtime.varWrite(new runtime.Var(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "object pattern",
    () => runtime.patternWrite(new runtime.Pattern(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "array pattern",
    () =>
      runtime.arrayPatternWrite(new runtime.ArrayPattern(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "stored array",
    () => runtime.storedWrite(new runtime.Stored(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "written array",
    () => runtime.writtenWrite(new runtime.Written(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "spread array",
    () => runtime.spreadWrite(new runtime.Spread(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "conditional true",
    () =>
      runtime.conditionalWrite(
        new runtime.Conditional(),
        new runtime.Beta(),
        true,
      ),
    ["Beta"],
  ],
  [
    "conditional false",
    () =>
      runtime.conditionalWrite(
        new runtime.Conditional(),
        new runtime.Beta(),
        false,
      ),
    ["Alpha"],
  ],
  [
    "typed array",
    () => runtime.typedWrite([new runtime.Typed()], new runtime.Beta()),
    ["Beta"],
  ],
  [
    "for-in control",
    () => runtime.forInSafe(new runtime.SafeForIn(), new runtime.Beta()),
    ["Alpha"],
  ],
  [
    "scope control",
    () => runtime.shadowSafe(new runtime.SafeShadow(), new runtime.Beta()),
    ["Alpha"],
  ],
  [
    "repeated var loops",
    () =>
      runtime.twiceWrite(
        new runtime.TwiceA(),
        new runtime.TwiceB(),
        new runtime.Alpha(),
      ),
    ["Alpha", "Alpha"],
  ],
  [
    "assigned pattern",
    () =>
      runtime.assignedPatternWrite(
        new runtime.AssignedPattern(),
        new runtime.Beta(),
      ),
    ["Beta"],
  ],
  [
    "named array property",
    () => runtime.namedSafe(new runtime.NamedSafe(), new runtime.Beta()),
    ["Alpha"],
  ],
  [
    "noncanonical numeric key",
    () => runtime.paddedSafe(new runtime.PaddedSafe(), new runtime.Beta()),
    ["Alpha"],
  ],
  [
    "array index limit",
    () => runtime.limitSafe(new runtime.LimitSafe(), new runtime.Beta()),
    ["Alpha"],
  ],
  [
    "explicit non-index property",
    () =>
      runtime.explicitPropertyWrite(
        new runtime.ExplicitProperty(),
        new runtime.Beta(),
      ),
    ["Beta"],
  ],
  [
    "annotation",
    () => runtime.annotatedWrite(new runtime.Annotated(), new runtime.Beta()),
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
const project = "ts-iterated-aliases";
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
      file: "iterated-aliases.ts",
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
  // Removing the iterable element restores the inferred field, then restore it.
  const edited = source.replace("of [holder]", "of [      ]");
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
      ["readLiteral", "literalWrite"].includes(row.source)
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
