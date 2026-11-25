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
    name: "ts-container-control",
    setup(build) {
      build.onLoad({ filter: /real-typescript-analyzer\.ts$/ }, ({ path }) => {
        if (baseline)
          return { contents: readFileSync(baseline, "utf8"), loader: "ts" };
        const changes: Record<string, [string, string]> = {
          writes: [
            "for (const write of containerWrites.get(container) ?? [])",
            "for (const write of [] as ContainerWrite[])",
          ],
          keys: ["part === null || part === path[index]", "true"],
          aliases: ["containerAliases.get(container) ?? []", "[]"],
          tail: [
            "[...write.sourcePath, ...path.slice(write.path.length)]",
            "[]",
          ],
          dynamic: [
            "part === null || part === path[index]",
            "part === path[index]",
          ],
          sibling: [
            "activeLength !== undefined && path.length > activeLength",
            "activeLength !== undefined",
          ],
          direct: [
            'while (base && ["member_expression", "subscript_expression"].includes(base.type)) {\n        base = unwrapAliasValue',
            "while (false) {\n        base = unwrapAliasValue",
          ],
          patterns: [
            "collectContainerWrites(left, right, [])",
            'if (left.type === "member_expression" || left.type === "subscript_expression") collectContainerWrites(left, right, [])',
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
        console.log(`APPLIED container mutation: ${mutation}`);
        return { contents: source.replace(before, after), loader: "ts" };
      });
    },
  });
const { ASTEngine } = await import("../../src/ast/engine");
const { storeResults, indexProjectParallel, reindexFilesParallel } =
  await import("../../src/ast/parallel-indexer");
const { BrainDatabase } = await import("../../src/brain/database");
const { handler: graph } = await import("../../src/mcp/tools/bb_graph/handler");
const root = mkdtempSync("/tmp/bb-ts-container-writes-");
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-ts-container-writes-data-");
const filePath = join(root, "container-writes.ts");
const source = `class Alpha { run() {} }
class Beta { run() {} }
class Original { item=new Alpha(); original() { this.item.run(); } }
class Replacement { item=new Beta(); replacement() { this.item.run(); } }
function replace(a:Original,b:Replacement,input:any) { const box:any={held:a}; box.held=b; const {held:alias}=box; alias.item=input; a.item.run(); b.item.run(); }
class ArrayHolder { item=new Alpha(); readArray() { this.item.run(); } }
function arrayWrite(holder:ArrayHolder,input:any) { const box:any[]=[]; box[0]=holder; const [alias]=box; alias.item=input; holder.item.run(); }
class Nested { item=new Alpha(); readNested() { this.item.run(); } }
function nestedWrite(holder:Nested,input:any) { const box:any={}; box.outer={held:holder}; const {outer:{held:alias}}=box; alias.item=input; holder.item.run(); }
class Deep { item=new Alpha(); readDeep() { this.item.run(); } }
function deepWrite(holder:Deep,input:any) { const box:any={outer:{}}; box.outer.held=holder; const alias=box.outer.held; alias.item=input; holder.item.run(); }
class ViaAlias { item=new Alpha(); readViaAlias() { this.item.run(); } }
function viaAliasWrite(holder:ViaAlias,input:any) { const box:any={}; const copy=box; copy.held=holder; const {held:alias}=box; alias.item=input; holder.item.run(); }
class ViaOriginal { item=new Alpha(); readViaOriginal() { this.item.run(); } }
function viaOriginalWrite(holder:ViaOriginal,input:any) { const box:any={}; const copy=box; box.held=holder; const {held:alias}=copy; alias.item=input; holder.item.run(); }
class Pattern { item=new Alpha(); readPattern() { this.item.run(); } }
function patternWrite(holder:Pattern,input:any) { const box:any={}; ({source:box.held}={source:holder}); const alias=box.held; alias.item=input; holder.item.run(); }
class ArrayPattern { item=new Alpha(); readArrayPattern() { this.item.run(); } }
function arrayPatternWrite(holder:ArrayPattern,input:any) { const box:any={}; [,box.held]=[null,holder]; const alias=box.held; alias.item=input; holder.item.run(); }
class Logical { item=new Alpha(); readLogical() { this.item.run(); } }
function logicalWrite(holder:Logical,input:any) { const box:any={}; box.held ||= holder; const alias=box.held; alias.item=input; holder.item.run(); }
class Dynamic { item=new Alpha(); readDynamic() { this.item.run(); } }
function dynamicWrite(holder:Dynamic,key:string,input:any) { const box:any={}; box[key]=holder; const alias=box.held; alias.item=input; holder.item.run(); }
class SafeKey { item=new Alpha(); readSafeKey() { this.item.run(); } }
function safeKey(holder:SafeKey,input:any) { const box:any={held:{item:input}}; box.other=holder; const alias=box.held; alias.item=input; holder.item.run(); }
class SafeScope { item=new Alpha(); readSafeScope() { this.item.run(); } }
function safeScope(holder:SafeScope,input:any) { const box:any={held:{item:input}}; { const box:any={}; box.held=holder; } const alias=box.held; alias.item=input; holder.item.run(); }
class SafeCopy { item=new Alpha(); readSafeCopy() { this.item.run(); } }
function safeCopy(holder:SafeCopy,input:any) { const box:any={held:{item:input}}; const {...copy}=box; copy.held=holder; const alias=box.held; alias.item=input; holder.item.run(); }
class Typed { item:Alpha=new Alpha(); readTyped() { this.item.run(); } }
function typedWrite(holder:Typed,input:any) { const box:any={}; box.held=holder; const alias=box.held; alias.item=input; holder.item.run(); }
class Sibling { item=new Alpha(); readSibling() { this.item.run(); } }
function siblingWrite(holder:Sibling,input:any) { const box:any={other:holder}; box.held=box.other; const alias=box.held; alias.item=input; holder.item.run(); }
class Default { item=new Alpha(); readDefault() { this.item.run(); } }
function defaultWrite(holder:Default,input:any) { const box:any={}; ({held:box.held=holder}={} as {held?:Default}); const alias=box.held; alias.item=input; holder.item.run(); }
class Chain { item=new Alpha(); readChain() { this.item.run(); } }
function chainWrite(holder:Chain,input:any) { const box:any={}; const first=box; let second=first; second=box; second.held=holder; const alias=box.held; alias.item=input; holder.item.run(); }
class Quoted { item=new Alpha(); readQuoted() { this.item.run(); } }
function quotedWrite(holder:Quoted,input:any) { const box:any={}; box['held']=holder; const alias=box.held; alias.item=input; holder.item.run(); }
class Nullish { item=new Alpha(); readNullish() { this.item.run(); } }
function nullishWrite(holder:Nullish,input:any) { const box:any={}; box.held ??= holder; const alias=box.held; alias.item=input; holder.item.run(); }
class And { item=new Alpha(); readAnd() { this.item.run(); } }
function andWrite(holder:And,input:any) { const box:any={held:{}}; box.held &&= holder; const alias=box.held; alias.item=input; holder.item.run(); }
class SafeParent { item=new Alpha(); readSafeParent() { this.item.run(); } }
function safeParent(holder:SafeParent,input:any) { const box:any={held:{item:input}}; box.held.child=holder; const alias=box.held; alias.item=input; holder.item.run(); }
class Direct { item=new Alpha(); readDirect() { this.item.run(); } }
function directWrite(holder:Direct,input:any) { const box:any={}; box.held=holder; box.held.item=input; holder.item.run(); }
class DirectArray { item=new Alpha(); readDirectArray() { this.item.run(); } }
function directArrayWrite(holder:DirectArray,input:any) { const box:any[]=[]; box[0]=holder; box[0].item=input; holder.item.run(); }
class Captured { item=new Alpha(); readCaptured() { this.item.run(); } }
function capturedWrite(holder:Captured,input:any) { const box:any={}; function fill() { box.held=holder; } fill(); const alias=box.held; alias.item=input; holder.item.run(); }
class SiblingSafe { item=new Alpha(); readSiblingSafe() { this.item.run(); } }
function siblingSafe(holder:SiblingSafe) { const box:any={}; box.held=holder; holder.item.run(); }
function siblingOther(input:any) { const box:any={held:{item:input}}; const alias=box.held; alias.item=input; }
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
  "readSafeKey",
  "safeKey",
  "readSafeScope",
  "safeScope",
  "readSafeCopy",
  "safeCopy",
  "readTyped",
  "typedWrite",
  "readSafeParent",
  "safeParent",
  "readSiblingSafe",
  "siblingSafe",
]);
const unsupported = new Set([
  "original",
  "replacement",
  "replace",
  "readArray",
  "arrayWrite",
  "readNested",
  "nestedWrite",
  "readDeep",
  "deepWrite",
  "readViaAlias",
  "viaAliasWrite",
  "readViaOriginal",
  "viaOriginalWrite",
  "readPattern",
  "patternWrite",
  "readArrayPattern",
  "arrayPatternWrite",
  "readLogical",
  "logicalWrite",
  "readDynamic",
  "dynamicWrite",
  "readSibling",
  "siblingWrite",
  "readDefault",
  "defaultWrite",
  "readChain",
  "chainWrite",
  "readQuoted",
  "quotedWrite",
  "readNullish",
  "nullishWrite",
  "readAnd",
  "andWrite",
  "readDirect",
  "directWrite",
  "readDirectArray",
  "directArrayWrite",
  "readCaptured",
  "capturedWrite",
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
  mkdtempSync("/tmp/bb-ts-destructured-runtime-"),
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
    "replacement",
    () =>
      runtime.replace(
        new runtime.Original(),
        new runtime.Replacement(),
        new runtime.Alpha(),
      ),
    ["Alpha", "Alpha"],
  ],
  [
    "array slot",
    () => runtime.arrayWrite(new runtime.ArrayHolder(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "nested replacement",
    () => runtime.nestedWrite(new runtime.Nested(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "deep write",
    () => runtime.deepWrite(new runtime.Deep(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "write through alias",
    () => runtime.viaAliasWrite(new runtime.ViaAlias(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "read through alias",
    () =>
      runtime.viaOriginalWrite(new runtime.ViaOriginal(), new runtime.Beta()),
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
    "logical assignment",
    () => runtime.logicalWrite(new runtime.Logical(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "dynamic key",
    () =>
      runtime.dynamicWrite(new runtime.Dynamic(), "held", new runtime.Beta()),
    ["Beta"],
  ],
  [
    "key control",
    () => runtime.safeKey(new runtime.SafeKey(), new runtime.Beta()),
    ["Alpha"],
  ],
  [
    "scope control",
    () => runtime.safeScope(new runtime.SafeScope(), new runtime.Beta()),
    ["Alpha"],
  ],
  [
    "rest-copy control",
    () => runtime.safeCopy(new runtime.SafeCopy(), new runtime.Beta()),
    ["Alpha"],
  ],
  [
    "sibling slot",
    () => runtime.siblingWrite(new runtime.Sibling(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "defaulted write",
    () => runtime.defaultWrite(new runtime.Default(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "alias cycle",
    () => runtime.chainWrite(new runtime.Chain(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "quoted write",
    () => runtime.quotedWrite(new runtime.Quoted(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "nullish write",
    () => runtime.nullishWrite(new runtime.Nullish(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "and write",
    () => runtime.andWrite(new runtime.And(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "parent identity control",
    () => runtime.safeParent(new runtime.SafeParent(), new runtime.Beta()),
    ["Alpha"],
  ],
  [
    "direct member write",
    () => runtime.directWrite(new runtime.Direct(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "direct element write",
    () =>
      runtime.directArrayWrite(new runtime.DirectArray(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "captured write",
    () => runtime.capturedWrite(new runtime.Captured(), new runtime.Beta()),
    ["Beta"],
  ],
  [
    "sibling scope control",
    () => {
      runtime.siblingOther(new runtime.Beta());
      runtime.siblingSafe(new runtime.SiblingSafe());
    },
    ["Alpha"],
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
const project = "ts-container-writes";
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
      file: "container-writes.ts",
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
  // Redirecting the container write restores Replacement's initializer evidence; then restore its origin.
  const edited = source.replace("box.held=b;", "box.held=a;");
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
      row.source === "replacement" ||
      (row.source === "replace" &&
        row.site ===
          expected.filter((edge) => edge.source === "replace")[1]!.site)
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
